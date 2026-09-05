from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from statistics import mean
from typing import Iterable

from .feasibility import FeasibilityStatus, StrategyFeasibilityResult, check_strategy_feasibility
from .market_range import EvidenceConfidence, MarketRangeResult, RangeStatus
from .models import Unit
from .own_sales import OwnProjectSaleRecord


class PricingBasis(str, Enum):
    MARKET_RANGE_POSITION = "market_range_position"
    COMPETITOR_REFERENCE = "competitor_reference"
    # The engine derives "latest" itself from the resolved OwnProjectSaleRecord for the
    # unit's family -- there is deliberately no manually-typed reference unit/price for
    # these two bases. A future SELECTED_OWN_PROJECT_SALE_REFERENCE basis, for a
    # deliberately hand-picked (not necessarily latest) internal sale, is out of scope.
    LATEST_OWN_PROJECT_SALE = "latest_own_project_sale"
    LATEST_OWN_PROJECT_SALE_PLUS_AMOUNT = "latest_own_project_sale_plus_amount"


class UnitPricingStatus(str, Enum):
    PRICED = "priced"
    MANUAL_REVIEW = "manual_review"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    STRATEGY_REQUIRED = "strategy_required"
    STRATEGY_CONFLICT = "strategy_conflict"


@dataclass(slots=True)
class FloorRule:
    """Optional company rule. No rule exists unless Marketing supplies it."""

    reference_floor: float
    amount_per_floor_ils: float
    source: str = "company_strategy_input"
    note: str | None = None


@dataclass(slots=True)
class StrategyProfile:
    """Explicit commercial inputs applied *after* market evidence.

    The engine intentionally contains no hidden premium/discount defaults.
    Numerical strategy fields only affect price when they are explicitly set.
    """

    name: str
    basis: PricingBasis = PricingBasis.MARKET_RANGE_POSITION

    # 0 = lower bound, 50 = midpoint, 100 = upper bound. This is a position
    # inside the already-supported interval, not a statistical percentile.
    range_position_pct: float | None = None

    # For competitor-reference strategy, these must come from a selected evidence
    # record in the application. The core accepts the resolved value + provenance.
    competitor_reference_ils: float | None = None
    competitor_reference_source_id: str | None = None
    competitor_reference_name: str | None = None
    competitor_delta_ils: float = 0.0

    # Optional explicit company inputs. Zero means no effect.
    negotiation_buffer_ils: float = 0.0
    floor_rule: FloorRule | None = None
    minimum_price_ils: float | None = None
    maximum_price_ils: float | None = None

    # For latest_own_project_sale_plus_amount only. The "latest" reference itself is
    # never typed manually -- it is resolved by the engine from the family's own
    # realized sales (see pricing_core.decision.price_project_decision).
    internal_sale_plus_amount_ils: float = 0.0

    # Optional modifier combinable with any basis: the proposed price may never fall
    # below the family's latest realized own-project sale. Detected for feasibility
    # against maximum_price_ils before any price is computed (see check_strategy_feasibility).
    minimum_not_below_last_realized_sale: bool = False

    source: str = "marketing_input"
    note: str | None = None

    def validate(self) -> None:
        if self.basis is PricingBasis.MARKET_RANGE_POSITION:
            if self.range_position_pct is None:
                raise ValueError("range_position_pct is required for market_range_position strategy")
            if not 0 <= self.range_position_pct <= 100:
                raise ValueError("range_position_pct must be between 0 and 100")
        elif self.basis is PricingBasis.COMPETITOR_REFERENCE:
            if self.competitor_reference_ils is None or self.competitor_reference_ils <= 0:
                raise ValueError("competitor_reference_ils must be a positive resolved evidence value")
            if not self.competitor_reference_source_id:
                raise ValueError("competitor_reference_source_id is required for provenance")

        if self.negotiation_buffer_ils < 0:
            raise ValueError("negotiation_buffer_ils cannot be negative")
        if self.minimum_price_ils is not None and self.minimum_price_ils <= 0:
            raise ValueError("minimum_price_ils must be positive")
        if self.maximum_price_ils is not None and self.maximum_price_ils <= 0:
            raise ValueError("maximum_price_ils must be positive")
        if (
            self.minimum_price_ils is not None
            and self.maximum_price_ils is not None
            and self.minimum_price_ils > self.maximum_price_ils
        ):
            raise ValueError("minimum_price_ils cannot exceed maximum_price_ils")


@dataclass(slots=True)
class PriceAdjustment:
    kind: str
    amount_ils: float
    source: str
    explanation: str


