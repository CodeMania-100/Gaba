import os
import json
import time
from pathlib import Path

import requests

KEY = os.environ["YAD2_RAPIDAPI_KEY"]
HOST = os.environ["YAD2_RAPIDAPI_HOST"]

HEADERS = {
    "X-RapidAPI-Key": KEY,
    "X-RapidAPI-Host": HOST,
}

BASE = f"https://{HOST}"
OUT = Path("yad2_petah_special/details")
OUT.mkdir(parents=True, exist_ok=True)

TOKENS = {
    "apt3_2r_garden": "81py2t5u",

    "apt36_37_256_duplex": "7a8ynci1",
    "apt36_37_220_premium": "9bsyydsn",
    "apt36_37_220_duplex": "tkgbr5hx",

    "apt39_160_duplex": "au7ykbzg",
    "apt38_145_7r_duplex": "5i4tr2xo",
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

    time.sleep(0.3)

print("\nDONE")
