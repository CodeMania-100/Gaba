from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Iterable

from .models import Unit
from .strategy import ProjectPricingResult, UnitPriceResult


class ConsistencySeverity(str, Enum):
    BLOCKER = "blocker"
    REVIEW = "review"


class ConsistencyStatus(str, Enum):
    PASS = "pass"
    REVIEW = "review"
    BLOCKED = "blocked"


@dataclass(slots=True)
class RelativePriceRule:
    """An explicit company relationship between two units.

    The core never invents superiority relationships. A rule exists only when
    Marketing/company configuration supplies it.
    """

    rule_id: str
    higher_priced_unit: str
    lower_priced_unit: str
    minimum_delta_ils: float = 0.0
    source: str = "company_strategy_input"
    note: str | None = None

    def validate(self) -> None:
        if not self.rule_id or not self.rule_id.strip():
            raise ValueError("relative price rule_id is required")
        if self.higher_priced_unit == self.lower_priced_unit:
            raise ValueError("relative price rule must reference two different units")
        if self.minimum_delta_ils < 0:
            raise ValueError("minimum_delta_ils cannot be negative")
        if not self.source or not self.source.strip():
            raise ValueError("relative price rule source is required")


@dataclass(slots=True)
class ConsistencyIssue:
    code: str
    severity: ConsistencySeverity
    message: str
    unit_numbers: list[str] = field(default_factory=list)
    family_key: str | None = None
    source: str | None = None
    expected: dict | None = None
    observed: dict | None = None

    def public_dict(self) -> dict:
        payload = asdict(self)
        payload["severity"] = self.severity.value
        return payload


@dataclass(slots=True)
class ConsistencyReport:
    status: ConsistencyStatus
    blocker_count: int
    review_count: int
    issues: list[ConsistencyIssue]
    checks_applied: list[str]
    checks_not_applied: list[str]

    def public_dict(self) -> dict:
        return {
            "status": self.status.value,
            "blocker_count": self.blocker_count,
            "review_count": self.review_count,
            "issue_count": len(self.issues),
            "checks_applied": self.checks_applied,
            "checks_not_applied": self.checks_not_applied,
            "issues": [issue.public_dict() for issue in self.issues],
        }


def check_project_consistency(
    inventory: Iterable[Unit],
    pricing: ProjectPricingResult,
    relative_price_rules: Iterable[RelativePriceRule] = (),
) -> ConsistencyReport:
    """Check only relationships supported by data or explicit company rules.

    Deliberately *not* checked without an explicit rule:
    - higher floor should cost more
    - east/west orientation should cost more
    - balcony/parking/storage premiums
    - arbitrary minimum spacing between same-family units
    """

    units = list(inventory)
    results = list(pricing.units)
    rules = list(relative_price_rules)
    issues: list[ConsistencyIssue] = []
    checks_applied = [
        "inventory_pricing_cardinality",
        "supported_range_integrity",
        "proposed_price_market_range",
        "explicit_strategy_constraints",
    ]
    checks_not_applied = [
        "floor_ordering_without_explicit_relationship",
        "orientation_premium_without_company_rule",
        "balcony_premium_without_company_rule",
        "parking_or_storage_premium_without_company_rule",
    ]

    inventory_by_number = _unique_units(units, issues)
    result_by_number = _unique_results(results, issues)

    missing_results = sorted(set(inventory_by_number) - set(result_by_number), key=_unit_sort_key)
    if missing_results:
        issues.append(
            ConsistencyIssue(
                code="inventory_units_missing_pricing_result",
                severity=ConsistencySeverity.BLOCKER,
                message="Inventory contains units with no pricing result.",
                unit_numbers=missing_results,
                observed={"missing_result_count": len(missing_results)},
            )
        )

    unknown_results = sorted(set(result_by_number) - set(inventory_by_number), key=_unit_sort_key)
    if unknown_results:
        issues.append(
            ConsistencyIssue(
                code="pricing_results_reference_unknown_units",
                severity=ConsistencySeverity.BLOCKER,
                message="Pricing output contains unit numbers not present in the inventory version.",
                unit_numbers=unknown_results,
                observed={"unknown_result_count": len(unknown_results)},
            )
        )

    strategy = pricing.strategy
    for result in results:
        _check_range_integrity(result, issues)
        _check_market_range_position(result, issues)
        _check_explicit_constraints(result, strategy.minimum_price_ils, strategy.maximum_price_ils, issues)
        _check_floor_adjustment_trace(result, inventory_by_number.get(result.unit_number), strategy.floor_rule, issues)

    if strategy.floor_rule is not None:
        checks_applied.append("explicit_floor_rule_adjustment_integrity")
    else:
        checks_not_applied.append("explicit_floor_rule_adjustment_integrity")

    if rules:
        checks_applied.append("explicit_relative_price_rules")
        for rule in rules:
            rule.validate()
            _check_relative_rule(rule, result_by_number, inventory_by_number, issues)
    else:
        checks_not_applied.append("explicit_relative_price_rules")

    blocker_count = sum(issue.severity is ConsistencySeverity.BLOCKER for issue in issues)
    review_count = sum(issue.severity is ConsistencySeverity.REVIEW for issue in issues)
    status = (
        ConsistencyStatus.BLOCKED
        if blocker_count
        else ConsistencyStatus.REVIEW
        if review_count
        else ConsistencyStatus.PASS
    )
    return ConsistencyReport(
        status=status,
        blocker_count=blocker_count,
        review_count=review_count,
        issues=issues,
        checks_applied=checks_applied,
        checks_not_applied=checks_not_applied,
    )


