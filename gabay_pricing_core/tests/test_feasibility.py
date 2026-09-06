from pricing_core.feasibility import FeasibilityStatus, check_strategy_feasibility
from pricing_core.strategy import StrategyProfile


def test_contradictory_constraints_return_conflict_with_exact_amount():
    strategy = StrategyProfile(
        name="conflict",
        range_position_pct=50,
        maximum_price_ils=1_600_000,
        minimum_not_below_last_realized_sale=True,
    )

    result = check_strategy_feasibility(strategy, resolved_latest_internal_sale_ils=1_650_000)

    assert result.status == FeasibilityStatus.CONFLICT.value
    assert result.binding_minimum.name == "minimum_not_below_last_realized_sale"
    assert result.binding_minimum.amount_ils == 1_650_000
    assert result.binding_maximum.name == "company_maximum_price"
    assert result.binding_maximum.amount_ils == 1_600_000
    assert result.conflict_amount_ils == 50_000


def test_compatible_bounds_are_feasible():
    strategy = StrategyProfile(
        name="ok",
        range_position_pct=50,
        minimum_price_ils=1_300_000,
        maximum_price_ils=1_600_000,
    )

    result = check_strategy_feasibility(strategy, resolved_latest_internal_sale_ils=None)

    assert result.status == FeasibilityStatus.FEASIBLE.value
    assert result.conflict_amount_ils is None


def test_no_constraints_at_all_is_feasible():
    strategy = StrategyProfile(name="plain", range_position_pct=50)
    result = check_strategy_feasibility(strategy, resolved_latest_internal_sale_ils=None)
    assert result.status == FeasibilityStatus.FEASIBLE.value
