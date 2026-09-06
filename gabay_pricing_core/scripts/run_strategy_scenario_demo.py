from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from statistics import median

from pricing_core import (
    PriceOverride,
    ProjectLocation,
    StrategyProfile,
    build_comparable_set,
    build_market_range,
    compare_scenarios,
    normalize_inventory_rows,
    price_project,
    reprice_unlocked_preserving_locks,
    run_sold_qa,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Engineering validation of strategy + scenario impact using real evidence snapshots.")
    parser.add_argument("--inventory-rows", type=Path, required=True)
    parser.add_argument("--sold-3-local", type=Path, required=True)
    parser.add_argument("--sold-5-local", type=Path, required=True)
    parser.add_argument("--sold-citywide", type=Path, required=True)
    parser.add_argument("--listings", type=Path, required=True)
    parser.add_argument("--projects", type=Path, required=True)
    parser.add_argument("--baseline-position", type=float, required=True)
    parser.add_argument("--scenario-position", type=float, required=True)
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
            unit, location, sold_records, listings, projects,
            as_of=date(2026, 9, 4), source_context=source_context,
        )
        pairs.append((unit, build_market_range(comps, as_of=date(2026, 9, 4))))

    baseline_strategy = StrategyProfile(
        name=f"engineering_baseline_{args.baseline_position:g}pct_of_supported_range",
        range_position_pct=args.baseline_position,
        source="candidate_engineering_test_input",
        note="Engineering validation only. This is not a Gabay strategy or recommendation.",
    )
    scenario_strategy = StrategyProfile(
        name=f"engineering_scenario_{args.scenario_position:g}pct_of_supported_range",
        range_position_pct=args.scenario_position,
        source="candidate_engineering_test_input",
        note="Engineering validation only. This is not a Gabay strategy or recommendation.",
    )

    baseline = price_project(pairs, baseline_strategy)
    scenario = price_project(pairs, scenario_strategy)
    impact = compare_scenarios(baseline, scenario)

    # Lock validation uses the baseline engine price itself, not an invented override
    # amount. The purpose is only to prove that a locked commercial decision remains
    # fixed while the same scenario reprices all other eligible units.
    unit17_baseline = next((u.proposed_list_price_ils for u in baseline.units if u.unit_number == "17"), None)
    locked_reprice = None
    locked_impact = None
    if unit17_baseline is not None:
        locked_reprice = reprice_unlocked_preserving_locks(
            pairs,
            scenario_strategy,
            [PriceOverride(
                unit_number="17",
                price_ils=unit17_baseline,
                reason="Engineering lock-preservation validation using the existing baseline price.",
                locked=True,
                created_by="engineering_test",
            )],
        )
        locked_impact = compare_scenarios(baseline, locked_reprice.pricing)

    payload = {
        "disclaimer": (
            "Assignment supplied no project location or internal Gabay strategy. City Wine, Ashkelon and the two range-position values "
            "are candidate-selected engineering test inputs only; they are not presented as Gabay data, policy or recommended pricing."
        ),
        "location": {
            "city": location.city,
            "neighborhood": location.neighborhood,
            "latitude": location.latitude,
            "longitude": location.longitude,
            "source": location.source,
        },
        "baseline": baseline.public_dict(),
        "scenario": scenario.public_dict(),
        "impact": impact.public_dict(),
        "locked_reprice": locked_reprice.public_dict() if locked_reprice else None,
        "locked_impact": locked_impact.public_dict() if locked_impact else None,
    }
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "baseline_metrics": baseline.project_metrics,
        "scenario_metrics": scenario.project_metrics,
        "impact": {
            "changed_unit_count": impact.changed_unit_count,
            "total_list_value_delta_ils": impact.total_list_value_delta_ils,
            "outside_range_before": impact.units_outside_supported_range_before,
            "outside_range_after": impact.units_outside_supported_range_after,
            "changed_units_with_unit17_locked": locked_impact.changed_unit_count if locked_impact else None,
        },
    }, ensure_ascii=False, indent=2))


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
