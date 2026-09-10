"""One-time geocoding pass for the market map (see "MAP UPGRADE" and "Map
Batch -- special apartments" tasks).

Resolves real lat/lng coordinates for:
  1. The competitor-register project addresses (workspace.competitor_landscape.projects),
     merged with the extra new-development competitor addresses referenced
     only by the special-unit evidence package (data/frozen/
     special_unit_master_data_v1.json's expanded_market_evidence.competitors)
     -- same "competitor:<project_name>" record_id namespace either way, so
     the map's competitor layer treats both as one concept.
  2. Every UNIQUE address among sold-transaction records already accepted by
     the pricing engine's own quality gate (quality_status == "usable") --
     never one geocode per duplicate transaction, and never a re-opened
     research/eligibility pass. Both sources are read from the *live*
     workspace API response (not re-parsed from raw frozen files) so this
     script is guaranteed to operate on exactly the same already-accepted
     records the app itself shows -- no risk of drifting from a stale or
     differently-filtered source file.
  3. Every UNIQUE address in the special-unit sold baskets (curated_special_
     review.baskets -- selected, broadened, AND rejected: excluded/context
     records still need a coordinate so the map can plot them with the
     correct non-participating status, see task item 25) and the special-
     unit current-asking evidence pool (expanded_market_evidence.
     current_asking_evidence). Read from the frozen special-unit master file
     directly (not the workspace API) since that file IS the authoritative,
     already-reviewed source for these baskets -- nothing here re-derives or
     re-filters them.

Uses OpenStreetMap's public Nominatim geocoder, rate-limited to ~1 request/
second per its usage policy, with a descriptive User-Agent. This is a
ONE-TIME, offline script -- the frontend/backend never geocode live at
request time. Every result is validated (must resolve inside Petah Tikva,
both by the geocoder's own returned address components and by a generous
coordinate sanity envelope) before being accepted; ambiguous, out-of-area,
or overly coarse (city/suburb-level) results are recorded as unresolved
rather than guessed. Output is frozen to data/frozen/map_geocodes_v1.json
and only ever re-read (never recomputed) by the API layer.

Requires the local dev API to be running at http://127.0.0.1:8000 (or set
WORKSPACE_API_URL). Rerun with: python build_map_geocodes_v1.py
"""

from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = (
    "GabayPricingDemo-Geocoder/1.0 "
    "(one-time offline geocoding pass for an educational pricing-demo assignment)"
)
RATE_LIMIT_SECONDS = 1.1
WORKSPACE_API_URL = os.environ.get("WORKSPACE_API_URL", "http://127.0.0.1:8000/api/v1/demo/petah-tikva/workspace")

# Primary validation: the geocoder's own returned address components must
# reference Petah Tikva (both common transliterations/spellings).
CITY_TOKENS = ["פתח תקווה", "פתח תקוה", "petah tikva", "petah tiqwa", "petah-tikva"]

# Secondary sanity envelope: generous bounds around all of Petah Tikva (not
# the tight submarket box the current-asking listings cluster in) so
# legitimate city-wide competitor/sold addresses outside the immediate
# comparison submarket are not falsely rejected.
BBOX = {"min_lat": 32.03, "max_lat": 32.13, "min_lng": 34.82, "max_lng": 34.94}

# Match-quality types too coarse to trust for a specific street address --
# rejected outright rather than shown as an "approximate" marker.
TOO_COARSE_TYPES = {"city", "town", "suburb", "postcode", "administrative", "state", "county", "state_district"}


