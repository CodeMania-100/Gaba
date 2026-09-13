"""One-time map-coordinate enrichment for the multi-city competitor register
(special_full_v2/competitor_projects_v2.json).

Most of that register's 32 projects fell back to a shared, per-city
NEIGHBORHOOD_CENTROID coordinate for map display -- not because no address
was known, but because the original compilation pass never geocoded the
address/street text it already carried. This script uses that ALREADY-ON-
FILE address/street text (never a new commercial fact, never new research)
to resolve a real coordinate, same geocoder and same one-time-offline
philosophy as build_map_geocodes_v1.py (Petah Tikva's own pass):

Resolution priority, per project:
  1. coordinate_precision == "PROJECT" -- already an exact, curated
     coordinate. Left alone entirely; this script does not even attempt to
     geocode it, let alone overwrite it.
  2. A full address string on file -- geocoded once, city-scoped. Accepted
     only when the geocoder itself resolves it to house/building precision
     (an actual street-number match) or, failing that, road precision.
  3. Only a street name on file (no address) -- geocoded as street+city
     only, accepted only at road precision.
  4. Neither -- left unresolved; the project keeps its existing
     neighborhood-centroid coordinate untouched (this script writes nothing
     for it).

Every result is validated: the geocoder's own address components must name
the project's own city (or a known alias), and the resolved point must fall
within a generous distance of that city's existing, already-used
neighborhood centroid (never a hand-tuned bounding box per city -- reuses
the one coordinate this dataset already trusts as "definitely in this
city"). Ambiguous/out-of-area/too-coarse results are recorded as unresolved
rather than guessed; nothing is ever jittered or spread out for appearance.

Output is written to its OWN frozen file
(data/frozen/multi_city_competitor_coordinate_enrichment_v1.json) --
special_full_v2/competitor_projects_v2.json itself is never opened for
writing and never modified. The workspace builder (see
app_api/multi_city_map_coordinate_enrichment.py) merges this file in at
read time as an additive overlay, exactly like the existing
precision_overlay_v3 pattern.

Requires network access to nominatim.openstreetmap.org. Rerun with:
  python build_multi_city_competitor_coordinate_enrichment_v1.py
"""

from __future__ import annotations

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

SOURCE_PATH = Path("data/multi_city_integration_final/special_full_v2/competitor_projects_v2.json")
OUT_PATH = Path("data/frozen/multi_city_competitor_coordinate_enrichment_v1.json")

# The one neighborhood-centroid coordinate each city's own frozen dataset
# already uses as its fallback -- reused here only as a validation anchor
# ("is this geocode plausibly still in the right city"), never as a
# fallback value itself.
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


def geocode_one(query_text: str, city: str) -> dict:
    """Returns {"lat","lng","precision","resolved_label"} on success, or
    {"rejected": True, "reason": ...} otherwise. Never raises for a normal
    not-found/ambiguous/out-of-area case -- mirrors build_map_geocodes_v1.py's
    geocode_one exactly, generalized to any of the three cities."""
    query = f"{query_text}, {city}, ישראל"
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
        # Anything coarser than street level is NOT an improvement over the
        # existing neighborhood centroid -- reject rather than accept a
        # second, differently-flavored approximation.
        return {"rejected": True, "reason": "no_better_than_centroid", "raw_display_name": top.get("display_name")}

    return {"lat": lat, "lng": lng, "precision": precision, "resolved_label": top.get("display_name")}