def _unique_units(units: list[Unit], issues: list[ConsistencyIssue]) -> dict[str, Unit]:
    out: dict[str, Unit] = {}
    duplicates: list[str] = []
    for unit in units:
        if unit.unit_number in out:
            duplicates.append(unit.unit_number)
        else:
            out[unit.unit_number] = unit
    if duplicates:
        values = sorted(set(duplicates), key=_unit_sort_key)
        issues.append(
            ConsistencyIssue(
                code="duplicate_inventory_unit_number",
                severity=ConsistencySeverity.BLOCKER,
                message="Inventory version contains duplicate unit numbers.",
                unit_numbers=values,
            )
        )
    return out


def _unique_results(results: list[UnitPriceResult], issues: list[ConsistencyIssue]) -> dict[str, UnitPriceResult]:
    out: dict[str, UnitPriceResult] = {}
    duplicates: list[str] = []
    for result in results:
        if result.unit_number in out:
            duplicates.append(result.unit_number)
        else:
            out[result.unit_number] = result
    if duplicates:
        values = sorted(set(duplicates), key=_unit_sort_key)
        issues.append(
            ConsistencyIssue(
                code="duplicate_pricing_result_unit_number",
                severity=ConsistencySeverity.BLOCKER,
                message="Pricing result contains duplicate unit numbers.",
                unit_numbers=values,
            )
        )
    return out


def _check_range_integrity(result: UnitPriceResult, issues: list[ConsistencyIssue]) -> None:
    if (
        result.supported_lower is not None
        and result.supported_upper is not None
        and result.supported_lower > result.supported_upper
    ):
        issues.append(
            ConsistencyIssue(
                code="invalid_supported_market_range",
                severity=ConsistencySeverity.BLOCKER,
                message="Supported market range has a lower bound above its upper bound.",
                unit_numbers=[result.unit_number],
                family_key=result.family_key,
                observed={"lower": result.supported_lower, "upper": result.supported_upper},
            )
        )
    if result.proposed_list_price_ils is not None and result.proposed_list_price_ils <= 0:
        issues.append(
            ConsistencyIssue(
                code="non_positive_proposed_price",
                severity=ConsistencySeverity.BLOCKER,
                message="A proposed list price must be positive.",
                unit_numbers=[result.unit_number],
                family_key=result.family_key,
                observed={"proposed_list_price_ils": result.proposed_list_price_ils},
            )
        )


def _check_market_range_position(result: UnitPriceResult, issues: list[ConsistencyIssue]) -> None:
    price = result.proposed_list_price_ils
    low = result.supported_lower
    high = result.supported_upper
    if price is None or low is None or high is None or low > high:
        return
    if price < low or price > high:
        issues.append(
            ConsistencyIssue(
                code="proposed_price_outside_supported_market_range",
                severity=ConsistencySeverity.REVIEW,
                message="Commercial price is outside the market-supported interval and requires review.",
                unit_numbers=[result.unit_number],
                family_key=result.family_key,
                source="market_range",
                expected={"lower": low, "upper": high},
                observed={"proposed_list_price_ils": price},
            )
        )


