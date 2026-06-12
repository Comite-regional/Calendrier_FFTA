"""
Récupère les épreuves FFTA via l'API extranet et génère concours26.csv.
Variables d'environnement :
  FFTA_SESSION_IDENTITE  — identifiant de session FFTA (obligatoire)
  FFTA_REGION            — code ligue à filtrer (défaut : CR12)
  FFTA_SAISON            — année saison (défaut : année en cours)
  FFTA_ENV               — "prod" ou "pprod" (défaut : prod)
  OUTPUT_CSV             — nom du fichier de sortie (défaut : concours26.csv)
"""

import os
import csv
import re
import datetime
import requests
from zoneinfo import ZoneInfo

# ── Config ────────────────────────────────────────────────────────────────────

SESSION_IDENTITE = os.environ["FFTA_SESSION_IDENTITE"]
REGION_CODE      = os.environ.get("FFTA_REGION", "CR12")
FFTA_ENV         = os.environ.get("FFTA_ENV", "prod")
SAISON           = os.environ.get("FFTA_SAISON", str(datetime.date.today().year))
OUTPUT_CSV       = os.environ.get("OUTPUT_CSV", "concours26.csv")

HOST   = "pprod-extranet.ffta.fr" if FFTA_ENV == "pprod" else "extranet.ffta.fr"
BASE   = f"https://{HOST}"
PARIS  = ZoneInfo("Europe/Paris")

HEADERS = {
    "accept": "application/json, */*;q=0.1",
    "accept-language": "fr-FR,fr;q=0.9",
    "user-agent": "Mozilla/5.0",
    "origin": "https://extranet.ffta.fr",
    "referer": "https://extranet.ffta.fr/",
}

# ── Utilitaires ───────────────────────────────────────────────────────────────

def paris_ts(dt: datetime.datetime) -> str:
    return dt.astimezone(PARIS).strftime("%Y%m%d%H%M")

def get_server_offset() -> datetime.timedelta:
    try:
        r = requests.head(BASE, timeout=5, headers=HEADERS)
        dh = r.headers.get("date") or r.headers.get("Date")
        if dh:
            s = datetime.datetime.strptime(dh, "%a, %d %b %Y %H:%M:%S %Z").replace(
                tzinfo=datetime.timezone.utc)
            return s - datetime.datetime.now(datetime.timezone.utc)
    except Exception:
        pass
    return datetime.timedelta(0)

def http_get(url: str) -> dict | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=20)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None

def http_post(url: str, body: dict) -> dict | None:
    try:
        r = requests.post(url, json=body,
                          headers={**HEADERS, "Content-Type": "application/json"},
                          timeout=20)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None

def qs(**params) -> str:
    return "&".join(f"{k}={requests.utils.quote(str(v))}" for k, v in params.items())

# ── Authentification ──────────────────────────────────────────────────────────

def get_token() -> str:
    offset  = get_server_offset()
    base_dt = datetime.datetime.now(datetime.timezone.utc) + offset

    get_paths  = ["/ws/rest/Parametres/GetToken", "/ws/rest/ApplicationTierce/GetToken",
                  "/ws/Parametres/GetToken", "/ws/ApplicationTierce/GetToken"]
    post_paths = ["/ws/Parametres.svc/GetToken", "/ws/ApplicationTierce.svc/GetToken"]

    for delta in [0, 1, 2, -1, -2]:
        pw = paris_ts(base_dt + datetime.timedelta(minutes=delta))
        q  = qs(sessionIdentite=SESSION_IDENTITE, password=pw, format="json")

        for path in get_paths:
            data = http_get(f"{BASE}{path}?{q}")
            tok  = _extract_token(data)
            if tok:
                print(f"Token obtenu via GET {path}")
                return tok

        body = {"sessionIdentite": SESSION_IDENTITE, "password": pw}
        for path in post_paths:
            data = http_post(f"{BASE}{path}", body)
            tok  = _extract_token(data)
            if tok:
                print(f"Token obtenu via POST {path}")
                return tok

    raise RuntimeError("Impossible d'obtenir un token FFTA.")

def _extract_token(data) -> str:
    if not data:
        return ""
    resp = data.get("Response", data)
    return (resp.get("Token") or resp.get("token") or
            data.get("Token") or data.get("token") or "")

# ── Récupération paginée des épreuves ────────────────────────────────────────

def get_all_epreuves(token: str) -> list[dict]:
    today    = datetime.date.today().strftime("%d/%m/%Y")
    date_fin = datetime.date(int(SAISON), 12, 31).strftime("%d/%m/%Y")
    nb       = 200
    page     = 1
    all_rows = []

    while True:
        params = dict(token=token, format="json",
                      DateDebut=today, DateFin=date_fin,
                      Page=str(page), NbResultats=str(nb))
        url  = f"{BASE}/ws/rest/Calendrier/GetEpreuves?{qs(**params)}"
        data = http_get(url)

        if not data:
            print(f"Page {page} : aucune réponse.")
            break

        resp  = data.get("Response", data)
        items = resp.get("tEpreuves") or []

        if not items:
            break

        all_rows.extend(items)
        print(f"Page {page} : {len(items)} épreuves (total {len(all_rows)})")

        derniere = resp.get("DernierePage", page)
        if page >= int(derniere):
            break
        page += 1

    return all_rows

