"""One-time map-coordinate enrichment for standard (3R/5R) and special-unit
(garden/duplex/triplex) sold/asking evidence in the multi-city package.

Companion to build_multi_city_competitor_coordinate_enrichment_v1.py (same
geocoder, same one-time-offline philosophy, same "never overwrite the frozen
research coordinate" rule) -- kept as its own script because it enriches a
different record family (per-transaction/listing evidence, not competitor
projects) with a different natural key: every sold/asking/special row
already carries a full street address, and several rows legitimately share
one address (multiple transactions in the same building) -- so this script
geocodes once per UNIQUE (city, address) pair, never once per row, and the
apply-time join (see app_api/multi_city_map_coordinate_enrichment.py) reuses
that one resolved coordinate for every row at that address. This mirrors how
the frontend already groups same-address sold transactions into one marker
(lib/marketMap.ts's deriveSoldPoints) -- geocoding at address granularity is
the same grain the UI already treats as one location.

Sources read (never modified):
  - data/multi_city_integration_final/standard_market/<dir>/completed_sales_{3r,5r}.csv
  - data/multi_city_integration_final/standard_market/<dir>/current_asking_{3r,5r}.csv
  - data/multi_city_integration_final/special_full_v2/<dir>/sold_special_v2.csv
  - data/multi_city_integration_final/special_full_v2/<dir>/asking_special_v2.csv

Every one of these rows already carries its own coordinate (submarket-
centroid fallback for standard rows, NEIGHBORHOOD_CENTROID for special
rows) -- this script only improves that, address by address, using the
address text already on file. No new commercial fact is collected.

Output: data/frozen/multi_city_evidence_coordinate_enrichment_v1.json,
merged in at request-build time as an additive overlay -- the source CSVs
themselves are never opened for writing.

Requires network access to nominatim.openstreetmap.org. Rerun with:
  python build_multi_city_evidence_coordinate_enrichment_v1.py
"""

from __future__ import annotations

import csv
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = (
    "GabayPricingDemo-Geocoder/1.0 "
    "(one-time offline geocoding pass for an educational pricing-demo assignment)"
)
RATE_LIMIT_SECONDS = 1.1

STANDARD_MARKET_DIRS = {"תל אביב-יפו": "tel_aviv", "נתניה": "netanya", "אשקלון": "ashkelon"}
SPECIAL_DIRS = STANDARD_MARKET_DIRS  # same directory naming under special_full_v2

OUT_PATH = Path("data/frozen/multi_city_evidence_coordinate_enrichment_v1.json")

# Reused verbatim from the competitor coordinate enrichment script -- the
# one neighborhood-centroid coordinate each city's own frozen dataset
# already uses as its fallback, kept here only as a validation anchor.
CITY_CENTROIDS = {
    "תל אביב-יפו": (32.05899, 34.79285),
    "נתניה": (32.30321, 34.87567),
    "אשקלון": (31.68751, 34.57109),
}
CITY_TOKENS = {
    "תל אביב-יפו": ["תל אביב", "תל־אביב", "יפו", "tel aviv", "yafo", "tel aviv-yafo"],
    "נתניה": ["נתניה", "netanya"],
    "אשקלון": ["אשקלון", "ashkelon", "ashqelon"],
}
MAX_DISTANCE_KM_FROM_CENTROID = 12.0
TOO_COARSE_TYPES = {"city", "town", "suburb", "postcode", "administrative", "state", "county", "state_district"}


def _http_get_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1 = a
    lat2, lng2 = b
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def geocode_one(address: str, city: str) -> dict:
    query = f"{address}, {city}, ישראל"
    params = {"q": query, "format": "jsonv2", "addressdetails": 1, "limit": 3, "countrycodes": "il"}
    url = f"{NOMINATIM_URL}?{urllib.parse.urlencode(params)}"
    try:
        results = _http_get_json(url)
    except Exception as e:  # noqa: BLE001 -- one-time script, log and continue
        return {"rejected": True, "reason": f"request_failed: {e}"}
    if not results:
        return {"rejected": True, "reason": "no_results"}

    top = results[0]
    addr = top.get("address", {})
    city_text = " ".join(str(addr.get(k, "")) for k in ("city", "town", "suburb", "county", "state_district")).lower()
    tokens = CITY_TOKENS.get(city, [city])
    in_city = any(tok.lower() in city_text for tok in tokens)
    try:
        lat, lng = float(top["lat"]), float(top["lon"])
    except (KeyError, ValueError):
        return {"rejected": True, "reason": "malformed_coordinates"}

    centroid = CITY_CENTROIDS.get(city)
    distance_km = _haversine_km((lat, lng), centroid) if centroid else 0.0
    if not in_city or (centroid and distance_km > MAX_DISTANCE_KM_FROM_CENTROID):
        return {"rejected": True, "reason": "outside_city_area", "raw_display_name": top.get("display_name")}

    addresstype = top.get("addresstype")
    if addresstype in TOO_COARSE_TYPES:
        return {"rejected": True, "reason": "too_coarse", "raw_display_name": top.get("display_name")}

    has_house_number = bool(addr.get("house_number"))
    if has_house_number or addresstype in ("house", "building"):
        precision = "address"
    elif addresstype == "road":
        precision = "street"
    else:
        return {"rejected": True, "reason": "no_better_than_centroid", "raw_display_name": top.get("display_name")}

    return {"lat": lat, "lng": lng, "precision": precision, "resolved_label": top.get("display_name")}