def _http_get_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def geocode_one(address: str) -> dict:
    """Returns {"lat","lng","precision","resolved_label"} on success, or
    {"rejected": True, "reason": ...} / {"error": ...} otherwise. Never
    raises for a normal not-found/ambiguous/out-of-area case."""
    query = f"{address}, פתח תקווה, ישראל"
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
    in_city = any(tok.lower() in city_text for tok in CITY_TOKENS)
    try:
        lat, lng = float(top["lat"]), float(top["lon"])
    except (KeyError, ValueError):
        return {"rejected": True, "reason": "malformed_coordinates"}
    in_bbox = BBOX["min_lat"] <= lat <= BBOX["max_lat"] and BBOX["min_lng"] <= lng <= BBOX["max_lng"]
    if not (in_city and in_bbox):
        return {"rejected": True, "reason": "outside_petah_tikva", "raw_display_name": top.get("display_name")}

    addresstype = top.get("addresstype")
    if addresstype in TOO_COARSE_TYPES:
        return {"rejected": True, "reason": "too_coarse", "raw_display_name": top.get("display_name")}

    has_house_number = bool(addr.get("house_number"))
    if has_house_number or addresstype in ("house", "building"):
        precision = "address"
    elif addresstype == "road":
        precision = "street"
    else:
        precision = "approximate"

    return {"lat": lat, "lng": lng, "precision": precision, "resolved_label": top.get("display_name")}


def geocode_batch(items: list[tuple[str, str]]) -> tuple[list[dict], list[dict]]:
    """items: list of (record_id, address). Returns (resolved, unresolved)."""
    resolved: list[dict] = []
    unresolved: list[dict] = []
    total = len(items)
    for i, (record_id, address) in enumerate(items, start=1):
        result = geocode_one(address)
        if result.get("rejected") or result.get("error"):
            unresolved.append({"record_id": record_id, "address": address, "reason": result.get("reason") or result.get("error")})
            print(f"  [{i}/{total}] UNRESOLVED  {address!r} -- {result.get('reason')}")
        else:
            resolved.append(
                {
                    "record_id": record_id,
                    "address": address,
                    "lat": result["lat"],
                    "lng": result["lng"],
                    "coordinate_source": "geocoded_address",
                    "precision": result["precision"],
                    "resolved_label": result["resolved_label"],
                    "verified": True,
                }
            )
            print(f"  [{i}/{total}] ok ({result['precision']})  {address!r}")
        time.sleep(RATE_LIMIT_SECONDS)
    return resolved, unresolved


