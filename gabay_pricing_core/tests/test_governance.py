from __future__ import annotations

from pricing_core import (
    EvidenceConfidence,
    LaneRange,
    MarketRangeResult,
    PriceOverride,
    RangeMethodology,
    RangeStatus,
    StrategyProfile,
    Unit,
    apply_overrides,
    price_project,
    reprice_unlocked_preserving_locks,
)


def unit(number: str, floor: int = 4) -> Unit:
    return Unit(number, floor, 3, 69, balcony_area=12, unit_type="standard_apartment")


def lane(name: str) -> LaneRange:
    return LaneRange(name, EvidenceConfidence.MEDIUM, None, None, None, [], [], [], [], False)


def market(number: str) -> MarketRangeResult:
    return MarketRangeResult(
        status=RangeStatus.CONSENSUS,
        confidence=EvidenceConfidence.MEDIUM,
        methodology=RangeMethodology(),
        target_unit_number=number,
        target_internal_area=69,
        supported_lower=1_300_000,
        supported_upper=1_400_000,
        support_lanes=["sold", "current_asking"],
        sold=lane("sold"),
        current_asking=lane("current_asking"),
        new_development=lane("new_development"),
        warnings=[], assumptions=[], decision_notes=[],
    )


def pairs():
    return [(unit("1", 1), market("1")), (unit("2", 2), market("2"))]


def test_override_requires_reason():
    pricing = price_project(pairs(), StrategyProfile(name="base", range_position_pct=50))
    try:
        apply_overrides(pricing, [PriceOverride("1", 1_350_000, reason="")])
        assert False, "expected reason validation"
    except ValueError as exc:
        assert "reason" in str(exc)


def test_locked_override_keeps_original_recommendation_in_audit():
    pricing = price_project(pairs(), StrategyProfile(name="base", range_position_pct=50))
    governed = apply_overrides(pricing, [PriceOverride("1", 1_390_000, reason="Commercial decision", locked=True)])
    u1 = next(u for u in governed.pricing.units if u.unit_number == "1")
    assert u1.proposed_list_price_ils == 1_390_000
    assert governed.locked_units == ["1"]
    assert governed.audit_entries[0].recommended_price_before_override_ils == 1_350_000
    assert governed.audit_entries[0].delta_ils == 40_000


def test_override_outside_supported_range_is_flagged_not_hidden():
    pricing = price_project(pairs(), StrategyProfile(name="base", range_position_pct=50))
    governed = apply_overrides(pricing, [PriceOverride("1", 1_500_000, reason="Executive decision", locked=True)])
    u1 = next(u for u in governed.pricing.units if u.unit_number == "1")
    assert "manual_override_outside_supported_market_range" in u1.warnings
    assert u1.requires_review is True
    assert governed.pricing.project_metrics["units_outside_supported_range"] == 1


def test_reprice_unlocked_changes_unlocked_but_preserves_locked_unit():
    baseline = price_project(pairs(), StrategyProfile(name="base", range_position_pct=50))
    locked_price = next(u.proposed_list_price_ils for u in baseline.units if u.unit_number == "1")
    controls = [PriceOverride("1", locked_price, reason="Lock approved unit", locked=True)]

    repriced = reprice_unlocked_preserving_locks(
        pairs(), StrategyProfile(name="upper", range_position_pct=100), controls
    )
    by_unit = {u.unit_number: u for u in repriced.pricing.units}
    assert by_unit["1"].proposed_list_price_ils == 1_350_000
    assert by_unit["2"].proposed_list_price_ils == 1_400_000
    assert repriced.locked_units == ["1"]


def test_unlocked_override_is_not_preserved_through_reprice():
    controls = [PriceOverride("1", 1_330_000, reason="Temporary working edit", locked=False)]
    repriced = reprice_unlocked_preserving_locks(
        pairs(), StrategyProfile(name="upper", range_position_pct=100), controls
    )
    by_unit = {u.unit_number: u for u in repriced.pricing.units}
    assert by_unit["1"].proposed_list_price_ils == 1_400_000
    assert repriced.locked_units == []
