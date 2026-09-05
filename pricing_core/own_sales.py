from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime
from typing import Any, Iterable


@dataclass(slots=True)
class OwnProjectSaleRecord:
    """A realized sale of a unit in the same project, used as its own evidence lane.

    Never fed into ``build_comparable_set``/``build_market_range`` -- own-project
    realized sales are summarized and compared against the external supported range
    separately, so the external range is provably unaffected by internal sales.
    """

    unit_number: str
    family_key: str
    contract_date: date
    contract_price_ils: float
    floor: str | int | None = None
    internal_area: float | None = None
    balcony_area: float | None = None
    source: str = "project_sale_record"
    # Present only for deterministic tie-breaking when two sales share a contract_date.
    # Never used for anything else (e.g. never treated as a commercial fact).
    recorded_at: datetime | None = None

    def public_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["contract_date"] = self.contract_date.isoformat()
        payload["recorded_at"] = self.recorded_at.isoformat() if self.recorded_at else None
        return payload


@dataclass(slots=True)
class OwnProjectSupportSummary:
    family_key: str
    sale_count: int
    lower_ils: float | None
    upper_ils: float | None
    latest_sale: OwnProjectSaleRecord | None

    def public_dict(self) -> dict[str, Any]:
        return {
            "family_key": self.family_key,
            "sale_count": self.sale_count,
            "lower_ils": self.lower_ils,
            "upper_ils": self.upper_ils,
            "latest_sale": self.latest_sale.public_dict() if self.latest_sale else None,
        }


def summarize_own_project_sales(family_key: str, sales: Iterable[OwnProjectSaleRecord]) -> OwnProjectSupportSummary:
    rows = [s for s in sales if s.family_key == family_key]
    if not rows:
        return OwnProjectSupportSummary(family_key=family_key, sale_count=0, lower_ils=None, upper_ils=None, latest_sale=None)

    prices = [r.contract_price_ils for r in rows]
    latest = max(rows, key=_latest_sort_key)
    return OwnProjectSupportSummary(
        family_key=family_key,
        sale_count=len(rows),
        lower_ils=min(prices),
        upper_ils=max(prices),
        latest_sale=latest,
    )


def _latest_sort_key(record: OwnProjectSaleRecord) -> tuple[date, datetime, str]:
    # "Latest" = most recent contract_date; ties broken by recorded_at (when the sale
    # was actually persisted), then by unit_number for full determinism.
    return (record.contract_date, record.recorded_at or datetime.min, record.unit_number)


@dataclass(slots=True)
class OwnSalesComparisonFlags:
    inside_external_support: bool | None
    above_latest_internal_sale_ils: float | None

    def public_dict(self) -> dict[str, Any]:
        return asdict(self)


def compare_against_own_sales(
    proposed_price_ils: float | None,
    external_lower_ils: float | None,
    external_upper_ils: float | None,
    summary: OwnProjectSupportSummary,
) -> OwnSalesComparisonFlags:
    inside: bool | None = None
    if proposed_price_ils is not None and external_lower_ils is not None and external_upper_ils is not None:
        inside = external_lower_ils <= proposed_price_ils <= external_upper_ils

    above: float | None = None
    if proposed_price_ils is not None and summary.latest_sale is not None:
        above = round(proposed_price_ils - summary.latest_sale.contract_price_ils)

    return OwnSalesComparisonFlags(inside_external_support=inside, above_latest_internal_sale_ils=above)
