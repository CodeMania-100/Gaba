from datetime import date, datetime

from pricing_core.own_sales import (
    OwnProjectSaleRecord,
    compare_against_own_sales,
    summarize_own_project_sales,
)


def _sale(unit_number, contract_date, price, recorded_at=None, family_key="standard_apartment|3r|69sqm"):
    return OwnProjectSaleRecord(
        unit_number=unit_number,
        family_key=family_key,
        contract_date=contract_date,
        contract_price_ils=price,
        source="engineering_test",
        recorded_at=recorded_at,
    )


def test_summary_math_and_family_scoping():
    sales = [
        _sale("4", date(2026, 1, 5), 1_500_000),
        _sale("8", date(2026, 2, 1), 1_560_000),
        _sale("99", date(2026, 3, 1), 5_000_000, family_key="standard_apartment|5r|111.1sqm"),
    ]

    summary = summarize_own_project_sales("standard_apartment|3r|69sqm", sales)

    assert summary.sale_count == 2
    assert summary.lower_ils == 1_500_000
    assert summary.upper_ils == 1_560_000
    assert summary.latest_sale.unit_number == "8"


def test_deterministic_tie_break_on_equal_contract_date():
    same_day = date(2026, 4, 1)
    sales = [
        _sale("4", same_day, 1_500_000, recorded_at=datetime(2026, 4, 1, 9, 0)),
        _sale("8", same_day, 1_560_000, recorded_at=datetime(2026, 4, 1, 14, 0)),
    ]

    summary = summarize_own_project_sales("standard_apartment|3r|69sqm", sales)

    assert summary.latest_sale.unit_number == "8"  # recorded later on the same contract date


def test_no_sales_yields_empty_summary():
    summary = summarize_own_project_sales("standard_apartment|3r|69sqm", [])
    assert summary.sale_count == 0
    assert summary.latest_sale is None


def test_comparison_flags_inside_and_above():
    summary = summarize_own_project_sales(
        "standard_apartment|3r|69sqm",
        [_sale("4", date(2026, 1, 1), 1_520_000)],
    )

    flags = compare_against_own_sales(1_550_000, 1_500_000, 1_600_000, summary)
    assert flags.inside_external_support is True
    assert flags.above_latest_internal_sale_ils == 30_000


def test_comparison_flags_outside_support():
    summary = summarize_own_project_sales("standard_apartment|3r|69sqm", [])
    flags = compare_against_own_sales(1_700_000, 1_500_000, 1_600_000, summary)
    assert flags.inside_external_support is False
    assert flags.above_latest_internal_sale_ils is None
