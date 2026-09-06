from __future__ import annotations

from datetime import date

import pytest

from pricing_core import (
    EvidenceConfidence,
    EvidenceContribution,
    FamilyStrategyDecision,
    LaneRange,
    MarketRangeResult,
    OwnProjectSaleRecord,
    PricingBasis,
    ProjectDecisionPlan,
    RangeMethodology,
    RangeStatus,
    StrategyProfile,
    Unit,
    UnitPricingStatus,
    compare_decision_scenarios,
    family_key,
    price_project_decision,
)


def unit(number: str, rooms: int, area: float, floor: int = 4, unit_type: str = "standard_apartment") -> Unit:
    return Unit(number, floor, rooms, area, unit_type=unit_type)


def empty_lane(name: str) -> LaneRange:
    return LaneRange(name, EvidenceConfidence.MEDIUM, None, None, None, [], [], [], [], False)


def market(number: str, area: float, low: float, high: float, *, special: bool = False, with_competitor: bool = False) -> MarketRangeResult:
    new_dev = empty_lane("new_development")
    if with_competitor:
        new_dev = LaneRange(
            lane="new_development",
            confidence=EvidenceConfidence.LOW,
            lower=1_491_000,
            center=1_491_000,
            upper=1_491_000,
            primary_contributors=[
                EvidenceContribution(
                    lane="new_development",
                    group_key="אפי בעיר היין, אשקלון",
                    source_ids=["efi:3r:0"],
                    observed_prices=[1_772_000],
                    observed_areas=[82],
                    representative_observed_price=1_772_000,
                    representative_observed_area=82,
                    representative_price_per_sqm=21_609.76,
                    area_normalized_indication_ils=1_491_000,
                    neighborhood="עיר היין, אשקלון",
                )
            ],
            reference_records=[
                {
                    "source_id": "peretz:3r:0",
                    "price": 1_680_000,
                    "area": None,
                    "project_name": "פרץ בוני הנגב בעיר היין, אשקלון",
                    "neighborhood": "עיר היין, אשקלון",
                    "source_url": "https://example.test/peretz",
                }
            ],
            warnings=[],
            methodology_notes=[],
            can_enter_consensus=False,
        )
    return MarketRangeResult(
        status=RangeStatus.MANUAL_REVIEW if special else RangeStatus.CONSENSUS,
        confidence=EvidenceConfidence.INSUFFICIENT if special else EvidenceConfidence.MEDIUM,
        methodology=RangeMethodology(),
        target_unit_number=number,
        target_internal_area=area,
        supported_lower=None if special else low,
        supported_upper=None if special else high,
        support_lanes=[] if special else ["sold", "current_asking"],
        sold=empty_lane("sold"),
        current_asking=empty_lane("current_asking"),
        new_development=new_dev,
        warnings=[],
        assumptions=[],
        decision_notes=[],
    )


def family_decision(u: Unit, name: str, pct: float) -> FamilyStrategyDecision:
    return FamilyStrategyDecision(
        family_key=family_key(u),
        strategy=StrategyProfile(name=name, range_position_pct=pct),
        rationale="Explicit engineering test decision for this apartment family.",
        source="candidate_engineering_test_input",
    )


def test_project_decision_requires_explicit_strategy_per_standard_family():
    u3 = unit("17", 3, 69)
    u5 = unit("7", 5, 111.1)
    plan = ProjectDecisionPlan("only-3r", [family_decision(u3, "3r-mid", 50)])
    result = price_project_decision(
        [(u3, market("17", 69, 1_300_000, 1_400_000)), (u5, market("7", 111.1, 1_500_000, 2_000_000))],
        plan,
    )
    by_unit = {x.unit_number: x for x in result.units}
    assert by_unit["17"].status is UnitPricingStatus.PRICED
    assert by_unit["7"].status is UnitPricingStatus.STRATEGY_REQUIRED
    assert by_unit["7"].proposed_list_price_ils is None
    assert result.project_metrics["strategy_required_count"] == 1


def test_two_families_can_have_different_explicit_positions():
    u3 = unit("17", 3, 69)
    u5 = unit("7", 5, 111.1)
    plan = ProjectDecisionPlan(
        "family-specific",
        [family_decision(u3, "3r-low", 25), family_decision(u5, "5r-high", 75)],
    )
    result = price_project_decision(
        [(u3, market("17", 69, 1_300_000, 1_400_000)), (u5, market("7", 111.1, 1_500_000, 2_000_000))],
        plan,
    )
    by_unit = {x.unit_number: x for x in result.units}
    assert by_unit["17"].proposed_list_price_ils == 1_325_000
    assert by_unit["7"].proposed_list_price_ils == 1_875_000


def test_family_decision_requires_a_business_rationale():
    u3 = unit("17", 3, 69)
    decision = FamilyStrategyDecision(family_key=family_key(u3), strategy=StrategyProfile(name="x", range_position_pct=50), rationale="")
    with pytest.raises(ValueError, match="rationale"):
        ProjectDecisionPlan("bad", [decision]).validate()


def test_competitor_reference_must_exist_in_visible_market_evidence():
    u3 = unit("17", 3, 69)
    strategy = StrategyProfile(
        name="efi-anchor",
        basis=PricingBasis.COMPETITOR_REFERENCE,
        competitor_reference_ils=1_491_000,
        competitor_reference_source_id="efi:3r:0",
        competitor_reference_name="אפי בעיר היין, אשקלון",
    )
    plan = ProjectDecisionPlan(
        "competitor",
        [FamilyStrategyDecision(family_key(u3), strategy, "Position this family against the explicitly selected competitor evidence.")],
    )
    result = price_project_decision([(u3, market("17", 69, 1_300_000, 1_550_000, with_competitor=True))], plan)
    assert result.units[0].proposed_list_price_ils == 1_491_000
    summary = result.family_summaries[0]
    assert summary.competitor_reference is not None
    assert summary.competitor_reference.project_name == "אפי בעיר היין, אשקלון"
    assert summary.competitor_reference.evidence_role == "priced_offer_with_known_area"