@dataclass(slots=True)
class UnitPriceResult:
    unit_number: str
    family_key: str
    status: UnitPricingStatus
    market_confidence: EvidenceConfidence
    supported_lower: float | None
    supported_upper: float | None
    commercial_base_price_ils: float | None
    proposed_list_price_ils: float | None
    adjustments: list[PriceAdjustment]
    warnings: list[str]
    decision_trace: list[str]
    requires_review: bool
    feasibility: StrategyFeasibilityResult | None = None

    def public_dict(self) -> dict:
        return {
            "unit_number": self.unit_number,
            "family_key": self.family_key,
            "status": self.status.value,
            "market_confidence": self.market_confidence.value,
            "supported_range": {
                "lower": self.supported_lower,
                "upper": self.supported_upper,
            },
            "commercial_base_price_ils": self.commercial_base_price_ils,
            "proposed_list_price_ils": self.proposed_list_price_ils,
            "adjustments": [asdict(x) for x in self.adjustments],
            "warnings": self.warnings,
            "decision_trace": self.decision_trace,
            "requires_review": self.requires_review,
            "feasibility": self.feasibility.public_dict() if self.feasibility else None,
        }


@dataclass(slots=True)
class ProjectPricingResult:
    strategy: StrategyProfile
    units: list[UnitPriceResult]
    project_metrics: dict

    def public_dict(self) -> dict:
        strategy = asdict(self.strategy)
        strategy["basis"] = self.strategy.basis.value
        return {
            "strategy": strategy,
            "project_metrics": self.project_metrics,
            "units": [u.public_dict() for u in self.units],
        }


@dataclass(slots=True)
class UnitScenarioImpact:
    unit_number: str
    baseline_price_ils: float | None
    scenario_price_ils: float | None
    delta_ils: float | None
    baseline_requires_review: bool
    scenario_requires_review: bool


@dataclass(slots=True)
class ScenarioImpactResult:
    baseline_strategy_name: str
    scenario_strategy_name: str
    changed_unit_count: int
    total_list_value_before_ils: float
    total_list_value_after_ils: float
    total_list_value_delta_ils: float
    units_outside_supported_range_before: int
    units_outside_supported_range_after: int
    manual_or_unpriced_before: int
    manual_or_unpriced_after: int
    unit_impacts: list[UnitScenarioImpact]

    def public_dict(self) -> dict:
        return {
            "baseline_strategy_name": self.baseline_strategy_name,
            "scenario_strategy_name": self.scenario_strategy_name,
            "changed_unit_count": self.changed_unit_count,
            "total_list_value_before_ils": self.total_list_value_before_ils,
            "total_list_value_after_ils": self.total_list_value_after_ils,
            "total_list_value_delta_ils": self.total_list_value_delta_ils,
            "units_outside_supported_range_before": self.units_outside_supported_range_before,
            "units_outside_supported_range_after": self.units_outside_supported_range_after,
            "manual_or_unpriced_before": self.manual_or_unpriced_before,
            "manual_or_unpriced_after": self.manual_or_unpriced_after,
            "unit_impacts": [asdict(x) for x in self.unit_impacts],
        }


_OWN_SALE_BASES = (PricingBasis.LATEST_OWN_PROJECT_SALE, PricingBasis.LATEST_OWN_PROJECT_SALE_PLUS_AMOUNT)


