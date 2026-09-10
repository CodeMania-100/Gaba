import os
import sys
import json
import time
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8")

KEY = os.environ.get("YAD2_RAPIDAPI_KEY")
HOST = os.environ.get("YAD2_RAPIDAPI_HOST")

if not KEY or not HOST:
    raise SystemExit(
        "Missing YAD2_RAPIDAPI_KEY or YAD2_RAPIDAPI_HOST"
    )

BASE = f"https://{HOST}"

HEADERS = {
    "X-RapidAPI-Key": KEY,
    "X-RapidAPI-Host": HOST,
}

OUT = Path("yad2_petah_special")
OUT.mkdir(exist_ok=True)

CITY_ID = "7900"  # Petah Tikva


def request_json(path, params=None):
    url = BASE + path

    print("\n" + "=" * 100)
    print("GET", path)
    print("params:", json.dumps(params or {}, ensure_ascii=False))
    print("=" * 100)

    r = requests.get(
        url,
        headers=HEADERS,
        params=params,
        timeout=45,
    )

    print("status:", r.status_code)
    print("url:", r.url)

    try:
        data = r.json()
    except Exception:
        print(r.text[:5000])
        raise

    if r.status_code != 200:
        print(json.dumps(data, ensure_ascii=False, indent=2)[:5000])
        raise RuntimeError(
            f"{path} returned HTTP {r.status_code}"
        )

    return data


def save_json(name, data):
    path = OUT / f"{name}.json"

    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("saved:", path)
    return path


def walk_objects(obj):
    """Yield every dict recursively."""
    if isinstance(obj, dict):
        yield obj

        for value in obj.values():
            yield from walk_objects(value)

    elif isinstance(obj, list):
        for value in obj:
            yield from walk_objects(value)


def detect_center_region(data):
    """
    Avoid guessing RapidAPI's region id.

    Look for an object containing מרכז / center
    and then inspect likely id fields.
    """

    candidates = []

    for obj in walk_objects(data):
        combined = " ".join(
            str(v)
            for v in obj.values()
            if isinstance(v, (str, int, float))
        ).lower()

        if "מרכז" in combined or "center" in combined or "central" in combined:
            candidates.append(obj)

    print("\nPotential Center-region objects:")
    for item in candidates:
        print(json.dumps(item, ensure_ascii=False))

    likely_id_fields = (
        "region_id",
        "regionId",
        "id",
        "value",
        "region",
    )

    for item in candidates:
        for field in likely_id_fields:
            if field in item:
                value = item[field]

                try:
                    region_id = int(value)
                except (TypeError, ValueError):
                    continue

                if 1 <= region_id <= 8:
                    return region_id

    return None


def count_items(data):
    """
    Best-effort count for varying API response shapes.
    """
    if isinstance(data, list):
        return len(data)

    if not isinstance(data, dict):
        return None

    for key in ("data", "results", "items", "feed", "listings"):
        value = data.get(key)

        if isinstance(value, list):
            return len(value)

        if isinstance(value, dict):
            for subkey in (
                "items",
                "results",
                "feed",
                "listings",
                "data",
            ):
                subvalue = value.get(subkey)
                if isinstance(subvalue, list):
                    return len(subvalue)

    return None


def run_search(name, region, params):
    full_params = {
        "deal": "forsale",
        "region": region,
        "city": CITY_ID,

        # Override dangerous API defaults
        "priceMin": 0,
        "priceMax": 20_000_000,
        "floorMin": 0,
        "floorMax": 60,

        "page": 1,

        **params,
    }

    data = request_json(
        "/realestate-search",
        full_params,
    )

    save_json(name, data)

    count = count_items(data)
    print(f"{name}: estimated result count on page = {count}")

    return data


# ----------------------------------------------------------------------
# 1. Region discovery
# ----------------------------------------------------------------------

regions = request_json("/regions")
save_json("00_regions", regions)

region = detect_center_region(regions)

if region is None:
    print(
        "\nCould not safely determine Center-region id."
        "\nOpen yad2_petah_special/00_regions.json"
        "\nand tell me the id corresponding to מרכז."
    )
    raise SystemExit(2)

print("\nDetected Center region:", region)

time.sleep(0.5)


# ----------------------------------------------------------------------
# 2. Apartments 36/37
#
# Subject:
# 6R triplex
# ~255-260 m² internal
#
# Search Triplex + Duplex + Penthouse together.
#
# property codes:
# 51 = triplex
# 7  = duplex
# 6  = roof/penthouse
# ----------------------------------------------------------------------

special_36_37 = run_search(
    "10_apt36_37_6r_premium",
    region,
    {
        "property": "51,7,6",
        "roomsMin": 6,
        "roomsMax": 6,

        # Broaden enough to expose relevant premium products,
        # but stay in the same Petah Tikva market.
        "sqmMin": 180,
        "sqmMax": 310,
    },
)

time.sleep(0.5)


# ----------------------------------------------------------------------
# 3. Apartments 38/39
#
# Apt 38 = 7R duplex, 170.1 m²
# Apt 39 = 5R duplex, 158.6 m²
#
# One call, separate locally afterwards.
# ----------------------------------------------------------------------

special_38_39 = run_search(
    "20_apt38_39_duplex",
    region,
    {
        "property": "7",
        "roomsMin": 5,
        "roomsMax": 7,
        "sqmMin": 130,
        "sqmMax": 210,
    },
)

time.sleep(0.5)


# ----------------------------------------------------------------------
# 4. Garden apartments 1-3
#
# 1/2 = 3R garden units
# 3   = 2R garden unit
#
# property 3 = garden apartment
# ----------------------------------------------------------------------

garden_1_3 = run_search(
    "30_apt1_2_3_garden",
    region,
    {
        "property": "3",
        "roomsMin": 1.5,
        "roomsMax": 3,
        "sqmMin": 40,
        "sqmMax": 90,
    },
)


print("\n" + "=" * 100)
print("DONE")
print("=" * 100)
print("Output directory:", OUT.resolve())
print()
print("Files:")
for file in sorted(OUT.glob("*.json")):
    print(" -", file)