def _load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def _collect_unique_addresses(root: Path) -> dict[tuple[str, str], str]:
    """Returns {(city, address): dataset_label} for every unique (city,
    address) pair across all four evidence datasets -- dataset_label is
    just the first dataset seen with that address, kept for reporting."""

    found: dict[tuple[str, str], str] = {}

    def add_all(rows: list[dict[str, str]], city: str, label: str) -> None:
        for row in rows:
            address = (row.get("address") or "").strip()
            if not address:
                continue
            key = (city, address)
            if key not in found:
                found[key] = label

    standard_root = root / "data/multi_city_integration_final/standard_market"
    special_root = root / "data/multi_city_integration_final/special_full_v2"

    for city, dirname in STANDARD_MARKET_DIRS.items():
        for fam in ("3r", "5r"):
            add_all(_load_csv(standard_root / dirname / f"completed_sales_{fam}.csv"), city, "standard_sold")
            add_all(_load_csv(standard_root / dirname / f"current_asking_{fam}.csv"), city, "standard_asking")
        add_all(_load_csv(special_root / dirname / "sold_special_v2.csv"), city, "special_sold")
        add_all(_load_csv(special_root / dirname / "asking_special_v2.csv"), city, "special_asking")

    return found


def main() -> None:
    root = Path(__file__).resolve().parent
    addresses = _collect_unique_addresses(root)
    items = sorted(addresses.items(), key=lambda kv: (kv[0][0], kv[0][1]))

    print(f"{len(items)} unique (city, address) pairs to geocode across standard + special evidence.\n")

    resolved: list[dict] = []
    unresolved: list[dict] = []
    for i, ((city, address), label) in enumerate(items, start=1):
        result = geocode_one(address, city)
        if result.get("rejected"):
            unresolved.append({"city": city, "address": address, "first_seen_in": label, "reason": result.get("reason")})
            print(f"  [{i}/{len(items)}] UNRESOLVED  {address!r} ({city}) -- {result.get('reason')}")
        else:
            resolved.append({
                "city": city,
                "address": address,
                "first_seen_in": label,
                "lat": result["lat"],
                "lng": result["lng"],
                "coordinate_precision": "GEOCODED_ADDRESS" if result["precision"] == "address" else "GEOCODED_STREET",
                "resolved_label": result["resolved_label"],
                "geocoder": "nominatim_openstreetmap",
            })
            print(f"  [{i}/{len(items)}] ok ({result['precision']})  {address!r} ({city})")
        time.sleep(RATE_LIMIT_SECONDS)

    output = {
        "version": "multi_city_evidence_coordinate_enrichment_v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "geocoder": "nominatim_openstreetmap",
        "sources": [
            "data/multi_city_integration_final/standard_market/<dir>/completed_sales_{3r,5r}.csv",
            "data/multi_city_integration_final/standard_market/<dir>/current_asking_{3r,5r}.csv",
            "data/multi_city_integration_final/special_full_v2/<dir>/sold_special_v2.csv",
            "data/multi_city_integration_final/special_full_v2/<dir>/asking_special_v2.csv",
        ],
        "note": (
            "One-time coordinate lookup only, from each row's own already-on-file address text -- keyed by "
            "(city, address), never by individual row, since several rows legitimately share one building "
            "address. No source CSV was ever modified. Applied at workspace-build time as an additive overlay "
            "(see app_api/multi_city_map_coordinate_enrichment.py); a row whose address has no resolved entry "
            "here keeps its existing submarket/neighborhood-centroid fallback untouched."
        ),
        "validation": {
            "city_tokens": CITY_TOKENS,
            "max_distance_km_from_city_centroid": MAX_DISTANCE_KM_FROM_CENTROID,
        },
        "counts": {"unique_addresses": len(items), "resolved": len(resolved), "unresolved": len(unresolved)},
        "resolved": resolved,
        "unresolved": unresolved,
    }

    out_path = root / OUT_PATH
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {out_path}")
    print(f"Resolved: {len(resolved)}/{len(items)}. Unresolved: {len(unresolved)}.")


if __name__ == "__main__":
    main()
