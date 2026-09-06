from __future__ import annotations

from datetime import date

from pricing_core import (
    EvidenceConfidence,
    FloorRule,
    LaneRange,
    MarketRangeResult,
    OwnProjectSaleRecord,
    PricingBasis,
    RangeMethodology,
    RangeStatus,
    StrategyProfile,
    Unit,
    UnitPricingStatus,
    compare_scenarios,
    price_project,
    price_unit,
)


def unit(number="17", floor=4, unit_type="standard_apartment"):
    return Unit(number, floor, 3, 69, balcony_area=12, orientation="מזרח", unit_type=unit_type)


def empty_lane(name="sold"):
    return LaneRange(name, EvidenceConfidence.MEDIUM, None, None, None, [], [], [], [], False)


def market(number="17", low=1_300_000, high=1_400_000, confidence=EvidenceConfidence.MEDIUM):
    return MarketRangeResult(
        status=RangeStatus.CONSENSUS,
        confidence=confidence,
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


def test_market_position_is_explicit_inside_supported_range():
    result = price_unit(unit(), market(), StrategyProfile(name="mid", range_position_pct=50))
    assert result.commercial_base_price_ils == 1_350_000
    assert result.proposed_list_price_ils == 1_350_000
    assert result.requires_review is False


def test_no_floor_rule_means_floor_does_not_secretly_change_price():
    strategy = StrategyProfile(name="mid", range_position_pct=50)
    low_floor = price_unit(unit("1", floor=1), market("1"), strategy)
    high_floor = price_unit(unit("2", floor=8), market("2"), strategy)
    assert low_floor.proposed_list_price_ils == high_floor.proposed_list_price_ils
    assert not any(a.kind == "company_floor_rule" for a in high_floor.adjustments)


def test_explicit_floor_rule_changes_only_by_supplied_amount():
    strategy = StrategyProfile(
        name="floor",
        range_position_pct=50,
        floor_rule=FloorRule(reference_floor=4, amount_per_floor_ils=10_000),
    )
    result = price_unit(unit(floor=6), market(), strategy)
    assert result.proposed_list_price_ils == 1_370_000
    adj = next(a for a in result.adjustments if a.kind == "company_floor_rule")
    assert adj.amount_ils == 20_000


def test_negotiation_buffer_is_explicit_and_can_trigger_market_review():
    strategy = StrategyProfile(name="buffer", range_position_pct=100, negotiation_buffer_ils=20_000)
    result = price_unit(unit(), market(), strategy)
    assert result.proposed_list_price_ils == 1_420_000
    assert "proposed_list_price_outside_supported_market_range" in result.warnings
    assert result.requires_review is True


def test_competitor_strategy_requires_source_provenance():
    strategy = StrategyProfile(
        name="competitor",
        basis=PricingBasis.COMPETITOR_REFERENCE,
        competitor_reference_ils=1_500_000,
        competitor_reference_source_id="madlan:P1:0",
        competitor_reference_name="P1",
        competitor_delta_ils=25_000,
    )
    result = price_unit(unit(), market(low=1_400_000, high=1_600_000), strategy)
    assert result.proposed_list_price_ils == 1_525_000
    assert result.requires_review is False


def test_special_unit_is_not_auto_priced_by_strategy():
    m = market()
    m.status = RangeStatus.MANUAL_REVIEW
    m.confidence = EvidenceConfidence.INSUFFICIENT
    result = price_unit(unit(unit_type="triplex"), m, StrategyProfile(name="mid", range_position_pct=50))
    assert result.proposed_list_price_ils is None
    assert result.requires_review is True


def test_scenario_impact_reports_project_value_and_changed_units():
    pairs = [(unit("1", 1), market("1")), (unit("2", 2), market("2"))]
    baseline = price_project(pairs, StrategyProfile(name="baseline", range_position_pct=50))
    scenario = price_project(pairs, StrategyProfile(name="upper", range_position_pct=100))
    impact = compare_scenarios(baseline, scenario)
    assert impact.changed_unit_count == 2
    assert impact.total_list_value_delta_ils == 100_000
    assert all(x.delta_ils == 50_000 for x in impact.unit_impacts)


def _own_sale(price=1_550_000, unit_number="8", contract_date=date(2026, 3, 1)):
    return OwnProjectSaleRecord(
        unit_number=unit_number,
        family_key="standard_apartment|3r|69sqm",
        contract_date=contract_date,
        contract_price_ils=price,
        source="engineering_test",
    )


def test_latest_own_project_sale_basis_uses_the_resolved_record_without_manual_retyping():
    strategy = StrategyProfile(name="anchor", basis=PricingBasis.LATEST_OWN_PROJECT_SALE)
    result = price_unit(unit(), market(), strategy, resolved_latest_internal_sale=_own_sale(price=1_550_000))
    assert result.status is UnitPricingStatus.PRICED
    assert result.commercial_base_price_ils == 1_550_000
    assert result.proposed_list_price_ils == 1_550_000
    assert any("apartment 8" in line for line in result.decision_trace)


def test_latest_own_project_sale_plus_amount_is_explicit_and_traceable():
    strategy = StrategyProfile(
        name="anchor_plus",
        basis=PricingBasis.LATEST_OWN_PROJECT_SALE_PLUS_AMOUNT,
        internal_sale_plus_amount_ils=30_000,
    )
    result = price_unit(unit(), market(), strategy, resolved_latest_internal_sale=_own_sale(price=1_550_000))
    assert result.proposed_list_price_ils == 1_580_000
    adj = next(a for a in result.adjustments if a.kind == "latest_internal_sale_plus_amount")
    assert adj.amount_ils == 30_000
    assert "apartment 8" in adj.explanation


def test_own_sale_basis_without_a_resolved_record_is_insufficient_evidence_not_a_crash():
    strategy = StrategyProfile(name="anchor", basis=PricingBasis.LATEST_OWN_PROJECT_SALE)
    result = price_unit(unit(), market(), strategy, resolved_latest_internal_sale=None)
    assert result.status is UnitPricingStatus.INSUFFICIENT_EVIDENCE
    assert result.proposed_list_price_ils is None


def test_minimum_not_below_last_realized_sale_conflicts_with_lower_maximum_returns_conflict():
    strategy = StrategyProfile(
        name="conflict",
        range_position_pct=50,
        maximum_price_ils=1_600_000,
        minimum_not_below_last_realized_sale=True,
    )
    result = price_unit(unit(), market(), strategy, resolved_latest_internal_sale=_own_sale(price=1_650_000))
    assert result.status is UnitPricingStatus.STRATEGY_CONFLICT
    assert result.proposed_list_price_ils is None
    assert result.feasibility is not None
    assert result.feasibility.conflict_amount_ils == 50_000


def test_minimum_not_below_last_realized_sale_clamps_up_when_compatible():
    strategy = StrategyProfile(
        name="floor_at_last_sale",
        range_position_pct=0,  # would otherwise select the lower bound of the range
        minimum_not_below_last_realized_sale=True,
    )
    result = price_unit(unit(), market(low=1_300_000, high=1_400_000), strategy, resolved_latest_internal_sale=_own_sale(price=1_350_000))
    assert result.proposed_list_price_ils == 1_350_000
    assert any(a.kind == "minimum_not_below_last_realized_sale" for a in result.adjustments)


def test_default_resolved_latest_internal_sale_reproduces_prior_behavior():
    # Regression guard: omitting the new parameter entirely must behave exactly as
    # before for the two original bases.
    result = price_unit(unit(), market(), StrategyProfile(name="mid", range_position_pct=50))
    assert result.proposed_list_price_ils == 1_350_000
