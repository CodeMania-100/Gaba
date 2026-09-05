from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from typing import Iterable
from statistics import mean

from .market_range import MarketRangeResult
from .models import Unit
from .strategy import (
    PriceAdjustment,
    ProjectPricingResult,
    StrategyProfile,
    UnitPriceResult,
    price_project,
)


@dataclass(slots=True)
class PriceOverride:
    unit_number: str
    price_ils: float
    reason: str
    locked: bool = True
    created_by: str = "current_user"
    source: str = "manual_override"

    def validate(self) -> None:
        if self.price_ils <= 0:
            raise ValueError("override price must be positive")
        if not self.reason or not self.reason.strip():
            raise ValueError("override reason is required")


@dataclass(slots=True)
class OverrideAuditEntry:
    unit_number: str
    recommended_price_before_override_ils: float | None
    override_price_ils: float
    delta_ils: float | None
    reason: str
    locked: bool
    created_by: str
    source: str


@dataclass(slots=True)
class GovernedProjectPricingResult:
    pricing: ProjectPricingResult
    locked_units: list[str]
    overrides: list[PriceOverride]
    audit_entries: list[OverrideAuditEntry]

    def public_dict(self) -> dict:
        return {
            "pricing": self.pricing.public_dict(),
            "locked_units": self.locked_units,
            "overrides": [asdict(x) for x in self.overrides],
            "audit_entries": [asdict(x) for x in self.audit_entries],
        }


def apply_overrides(
    pricing: ProjectPricingResult,
    overrides: Iterable[PriceOverride],
) -> GovernedProjectPricingResult:
    """Apply explicit manual decisions without hiding the engine recommendation.

    The original recommendation remains in the audit entry. Overrides never alter
    the underlying market-supported interval.
    """

    override_list = list(overrides)
    by_unit: dict[str, PriceOverride] = {}
    for override in override_list:
        override.validate()
        if override.unit_number in by_unit:
            raise ValueError(f"multiple active overrides supplied for unit {override.unit_number}")
        by_unit[override.unit_number] = override

    known_units = {u.unit_number for u in pricing.units}
    missing = sorted(set(by_unit) - known_units)
    if missing:
        raise ValueError(f"override references unknown unit(s): {', '.join(missing)}")

    audit: list[OverrideAuditEntry] = []
    updated: list[UnitPriceResult] = []

    for result in pricing.units:
        override = by_unit.get(result.unit_number)
        if override is None:
            updated.append(result)
            continue

        before = result.proposed_list_price_ils
        delta = None if before is None else float(round(override.price_ils - before))
        warnings = list(result.warnings)
        if "manual_price_override_applied" not in warnings:
            warnings.append("manual_price_override_applied")

        outside = False
        if result.supported_lower is not None and result.supported_upper is not None:
            outside = override.price_ils < result.supported_lower or override.price_ils > result.supported_upper
            if outside and "manual_override_outside_supported_market_range" not in warnings:
                warnings.append("manual_override_outside_supported_market_range")

        adjustments = list(result.adjustments)
        if delta is not None and delta != 0:
            adjustments.append(
                PriceAdjustment(
                    kind="manual_override",
                    amount_ils=delta,
                    source=override.source,
                    explanation=f"Manual pricing decision. Reason: {override.reason.strip()}",
                )
            )

        trace = list(result.decision_trace)
        trace.append(
            f"Manual override set unit price to {override.price_ils:,.0f} ILS; locked={override.locked}. Reason recorded."
        )

        updated.append(
            replace(
                result,
                proposed_list_price_ils=float(round(override.price_ils)),
                adjustments=adjustments,
                warnings=warnings,
                decision_trace=trace,
                requires_review=True if outside else result.requires_review,
            )
        )
        audit.append(
            OverrideAuditEntry(
                unit_number=result.unit_number,
                recommended_price_before_override_ils=before,
                override_price_ils=float(round(override.price_ils)),
                delta_ils=delta,
                reason=override.reason.strip(),
                locked=override.locked,
                created_by=override.created_by,
                source=override.source,
            )
        )

    governed_pricing = ProjectPricingResult(
        strategy=pricing.strategy,
        units=updated,
        project_metrics=_recalculate_metrics(pricing, updated),
    )
    return GovernedProjectPricingResult(
        pricing=governed_pricing,
        locked_units=sorted([o.unit_number for o in override_list if o.locked], key=_unit_sort_key),
        overrides=override_list,
        audit_entries=audit,
    )


def reprice_unlocked_preserving_locks(
    unit_market_results: Iterable[tuple[Unit, MarketRangeResult]],
    new_strategy: StrategyProfile,
    current_overrides: Iterable[PriceOverride],
) -> GovernedProjectPricingResult:
    """Recompute unlocked units under a new strategy while preserving locked decisions.

    Unlocked manual overrides are intentionally not carried forward. This keeps
    the behavior explicit: only a lock means "preserve this decision through a
    reprice".
    """

    locked = [o for o in current_overrides if o.locked]
    repriced = price_project(unit_market_results, new_strategy)
    return apply_overrides(repriced, locked)


def _recalculate_metrics(original: ProjectPricingResult, units: list[UnitPriceResult]) -> dict:
    # Preserve family averages only when no overrides exist in a family-specific
    # context would be misleading. For now recalculate the metrics that governance
    # can prove from UnitPriceResult alone; family averages are omitted here and
    # will be recalculated from unit metadata in the application/service layer.
    priced = [u for u in units if u.proposed_list_price_ils is not None]
    total = sum(float(u.proposed_list_price_ils) for u in priced)
    outside = sum(
        (
            "proposed_list_price_outside_supported_market_range" in u.warnings
            or "manual_override_outside_supported_market_range" in u.warnings
        )
        for u in units
    )
    manual_or_unpriced = sum(u.proposed_list_price_ils is None for u in units)
    review_count = sum(u.requires_review for u in units)
    by_family: dict[str, list[float]] = {}
    for u in priced:
        by_family.setdefault(u.family_key, []).append(float(u.proposed_list_price_ils))

    return {
        **original.project_metrics,
        "priced_unit_count": len(priced),
        "unpriced_or_manual_unit_count": manual_or_unpriced,
        "requires_review_count": review_count,
        "units_outside_supported_range": outside,
        "total_proposed_list_value_ils": float(round(total)),
        "average_price_by_family_ils": {
            family: float(round(mean(values))) for family, values in sorted(by_family.items())
        },
    }


def _unit_sort_key(value: str) -> tuple[int, str]:
    try:
        return (0, f"{int(value):09d}")
    except (TypeError, ValueError):
        return (1, str(value))