def main() -> None:
    root = Path(__file__).resolve().parent
    out_path = root / "data" / "frozen" / "map_geocodes_v1.json"

    print(f"Fetching live workspace payload from {WORKSPACE_API_URL} ...")
    req = urllib.request.Request(WORKSPACE_API_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        workspace = json.loads(resp.read().decode("utf-8"))

    master = json.loads((root / "data" / "frozen" / "special_unit_master_data_v1.json").read_text(encoding="utf-8"))

    # 1. Competitor register projects, plus any extra new-development
    # competitor addresses the special-unit evidence package references that
    # aren't already in the standard register -- same record_id namespace,
    # merged into one list (a competitor project is a competitor project
    # regardless of which lane cites it).
    competitor_items = [
        (f"competitor:{p['project_name']}", p["address"])
        for p in workspace["competitor_landscape"]["projects"]
        if p.get("address")
    ]
    existing_competitor_names = {p["project_name"] for p in workspace["competitor_landscape"]["projects"]}
    special_competitors = master["expanded_market_evidence"]["competitors"]
    extra_competitor_items = [
        (f"competitor:{c['project_name']}", c["address"])
        for c in special_competitors
        if c.get("address") and c["project_name"] not in existing_competitor_names
    ]
    competitor_items = competitor_items + extra_competitor_items

    # 2. Unique sold-transaction addresses already accepted by the pricing
    # engine's own quality gate -- one geocode per unique address, not per
    # transaction (a single address can carry many transactions).
    sold_addresses: dict[str, str] = {}
    total_usable = 0
    for fam in ("3R", "5R"):
        for r in workspace["evidence_provenance"]["sold"][fam].get("records", []):
            if r.get("quality_status") != "usable":
                continue
            total_usable += 1
            addr = r.get("address")
            if addr and addr not in sold_addresses:
                sold_addresses[addr] = f"sold_address:{addr}"
    sold_items = [(record_id, addr) for addr, record_id in sold_addresses.items()]

    # 3. Unique special-unit sold-basket addresses -- selected, broadened,
    # AND rejected, so excluded/context records can still be plotted (with
    # their non-participating status) rather than silently vanishing from
    # "כל נתוני השוק" mode.
    special_sold_addresses: dict[str, str] = {}
    for basket in master["curated_special_review"]["baskets"].values():
        records = (
            (basket.get("selected_sold") or [])
            + (basket.get("selected_broadened_sold") or [])
            + (basket.get("rejected_sold") or [])
        )
        for r in records:
            addr = r.get("address")
            if addr and addr not in special_sold_addresses:
                special_sold_addresses[addr] = f"special_sold_address:{addr}"
    special_sold_items = [(record_id, addr) for addr, record_id in special_sold_addresses.items()]

    # 4. Unique special-unit current-asking evidence addresses (direct +
    # broadened -- both, same reasoning as above).
    special_asking_addresses: dict[str, str] = {}
    for r in master["expanded_market_evidence"]["current_asking_evidence"]:
        addr = r.get("address")
        if addr and addr not in special_asking_addresses:
            special_asking_addresses[addr] = f"special_asking_address:{addr}"
    special_asking_items = [(record_id, addr) for addr, record_id in special_asking_addresses.items()]

    total_items = len(competitor_items) + len(sold_items) + len(special_sold_items) + len(special_asking_items)
    print(
        f"\n{len(competitor_items)} competitor addresses ({len(extra_competitor_items)} new from special evidence), "
        f"{len(sold_items)} unique sold addresses (covering {total_usable} usable sold transactions), "
        f"{len(special_sold_items)} unique special-unit sold-basket addresses, "
        f"{len(special_asking_items)} unique special-unit asking addresses."
    )
    print(f"Estimated time: ~{total_items * RATE_LIMIT_SECONDS / 60:.1f} minutes.\n")

    print("Geocoding competitor addresses...")
    competitor_resolved, competitor_unresolved = geocode_batch(competitor_items)

    print("\nGeocoding sold-transaction addresses...")
    sold_resolved, sold_unresolved = geocode_batch(sold_items)

    print("\nGeocoding special-unit sold-basket addresses...")
    special_sold_resolved, special_sold_unresolved = geocode_batch(special_sold_items)

    print("\nGeocoding special-unit asking addresses...")
    special_asking_resolved, special_asking_unresolved = geocode_batch(special_asking_items)

    output = {
        "version": "map_geocodes_v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "geocoder": "nominatim_openstreetmap",
        "validation": {
            "city_tokens": CITY_TOKENS,
            "bbox": BBOX,
            "note": "Every accepted record resolved inside Petah Tikva by both the geocoder's own address "
            "components and this coordinate envelope; ambiguous/out-of-area/too-coarse results are listed "
            "under unresolved rather than guessed.",
        },
        "sold_evidence_coverage": {
            "usable_transactions_total": total_usable,
            "unique_addresses_total": len(sold_items),
            "unique_addresses_resolved": len(sold_resolved),
        },
        "special_sold_evidence_coverage": {
            "unique_addresses_total": len(special_sold_items),
            "unique_addresses_resolved": len(special_sold_resolved),
        },
        "special_asking_evidence_coverage": {
            "unique_addresses_total": len(special_asking_items),
            "unique_addresses_resolved": len(special_asking_resolved),
        },
        "competitors": {"resolved": competitor_resolved, "unresolved": competitor_unresolved},
        "sold": {"resolved": sold_resolved, "unresolved": sold_unresolved},
        "special_sold": {"resolved": special_sold_resolved, "unresolved": special_sold_unresolved},
        "special_asking": {"resolved": special_asking_resolved, "unresolved": special_asking_unresolved},
    }

    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {out_path}")
    print(f"Competitors: {len(competitor_resolved)} resolved, {len(competitor_unresolved)} unresolved.")
    print(f"Sold addresses: {len(sold_resolved)} resolved, {len(sold_unresolved)} unresolved "
          f"(covering {sum(1 for a in sold_addresses if a)} unique addresses / {total_usable} usable transactions).")
    print(f"Special-unit sold-basket addresses: {len(special_sold_resolved)} resolved, {len(special_sold_unresolved)} unresolved.")
    print(f"Special-unit asking addresses: {len(special_asking_resolved)} resolved, {len(special_asking_unresolved)} unresolved.")


if __name__ == "__main__":
    main()
