from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import timedelta
from math import isclose
from statistics import median
from typing import Iterable

from .models import QAResult, QualityStatus, SoldTransaction
from .normalization import normalize_address, normalize_property_type


@dataclass(slots=True)
class SoldQAOutput:
    records: list[QAResult]
    summary: dict

    @property
    def usable_primary(self) -> list[QAResult]:
        return [r for r in self.records if r.status is QualityStatus.USABLE]

    @property
    def review(self) -> list[QAResult]:
        return [
            r
            for r in self.records
            if r.status in {QualityStatus.LOW_CONFIDENCE, QualityStatus.AMBIGUOUS}
        ]

    @property
    def rejected(self) -> list[QAResult]:
        return [r for r in self.records if r.status is QualityStatus.REJECTED]


def run_sold_qa(raw_records: Iterable[dict]) -> SoldQAOutput:
    results = [
        QAResult(
            transaction=SoldTransaction.from_raw(raw, source_index=i),
        )
        for i, raw in enumerate(raw_records)
    ]

    for result in results:
        result.normalized_address = normalize_address(result.transaction.address)
        result.normalized_property_type = normalize_property_type(result.transaction.property_type)
        _basic_validation(result)
        if result.normalized_property_type is None:
            result.add_reason("property_type_unknown", QualityStatus.LOW_CONFIDENCE)

    _collapse_exact_duplicates(results)
    _mark_same_registered_unit_same_day_conflicts(results)
    _mark_possible_companion_records(results)
    _mark_far_ppsqm_outliers(results)

    summary = _build_summary(results)
    return SoldQAOutput(records=results, summary=summary)


def _basic_validation(result: QAResult) -> None:
    tx = result.transaction
    missing = []
    if tx.deal_date is None:
        missing.append("deal_date")
    if tx.deal_amount is None or tx.deal_amount <= 0:
        missing.append("deal_amount")
    if tx.area is None or tx.area <= 0:
        missing.append("area")
    if tx.rooms is None or tx.rooms <= 0:
        missing.append("rooms")

    # A human-readable address is useful but not strictly required when the
    # transaction still has a valid geographic/cadastral locator. Some GovMap
    # records in the tested feed omit address while preserving coordinates plus
    # block/parcel identifiers. Reject only when no usable location remains.
    if not result.normalized_address:
        has_coords = tx.latitude is not None and tx.longitude is not None
        has_cadastral = bool(tx.gush and tx.helka)
        if has_coords or has_cadastral:
            result.add_reason("address_missing_but_geographic_locator_available")
        else:
            missing.append("address_or_geographic_locator")

    if missing:
        result.add_reason(
            "invalid_or_missing_required_fields:" + ",".join(missing),
            QualityStatus.REJECTED,
        )

    if tx.price_per_sqm is not None and tx.price_per_sqm <= 0:
        result.add_reason("invalid_price_per_sqm", QualityStatus.REJECTED)


def _collapse_exact_duplicates(results: list[QAResult]) -> None:
    groups: dict[tuple, list[QAResult]] = defaultdict(list)
    for result in results:
        if result.status is QualityStatus.REJECTED:
            continue
        tx = result.transaction
        key = (
            tx.deal_date,
            tx.deal_amount,
            result.normalized_address,
            tx.rooms,
            tx.floor,
            tx.area,
            tx.gush,
            tx.helka,
            tx.tat_helka,
            tx.asset_id,
        )
        groups[key].append(result)

    for group in groups.values():
        if len(group) < 2:
            continue
        keeper = max(group, key=_record_richness)
        indices = [g.transaction.source_index for g in group]
        for item in group:
            item.related_source_indices = sorted(i for i in indices if i != item.transaction.source_index)
            if item is keeper:
                item.add_reason("exact_duplicate_group_keeper")
            else:
                item.add_reason("exact_duplicate", QualityStatus.REJECTED)


def _mark_same_registered_unit_same_day_conflicts(results: list[QAResult]) -> None:
    groups: dict[tuple, list[QAResult]] = defaultdict(list)
    for result in results:
        if result.status is QualityStatus.REJECTED:
            continue
        tx = result.transaction
        if not (tx.deal_date and tx.gush and tx.helka and tx.tat_helka):
            continue
        key = (tx.deal_date, tx.gush, tx.helka, tx.tat_helka)
        groups[key].append(result)

    for group in groups.values():
        if len(group) < 2:
            continue
        material = {
            (
                item.transaction.deal_amount,
                item.transaction.rooms,
                item.transaction.floor,
                item.transaction.area,
            )
            for item in group
        }
        if len(material) <= 1:
            continue
        indices = sorted(item.transaction.source_index for item in group)
        for item in group:
            item.related_source_indices = sorted(
                set(item.related_source_indices)
                | {i for i in indices if i != item.transaction.source_index}
            )
            item.add_reason("same_registered_unit_same_day_conflict", QualityStatus.AMBIGUOUS)


