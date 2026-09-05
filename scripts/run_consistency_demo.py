from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from statistics import median

from pricing_core import (
    ProjectLocation,
    StrategyProfile,
    build_comparable_set,
    build_market_range,
    check_project_consistency,
    normalize_inventory_rows,
    price_project,
    run_sold_qa,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Real-evidence consistency-engine validation with no invented company relationships.")
    parser.add_argument("--inventory-rows", type=Path, required=True)
    parser.add_argument("--sold-3-local", type=Path, required=True)
    parser.add_argument("--sold-5-local", type=Path, required=True)
    parser.add_argument("--sold-citywide", type=Path, required=True)
    parser.add_argument("--listings", type=Path, required=True)
    parser.add_argument("--projects", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    inventory_rows = json.loads(args.inventory_rows.read_text(encoding="utf-8"))
    listings = json.loads(args.listings.read_text(encoding="utf-8"))
    projects = json.loads(args.projects.read_text(encoding="utf-8"))
    sold_3 = run_sold_qa(json.loads(args.sold_3_local.read_text(encoding="utf-8")))
    sold_5 = run_sold_qa(json.loads(args.sold_5_local.read_text(encoding="utf-8")))
    sold_citywide = run_sold_qa(json.loads(args.sold_citywide.read_text(encoding="utf-8")))

    inventory = normalize_inventory_rows(inventory_rows)
    location = _demo_location(listings)
    pairs = []

    for record in inventory:
        unit = record.unit
        if unit.rooms == 3 and unit.unit_type == "standard_apartment":
            sold_records = sold_3.records
            source_context = {"sold_query_scope": {"city": "אשקלון", "neighborhoods": ["עיר היין", "רמת כרמים"], "rooms": [3]}}
        elif unit.rooms == 5 and unit.unit_type == "standard_apartment":
            sold_records = sold_5.records
            source_context = {"sold_query_scope": {"city": "אשקלון", "neighborhoods": ["עיר היין", "רמות אשקלון", "רמת כרמים"], "rooms": [5]}}
        else:
            sold_records = sold_citywide.records
            source_context = {"sold_query_scope": {"city": "אשקלון", "neighborhoods": [], "rooms": [unit.rooms] if unit.rooms else []}}

        comps = build_comparable_set(
            unit,
            location,
            sold_records,
            listings,
            projects,
            as_of=date(2026, 9, 4),
            source_context=source_context,
        )
        pairs.append((unit, build_market_range(comps, as_of=date(2026, 9, 4))))

    # Engineering-only neutral range position. No company floor/orientation/
    # relationship rule is supplied, so the consistency engine must not invent one.
    strategy = StrategyProfile(
        name="engineering_consistency_validation",
        range_position_pct=50,
        source="candidate_engineering_test_input",
        note="Midpoint is used only to create a deterministic price list for consistency validation; it is not Gabay policy or a recommendation.",
    )
    pricing = price_project(pairs, strategy)
    report = check_project_consistency([record.unit for record in inventory], pricing)

    payload = {
        "disclaimer": (
            "This is an engineering validation. The assignment supplied no project location or Gabay pricing rules. "
            "City Wine, Ashkelon is a candidate-selected demo market. No floor, orientation, balcony, parking, storage or relative-unit rule is assumed."
        ),
        "pricing_summary": pricing.project_metrics,
        "consistency": report.public_dict(),
    }
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))


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
