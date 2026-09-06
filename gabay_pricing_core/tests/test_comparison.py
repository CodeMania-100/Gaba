from pricing_core.comparison import (
    AttributeAdjustmentRule,
    AttributeStatus,
    ComparableAttributes,
    build_comparable_price_gap,
    compare_attributes,
)


def _target(**overrides):
    base = dict(rooms=3, internal_area=69, floor=4, balcony_present=True, balcony_area_sqm=12)
    base.update(overrides)
    return ComparableAttributes(**base)


def test_balcony_known_zero_from_has_balcony_false_is_different_not_unknown():
    target = _target()
    comparable = ComparableAttributes(rooms=3, internal_area=69, floor=4, balcony_present=False, balcony_area_sqm=0.0)

    comparisons = {c.field: c for c in compare_attributes(target, comparable)}

    assert comparisons["balcony_present"].status == AttributeStatus.DIFFERENT.value
    assert comparisons["balcony_area_sqm"].status == AttributeStatus.DIFFERENT.value
    assert comparisons["balcony_area_sqm"].comparable_value == 0.0


def test_balcony_present_but_unknown_size_is_unknown_not_false():
    target = _target()
    comparable = ComparableAttributes(rooms=3, internal_area=69, floor=4, balcony_present=True, balcony_area_sqm=None)

    comparisons = {c.field: c for c in compare_attributes(target, comparable)}

    assert comparisons["balcony_present"].status == AttributeStatus.MATCH.value
    assert comparisons["balcony_area_sqm"].status == AttributeStatus.UNKNOWN.value


def test_missing_field_is_never_treated_as_false():
    target = _target(parking_present=None)
    comparable = ComparableAttributes(rooms=3, internal_area=69, floor=4, parking_present=None)

    comparisons = {c.field: c for c in compare_attributes(target, comparable)}

    assert comparisons["parking_present"].status == AttributeStatus.UNKNOWN.value


def test_price_gap_matches_worked_example():
    gap = build_comparable_price_gap(
        lane="current_asking",
        source_id="competitor-1",
        target=_target(),
        comparable=ComparableAttributes(rooms=3, internal_area=69, floor=4, balcony_present=False, balcony_area_sqm=0.0),
        observed_price_ils=1_400_000,
        area_normalized_indication_ils=None,
        target_proposed_price_ils=1_500_000,
    )

    assert gap.absolute_gap_ils == 100_000
    assert gap.gap_pct_vs_comparable == 7.14


def test_no_verified_rule_produces_no_monetary_adjustment():
    gap = build_comparable_price_gap(
        lane="current_asking",
        source_id="competitor-1",
        target=_target(),
        comparable=ComparableAttributes(rooms=3, internal_area=69, floor=4, balcony_present=False, balcony_area_sqm=0.0),
        observed_price_ils=1_400_000,
        area_normalized_indication_ils=None,
        target_proposed_price_ils=1_500_000,
    )

    balcony_adjustment = next(a for a in gap.attribute_adjustments if a.attribute == "balcony_present")
    assert balcony_adjustment.amount_ils is None
    assert balcony_adjustment.reason == "NO_VERIFIED_MONETARY_RULE"


def test_explicit_company_rule_produces_exact_adjustment_and_provenance():
    rule = AttributeAdjustmentRule(
        attribute="balcony_area_sqm",
        amount_per_unit_ils=4_000,
        reference_value=0,
        source_type="COMPANY_RULE",
        source_name="Gabay project pricing policy",
    )
    gap = build_comparable_price_gap(
        lane="current_asking",
        source_id="competitor-1",
        target=_target(),
        comparable=ComparableAttributes(rooms=3, internal_area=69, floor=4, balcony_present=False, balcony_area_sqm=0.0),
        observed_price_ils=1_400_000,
        area_normalized_indication_ils=None,
        target_proposed_price_ils=1_500_000,
        adjustment_rules=[rule],
    )

    area_adjustment = next(a for a in gap.attribute_adjustments if a.attribute == "balcony_area_sqm")
    assert area_adjustment.amount_ils == 48_000
    assert area_adjustment.source_type == "COMPANY_RULE"
    assert area_adjustment.source_name == "Gabay project pricing policy"
    assert area_adjustment.reason is None
