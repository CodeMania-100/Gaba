import os
import json
import time
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

TARGET_NEIGHBORHOOD = "המרכז השקט / מרכז העיר"

PARAMS = {
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
}

BUCKETS = ["private", "agency", "platinum", "booster"]


def norm(v):
    if v is None:
        return ""
    return " ".join(str(v).strip().split())


def is_new_contractor(r):
    packages = r.get("packages") or {}
    if packages.get("isNewFromContractor") is True:
        return True

    tags = {
        norm(t.get("name"))
        for t in (r.get("tags") or [])
        if isinstance(t, dict)
    }

    return "חדש מקבלן" in tags


def extract(r, bucket, page):
    addr = r.get("address") or {}
    details = r.get("additionalDetails") or {}
    house = addr.get("house") or {}
    coords = addr.get("coords") or {}
    prop = details.get("property") or {}
    customer = r.get("customer") or {}

    neighborhood = norm(
        (addr.get("neighborhood") or {}).get("text")
    )

    street = norm(
        (addr.get("street") or {}).get("text")
    )

    return {
        "page": page,
        "bucket": bucket,
        "token": r.get("token"),
        "orderId": r.get("orderId"),
        "neighborhood": neighborhood,
        "street": street,
        "house": house.get("number"),
        "floor": house.get("floor"),
        "lat": coords.get("lat"),
        "lon": coords.get("lon"),
        "property": prop.get("text"),
        "rooms": details.get("roomsCount"),
        "sqm": details.get("squareMeter"),
        "price": r.get("price"),
        "agency": customer.get("agencyName"),
        "isNewFromContractor": (
            (r.get("packages") or {}).get("isNewFromContractor")
        ),
        "tags": [
            t.get("name")
            for t in (r.get("tags") or [])
            if isinstance(t, dict)
        ],
    }


def project_key(x):
    """
    Conservative likely-project grouping.

    Same street + house + nearly identical coordinates -> same project.
    If house is missing, coordinates distinguish projects.
    """

    street = norm(x["street"]).lower()
    house = str(x["house"] or "")

    lat = x.get("lat")
    lon = x.get("lon")

    if lat is not None and lon is not None:
        # ~10m-ish coordinate precision, enough to collapse repeated ads
        coord = f"{float(lat):.4f},{float(lon):.4f}"
    else:
        coord = ""

    return f"{street}|{house}|{coord}"


def process_page(data, page, seen_ads, accepted):
    root = data.get("data") or {}

    for bucket in BUCKETS:
        for r in root.get(bucket, []) or []:

            # Same Yad2 ad can appear in agency/platinum/booster.
            ad_key = r.get("token") or r.get("orderId")
            if not ad_key:
                continue

            if ad_key in seen_ads:
                continue

            seen_ads.add(ad_key)

            if not is_new_contractor(r):
                continue

            x = extract(r, bucket, page)

            if x["neighborhood"] != TARGET_NEIGHBORHOOD:
                continue

            # Search already asks for this, but verify instead of trusting filter.
            if x["rooms"] != 3:
                continue

            if x["sqm"] is None or x["price"] is None:
                continue

            accepted.append(x)


seen_ads = set()
accepted = []

# --------------------------------------------------
# Existing page 1 — zero API spend
# --------------------------------------------------

page1 = OUT / "petah_tikva_3r_page1.json"

if not page1.exists():
    raise FileNotFoundError(
        f"Missing existing page-1 file: {page1}"
    )

data = json.loads(page1.read_text(encoding="utf-8"))
process_page(data, 1, seen_ads, accepted)

print("\nPAGE 1 LOADED")

# --------------------------------------------------
# Pages 2–11
# --------------------------------------------------

for page in range(2, 12):

    current_groups = {
        project_key(x)
        for x in accepted
    }

    # If page 1 itself unexpectedly already establishes >1 project, stop.
    if len(current_groups) >= 2:
        break

    print(f"\nFetching page {page}...")

    params = dict(PARAMS)
    params["page"] = page

    r = requests.get(
        BASE + "/realestate-search",
        headers=HEADERS,
        params=params,
        timeout=30,
    )

    print("status:", r.status_code)

    if r.status_code != 200:
        try:
            print(
                json.dumps(
                    r.json(),
                    ensure_ascii=False,
                    indent=2
                )[:3000]
            )
        except Exception:
            print(r.text[:3000])
        continue

    data = r.json()

    raw_path = OUT / f"petah_tikva_3r_page{page}.json"
    raw_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    process_page(data, page, seen_ads, accepted)

    groups = {}
    for x in accepted:
        groups.setdefault(project_key(x), []).append(x)

    print(
        "exact-target contractor ads:",
        len(accepted),
        "| likely independent projects:",
        len(groups),
    )

    if len(groups) >= 2:
        print("\nSECOND LIKELY PROJECT FOUND — stopping early.")
        break

    time.sleep(0.25)


# --------------------------------------------------
# Final report
# --------------------------------------------------

groups = {}

for x in accepted:
    groups.setdefault(project_key(x), []).append(x)

print("\n" + "=" * 100)
print("FINAL EXACT-TARGET 3R NEW-DEVELOPMENT EVIDENCE")
print("=" * 100)

print("unique ads:", len(accepted))
print("likely independent projects:", len(groups))

for i, (key, rows) in enumerate(groups.items(), start=1):

    first = rows[0]

    print("\n" + "-" * 100)
    print(f"PROJECT GROUP {i}")
    print("key:", key)
    print(
        f"{first['street']} {first['house'] or ''} | "
        f"{first['neighborhood']} | "
        f"coords={first['lat']},{first['lon']}"
    )
    print("ads:", len(rows))

    for x in rows:
        print(
            f"  page={x['page']} "
            f"| {x['sqm']} m² "
            f"| ₪{x['price']:,} "
            f"| floor={x['floor']} "
            f"| agency={x['agency']} "
            f"| token={x['token']}"
        )


result = {
    "target": {
        "city": "פתח תקווה",
        "neighborhood": TARGET_NEIGHBORHOOD,
        "rooms": 3,
        "sqm_min": 58,
        "sqm_max": 80,
    },
    "unique_ads": len(accepted),
    "likely_independent_project_count": len(groups),
    "projects": [
        {
            "project_key": key,
            "records": rows,
        }
        for key, rows in groups.items()
    ],
}

summary_path = OUT / "petah_tikva_3r_exact_target_newdev_summary.json"

summary_path.write_text(
    json.dumps(result, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

print("\nsaved:", summary_path)
print("\nDONE")
