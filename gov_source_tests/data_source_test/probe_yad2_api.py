import os
import json
import requests

KEY = os.environ.get("YAD2_RAPIDAPI_KEY")
HOST = os.environ.get("YAD2_RAPIDAPI_HOST")

if not KEY or not HOST:
    raise SystemExit(
        "Missing YAD2_RAPIDAPI_KEY or YAD2_RAPIDAPI_HOST environment variable"
    )

BASE = f"https://{HOST}"

HEADERS = {
    "X-RapidAPI-Key": KEY,
    "X-RapidAPI-Host": HOST,
}

ENDPOINTS = [
    "/regions",
    "/cities",
    "/locations-autocomplete",
    "/realestate-search-options",
    "/latest-deals",
    "/realestate-yad1-projects",
]

def probe(path):
    print("\n" + "=" * 90)
    print(path)
    print("=" * 90)

    try:
        r = requests.get(
            BASE + path,
            headers=HEADERS,
            timeout=30,
        )

        print("status:", r.status_code)
        print("url:", r.url)

        try:
            data = r.json()
            print(json.dumps(data, ensure_ascii=False, indent=2)[:12000])
        except Exception:
            print(r.text[:12000])

    except Exception as e:
        print("ERROR:", repr(e))


for endpoint in ENDPOINTS:
    probe(endpoint)
