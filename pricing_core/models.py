from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from enum import Enum
from typing import Any


class QualityStatus(str, Enum):
    USABLE = "usable"
    LOW_CONFIDENCE = "low_confidence"
    AMBIGUOUS = "ambiguous"
    REJECTED = "rejected"


class SourceRunStatus(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"


@dataclass(slots=True)
class ProjectLocation:
    city: str
    neighborhood: str | None = None
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    source: str | None = None


@dataclass(slots=True)
class Unit:
    unit_number: str
    floor: str | int | None
    rooms: float | None
    internal_area: float | None
    balcony_area: float | None = None
    orientation: str | None = None
    parking: int | None = None
    storage: bool | None = None
    unit_type: str | None = None
    notes: str | None = None


@dataclass(slots=True)
class SourceRun:
    source: str
    status: SourceRunStatus
    started_at: datetime | None = None
    completed_at: datetime | None = None
    raw_count: int = 0
    usable_count: int = 0
    rejected_count: int = 0
    error: str | None = None


@dataclass(slots=True)
class SoldTransaction:
    source_index: int
    deal_date: date | None
    deal_amount: float | None
    price_per_sqm: float | None
    address: str | None
    city: str | None
    neighborhood: str | None
    rooms: float | None
    floor: str | None
    area: float | None
    property_type: str | None
    is_first_hand: bool | None
    gush: str | None
    helka: str | None
    tat_helka: str | None
    asset_id: str | None
    latitude: float | None
    longitude: float | None
    scraped_at: str | None
    raw: dict[str, Any] = field(repr=False, default_factory=dict)

    @classmethod
    def from_raw(cls, raw: dict[str, Any], source_index: int) -> "SoldTransaction":
        return cls(
            source_index=source_index,
            deal_date=_parse_date(raw.get("dealDate")),
            deal_amount=_number(raw.get("dealAmount")),
            price_per_sqm=_number(raw.get("pricePerSqm")),
            address=_text(raw.get("address")),
            city=_text(raw.get("cityName")),
            neighborhood=_text(raw.get("neighborhoodName")),
            rooms=_number(raw.get("rooms")),
            floor=_text(raw.get("floor")),
            area=_number(raw.get("area")),
            property_type=_text(raw.get("propertyType")),
            is_first_hand=raw.get("isFirstHand") if isinstance(raw.get("isFirstHand"), bool) else None,
            gush=_text(raw.get("gush")),
            helka=_text(raw.get("helka")),
            tat_helka=_text(raw.get("tatHelka")),
            asset_id=_text(raw.get("assetId")),
            latitude=_number(raw.get("lat")),
            longitude=_number(raw.get("lng")),
            scraped_at=_text(raw.get("scrapedAt")),
            raw=dict(raw),
        )


@dataclass(slots=True)
class QAResult:
    transaction: SoldTransaction
    status: QualityStatus = QualityStatus.USABLE
    reasons: list[str] = field(default_factory=list)
    normalized_address: str | None = None
    normalized_property_type: str | None = None
    related_source_indices: list[int] = field(default_factory=list)

    def add_reason(self, reason: str, status: QualityStatus | None = None) -> None:
        if reason not in self.reasons:
            self.reasons.append(reason)
        if status is not None and _status_rank(status) > _status_rank(self.status):
            self.status = status

    def as_dict(self) -> dict[str, Any]:
        tx = asdict(self.transaction)
        tx.pop("raw", None)
        if tx.get("deal_date") is not None:
            tx["deal_date"] = tx["deal_date"].isoformat()
        return {
            "transaction": tx,
            "status": self.status.value,
            "reasons": self.reasons,
            "normalized_address": self.normalized_address,
            "normalized_property_type": self.normalized_property_type,
            "related_source_indices": self.related_source_indices,
        }


def _status_rank(status: QualityStatus) -> int:
    return {
        QualityStatus.USABLE: 0,
        QualityStatus.LOW_CONFIDENCE: 1,
        QualityStatus.AMBIGUOUS: 2,
        QualityStatus.REJECTED: 3,
    }[status]


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_date(value: Any) -> date | None:
    text = _text(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None