def price_unit(
    unit: Unit,
    market: MarketRangeResult,
    strategy: StrategyProfile,
    resolved_latest_internal_sale: OwnProjectSaleRecord | None = None,
) -> UnitPriceResult:
    strategy.validate()

    if market.status is RangeStatus.MANUAL_REVIEW:
        return UnitPriceResult(
            unit_number=unit.unit_number,
            family_key=_family_key(unit),
            status=UnitPricingStatus.MANUAL_REVIEW,
            market_confidence=market.confidence,
            supported_lower=market.supported_lower,
            supported_upper=market.supported_upper,
            commercial_base_price_ils=None,
            proposed_list_price_ils=None,
            adjustments=[],
            warnings=list(market.warnings) + ["strategy_not_applied_to_manual_review_unit"],
            decision_trace=["Market engine requires individual pricing review; no automatic commercial price was created."],
            requires_review=True,
        )

    if (
        market.status is not RangeStatus.CONSENSUS
        or market.supported_lower is None
        or market.supported_upper is None
    ):
        return UnitPriceResult(
            unit_number=unit.unit_number,
            family_key=_family_key(unit),
            status=UnitPricingStatus.INSUFFICIENT_EVIDENCE,
            market_confidence=market.confidence,
            supported_lower=market.supported_lower,
            supported_upper=market.supported_upper,
            commercial_base_price_ils=None,
            proposed_list_price_ils=None,
            adjustments=[],
            warnings=list(market.warnings) + ["strategy_requires_market_consensus_for_automatic_pricing"],
            decision_trace=["No automatic price was created because the market evidence does not form a supported interval."],
            requires_review=True,
        )

    if strategy.basis in _OWN_SALE_BASES and resolved_latest_internal_sale is None:
        return UnitPriceResult(
            unit_number=unit.unit_number,
            family_key=_family_key(unit),
            status=UnitPricingStatus.INSUFFICIENT_EVIDENCE,
            market_confidence=market.confidence,
            supported_lower=market.supported_lower,
            supported_upper=market.supported_upper,
            commercial_base_price_ils=None,
            proposed_list_price_ils=None,
            adjustments=[],
            warnings=["no_own_project_sale_available_for_this_family"],
            decision_trace=[
                "No automatic price was created because this pricing basis requires a realized own-project sale "
                "for this apartment family, and none exists in this session's frozen commercial state yet."
            ],
            requires_review=True,
        )

    resolved_latest_internal_sale_ils = (
        resolved_latest_internal_sale.contract_price_ils
        if resolved_latest_internal_sale is not None and strategy.minimum_not_below_last_realized_sale
        else None
    )
    feasibility = check_strategy_feasibility(strategy, resolved_latest_internal_sale_ils)
    if feasibility.status == FeasibilityStatus.CONFLICT.value:
        return UnitPriceResult(
            unit_number=unit.unit_number,
            family_key=_family_key(unit),
            status=UnitPricingStatus.STRATEGY_CONFLICT,
            market_confidence=market.confidence,
            supported_lower=market.supported_lower,
            supported_upper=market.supported_upper,
            commercial_base_price_ils=None,
            proposed_list_price_ils=None,
            adjustments=[],
            warnings=["explicit_strategy_constraints_are_contradictory"],
            decision_trace=[
                "No price was computed: explicit company constraints contradict each other -- "
                f"binding minimum {feasibility.binding_minimum.amount_ils:,.0f} ILS "
                f"({feasibility.binding_minimum.name}) exceeds binding maximum "
                f"{feasibility.binding_maximum.amount_ils:,.0f} ILS ({feasibility.binding_maximum.name}) "
                f"by {feasibility.conflict_amount_ils:,.0f} ILS."
            ],
            requires_review=True,
            feasibility=feasibility,
        )

    trace: list[str] = []
    adjustments: list[PriceAdjustment] = []

    if strategy.basis is PricingBasis.MARKET_RANGE_POSITION:
        position = float(strategy.range_position_pct)
        base = market.supported_lower + (position / 100.0) * (market.supported_upper - market.supported_lower)
        trace.append(
            f"Commercial base selected at {position:g}% of the supported market interval (0%=lower bound, 100%=upper bound)."
        )
    elif strategy.basis is PricingBasis.COMPETITOR_REFERENCE:
        base = float(strategy.competitor_reference_ils)
        trace.append(
            "Commercial base uses the explicitly selected competitor evidence record "
            f"{strategy.competitor_reference_source_id}."
        )
        if strategy.competitor_delta_ils:
            adjustments.append(
                PriceAdjustment(
                    kind="competitor_delta",
                    amount_ils=float(strategy.competitor_delta_ils),
                    source=strategy.source,
                    explanation="Explicit Marketing positioning amount relative to the selected competitor evidence.",
                )
            )
    else:
        # LATEST_OWN_PROJECT_SALE / LATEST_OWN_PROJECT_SALE_PLUS_AMOUNT. The reference
        # itself is never typed manually -- resolved_latest_internal_sale is derived by
        # the engine (see price_project_decision) from the family's own realized sales.
        ref = resolved_latest_internal_sale
        base = float(ref.contract_price_ils)
        trace.append(
            f"Commercial base uses the latest realized own-project sale: apartment {ref.unit_number}, "
            f"contract date {ref.contract_date.isoformat()}, contract price {ref.contract_price_ils:,.0f} ILS "
            f"(source: {ref.source})."
        )
        if strategy.basis is PricingBasis.LATEST_OWN_PROJECT_SALE_PLUS_AMOUNT and strategy.internal_sale_plus_amount_ils:
            adjustments.append(
                PriceAdjustment(
                    kind="latest_internal_sale_plus_amount",
                    amount_ils=float(strategy.internal_sale_plus_amount_ils),
                    source=strategy.source,
                    explanation=(
                        f"Explicit company rule: {strategy.internal_sale_plus_amount_ils:+,.0f} ILS on top of the "
                        f"latest realized own-project sale (apartment {ref.unit_number}, "
                        f"{ref.contract_price_ils:,.0f} ILS, {ref.contract_date.isoformat()}, source: {ref.source})."
                    ),
                )
            )

    proposed = base

    # competitor delta belongs after the selected competitor reference base
    if strategy.basis is PricingBasis.COMPETITOR_REFERENCE and strategy.competitor_delta_ils:
        proposed += float(strategy.competitor_delta_ils)

    if strategy.basis is PricingBasis.LATEST_OWN_PROJECT_SALE_PLUS_AMOUNT and strategy.internal_sale_plus_amount_ils:
        proposed += float(strategy.internal_sale_plus_amount_ils)

    if strategy.floor_rule is not None:
        floor = _number(unit.floor)
        if floor is None:
            trace.append("Floor company rule was configured but this unit has no numeric floor; no floor adjustment applied.")
        else:
            delta_floors = floor - strategy.floor_rule.reference_floor
            amount = delta_floors * strategy.floor_rule.amount_per_floor_ils
            if amount:
                adjustments.append(
                    PriceAdjustment(
                        kind="company_floor_rule",
                        amount_ils=amount,
                        source=strategy.floor_rule.source,
                        explanation=(
                            f"Explicit company rule: {amount:+,.0f} ILS for floor {floor:g} relative to "
                            f"reference floor {strategy.floor_rule.reference_floor:g}."
                        ),
                    )
                )
                proposed += amount

    if strategy.negotiation_buffer_ils:
        adjustments.append(
            PriceAdjustment(
                kind="negotiation_buffer",
                amount_ils=float(strategy.negotiation_buffer_ils),
                source=strategy.source,
                explanation="Explicit Marketing list-price buffer added after the commercial base price.",
            )
        )
        proposed += float(strategy.negotiation_buffer_ils)

    if strategy.minimum_price_ils is not None and proposed < strategy.minimum_price_ils:
        amount = strategy.minimum_price_ils - proposed
        adjustments.append(
            PriceAdjustment(
                kind="minimum_price_constraint",
                amount_ils=amount,
                source=strategy.source,
                explanation="Explicit company minimum-price constraint applied.",
            )
        )
        proposed = strategy.minimum_price_ils

    if strategy.maximum_price_ils is not None and proposed > strategy.maximum_price_ils:
        amount = strategy.maximum_price_ils - proposed
        adjustments.append(
            PriceAdjustment(
                kind="maximum_price_constraint",
                amount_ils=amount,
                source=strategy.source,
                explanation="Explicit company maximum-price constraint applied.",
            )
        )
        proposed = strategy.maximum_price_ils

    if (
        strategy.minimum_not_below_last_realized_sale
        and resolved_latest_internal_sale is not None
        and proposed < resolved_latest_internal_sale.contract_price_ils
    ):
        # Feasibility was already proven compatible with maximum_price_ils above, so
        # this clamp can never silently contradict it.
        amount = resolved_latest_internal_sale.contract_price_ils - proposed
        adjustments.append(
            PriceAdjustment(
                kind="minimum_not_below_last_realized_sale",
                amount_ils=amount,
                source=strategy.source,
                explanation=(
                    "Explicit company rule: proposed price cannot fall below the latest realized own-project sale "
                    f"(apartment {resolved_latest_internal_sale.unit_number}, "
                    f"{resolved_latest_internal_sale.contract_price_ils:,.0f} ILS, "
                    f"{resolved_latest_internal_sale.contract_date.isoformat()}, "
                    f"source: {resolved_latest_internal_sale.source})."
                ),
            )
        )
        proposed = resolved_latest_internal_sale.contract_price_ils

    proposed = _round_ils(proposed)
    base = _round_ils(base)

    warnings = list(market.warnings)
    outside = proposed < market.supported_lower or proposed > market.supported_upper
    if outside:
        warnings.append("proposed_list_price_outside_supported_market_range")
        trace.append("Commercial strategy moves the proposed list price outside the supported market interval; review is required.")
    else:
        trace.append("Proposed list price remains inside the supported market interval.")

    return UnitPriceResult(
        unit_number=unit.unit_number,
        family_key=_family_key(unit),
        status=UnitPricingStatus.PRICED,
        market_confidence=market.confidence,
        supported_lower=market.supported_lower,
        supported_upper=market.supported_upper,
        commercial_base_price_ils=base,
        proposed_list_price_ils=proposed,
        adjustments=adjustments,
        warnings=warnings,
        decision_trace=trace,
        requires_review=outside or market.confidence in {EvidenceConfidence.LOW, EvidenceConfidence.INSUFFICIENT},
    )