def main() -> None:
    root = Path(__file__).resolve().parent
    source = json.loads((root / SOURCE_PATH).read_text(encoding="utf-8"))
    projects = source["projects"]

    resolved: list[dict] = []
    unresolved: list[dict] = []
    skipped_already_project = 0
    skipped_no_address = 0

    candidates = []
    for p in projects:
        if p.get("coordinate_precision") == "PROJECT":
            skipped_already_project += 1
            continue
        query_text = p.get("address") or p.get("street")
        if not query_text:
            skipped_no_address += 1
            continue
        candidates.append(p)

    print(
        f"{len(projects)} total projects: {skipped_already_project} already PROJECT-precision (untouched), "
        f"{skipped_no_address} with no address/street on file (stay at neighborhood centroid), "
        f"{len(candidates)} to geocode.\n"
    )

    for i, p in enumerate(candidates, start=1):
        query_text = p["address"] or p["street"]
        input_kind = "address" if p.get("address") else "street"
        city = p["city"]
        result = geocode_one(query_text, city)
        if result.get("rejected"):
            unresolved.append(
                {
                    "project_id": p["project_id"],
                    "project_name": p["project_name"],
                    "city": city,
                    "input_kind": input_kind,
                    "query_text": query_text,
                    "reason": result.get("reason"),
                }
            )
            print(f"  [{i}/{len(candidates)}] UNRESOLVED  {p['project_name']!r} ({query_text!r}) -- {result.get('reason')}")
        else:
            resolved.append(
                {
                    "project_id": p["project_id"],
                    "project_name": p["project_name"],
                    "city": city,
                    "input_kind": input_kind,
                    "query_text": query_text,
                    "lat": result["lat"],
                    "lng": result["lng"],
                    # Distinct from the source dataset's own "PROJECT"/
                    # "NEIGHBORHOOD_CENTROID" values so a reader can always
                    # tell a curated project coordinate apart from one this
                    # script derived -- never silently relabeled "PROJECT".
                    "coordinate_precision": "GEOCODED_ADDRESS" if result["precision"] == "address" else "GEOCODED_STREET",
                    "resolved_label": result["resolved_label"],
                    "geocoder": "nominatim_openstreetmap",
                }
            )
            print(f"  [{i}/{len(candidates)}] ok ({result['precision']})  {p['project_name']!r} ({query_text!r})")
        time.sleep(RATE_LIMIT_SECONDS)

    output = {
        "version": "multi_city_competitor_coordinate_enrichment_v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "geocoder": "nominatim_openstreetmap",
        "source": str(SOURCE_PATH).replace("\\", "/"),
        "note": (
            "One-time coordinate lookup only, from address/street text already present on the frozen "
            "competitor register -- no new commercial fact was collected, and "
            "special_full_v2/competitor_projects_v2.json itself was never modified. Applied at workspace-"
            "build time as an additive overlay (see app_api/multi_city_map_coordinate_enrichment.py); a "
            "project already at PROJECT precision is never touched, and a project with neither an address "
            "nor a street on file keeps its existing neighborhood-centroid fallback."
        ),
        "resolution_priority": ["PROJECT (untouched)", "GEOCODED_ADDRESS", "GEOCODED_STREET", "NEIGHBORHOOD_CENTROID (untouched fallback)"],
        "validation": {
            "city_tokens": CITY_TOKENS,
            "max_distance_km_from_city_centroid": MAX_DISTANCE_KM_FROM_CENTROID,
            "note": "Every accepted record must (a) name its own city in the geocoder's own address components "
            "and (b) fall within max_distance_km_from_city_centroid of that city's existing neighborhood-"
            "centroid coordinate. Results coarser than street level are rejected as no improvement over the "
            "existing fallback.",
        },
        "counts": {
            "total_projects": len(projects),
            "already_project_precision": skipped_already_project,
            "no_address_or_street_on_file": skipped_no_address,
            "geocode_attempted": len(candidates),
            "resolved": len(resolved),
            "unresolved": len(unresolved),
        },
        "resolved": resolved,
        "unresolved": unresolved,
    }

    out_path = root / OUT_PATH
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {out_path}")
    print(f"Resolved: {len(resolved)}/{len(candidates)} ({sum(1 for r in resolved if r['coordinate_precision']=='GEOCODED_ADDRESS')} address-level, "
          f"{sum(1 for r in resolved if r['coordinate_precision']=='GEOCODED_STREET')} street-level). Unresolved: {len(unresolved)}.")


if __name__ == "__main__":
    main()