def _mark_possible_companion_records(results: list[QAResult]) -> None:
    candidates = [
        r
        for r in results
        if r.status in {QualityStatus.USABLE, QualityStatus.LOW_CONFIDENCE}
        and r.transaction.deal_date is not None
    ]
    by_address: dict[str, list[QAResult]] = defaultdict(list)
    for result in candidates:
        if result.normalized_address:
            by_address[result.normalized_address].append(result)

    for group in by_address.values():
        group.sort(key=lambda r: r.transaction.deal_date)
        for i, left in enumerate(group):
            for right in group[i + 1 :]:
                day_gap = (right.transaction.deal_date - left.transaction.deal_date).days
                if day_gap > 1:
                    break
                if day_gap < 0 or not _same_observed_sale_shape(left, right):
                    continue
                if left.transaction.tat_helka == right.transaction.tat_helka:
                    continue

                left_known = left.normalized_property_type is not None
                right_known = right.normalized_property_type is not None
                if left_known == right_known:
                    continue

                lower = right if left_known else left
                richer = left if left_known else right
                lower.add_reason("possible_companion_record", QualityStatus.LOW_CONFIDENCE)
                lower.related_source_indices = sorted(
                    set(lower.related_source_indices) | {richer.transaction.source_index}
                )
                richer.related_source_indices = sorted(
                    set(richer.related_source_indices) | {lower.transaction.source_index}
                )


def _same_observed_sale_shape(a: QAResult, b: QAResult) -> bool:
    ta, tb = a.transaction, b.transaction
    if ta.deal_amount != tb.deal_amount:
        return False
    if ta.rooms != tb.rooms or ta.floor != tb.floor or ta.area != tb.area:
        return False
    if ta.gush != tb.gush or ta.helka != tb.helka:
        return False
    if not _same_coord(ta.latitude, tb.latitude) or not _same_coord(ta.longitude, tb.longitude):
        return False
    return True


def _same_coord(a: float | None, b: float | None) -> bool:
    if a is None or b is None:
        return False
    return isclose(a, b, abs_tol=1e-7)


def _mark_far_ppsqm_outliers(results: list[QAResult]) -> None:
    """Conservative statistical QA flag only; never an automatic rejection.

    Uses a standard far-outlier Tukey fence (3 x IQR), grouped by room count.
    This is deliberately conservative and only changes records to LOW_CONFIDENCE.
    """

    by_rooms: dict[float, list[float]] = defaultdict(list)
    for result in results:
        tx = result.transaction
        if result.status in {QualityStatus.REJECTED, QualityStatus.AMBIGUOUS}:
            continue
        if tx.rooms is None or tx.price_per_sqm is None or tx.price_per_sqm <= 0:
            continue
        by_rooms[tx.rooms].append(tx.price_per_sqm)

    fences: dict[float, tuple[float, float]] = {}
    for rooms, values in by_rooms.items():
        if len(values) < 8:
            continue
        q1 = _percentile(values, 25)
        q3 = _percentile(values, 75)
        iqr = q3 - q1
        if iqr <= 0:
            continue
        fences[rooms] = (q1 - 3 * iqr, q3 + 3 * iqr)

    for result in results:
        tx = result.transaction
        if result.status in {QualityStatus.REJECTED, QualityStatus.AMBIGUOUS}:
            continue
        if tx.rooms not in fences or tx.price_per_sqm is None:
            continue
        low, high = fences[tx.rooms]
        if tx.price_per_sqm < low or tx.price_per_sqm > high:
            result.add_reason("far_price_per_sqm_outlier", QualityStatus.LOW_CONFIDENCE)


def _percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * percentile / 100
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _record_richness(result: QAResult) -> int:
    tx = result.transaction
    fields = [
        tx.property_type,
        tx.asset_id,
        tx.gush,
        tx.helka,
        tx.tat_helka,
        tx.latitude,
        tx.longitude,
        tx.neighborhood,
    ]
    return sum(value is not None for value in fields)


def _build_summary(results: list[QAResult]) -> dict:
    statuses = {status.value: 0 for status in QualityStatus}
    reason_counts: dict[str, int] = defaultdict(int)
    for result in results:
        statuses[result.status.value] += 1
        for reason in result.reasons:
            reason_counts[reason] += 1

    return {
        "raw_records": len(results),
        "status_counts": statuses,
        "reason_counts": dict(sorted(reason_counts.items())),
        "primary_usable_records": statuses[QualityStatus.USABLE.value],
        "review_records": statuses[QualityStatus.LOW_CONFIDENCE.value]
        + statuses[QualityStatus.AMBIGUOUS.value],
        "rejected_records": statuses[QualityStatus.REJECTED.value],
        "policy_notes": [
            "Unknown property type is preserved and marked low-confidence, not guessed.",
            "Possible consecutive-day companion records are flagged, not silently deleted.",
            "Same registered unit/date conflicts are excluded from primary evidence as ambiguous.",
            "Far price-per-sqm outliers are low-confidence flags, not automatic rejections.",
            "Missing human-readable address is allowed when coordinates or cadastral identifiers preserve geographic traceability.",
        ],
    }
