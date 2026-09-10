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

OUT = Path("yad2_petah_special/nearby_deals")
OUT.mkdir(parents=True, exist_ok=True)

ANCHORS = [
    ("apt3_garden", "81py2t5u"),
    ("apt39_duplex", "au7ykbzg"),
    ("apt36_37_context", "tkgbr5hx"),
]


def call(name, token):
    print("\n" + "=" * 100)
    print(name, token)
    print("=" * 100)

    r = requests.get(
        BASE + "/realestate-nearby-deals",
        headers=HEADERS,
        params={"token": token},
        timeout=45,
    )

    print("status:", r.status_code)
    print("url:", r.url)

    try:
        data = r.json()
    except Exception:
        print(r.text[:5000])
        return r.status_code, None

    print(
        json.dumps(
            data,
            ensure_ascii=False,
            indent=2
        )[:6000]
    )

    if r.status_code == 200:
        path = OUT / f"{name}.json"
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print("saved:", path)

    return r.status_code, data


# First call = parameter validation
status, data = call(*ANCHORS[0])

if status != 200:
    print("\nSTOPPED.")
    print("The endpoint did not accept token=<listing token>.")
    print("Do not make additional requests.")
    raise SystemExit(1)

print("\nToken parameter confirmed. Collecting remaining anchors...")

for anchor in ANCHORS[1:]:
    call(*anchor)

print("\nDONE")
