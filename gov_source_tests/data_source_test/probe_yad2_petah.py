import os
import json
import requests

KEY = os.environ["YAD2_RAPIDAPI_KEY"]
HOST = os.environ["YAD2_RAPIDAPI_HOST"]

BASE = f"https://{HOST}"
HEADERS = {
    "X-RapidAPI-Key": KEY,
    "X-RapidAPI-Host": HOST,
}

tests = [
    # Autocomplete: discover correct free-text parameter
    ("autocomplete_query",
     "/locations-autocomplete",
     {"query": "פתח תקווה"}),

    ("autocomplete_q",
     "/locations-autocomplete",
     {"q": "פתח תקווה"}),

    # Current resale listings — Yad2 uses city 7900 for Petah Tikva
    ("search_petah",
     "/realestate-search",
     {"city": "7900"}),

    # Direct special-property tests
    ("search_triplex",
     "/realestate-search",
     {
         "city": "7900",
         "property": "51",
     }),

    ("search_duplex_6r",
     "/realestate-search",
     {
         "city": "7900",
         "property": "7",
         "minRooms": "6",
         "maxRooms": "6",
     }),

    # New developments
    ("yad1_city",
     "/realestate-yad1-projects",
     {"city": "7900"}),

    ("yad1_area_city",
     "/realestate-yad1-projects",
     {
         "area": "4",
         "city": "7900",
     }),

    # See whether latest-deals accepts city filtering
    ("latest_deals_petah",
     "/latest-deals",
     {"city": "7900"}),
]

for name, path, params in tests:
    print("\n" + "=" * 100)
    print(name)
    print(path, params)
    print("=" * 100)

    try:
        r = requests.get(
            BASE + path,
            headers=HEADERS,
            params=params,
            timeout=30,
        )

        print("status:", r.status_code)
        print("url:", r.url)

        try:
            data = r.json()
            print(json.dumps(
                data,
                ensure_ascii=False,
                indent=2
            )[:16000])
        except Exception:
            print(r.text[:16000])

    except Exception as exc:
        print("ERROR:", repr(exc))