# ── Normalisation champ département ──────────────────────────────────────────

def normalize_dept(raw: str) -> str:
    """"44000" → "44", "01000" → "01", DOM 971xx → "971" """
    s = str(raw or "").strip()
    m = re.match(r"^(\d{2,3})0+$", s)
    if m:
        return m.group(1)
    m2 = re.match(r"^(\d{2,3})", s)
    if m2:
        return m2.group(1)
    return s

# ── Mapping épreuve → ligne CSV ───────────────────────────────────────────────

def epreuve_to_row(e: dict) -> dict:
    def iso_to_fr(s):
        s = str(s or "").strip()
        if re.match(r"^\d{4}-\d{2}-\d{2}", s):
            y, m, d = s[:10].split("-")
            return f"{d}/{m}/{y}"
        return s

    def gps(val):
        v = str(val or "").strip()
        return "" if v in ("0", "0.0", "") else v

    deb  = iso_to_fr(e.get("EprvDateDebut"))
    fin  = iso_to_fr(e.get("EprvDateFin"))

    bat  = str(e.get("AdresseBatiment") or "").strip()
    voie = " ".join(filter(None, [
        str(e.get("AdresseNumVoie") or ""),
        str(e.get("AdresseTypeVoie") or ""),
        str(e.get("AdresseNomVoie") or ""),
    ])).strip()
    lieu = bat if bat else voie

    # Mandat : premier document
    mandat = ""
    docs = e.get("Documents") or []
    if isinstance(docs, list) and docs:
        url = str(docs[0].get("DocUrl") or "").strip()
        if url:
            mandat = url if url.startswith("http") else f"https://www.ffta.fr{url}"

    type_map = {"I": "individuel", "E": "par équipe", "U": "uniquement équipe"}
    etype = type_map.get(str(e.get("EprvType") or ""), str(e.get("EprvType") or ""))

    return {
        "Date debut":         deb,
        "Date fin":           fin,
        "Titre compétition":  str(e.get("EprvNom") or "").strip(),
        "Ville":              str(e.get("EprvLieu") or "").strip(),
        "Code structure":     str(e.get("StructureCode") or e.get("StructureId") or "").strip(),
        "Club organisateur":  str(e.get("StructureNom") or "").strip(),
        "Code region":        str(e.get("LigueCode") or "").strip(),
        "Departement":        normalize_dept(e.get("DepartementCode")),
        "Discipline":         str(e.get("DisciplineCode") or "").strip(),
        "Type":               etype,
        "Saison":             str(e.get("SaisonAnnee") or SAISON),
        "Mail":               str(e.get("ContactsAdresseMail") or "").strip(),
        "Site web":           str(e.get("ContactsAdrWeb") or "").strip(),
        "Lieu":               lieu,
        "Adresse":            voie,
        "CP":                 str(e.get("AdresseCodePostal") or "").strip(),
        "Ville compétition":  str(e.get("AdresseCommune") or "").strip(),
        "Long":               gps(e.get("AdresseLongitude")),
        "Lat":                gps(e.get("AdresseLatitude")),
        "Mandat":             mandat,
        "Etat":               str(e.get("EprvEtat") or "").strip(),
        "EprvId":             str(e.get("EprvId") or "").strip(),
    }

# ── Point d'entrée ────────────────────────────────────────────────────────────

FIELDNAMES = [
    "Date debut", "Date fin", "Titre compétition", "Ville",
    "Code structure", "Club organisateur", "Code region", "Departement",
    "Discipline", "Type", "Saison",
    "Mail", "Site web", "Lieu", "Adresse", "CP", "Ville compétition",
    "Long", "Lat", "Mandat", "Etat", "EprvId",
]

def main():
    print(f"Récupération épreuves FFTA — filtre {REGION_CODE}, saison {SAISON}")

    token    = get_token()
    epreuves = get_all_epreuves(token)
    print(f"\nTotal récupéré : {len(epreuves)} épreuves (toute France)")

    # Filtre région côté client sur LigueCode
    filtered = [e for e in epreuves if str(e.get("LigueCode") or "") == REGION_CODE]
    print(f"Après filtre {REGION_CODE} : {len(filtered)} épreuves")

    # Exclure les annulées
    filtered = [e for e in filtered if str(e.get("EprvEtatCode") or "") != "X"]
    print(f"Après exclusion annulées : {len(filtered)} épreuves")

    if not filtered:
        raise RuntimeError(f"Aucune épreuve trouvée pour {REGION_CODE}.")

    rows = [epreuve_to_row(e) for e in filtered]
    rows.sort(key=lambda r: r["Date debut"])

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES, delimiter=";", extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n✅ {len(rows)} épreuves écrites dans {OUTPUT_CSV}")

if __name__ == "__main__":
    main()
