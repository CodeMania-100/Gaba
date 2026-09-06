from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class AttributeStatus(str, Enum):
    MATCH = "MATCH"
    DIFFERENT = "DIFFERENT"
    UNKNOWN = "UNKNOWN"


# The full set of attribute fields compared between a target unit and one comparable.
# Presence and quantity are deliberately separate fields (a comparable can be known to
# have a balcony of unknown size, or known to have none at all -- those are different
# facts, never collapsed into one).
ATTRIBUTE_FIELDS = (
    "rooms",
    "internal_area",
    "floor",
    "balcony_present",
    "balcony_area_sqm",
    "parking_present",
    "parking_count",
    "storage_present",
    "storage_area_sqm",
    "orientation",
    "property_type",
    "garden",
    "special_type",
)


@dataclass(slots=True)
class ComparableAttributes:
    """A source-agnostic attribute snapshot for one side of a comparison.

    Every field is optional. ``None`` always means "unknown for this record" and is
    never treated as a negative/false answer. A source that explicitly states an
    attribute is absent (e.g. ``hasBalcony=false``) should set the presence field to
    ``False`` and the quantity field to a known ``0`` -- that is a confirmed fact, not
    a missing one.
    """

    rooms: float | None = None
    internal_area: float | None = None
    floor: str | int | None = None
    balcony_present: bool | None = None
    balcony_area_sqm: float | None = None
    parking_present: bool | None = None
    parking_count: int | None = None
    storage_present: bool | None = None
    storage_area_sqm: float | None = None
    orientation: str | None = None
    property_type: str | None = None
    garden: bool | None = None
    special_type: str | None = None

    def public_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class AttributeComparison:
    field: str
    target_value: Any
    comparable_value: Any
    status: str

    def public_dict(self) -> dict[str, Any]:
        return asdict(self)


def compare_attributes(target: ComparableAttributes, comparable: ComparableAttributes) -> list[AttributeComparison]:
    """Categorical, explanatory comparison -- never a fabricated numeric score.

    A field is ``UNKNOWN`` whenever either side has no recorded value. It is
    ``MATCH``/``DIFFERENT`` only when both sides carry an actual value.
    """

    results: list[AttributeComparison] = []
    for name in ATTRIBUTE_FIELDS:
        target_value = getattr(target, name)
        comparable_value = getattr(comparable, name)
        results.append(
            AttributeComparison(
                field=name,
                target_value=target_value,
                comparable_value=comparable_value,
                status=_status_for(name, target_value, comparable_value).value,
            )
        )
    return results


def _status_for(field_name: str, target_value: Any, comparable_value: Any) -> AttributeStatus:
    if target_value is None or comparable_value is None:
        return AttributeStatus.UNKNOWN
    if field_name == "floor":
        target_num = _as_float(target_value)
        comparable_num = _as_float(comparable_value)
        if target_num is not None and comparable_num is not None:
            return AttributeStatus.MATCH if target_num == comparable_num else AttributeStatus.DIFFERENT
    return AttributeStatus.MATCH if target_value == comparable_value else AttributeStatus.DIFFERENT


def _as_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


@dataclass(slots=True)
class AttributeAdjustmentRule:
    """An explicit, provenance-carrying monetary rule for one attribute difference.

    This exists only to *explain* a price gap against a specific comparable. It is
    never applied to the actual pricing formula (``pricing_core.strategy.price_unit``)
    -- only an explicit ``FloorRule``-style rule wired into that function would do that,
    and no such wiring exists for attribute rules in this milestone.
    """

    attribute: str
    amount_per_unit_ils: float
    reference_value: float
    source_type: str
    source_name: str


@dataclass(slots=True)
class AttributeAdjustment:
    attribute: str
    amount_ils: float | None
    reason: str | None
    source_type: str | None
    source_name: str | None
    formula: str | None

    def public_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ComparablePriceGap:
    lane: str
    source_id: str | None
    observed_price_ils: float | None
    area_normalized_indication_ils: float | None
    target_proposed_price_ils: float | None
    absolute_gap_ils: float | None
    gap_pct_vs_comparable: float | None
    attribute_comparison: list[AttributeComparison] = field(default_factory=list)
    attribute_adjustments: list[AttributeAdjustment] = field(default_factory=list)

    def public_dict(self) -> dict[str, Any]:
        return {
            "lane": self.lane,
            "source_id": self.source_id,
            "observed_price_ils": self.observed_price_ils,
            "area_normalized_indication_ils": self.area_normalized_indication_ils,
            "target_proposed_price_ils": self.target_proposed_price_ils,
            "absolute_gap_ils": self.absolute_gap_ils,
            "gap_pct_vs_comparable": self.gap_pct_vs_comparable,
            "attribute_comparison": [c.public_dict() for c in self.attribute_comparison],
            "attribute_adjustments": [a.public_dict() for a in self.attribute_adjustments],
        }


def build_comparable_price_gap(
    *,
    lane: str,
    source_id: str | None,
    target: ComparableAttributes,
    comparable: ComparableAttributes,
    observed_price_ils: float | None,
    area_normalized_indication_ils: float | None,
    target_proposed_price_ils: float | None,
    adjustment_rules: list[AttributeAdjustmentRule] = (),
) -> ComparablePriceGap:
    comparison = compare_attributes(target, comparable)

    absolute_gap: float | None = None
    gap_pct: float | None = None
    if target_proposed_price_ils is not None and observed_price_ils is not None and observed_price_ils != 0:
        absolute_gap = round(target_proposed_price_ils - observed_price_ils)
        gap_pct = round((target_proposed_price_ils - observed_price_ils) / observed_price_ils * 100, 2)

    rules_by_attribute = {rule.attribute: rule for rule in adjustment_rules}
    adjustments: list[AttributeAdjustment] = []
    for comp in comparison:
        if comp.status != AttributeStatus.DIFFERENT.value:
            continue
        rule = rules_by_attribute.get(comp.field)
        if rule is None:
            adjustments.append(
                AttributeAdjustment(
                    attribute=comp.field,
                    amount_ils=None,
                    reason="NO_VERIFIED_MONETARY_RULE",
                    source_type=None,
                    source_name=None,
                    formula=None,
                )
            )
            continue
        target_num = _as_float(comp.target_value)
        comparable_num = _as_float(comp.comparable_value)
        if target_num is None or comparable_num is None:
            delta = 1.0 if bool(comp.target_value) and not bool(comp.comparable_value) else -1.0
        else:
            delta = target_num - comparable_num
        amount = round(delta * rule.amount_per_unit_ils)
        adjustments.append(
            AttributeAdjustment(
                attribute=comp.field,
                amount_ils=amount,
                reason=None,
                source_type=rule.source_type,
                source_name=rule.source_name,
                formula=f"{delta:g} x {rule.amount_per_unit_ils:,.0f}",
            )
        )

    return ComparablePriceGap(
        lane=lane,
        source_id=source_id,
        observed_price_ils=observed_price_ils,
        area_normalized_indication_ils=area_normalized_indication_ils,
        target_proposed_price_ils=target_proposed_price_ils,
        absolute_gap_ils=absolute_gap,
        gap_pct_vs_comparable=gap_pct,
        attribute_comparison=comparison,
        attribute_adjustments=adjustments,
    )
