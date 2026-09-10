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

OUT = Path("yad2_petah_special/details")
OUT.mkdir(parents=True, exist_ok=True)

TOKENS = {
    # 3R garden evidence for Apts 1/2
    "garden_3r_85": "kihl5wee",
    "garden_3r_76": "am2daomo",
    "garden_3r_74": "0xkpq9l7",

    # Closest total-scale broadened products for 36/37
    "apt36_37_255_adv_duplex": "ub2tzaqh",
    "apt36_37_285_adv_duplex": "wbvl4w9m",
}

for name, token in TOKENS.items():
    print(f"\n{name}: {token}")

    r = requests.get(
        BASE + "/realestate-details",
        headers=HEADERS,
        params={"token": token},
        timeout=30,
    )

    print("status:", r.status_code)

    try:
        data = r.json()
    except Exception:
        print(r.text[:2000])
        continue

    if r.status_code != 200:
        print(json.dumps(data, ensure_ascii=False, indent=2)[:2000])
        continue

    path = OUT / f"{name}.json"

    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("saved:", path)

print("\nDONE")
