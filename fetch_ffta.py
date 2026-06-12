"""
Récupère les épreuves FFTA via l'API extranet et génère concours26.csv.
Variables d'environnement requises :
  FFTA_SESSION_IDENTITE  — identifiant de session FFTA
Optionnelles :
  FFTA_REGION            — code région (défaut : CR12)
  FFTA_SAISON            — année saison (défaut : année en cours)
  FFTA_ENV               — "prod" ou "pprod" (défaut : prod)
"""

import os
import csv
import json
import time
import datetime
import requests
from zoneinfo import ZoneInfo

# ── Configuration ────────────────────────────────────────────────────────────

SESSION_IDENTITE = os.environ["FFTA_SESSION_IDENTITE"]
REGION_CODE      = os.environ.get("FFTA_REGION", "CR12")
FFTA_ENV         = os.environ.get("FFTA_ENV", "prod")
SAISON           = os.environ.get("FFTA_SAISON", str(datetime.date.today().year))
OUTPUT_CSV       = os.environ.get("OUTPUT_CSV", "concours26.csv")

HOST = "pprod-extranet.ffta.fr" if FFTA_ENV == "pprod" else "extranet.ffta.fr"
BASE_HTTPS = f"https://{HOST}"
BASE_HTTP  = f"http://{HOST}"

HEADERS = {
    "accept": "application/json, */*;q=0.1",
    "accept-language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "user-agent": "Mozilla/5.0",
    "origin": "https://extranet.ffta.fr",
    "referer": "https://extranet.ffta.fr/",
}

PARIS = ZoneInfo("Europe/Paris")

# ── Utilitaires ───────────────────────────────────────────────────────────────

def paris_timestamp(dt: datetime.datetime) -> str:
    """Retourne YYYYMMDDHHmm en heure de Paris."""
    p = dt.astimezone(PARIS)
    return p.strftime("%Y%m%d%H%M")


def get_server_offset() -> datetime.timedelta:
    """Calcule le décalage entre l'horloge locale et le serveur FFTA."""
    for base in (BASE_HTTPS, BASE_HTTP):
        try:
            r = requests.head(base, timeout=5, headers=HEADERS)
            date_header = r.headers.get("date") or r.headers.get("Date")
            if date_header:
                server_dt = datetime.datetime.strptime(
                    date_header, "%a, %d %b %Y %H:%M:%S %Z"
                ).replace(tzinfo=datetime.timezone.utc)
                return server_dt - datetime.datetime.now(datetime.timezone.utc)
        except Exception:
            pass
    return datetime.timedelta(0)


def http_get(url: str) -> dict | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


