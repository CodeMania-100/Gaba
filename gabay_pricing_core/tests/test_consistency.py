from dataclasses import replace

from pricing_core import (
    ConsistencyStatus,
    EvidenceConfidence,
    FloorRule,
    LaneRange,
    MarketRangeResult,
    PriceOverride,
    RangeMethodology,
    RangeStatus,
    RelativePriceRule,
    StrategyProfile,
    Unit,
    apply_overrides,
    check_project_consistency,
    price_project,
)


def unit(number="1", floor=1):
    return Unit(number, floor, 3, 69, balcony_area=12, unit_type="standard_apartment")


def empty_lane(name="sold"):
    return LaneRange(name, EvidenceConfidence.MEDIUM, None, None, None, [], [], [], [], False)


def market(number="1", low=1_300_000, high=1_400_000):
    return MarketRangeResult(
        status=RangeStatus.CONSENSUS,
        confidence=EvidenceConfidence.MEDIUM,
        methodology=RangeMethodology(),
        target_unit_number=number,
        target_internal_area=69,
        supported_lower=low,
        supported_upper=high,
        support_lanes=["sold", "current_asking"],
        sold=empty_lane("sold"),
        current_asking=empty_lane("current_asking"),
        new_development=empty_lane("new_development"),
        warnings=[],
        assumptions=[],
        decision_notes=[],
    )


def priced_two(strategy=None):
    strategy = strategy or StrategyProfile(name="mid", range_position_pct=50)
    pairs = [(unit("1", 1), market("1")), (unit("2", 8), market("2"))]
    return [u for u, _ in pairs], price_project(pairs, strategy)


def test_no_floor_order_is_invented_without_explicit_rule():
    units, pricing = priced_two()
    pricing.units[1] = replace(pricing.units[1], proposed_list_price_ils=1_340_000)
    report = check_project_consistency(units, pricing)
    assert report.status is ConsistencyStatus.PASS
    assert not any("floor" in issue.code for issue in report.issues)


def test_explicit_relative_price_rule_flags_only_when_breached():
    units, pricing = priced_two()
    rule = RelativePriceRule(
        rule_id="company_stack_rule_1",
        higher_priced_unit="2",
        lower_priced_unit="1",
        minimum_delta_ils=10_000,
        source="company_strategy_input",
    )
    report = check_project_consistency(units, pricing, [rule])
    assert report.status is ConsistencyStatus.REVIEW
    issue = next(i for i in report.issues if i.code == "explicit_relative_price_rule_breached")
    assert issue.unit_numbers == ["2", "1"]


def test_explicit_relative_price_rule_passes_when_satisfied():
    strategy = StrategyProfile(
        name="floor",
        range_position_pct=50,
        floor_rule=FloorRule(reference_floor=1, amount_per_floor_ils=5_000),
    )
    units, pricing = priced_two(strategy)
    rule = RelativePriceRule("rule", "2", "1", minimum_delta_ils=30_000)
    report = check_project_consistency(units, pricing, [rule])
    assert report.status is ConsistencyStatus.PASS


def test_market_range_breach_is_review_not_blocker():
    units, pricing = priced_two()
    governed = apply_overrides(
        pricing,
        [PriceOverride("1", 1_450_000, "Explicit commercial exception")],
    )
    report = check_project_consistency(units, governed.pricing)
    assert report.status is ConsistencyStatus.REVIEW
    assert any(i.code == "proposed_price_outside_supported_market_range" for i in report.issues)


def test_override_can_breach_explicit_minimum_constraint_and_is_reported():
    strategy = StrategyProfile(name="min", range_position_pct=50, minimum_price_ils=1_340_000)
    units, pricing = priced_two(strategy)
    governed = apply_overrides(pricing, [PriceOverride("1", 1_320_000, "Approved exception")])
    report = check_project_consistency(units, governed.pricing)
    assert any(i.code == "explicit_minimum_price_constraint_breached" for i in report.issues)


def test_inventory_pricing_cardinality_mismatch_blocks_approval():
    units, pricing = priced_two()
    report = check_project_consistency(units + [unit("3", 3)], pricing)
    assert report.status is ConsistencyStatus.BLOCKED
    assert any(i.code == "inventory_units_missing_pricing_result" for i in report.issues)


def test_explicit_floor_adjustment_trace_is_verified():
    strategy = StrategyProfile(
        name="floor",
        range_position_pct=50,
        floor_rule=FloorRule(reference_floor=1, amount_per_floor_ils=10_000),
    )
    units, pricing = priced_two(strategy)
    # Corrupt one stored adjustment to prove the consistency layer detects a
    # persisted/result-integrity problem rather than trusting the price row.
    pricing.units[1].adjustments = []
    report = check_project_consistency(units, pricing)
    assert report.status is ConsistencyStatus.BLOCKED
    assert any(i.code == "explicit_floor_rule_adjustment_mismatch" for i in report.issues)
