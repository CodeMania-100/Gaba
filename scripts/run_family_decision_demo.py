from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from statistics import median

from pricing_core import (
    FamilyStrategyDecision,
    PricingBasis,
    ProjectDecisionPlan,
    ProjectLocation,
    StrategyProfile,
    build_comparable_set,
    build_market_range,
    compare_decision_scenarios,
    family_key,
    normalize_inventory_rows,
    price_project_decision,
    run_sold_qa,
)

AS_OF = date(2026, 9, 4)


def main() -> None:
    parser = argparse.ArgumentParser(description="Family-level pricing decision engineering demo using real evidence snapshots.")
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
            as_of=AS_OF,
            source_context=source_context,
        )
        pairs.append((unit, build_market_range(comps, as_of=AS_OF)))

    standard_3 = next(unit for unit, _ in pairs if unit.unit_type == "standard_apartment" and unit.rooms == 3)
    standard_5 = next(unit for unit, _ in pairs if unit.unit_type == "standard_apartment" and unit.rooms == 5)
    key3 = family_key(standard_3)
    key5 = family_key(standard_5)

    baseline = ProjectDecisionPlan(
        name="engineering_family_baseline",
        source="candidate_engineering_test_input",
        note="50% range positions are engineering controls only; they are not Gabay strategy or recommended pricing.",
        family_decisions=[
            FamilyStrategyDecision(
                family_key=key3,
                strategy=StrategyProfile(
                    name="3-room baseline midpoint",
                    range_position_pct=50,
                    source="candidate_engineering_test_input",
                ),
                rationale="Engineering baseline used only to prove family-level scenario mechanics.",
                source="candidate_engineering_test_input",
            ),
            FamilyStrategyDecision(
                family_key=key5,
                strategy=StrategyProfile(
                    name="5-room baseline midpoint",
                    range_position_pct=50,
                    source="candidate_engineering_test_input",
                ),
                rationale="Engineering baseline used only to prove family-level scenario mechanics.",
                source="candidate_engineering_test_input",
            ),
        ],
    )
    baseline_result = price_project_decision(pairs, baseline)

    market3 = next(market for unit, market in pairs if unit.unit_number == standard_3.unit_number)
    efi = next(
        contribution
        for contribution in market3.new_development.primary_contributors
        if contribution.group_key == "אפי בעיר היין, אשקלון" and contribution.target_equivalent_indication is not None
    )
    efi_source_id = efi.source_ids[0]
    efi_target_equiv = float(efi.target_equivalent_indication)

    competitor_scenario = ProjectDecisionPlan(
        name="engineering_3room_competitor_anchor_scenario",
        source="candidate_engineering_test_input",
        note=(
            "Engineering scenario only. It demonstrates what the product reports if Marketing explicitly chooses to position the 3-room family "
            "against a real named competitor. It is not represented as Gabay strategy."
        ),
        family_decisions=[
            FamilyStrategyDecision(
                family_key=key3,
                strategy=StrategyProfile(
                    name="3-room explicit Afi competitor anchor",
                    basis=PricingBasis.COMPETITOR_REFERENCE,
                    competitor_reference_ils=efi_target_equiv,
                    competitor_reference_source_id=efi_source_id,
                    competitor_reference_name="אפי בעיר היין, אשקלון",
                    competitor_delta_ils=0,
                    source="candidate_engineering_test_input",
                ),
                rationale=(
                    "Demonstrate a deliberate Marketing decision to benchmark the 3-room family against the explicitly priced Afi City Wine offer. "
                    "The reference value is the evidence engine's transparent target-area indication, not an invented competitor price."
                ),
                source="candidate_engineering_test_input",
            ),
            FamilyStrategyDecision(
                family_key=key5,
                strategy=StrategyProfile(
                    name="5-room unchanged baseline",
                    range_position_pct=50,
                    source="candidate_engineering_test_input",
                ),
                rationale="Hold the 5-room family unchanged so the scenario isolates the 3-room commercial decision.",
                source="candidate_engineering_test_input",
            ),
        ],
    )
    scenario_result = price_project_decision(pairs, competitor_scenario)
    impact = compare_decision_scenarios(baseline_result, scenario_result)

    payload = {
        "disclaimer": (
            "The assignment supplied no project location or Gabay internal pricing strategy. City Wine, Ashkelon is a candidate-selected demo market. "
            "The baseline 50% positions and the decision to anchor 3-room units to Afi are engineering scenario inputs only. The competitor evidence itself "
            "comes from the real collected market snapshot."
        ),
        "location": {
            "city": location.city,
            "neighborhood": location.neighborhood,
            "latitude": location.latitude,
            "longitude": location.longitude,
            "source": location.source,
        },
        "real_competitor_anchor_used_in_scenario": {
            "project_name": efi.group_key,
            "source_id": efi_source_id,
            "observed_offer_price_ils": efi.representative_observed_price,
            "observed_offer_area_sqm": efi.representative_observed_area,
            "target_area_sqm": market3.target_internal_area,
            "transparent_target_area_indication_ils": efi.target_equivalent_indication,
            "neighborhood": efi.neighborhood,
            "distance_m": efi.distance_m,
            "warning": "Target-area indication uses observed price-per-sqm x target internal area; it is evidence normalization, not a claim of perfect linear pricing.",
        },
        "baseline": baseline_result.public_dict(),
        "scenario": scenario_result.public_dict(),
        "impact": impact.public_dict(),
    }
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({
        "baseline_metrics": baseline_result.project_metrics,
        "scenario_metrics": scenario_result.project_metrics,
        "impact": {
            "changed_unit_count": impact.changed_unit_count,
            "total_list_value_delta_ils": impact.total_list_value_delta_ils,
            "review_units_before": impact.review_units_before,
            "review_units_after": impact.review_units_after,
            "family_impacts": [
                {
                    "family_key": item.family_key,
                    "changed_unit_count": item.changed_unit_count,
                    "delta_ils": item.delta_ils,
                }
                for item in impact.family_impacts
            ],
        },
        "competitor_anchor": payload["real_competitor_anchor_used_in_scenario"],
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