def price_project(
    unit_market_results: Iterable[tuple[Unit, MarketRangeResult]],
    strategy: StrategyProfile,
) -> ProjectPricingResult:
    strategy.validate()
    pairs = list(unit_market_results)
    results = [price_unit(unit, market, strategy) for unit, market in pairs]

    priced = [r for r in results if r.proposed_list_price_ils is not None]
    total = sum(float(r.proposed_list_price_ils) for r in priced)
    outside = sum("proposed_list_price_outside_supported_market_range" in r.warnings for r in results)
    manual_or_unpriced = sum(r.proposed_list_price_ils is None for r in results)
    review_count = sum(r.requires_review for r in results)

    by_family: dict[str, list[float]] = {}
    for result in priced:
        by_family.setdefault(result.family_key, []).append(float(result.proposed_list_price_ils))

    metrics = {
        "priced_unit_count": len(priced),
        "unpriced_or_manual_unit_count": manual_or_unpriced,
        "requires_review_count": review_count,
        "units_outside_supported_range": outside,
        "total_proposed_list_value_ils": _round_ils(total),
        "average_price_by_family_ils": {
            family: _round_ils(mean(values)) for family, values in sorted(by_family.items())
        },
    }
    return ProjectPricingResult(strategy=strategy, units=results, project_metrics=metrics)


