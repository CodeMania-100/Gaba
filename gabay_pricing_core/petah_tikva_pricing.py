"""Shared standard-unit (3R/5R) pricing helpers for the Petah Tikva demo.

Single source of truth for two call sites that must never drift apart:
run_petah_tikva_standard_price_list_v1.py (freezes the baseline price list)
and app_api/petah_tikva_workspace.py (serves the baseline + on-demand
strategy scenarios). Both reconstruct MarketRangeResult from the same frozen
data/frozen/petah_tikva_standard_market_ranges_v1.json and price units through
the same unmodified pricing_core.decision.price_project_decision -- no pricing
math is duplicated or re-derived here.
"""

from __future__ import annotations

import json
from pathlib import Path

from pricing_core import (
    EvidenceConfidence,
    FamilyStrategyDecision,
    LaneRange,
    MarketRangeResult,
    PricingBasis,
    ProjectDecisionPlan,
    RangeMethodology,
    RangeStatus,
    StrategyProfile,
    Unit,
    family_key,
    normalize_inventory_rows,
    price_project_decision,
)

MARKET_RANGES_RELATIVE_PATH = "data/frozen/petah_tikva_standard_market_ranges_v1.json"
INVENTORY_RELATIVE_PATH = "inventory_source_rows.json"

BASELINE_POSITION_PCT = 50.0
BASELINE_PLAN_NAME = "petah_tikva_standard_baseline"

_POSITION_MIN, _POSITION_MAX = 0.0, 100.0


def lane_from_dict(d: dict) -> LaneRange:
    return LaneRange(
        lane=d["lane"],
        confidence=EvidenceConfidence(d["confidence"]),
        lower=d["range"]["lower"],
        center=d["range"]["center"],
        upper=d["range"]["upper"],
        # Full per-contributor provenance already lives in the frozen market-range
        # file; not re-hydrated here since the market_range_position strategy basis
        # never reads it (unlike competitor_reference).
        primary_contributors=[],
        reference_records=d["reference_records"],
        warnings=d["warnings"],
        methodology_notes=d["methodology_notes"],
        can_enter_consensus=d["can_enter_consensus"],
    )


def market_range_from_dict(d: dict) -> MarketRangeResult:
    return MarketRangeResult(
        status=RangeStatus(d["status"]),
        confidence=EvidenceConfidence(d["confidence"]),
        methodology=RangeMethodology(**d["methodology"]),
        target_unit_number=d["target_unit_number"],
        target_internal_area=d["target_internal_area"],
        supported_lower=d["supported_range"]["lower"],
        supported_upper=d["supported_range"]["upper"],
        support_lanes=d["supported_range"]["support_lanes"],
        sold=lane_from_dict(d["lanes"]["sold"]),
        current_asking=lane_from_dict(d["lanes"]["current_asking"]),
        new_development=lane_from_dict(d["lanes"]["new_development"]),
        warnings=d["warnings"],
        assumptions=d["assumptions"],
        decision_notes=d["decision_notes"],
    )


def standard_unit_market_pairs(root: Path) -> list[tuple[Unit, MarketRangeResult]]:
    """The 32 standard units paired with their (frozen, unmodified) family market
    range. Reads only frozen artifacts -- never recomputes evidence."""

    market_ranges = json.loads((root / MARKET_RANGES_RELATIVE_PATH).read_text(encoding="utf-8"))
    market_3r = market_range_from_dict(market_ranges["families"]["3R"]["market_range"])
    market_5r = market_range_from_dict(market_ranges["families"]["5R"]["market_range"])

    inventory_rows = json.loads((root / INVENTORY_RELATIVE_PATH).read_text(encoding="utf-8"))
    normalized = normalize_inventory_rows(inventory_rows)
    standard_units = [n.unit for n in normalized if n.unit.unit_type == "standard_apartment"]

    pairs: list[tuple[Unit, MarketRangeResult]] = []
    for unit in standard_units:
        if unit.rooms == 3:
            pairs.append((unit, market_3r))
        elif unit.rooms == 5:
            pairs.append((unit, market_5r))
        else:
            raise ValueError(f"Unexpected standard-family room count for unit {unit.unit_number}: {unit.rooms}")
    return pairs


def clamp_range_position_pct(value: float) -> float:
    return max(_POSITION_MIN, min(_POSITION_MAX, float(value)))


def build_market_range_position_plan(
    pairs: list[tuple[Unit, MarketRangeResult]],
    range_position_pct: float,
    *,
    plan_name: str,
    note: str,
    rationale: str,
) -> ProjectDecisionPlan:
    """A single explicit range-position strategy applied to both the 3R and 5R
    families -- the only strategy mechanism this demo currently offers.
    ``pricing_core.strategy`` supports richer bases (competitor_reference,
    explicit floor rules, min/max constraints, negotiation buffers); none of
    those are invented here because no verified company rule exists yet."""

    position = clamp_range_position_pct(range_position_pct)
    key_3r = family_key(next(u for u, _ in pairs if u.rooms == 3))
    key_5r = family_key(next(u for u, _ in pairs if u.rooms == 5))

    def _decision(key: str, label: str) -> FamilyStrategyDecision:
        return FamilyStrategyDecision(
            family_key=key,
            strategy=StrategyProfile(
                name=f"{label} @ {position:g}% of supported range",
                basis=PricingBasis.MARKET_RANGE_POSITION,
                range_position_pct=position,
                source="candidate_engineering_test_input",
            ),
            rationale=rationale,
            source="candidate_engineering_test_input",
        )

    return ProjectDecisionPlan(
        name=plan_name,
        source="candidate_engineering_test_input",
        note=note,
        family_decisions=[_decision(key_3r, "3-room"), _decision(key_5r, "5-room")],
    )


def price_standard_units_at_position(
    pairs: list[tuple[Unit, MarketRangeResult]],
    range_position_pct: float,
    *,
    plan_name: str,
    note: str,
    rationale: str,
):
    plan = build_market_range_position_plan(
        pairs, range_position_pct, plan_name=plan_name, note=note, rationale=rationale
    )
    return plan, price_project_decision(pairs, plan)


def price_standard_units_baseline(pairs: list[tuple[Unit, MarketRangeResult]]):
    return price_standard_units_at_position(
        pairs,
        BASELINE_POSITION_PCT,
        plan_name=BASELINE_PLAN_NAME,
        note=(
            "50% range positions are an engineering baseline consistent with the "
            "existing family-decision convention; they are not Gabay commercial "
            "strategy or a pricing recommendation."
        ),
        rationale=(
            "No explicit Gabay commercial strategy exists yet for Petah Tikva; "
            "the midpoint of the supported market range is used as a neutral "
            "engineering baseline so the price list is reproducible."
        ),
    )
