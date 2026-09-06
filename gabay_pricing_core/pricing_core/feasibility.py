from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .strategy import StrategyProfile


class FeasibilityStatus(str, Enum):
    FEASIBLE = "FEASIBLE"
    CONFLICT = "CONFLICT"


@dataclass(slots=True)
class ConstraintBound:
    name: str
    amount_ils: float
    source: str

    def public_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class StrategyFeasibilityResult:
    status: str
    binding_minimum: ConstraintBound | None
    binding_maximum: ConstraintBound | None
    conflict_amount_ils: float | None
    all_minimums: list[ConstraintBound] = field(default_factory=list)
    all_maximums: list[ConstraintBound] = field(default_factory=list)

    def public_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "binding_minimum": self.binding_minimum.public_dict() if self.binding_minimum else None,
            "binding_maximum": self.binding_maximum.public_dict() if self.binding_maximum else None,
            "conflict_amount_ils": self.conflict_amount_ils,
            "all_minimums": [b.public_dict() for b in self.all_minimums],
            "all_maximums": [b.public_dict() for b in self.all_maximums],
        }


def check_strategy_feasibility(
    strategy: "StrategyProfile",
    resolved_latest_internal_sale_ils: float | None,
) -> StrategyFeasibilityResult:
    """Detects contradictory explicit constraints before any price is computed.

    This never resolves a conflict on the engine's own judgement -- it only proves
    whether a valid price can exist at all, so a later clamp-ordering bug can never
    silently violate one constraint while satisfying another.
    """

    minimums: list[ConstraintBound] = []
    maximums: list[ConstraintBound] = []

    if strategy.minimum_price_ils is not None:
        minimums.append(ConstraintBound("company_minimum_price", float(strategy.minimum_price_ils), strategy.source))
    if strategy.maximum_price_ils is not None:
        maximums.append(ConstraintBound("company_maximum_price", float(strategy.maximum_price_ils), strategy.source))
    if strategy.minimum_not_below_last_realized_sale and resolved_latest_internal_sale_ils is not None:
        minimums.append(
            ConstraintBound(
                "minimum_not_below_last_realized_sale",
                float(resolved_latest_internal_sale_ils),
                "own_project_sale_record",
            )
        )

    if not minimums or not maximums:
        return StrategyFeasibilityResult(
            status=FeasibilityStatus.FEASIBLE.value,
            binding_minimum=max(minimums, key=lambda b: b.amount_ils) if minimums else None,
            binding_maximum=min(maximums, key=lambda b: b.amount_ils) if maximums else None,
            conflict_amount_ils=None,
            all_minimums=minimums,
            all_maximums=maximums,
        )

    binding_minimum = max(minimums, key=lambda b: b.amount_ils)
    binding_maximum = min(maximums, key=lambda b: b.amount_ils)

    if binding_minimum.amount_ils > binding_maximum.amount_ils:
        return StrategyFeasibilityResult(
            status=FeasibilityStatus.CONFLICT.value,
            binding_minimum=binding_minimum,
            binding_maximum=binding_maximum,
            conflict_amount_ils=round(binding_minimum.amount_ils - binding_maximum.amount_ils),
            all_minimums=minimums,
            all_maximums=maximums,
        )

    return StrategyFeasibilityResult(
        status=FeasibilityStatus.FEASIBLE.value,
        binding_minimum=binding_minimum,
        binding_maximum=binding_maximum,
        conflict_amount_ils=None,
        all_minimums=minimums,
        all_maximums=maximums,
    )
