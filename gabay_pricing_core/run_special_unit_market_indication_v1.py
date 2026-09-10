"""Runs the deterministic special-unit market-indication engine
(pricing_core.special_market_indication, v2 -- tightened eligibility) against
the frozen data/frozen/special_unit_master_data_v1.json package and the real,
normalized assignment inventory, for all 7 special units. Report-only: not
wired into app_api/frontend yet.

Never touches pricing_core.market_range or any standard 3R/5R artifact.
"""

from __future__ import annotations

import json
from pathlib import Path

from pricing_core import normalize_inventory_rows
from pricing_core.special_market_indication import compute_special_unit_indication

from app_api.special_market_indication_data import build_inputs_for_unit, load_master_data

ROOT = Path(__file__).resolve().parent


def ils(v: float | None) -> str:
    return "—" if v is None else f"₪{v:,.0f}"


def main() -> None:
    inventory_rows = json.loads((ROOT / "inventory_source_rows.json").read_text(encoding="utf-8"))
    normalized = normalize_inventory_rows(inventory_rows)
    special_units = {u.unit.unit_number: u.unit for u in normalized if u.unit.unit_type != "standard_apartment"}

    master = load_master_data(ROOT)

    unit_numbers = ["1", "2", "3", "36", "37", "38", "39"]
    for unit_number in unit_numbers:
        unit = special_units[unit_number]
        category, sold_c, sold_x, asking_c, asking_x, nd_c, nd_x = build_inputs_for_unit(
            master, unit_number, unit.rooms, unit.internal_area
        )
        indication = compute_special_unit_indication(
            unit_number=unit_number, category=category, subject_internal_area_sqm=unit.internal_area,
            sold_comparables=sold_c, asking_comparables=asking_c, new_development_comparables=nd_c,
            excluded=sold_x + asking_x + nd_x,
        )

        print("=" * 90)
        print(f"APT {unit_number}  ({category}, {unit.rooms:g} rooms, {unit.internal_area:g} m² internal, floor {unit.floor})")
        print("-" * 90)

        for lane_name in ("sold", "current_asking", "new_development"):
            lane = indication.lanes.get(lane_name)
            if lane is None:
                print(f"  [{lane_name}] OMITTED -- no usable numeric evidence at all")
                continue
            votes = lane_name in indication.voting_lane_names
            status = "VOTES in suggested price" if votes else "CONTEXT ONLY -- excluded from vote (provisional, a non-provisional lane exists)"
            print(f"  [{lane_name}] method={lane.calculation_method} | label=\"{lane.label}\" | {status}")
            print(f"      reference = {ils(lane.reference_ils)}  ({len(lane.comps_used)} used, {len(lane.comps_context_only)} context-only within this lane)")

        print(f"  excluded entirely: {len(indication.excluded)} record(s) (quarantine/rejected/no-area-join/context-price -- unchanged from prior report)")
        print("-" * 90)
        print(f"  voting lanes: {indication.voting_lane_names}")
        print(f"  indicative range: {ils(indication.indicative_lower_ils)} - {ils(indication.indicative_upper_ils)}")
        print(f"  suggested price:  {ils(indication.suggested_price_ils)}")
        print(f"  confidence: {indication.confidence.upper()} -- {indication.confidence_reason}")
        print()


if __name__ == "__main__":
    main()
