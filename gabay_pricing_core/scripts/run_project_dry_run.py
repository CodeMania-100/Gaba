from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import date
from pathlib import Path
from statistics import median

from pricing_core import ProjectLocation, build_comparable_set, build_market_range, normalize_inventory_rows, run_sold_qa


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a full supplied-inventory evidence dry run before strategy/UI work.")
    parser.add_argument("--inventory-rows", type=Path, required=True)
    parser.add_argument("--sold-3-local", type=Path, required=True)
    parser.add_argument("--sold-5-local", type=Path, required=False)
    parser.add_argument("--sold-citywide", type=Path, required=True)
    parser.add_argument("--listings", type=Path, required=True)
    parser.add_argument("--projects", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    inventory_rows = json.loads(args.inventory_rows.read_text(encoding="utf-8"))
    listings = json.loads(args.listings.read_text(encoding="utf-8"))
    projects = json.loads(args.projects.read_text(encoding="utf-8"))
    sold_3 = run_sold_qa(json.loads(args.sold_3_local.read_text(encoding="utf-8")))
    sold_5 = run_sold_qa(json.loads(args.sold_5_local.read_text(encoding="utf-8"))) if args.sold_5_local else None
    sold_citywide = run_sold_qa(json.loads(args.sold_citywide.read_text(encoding="utf-8")))

    inventory = normalize_inventory_rows(inventory_rows)
    location = _demo_location(listings)
    unit_outputs = []

    for record in inventory:
        unit = record.unit
        if unit.rooms == 3 and unit.unit_type == "standard_apartment":
            sold_records = sold_3.records
            source_context = {
                "sold_query_scope": {
                    "city": "אשקלון",
                    "neighborhoods": ["עיר היין", "רמת כרמים"],
                    "rooms": [3],
                    "source_file": args.sold_3_local.name,
                }
            }
        elif unit.rooms == 5 and unit.unit_type == "standard_apartment" and sold_5 is not None:
            sold_records = sold_5.records
            source_context = {
                "sold_query_scope": {
                    "city": "אשקלון",
                    "neighborhoods": ["עיר היין", "רמות אשקלון", "רמת כרמים"],
                    "rooms": [5],
                    "source_file": args.sold_5_local.name,
                    "note": "Targeted local-area query. Returned source neighborhood labels are incomplete/inconsistent, so actual coordinates remain visible and drive geographic ranking.",
                }
            }
        else:
            # Citywide sold data can be inspected as reference evidence, but the
            # range engine will not let it drive a neighborhood price unless it
            # carries a verified target-neighborhood scope or label.
            sold_records = sold_citywide.records
            source_context = {
                "sold_query_scope": {
                    "city": "אשקלון",
                    "neighborhoods": [],
                    "rooms": [unit.rooms] if unit.rooms is not None else [],
                    "source_file": args.sold_citywide.name,
                }
            }

        comps = build_comparable_set(
            unit,
            location,
            sold_records,
            listings,
            projects,
            as_of=date(2026, 9, 4),
            source_context=source_context,
        )
        market = build_market_range(comps, as_of=date(2026, 9, 4))
        unit_outputs.append({
            "inventory": record.public_dict(),
            "evidence_counts": {
                "sold_candidates": len(comps.sold),
                "current_asking_candidates": len(comps.current_asking),
                "new_development_candidates": len(comps.new_development),
            },
            "market_range": market.public_dict(),
        })

    statuses = Counter(x["market_range"]["status"] for x in unit_outputs)
    by_type = Counter(x["inventory"]["unit"]["unit_type"] for x in unit_outputs)
    standard_by_rooms = Counter(
        str(x["inventory"]["unit"]["rooms"])
        for x in unit_outputs
        if x["inventory"]["unit"]["unit_type"] == "standard_apartment"
    )
    unresolved_standard = [
        x["inventory"]["unit"]["unit_number"]
        for x in unit_outputs
        if x["inventory"]["unit"]["unit_type"] == "standard_apartment"
        and x["market_range"]["status"] != "consensus"
    ]

    payload = {
        "demo_disclaimer": "Assignment supplied no project location. This dry run uses City Wine, Ashkelon as a candidate-selected demo market and does not claim the supplied inventory belongs to a real Gabay project.",
        "location": {
            "city": location.city,
            "neighborhood": location.neighborhood,
            "latitude": location.latitude,
            "longitude": location.longitude,
            "source": location.source,
        },
        "summary": {
            "normalized_units": len(unit_outputs),
            "unit_types": dict(by_type),
            "standard_units_by_rooms": dict(standard_by_rooms),
            "range_statuses": dict(statuses),
            "standard_units_still_missing_consensus": unresolved_standard,
        },
        "units": unit_outputs,
    }
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload["summary"], ensure_ascii=False, indent=2))


def _demo_location(listings: list[dict]) -> ProjectLocation:
    points = []
    for row in listings:
        if row.get("neighbourhood") != "עיר היין":
            continue
        try:
            lat, lng = float(row.get("latitude")), float(row.get("longitude"))
        except (TypeError, ValueError):
            continue
        if 29 <= lat <= 34.6 and 34 <= lng <= 36.6:
            points.append((lat, lng))
        elif 29 <= lng <= 34.6 and 34 <= lat <= 36.6:
            points.append((lng, lat))
    if not points:
        raise SystemExit("Could not derive City Wine demo anchor")
    return ProjectLocation(
        city="אשקלון",
        neighborhood="עיר היין",
        latitude=median(p[0] for p in points),
        longitude=median(p[1] for p in points),
        source="candidate_demo_neighborhood_centroid_from_current_listings",
    )


if __name__ == "__main__":
    main()