def _check_explicit_constraints(
    result: UnitPriceResult,
    minimum_price_ils: float | None,
    maximum_price_ils: float | None,
    issues: list[ConsistencyIssue],
) -> None:
    price = result.proposed_list_price_ils
    if price is None:
        return
    if minimum_price_ils is not None and price < minimum_price_ils:
        issues.append(
            ConsistencyIssue(
                code="explicit_minimum_price_constraint_breached",
                severity=ConsistencySeverity.REVIEW,
                message="Final price is below the explicit company minimum price constraint.",
                unit_numbers=[result.unit_number],
                family_key=result.family_key,
                source="company_strategy_input",
                expected={"minimum_price_ils": minimum_price_ils},
                observed={"proposed_list_price_ils": price},
            )
        )
    if maximum_price_ils is not None and price > maximum_price_ils:
        issues.append(
            ConsistencyIssue(
                code="explicit_maximum_price_constraint_breached",
                severity=ConsistencySeverity.REVIEW,
                message="Final price is above the explicit company maximum price constraint.",
                unit_numbers=[result.unit_number],
                family_key=result.family_key,
                source="company_strategy_input",
                expected={"maximum_price_ils": maximum_price_ils},
                observed={"proposed_list_price_ils": price},
            )
        )


def _check_floor_adjustment_trace(result, unit, floor_rule, issues) -> None:
    if floor_rule is None or unit is None:
        return
    try:
        floor = float(unit.floor)
    except (TypeError, ValueError):
        # The strategy engine intentionally applies no floor adjustment when the
        # inventory floor is non-numeric. That is not a consistency failure.
        return

    expected = (floor - floor_rule.reference_floor) * floor_rule.amount_per_floor_ils
    observed = sum(a.amount_ils for a in result.adjustments if a.kind == "company_floor_rule")
    if round(expected) != round(observed):
        issues.append(
            ConsistencyIssue(
                code="explicit_floor_rule_adjustment_mismatch",
                severity=ConsistencySeverity.BLOCKER,
                message="Recorded floor adjustment does not match the explicit company floor rule.",
                unit_numbers=[result.unit_number],
                family_key=result.family_key,
                source=floor_rule.source,
                expected={"floor_adjustment_ils": float(round(expected))},
                observed={"floor_adjustment_ils": float(round(observed))},
            )
        )


def _check_relative_rule(
    rule: RelativePriceRule,
    results: dict[str, UnitPriceResult],
    inventory: dict[str, Unit],
    issues: list[ConsistencyIssue],
) -> None:
    missing = [u for u in (rule.higher_priced_unit, rule.lower_priced_unit) if u not in inventory]
    if missing:
        issues.append(
            ConsistencyIssue(
                code="relative_price_rule_references_unknown_unit",
                severity=ConsistencySeverity.BLOCKER,
                message="Explicit relative-price rule references a unit not present in the inventory version.",
                unit_numbers=missing,
                source=rule.source,
                expected={"rule_id": rule.rule_id},
            )
        )
        return

    high = results.get(rule.higher_priced_unit)
    low = results.get(rule.lower_priced_unit)
    if high is None or low is None:
        # Cardinality checks already report missing pricing rows.
        return
    if high.proposed_list_price_ils is None or low.proposed_list_price_ils is None:
        issues.append(
            ConsistencyIssue(
                code="relative_price_rule_cannot_be_evaluated",
                severity=ConsistencySeverity.REVIEW,
                message="Explicit relative-price rule cannot be evaluated because at least one unit has no proposed price.",
                unit_numbers=[rule.higher_priced_unit, rule.lower_priced_unit],
                source=rule.source,
                expected={"rule_id": rule.rule_id, "minimum_delta_ils": rule.minimum_delta_ils},
            )
        )
        return

    required = low.proposed_list_price_ils + rule.minimum_delta_ils
    if high.proposed_list_price_ils < required:
        issues.append(
            ConsistencyIssue(
                code="explicit_relative_price_rule_breached",
                severity=ConsistencySeverity.REVIEW,
                message="Final price list breaches an explicit company relative-price rule.",
                unit_numbers=[rule.higher_priced_unit, rule.lower_priced_unit],
                family_key=high.family_key if high.family_key == low.family_key else None,
                source=rule.source,
                expected={
                    "rule_id": rule.rule_id,
                    "higher_unit_minimum_price_ils": float(round(required)),
                    "minimum_delta_ils": rule.minimum_delta_ils,
                },
                observed={
                    "higher_unit_price_ils": high.proposed_list_price_ils,
                    "lower_unit_price_ils": low.proposed_list_price_ils,
                    "actual_delta_ils": float(round(high.proposed_list_price_ils - low.proposed_list_price_ils)),
                },
            )
        )


def _unit_sort_key(value: str) -> tuple[int, str]:
    try:
        return (0, f"{int(value):09d}")
    except (TypeError, ValueError):
        return (1, str(value))
