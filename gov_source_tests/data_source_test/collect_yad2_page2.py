import os
import json
from pathlib import Path

import requests

KEY = os.environ["YAD2_RAPIDAPI_KEY"]
HOST = os.environ["YAD2_RAPIDAPI_HOST"]

BASE = f"https://{HOST}"

HEADERS = {
    "X-RapidAPI-Key": KEY,
    "X-RapidAPI-Host": HOST,
}

OUT = Path("yad2_petah_special")
OUT.mkdir(exist_ok=True)

SEARCHES = {
    "11_apt36_37_6r_premium_page2": {
        "deal": "forsale",
        "region": 1,
        "city": "7900",
        "property": "51,7,6",
        "roomsMin": 6,
        "roomsMax": 6,
        "sqmMin": 180,
        "sqmMax": 310,
        "priceMin": 0,
        "priceMax": 20000000,
        "floorMin": 0,
        "floorMax": 60,
        "page": 2,
    },

    "21_apt38_39_duplex_page2": {
        "deal": "forsale",
        "region": 1,
        "city": "7900",
        "property": "7",
        "roomsMin": 5,
        "roomsMax": 7,
        "sqmMin": 130,
        "sqmMax": 210,
        "priceMin": 0,
        "priceMax": 20000000,
        "floorMin": 0,
        "floorMax": 60,
        "page": 2,
    },
}

for name, params in SEARCHES.items():
    print("\n", name)

    r = requests.get(
        BASE + "/realestate-search",
        headers=HEADERS,
        params=params,
        timeout=30,
    )

    print("status:", r.status_code)

    data = r.json()

    if r.status_code != 200:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        continue

    path = OUT / f"{name}.json"

    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("saved:", path)

print("\nDONE")
