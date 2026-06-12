"""
Script de debug : affiche la réponse brute de l'API FFTA (GetEpreuves + GetToken).
Lance via GitHub Actions (workflow_dispatch) pour inspecter les champs disponibles.
"""

import os
import json
import datetime
import requests
from zoneinfo import ZoneInfo

SESSION_IDENTITE = os.environ["FFTA_SESSION_IDENTITE"]
PARIS = ZoneInfo("Europe/Paris")
HOST = "extranet.ffta.fr"
BASE = f"https://{HOST}"

HEADERS = {
    "accept": "application/json, */*;q=0.1",
    "accept-language": "fr-FR,fr;q=0.9",
    "user-agent": "Mozilla/5.0",
    "origin": "https://extranet.ffta.fr",
    "referer": "https://extranet.ffta.fr/",
}


def paris_ts(dt):
    p = dt.astimezone(PARIS)
    return p.strftime("%Y%m%d%H%M")


def get_server_offset():
    try:
        r = requests.head(BASE, timeout=5, headers=HEADERS)
        dh = r.headers.get("date") or r.headers.get("Date")
        if dh:
            s = datetime.datetime.strptime(dh, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=datetime.timezone.utc)
            return s - datetime.datetime.now(datetime.timezone.utc)
    except Exception as e:
        print(f"[offset] erreur : {e}")
    return datetime.timedelta(0)


def try_get(url):
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        print(f"  GET {url[:90]} → {r.status_code}")
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print(f"  GET {url[:90]} → exception : {e}")
    return None


def try_post(url, body):
    try:
        r = requests.post(url, json=body, headers={**HEADERS, "Content-Type": "application/json"}, timeout=15)
        print(f"  POST {url[:90]} → {r.status_code}")
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print(f"  POST {url[:90]} → exception : {e}")
    return None


# ── Token ──────────────────────────────────────────────────────────────────────

print("=" * 60)
print("ÉTAPE 1 — Décalage serveur FFTA")
offset = get_server_offset()
print(f"  offset = {offset}")

base_dt = datetime.datetime.now(datetime.timezone.utc) + offset

print("\nÉTAPE 2 — Obtention du token")
token = None

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

for delta in [0, 1, 2, -1, -2]:
    if token:
        break
    dt = base_dt + datetime.timedelta(minutes=delta)
    pw = paris_ts(dt)
    print(f"\n  Tentative offset +{delta} min, password={pw}")
    qs = f"sessionIdentite={requests.utils.quote(SESSION_IDENTITE)}&password={pw}&format=json"

    for path in get_paths:
        if token:
            break
        data = try_get(f"{BASE}{path}?{qs}")
        if data:
            resp = data.get("Response", data)
            tok = resp.get("Token") or resp.get("token") or data.get("Token") or data.get("token")
            if tok:
                token = tok
                print(f"  ✅ Token obtenu via GET {path}")
                break

    if not token:
        body = {"sessionIdentite": SESSION_IDENTITE, "password": pw}
        for path in post_paths:
            if token:
                break
            data = try_post(f"{BASE}{path}", body)
            if data:
                resp = data.get("Response", data)
                tok = resp.get("Token") or resp.get("token") or data.get("Token") or data.get("token")
                if tok:
                    token = tok
                    print(f"  ✅ Token obtenu via POST {path}")
                    break

if not token:
    print("\n❌ Impossible d'obtenir un token. Vérifie SESSION_IDENTITE.")
    exit(1)

print(f"\nToken : {token[:20]}…")

# ── GetEpreuves brut ───────────────────────────────────────────────────────────

print("\n" + "=" * 60)
print("ÉTAPE 3 — GetEpreuves (région CR12, brut)")

today = datetime.date.today().strftime("%d/%m/%Y")
end   = datetime.date(datetime.date.today().year, 12, 31).strftime("%d/%m/%Y")

epreuves_paths = [
    "/ws/rest/Calendrier/GetEpreuves",
    "/ws/Calendrier/GetEpreuves",
    "/ws/Calendrier.svc/json/GetEpreuves",
]

params = {
    "token": token,
    "format": "json",
    "RegionCode": "CR12",
    "DateDebut": today,
    "DateFin": end,
    "Page": "1",
    "NbResultats": "5",  # on limite à 5 pour le debug
}

raw = None
for path in epreuves_paths:
    qs = "&".join(f"{k}={requests.utils.quote(str(v))}" for k, v in params.items())
    raw = try_get(f"{BASE}{path}?{qs}")
    if raw:
        print(f"  ✅ GetEpreuves OK via {path}")
        break

if not raw:
    print("\n⚠️  GetEpreuves a échoué. Essai sans filtre région...")
    params_no_region = {k: v for k, v in params.items() if k != "RegionCode"}
    for path in epreuves_paths:
        qs = "&".join(f"{k}={requests.utils.quote(str(v))}" for k, v in params_no_region.items())
        raw = try_get(f"{BASE}{path}?{qs}")
        if raw:
            print(f"  ✅ GetEpreuves (sans région) OK via {path}")
            break

print("\n" + "=" * 60)
print("RÉPONSE BRUTE (structure + 2 premières épreuves) :")
print("=" * 60)

if raw:
    # Affiche les clés de premier niveau
    print(f"\nClés de premier niveau : {list(raw.keys())}")

    resp = raw.get("Response", raw)
    print(f"Clés dans Response : {list(resp.keys()) if isinstance(resp, dict) else type(resp)}")

    # Cherche le tableau d'épreuves
    items = None
    for key in ("EpreuveArray", "Epreuve", "epreuves", "items", "data"):
        val = resp.get(key) if isinstance(resp, dict) else None
        if isinstance(val, list) and val:
            items = val
            print(f"\nTableau trouvé sous clé '{key}' : {len(val)} éléments")
            break

    if items is None and isinstance(resp, list):
        items = resp
        print(f"\nRéponse directement un tableau : {len(items)} éléments")

    if items is None and isinstance(resp, dict):
        keys = list(resp.keys())
        if keys and all(k.isdigit() for k in keys):
            items = [resp[k] for k in sorted(keys, key=int)]
            print(f"\nObjet indexé numériquement → {len(items)} épreuves")

    if items:
        print(f"\n── Champs de la 1ère épreuve ──")
        print(json.dumps(items[0], indent=2, ensure_ascii=False))
        if len(items) > 1:
            print(f"\n── Champs de la 2ème épreuve ──")
            print(json.dumps(items[1], indent=2, ensure_ascii=False))
    else:
        print("\n⚠️  Aucun tableau d'épreuves trouvé. Réponse complète :")
        print(json.dumps(raw, indent=2, ensure_ascii=False))
else:
    print("❌ Aucune réponse valide de GetEpreuves.")
