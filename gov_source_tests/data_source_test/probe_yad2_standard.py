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

OUT = Path("yad2_standard_probe")
OUT.mkdir(exist_ok=True)

# --------------------------------------------------
# 1. Search options / taxonomy
# --------------------------------------------------

print("\nSEARCH OPTIONS")

r = requests.get(
    BASE + "/realestate-search-options",
    headers=HEADERS,
    timeout=30,
)

print("status:", r.status_code)

try:
    data = r.json()
except Exception:
    print(r.text[:3000])
    raise

(OUT / "search_options.json").write_text(
    json.dumps(data, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

print("saved:", OUT / "search_options.json")


# --------------------------------------------------
# 2. Minimal Petah Tikva standard-unit probes
# --------------------------------------------------

SEARCHES = {
    "petah_tikva_3r_page1": {
        "deal": "forsale",
        "region": 1,
        "city": "7900",
        "roomsMin": 3,
        "roomsMax": 3,
        "sqmMin": 58,
        "sqmMax": 80,
        "priceMin": 0,
        "priceMax": 10000000,
        "floorMin": 0,
        "floorMax": 60,
        "page": 1,
    },

    "petah_tikva_5r_page1": {
        "deal": "forsale",
        "region": 1,
        "city": "7900",
        "roomsMin": 5,
        "roomsMax": 5,
        "sqmMin": 94,
        "sqmMax": 128,
        "priceMin": 0,
        "priceMax": 15000000,
        "floorMin": 0,
        "floorMax": 60,
        "page": 1,
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
    print("request:", r.url)

    try:
        data = r.json()
    except Exception:
        print(r.text[:3000])
        continue

    if r.status_code != 200:
        print(json.dumps(data, ensure_ascii=False, indent=2)[:5000])
        continue

    path = OUT / f"{name}.json"
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("saved:", path)

    # Print only enough structure for us to understand the response.
    if isinstance(data, dict):
        print("top-level keys:", list(data.keys()))

        for key, value in data.items():
            if isinstance(value, list):
                print(f"{key}: list[{len(value)}]")
                if value:
                    first = value[0]
                    if isinstance(first, dict):
                        print("first record keys:", list(first.keys()))
                        print(
                            json.dumps(
                                first,
                                ensure_ascii=False,
                                indent=2,
                            )[:5000]
                        )
                break

print("\nDONE")