def compare_scenarios(baseline: ProjectPricingResult, scenario: ProjectPricingResult) -> ScenarioImpactResult:
    before = {u.unit_number: u for u in baseline.units}
    after = {u.unit_number: u for u in scenario.units}
    all_units = sorted(set(before) | set(after), key=_unit_sort_key)

    impacts: list[UnitScenarioImpact] = []
    changed = 0
    for unit_number in all_units:
        b = before.get(unit_number)
        a = after.get(unit_number)
        b_price = b.proposed_list_price_ils if b else None
        a_price = a.proposed_list_price_ils if a else None
        delta = None if b_price is None or a_price is None else _round_ils(a_price - b_price)
        if b_price != a_price:
            changed += 1
        impacts.append(
            UnitScenarioImpact(
                unit_number=unit_number,
                baseline_price_ils=b_price,
                scenario_price_ils=a_price,
                delta_ils=delta,
                baseline_requires_review=b.requires_review if b else True,
                scenario_requires_review=a.requires_review if a else True,
            )
        )

    before_total = float(baseline.project_metrics["total_proposed_list_value_ils"])
    after_total = float(scenario.project_metrics["total_proposed_list_value_ils"])
    return ScenarioImpactResult(
        baseline_strategy_name=baseline.strategy.name,
        scenario_strategy_name=scenario.strategy.name,
        changed_unit_count=changed,
        total_list_value_before_ils=before_total,
        total_list_value_after_ils=after_total,
        total_list_value_delta_ils=_round_ils(after_total - before_total),
        units_outside_supported_range_before=int(baseline.project_metrics["units_outside_supported_range"]),
        units_outside_supported_range_after=int(scenario.project_metrics["units_outside_supported_range"]),
        manual_or_unpriced_before=int(baseline.project_metrics["unpriced_or_manual_unit_count"]),
        manual_or_unpriced_after=int(scenario.project_metrics["unpriced_or_manual_unit_count"]),
        unit_impacts=impacts,
    )


def _family_key(unit: Unit) -> str:
    area = "unknown" if unit.internal_area is None else f"{unit.internal_area:g}sqm"
    rooms = "unknown" if unit.rooms is None else f"{unit.rooms:g}r"
    return f"{unit.unit_type or 'unknown'}|{rooms}|{area}"


def _number(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _round_ils(value: float) -> float:
    # The evidence engine itself is already expressed to ₪1,000 precision. Do not
    # introduce a separate list-price rounding policy here; preserve explicit
    # strategy arithmetic to the nearest shekel.
    return float(round(value))


def _unit_sort_key(value: str) -> tuple[int, str]:
    try:
        return (0, f"{int(value):09d}")
    except (TypeError, ValueError):
        return (1, str(value))