def http_post(url: str, body: dict) -> dict | None:
    try:
        r = requests.post(url, json=body, headers={**HEADERS, "Content-Type": "application/json"}, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


# ── Authentification ──────────────────────────────────────────────────────────

def get_token() -> str:
    offset = get_server_offset()
    base_dt = datetime.datetime.now(datetime.timezone.utc) + offset

    get_paths = [
        "/ws/rest/Parametres/GetToken",
        "/ws/rest/ApplicationTierce/GetToken",
        "/ws/Parametres/GetToken",
        "/ws/ApplicationTierce/GetToken",
    ]
    post_paths = [
        "/ws/Parametres.svc/GetToken",
        "/ws/ApplicationTierce.svc/GetToken",
    ]

    for minute_delta in [0, 1, 2, -1, -2]:
        dt = base_dt + datetime.timedelta(minutes=minute_delta)
        pw = paris_timestamp(dt)
        qs = f"sessionIdentite={requests.utils.quote(SESSION_IDENTITE)}&password={pw}&format=json"

        for path in get_paths:
            for base in (BASE_HTTPS, BASE_HTTP):
                data = http_get(f"{base}{path}?{qs}")
                tok = _extract_token(data)
                if tok:
                    print(f"Token obtenu via GET {path}")
                    return tok

        body = {"sessionIdentite": SESSION_IDENTITE, "password": pw}
        for path in post_paths:
            for base in (BASE_HTTPS, BASE_HTTP):
                data = http_post(f"{base}{path}", body)
                tok = _extract_token(data)
                if tok:
                    print(f"Token obtenu via POST {path}")
                    return tok

    raise RuntimeError("Impossible d'obtenir un token FFTA après toutes les tentatives.")


def _extract_token(data: dict | None) -> str:
    if not data:
        return ""
    resp = data.get("Response", data)
    return resp.get("Token") or resp.get("token") or data.get("Token") or data.get("token") or ""


# ── Appel GetEpreuves ─────────────────────────────────────────────────────────

def get_epreuves(token: str, region: str, saison: str) -> list[dict]:
    today = datetime.date.today().strftime("%d/%m/%Y")
    end   = datetime.date(int(saison), 12, 31).strftime("%d/%m/%Y")

    params = {
        "token": token,
        "format": "json",
        "RegionCode": region,
        "DateDebut": today,
        "DateFin": end,
        "Page": "1",
        "NbResultats": "500",
    }

    paths = [
        "/ws/rest/Calendrier/GetEpreuves",
        "/ws/Calendrier/GetEpreuves",
        "/ws/Calendrier.svc/json/GetEpreuves",
    ]

    for path in paths:
        for base in (BASE_HTTPS, BASE_HTTP):
            url = f"{base}{path}"
            data = http_get(url + "?" + "&".join(f"{k}={requests.utils.quote(str(v))}" for k, v in params.items()))
            rows = _extract_epreuves(data)
            if rows is not None:
                print(f"GetEpreuves OK : {len(rows)} épreuves via {path}")
                return rows

    raise RuntimeError("GetEpreuves a échoué sur toutes les URLs connues.")


def _extract_epreuves(data: dict | None) -> list[dict] | None:
    if not data:
        return None
    resp = data.get("Response", data)

    # L'API peut retourner un tableau directement ou sous une clé
    for key in ("EpreuveArray", "Epreuve", "epreuves", "items", "data"):
        val = resp.get(key)
        if isinstance(val, list) and val:
            return val

    # Objet indexé numériquement {"1": {...}, "2": {...}}
    keys = list(resp.keys())
    if keys and all(k.isdigit() for k in keys):
        return [resp[k] for k in sorted(keys, key=int)]

    # Tableau direct
    if isinstance(resp, list):
        return resp

    return None


# ── Normalisation → CSV ───────────────────────────────────────────────────────

def _s(*fields, src: dict, default="") -> str:
    for f in fields:
        v = src.get(f)
        if v is not None and str(v).strip():
            return str(v).strip()
    return default


def normalize_date(raw: str) -> str:
    """Tente de retourner DD/MM/YYYY depuis plusieurs formats."""
    raw = str(raw or "").strip()
    if not raw:
        return ""
    # Déjà DD/MM/YYYY
    if len(raw) == 10 and raw[2] == "/" and raw[5] == "/":
        return raw
    # ISO YYYY-MM-DD
    if len(raw) >= 10 and raw[4] == "-" and raw[7] == "-":
        y, m, d = raw[:10].split("-")
        return f"{d}/{m}/{y}"
    # Timestamp YYYYMMDD...
    if len(raw) >= 8 and raw[:8].isdigit():
        return f"{raw[6:8]}/{raw[4:6]}/{raw[:4]}"
    return raw


def epreuve_to_row(e: dict) -> dict:
    title  = _s("EprvLibelle", "Libelle", "NomEpreuve", "Titre", "libelle", src=e)
    deb    = normalize_date(_s("EprvDateDebut", "DateDebut", "date_debut", "DateDeb", src=e))
    fin    = normalize_date(_s("EprvDateFin", "DateFin", "date_fin", "DateFin", src=e))
    ville  = _s("EprvVille", "Ville", "VilleEpreuve", "commune", src=e)
    cp     = _s("EprvCP", "CodePostal", "CP", "cp", src=e)
    lieu   = _s("EprvLieuTir", "LieuTir", "Lieu", "lieu", src=e)
    adresse= _s("EprvAdresse", "Adresse", "adresse", src=e)

    code_struct = _s("StructureId", "CodeStructure", "EprvStructureId", "code_structure", src=e)
    club        = _s("StructureNom", "StructureNomCourt", "Club", "club", "NomClub", src=e)
    region      = _s("RegionCode", "CodeRegion", "LigueCode", "region_code", src=e) or REGION_CODE
    dept        = _s("DepartementCode", "CodeDepartement", "dept", "departement", src=e)

    discipline  = _s("DisciplineLibelle", "Discipline", "disc", "discipline_libelle", src=e)
    type_eprv   = _s("EprvType", "Type", "TypeEpreuve", "type", src=e)

    lat         = _s("EprvLatitude", "Latitude", "lat", src=e)
    lon         = _s("EprvLongitude", "Longitude", "long", "lon", src=e)

    mandat_raw  = _s("EprvMandatUrl", "MandatUrl", "Mandat", "mandat", src=e)
    mandat      = mandat_raw if mandat_raw.startswith("http") else (
                  f"https://www.ffta.fr{mandat_raw}" if mandat_raw else "")

    mail        = _s("ContactEmail", "Email", "Mail", "mail", src=e)
    site        = _s("EprvSiteWeb", "SiteWeb", "Site", "site", src=e)

    return {
        "Date debut":          deb,
        "Date fin":            fin,
        "Titre compétition":   title,
        "Ville":               ville,
        "Code structure":      code_struct,
        "Club organisateur":   club,
        "Code region":         region,
        "Departement":         dept,
        "Discipline":          discipline,
        "Type":                type_eprv,
        "Saison":              saison,
        "Mail":                mail,
        "Site web":            site,
        "Lieu":                lieu,
        "Adresse":             adresse,
        "CP":                  cp,
        "Ville compétition":   ville,
        "Long":                lon,
        "Lat":                 lat,
        "Mandat":              mandat,
    }


# ── Point d'entrée ────────────────────────────────────────────────────────────

def main():
    print(f"Récupération des épreuves FFTA — région {REGION_CODE}, saison {SAISON}")

    token    = get_token()
    epreuves = get_epreuves(token, REGION_CODE, SAISON)

    if not epreuves:
        raise RuntimeError("Aucune épreuve retournée par l'API FFTA.")

    rows = [epreuve_to_row(e) for e in epreuves]
    rows.sort(key=lambda r: r["Date debut"])

    fieldnames = [
        "Date debut", "Date fin", "Titre compétition", "Ville",
        "Code structure", "Club organisateur", "Code region", "Departement",
        "Discipline", "Type", "Saison",
        "Mail", "Site web", "Lieu", "Adresse", "CP", "Ville compétition",
        "Long", "Lat", "Mandat",
    ]

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=";", extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    print(f"✅ {len(rows)} épreuves écrites dans {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