def test_typed_fake_competitor_value_cannot_masquerade_as_evidence():
    u3 = unit("17", 3, 69)
    strategy = StrategyProfile(
        name="fake",
        basis=PricingBasis.COMPETITOR_REFERENCE,
        competitor_reference_ils=1_600_000,
        competitor_reference_source_id="efi:3r:0",
        competitor_reference_name="אפי בעיר היין, אשקלון",
    )
    plan = ProjectDecisionPlan(
        "bad-competitor",
        [FamilyStrategyDecision(family_key(u3), strategy, "Engineering negative test.")],
    )
    with pytest.raises(ValueError, match="does not equal"):
        price_project_decision([(u3, market("17", 69, 1_300_000, 1_700_000, with_competitor=True))], plan)


def test_special_unit_stays_manual_even_when_no_family_strategy_exists():
    special = unit("36", 6, 255.2, floor=9, unit_type="triplex")
    result = price_project_decision([(special, market("36", 255.2, 0, 0, special=True))], ProjectDecisionPlan("empty", []))
    assert result.units[0].status is UnitPricingStatus.MANUAL_REVIEW
    assert result.units[0].proposed_list_price_ils is None
    assert result.project_metrics["manual_review_count"] == 1
    assert result.project_metrics["strategy_required_count"] == 0


def test_scenario_reports_which_family_changed_not_just_project_total():
    u3a = unit("17", 3, 69)
    u3b = unit("18", 3, 69)
    u5 = unit("7", 5, 111.1)
    pairs = [
        (u3a, market("17", 69, 1_300_000, 1_400_000)),
        (u3b, market("18", 69, 1_300_000, 1_400_000)),
        (u5, market("7", 111.1, 1_500_000, 2_000_000)),
    ]
    baseline = price_project_decision(
        pairs,
        ProjectDecisionPlan("baseline", [family_decision(u3a, "3r-50", 50), family_decision(u5, "5r-50", 50)]),
    )
    scenario = price_project_decision(
        pairs,
        ProjectDecisionPlan("scenario", [family_decision(u3a, "3r-75", 75), family_decision(u5, "5r-50", 50)]),
    )
    impact = compare_decision_scenarios(baseline, scenario)
    assert impact.changed_unit_count == 2
    by_family = {x.family_key: x for x in impact.family_impacts}
    assert by_family[family_key(u3a)].changed_unit_count == 2
    assert by_family[family_key(u5)].changed_unit_count == 0
    assert by_family[family_key(u3a)].delta_ils == 50_000


def test_default_own_project_sales_reproduces_prior_behavior():
    # Regression guard: the new optional parameter must be a strict no-op when omitted.
    u3 = unit("17", 3, 69)
    plan = ProjectDecisionPlan("only-3r", [family_decision(u3, "3r-mid", 50)])
    pairs = [(u3, market("17", 69, 1_300_000, 1_400_000))]
    without_param = price_project_decision(pairs, plan)
    with_empty_tuple = price_project_decision(pairs, plan, own_project_sales=())
    assert without_param.units[0].proposed_list_price_ils == with_empty_tuple.units[0].proposed_list_price_ils == 1_350_000


def test_own_project_sale_never_alters_external_supported_range():
    u3 = unit("18", 3, 69)
    plan = ProjectDecisionPlan(
        "anchor",
        [
            FamilyStrategyDecision(
                family_key(u3),
                StrategyProfile(name="anchor", basis=PricingBasis.LATEST_OWN_PROJECT_SALE),
                "Marketing wants to anchor remaining 3-room units to the latest realized sale.",
            )
        ],
    )
    own_sales = [
        OwnProjectSaleRecord(
            unit_number="17",
            family_key=family_key(u3),
            contract_date=date(2026, 11, 1),
            contract_price_ils=1_520_000,
            source="engineering_test",
        )
    ]
    m = market("18", 69, 1_300_000, 1_400_000)
    result = price_project_decision([(u3, m)], plan, own_project_sales=own_sales)

    # The external supported range on the market result object itself is untouched --
    # own_project_sales is never threaded into build_market_range/build_comparable_set.
    assert m.supported_lower == 1_300_000
    assert m.supported_upper == 1_400_000
    # And the resulting price legitimately falls outside that external range, which is
    # exactly the kind of consequence the application must surface, not hide.
    assert result.units[0].proposed_list_price_ils == 1_520_000
    assert "proposed_list_price_outside_supported_market_range" in result.units[0].warnings


def test_family_scoped_own_sales_do_not_leak_into_a_different_family():
    u3 = unit("18", 3, 69)
    plan = ProjectDecisionPlan(
        "anchor",
        [
            FamilyStrategyDecision(
                family_key(u3),
                StrategyProfile(name="anchor", basis=PricingBasis.LATEST_OWN_PROJECT_SALE),
                "Anchor to latest realized sale in this family only.",
            )
        ],
    )
    other_family_sale = [
        OwnProjectSaleRecord(
            unit_number="7",
            family_key="standard_apartment|5r|111.1sqm",
            contract_date=date(2026, 11, 1),
            contract_price_ils=1_900_000,
            source="engineering_test",
        )
    ]
    result = price_project_decision(
        [(u3, market("18", 69, 1_300_000, 1_400_000))], plan, own_project_sales=other_family_sale
    )
    assert result.units[0].status is UnitPricingStatus.INSUFFICIENT_EVIDENCE
    assert result.units[0].proposed_list_price_ils is None
