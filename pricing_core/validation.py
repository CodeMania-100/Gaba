from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import date
from math import inf
from statistics import mean, median
from typing import Iterable
import calendar

from .comparables import haversine_m
from .models import QAResult, QualityStatus


@dataclass(frozen=True, slots=True)
class HistoricalValidationPolicy:
    """Transparent sold-comparable policy used only for historical validation.

    There are intentionally no learned weights. The policy chooses independent
    building/location clusters lexicographically by distance, recency and then
    area similarity. A target-equivalent indication is median cluster price/m²
    multiplied by target internal area, matching the current sold-lane idea.
    """

    name: str
    max_clusters: int | None = None
    area_band_pct: float | None = None
    primary_lookback_months: int = 24
    fallback_lookback_months: int = 60
    min_independent_clusters: int = 2
    min_clusters_for_area_filter: int = 3
    exclude_target_building: bool = False


@dataclass(slots=True)
class HistoricalPrediction:
    policy_name: str
    target_source_index: int
    target_asset_id: str | None
    target_group_key: str
    target_date: date
    rooms: float
    target_area: float
    actual_price: float
    predicted_price: float
    interval_lower: float
    interval_upper: float
    absolute_error: float
    absolute_percentage_error: float
    signed_percentage_error: float
    interval_contains_actual: bool
    selected_cluster_count: int
    selected_cluster_keys: list[str]
    lookback_months_used: int
    used_area_filter: bool
    area_filter_fallback: bool

    def public_dict(self) -> dict:
        payload = asdict(self)
        payload["target_date"] = self.target_date.isoformat()
        return payload


@dataclass(slots=True)
class ValidationMetrics:
    eligible_targets: int
    predicted_targets: int
    prediction_coverage: float
    median_absolute_error: float | None
    median_absolute_percentage_error: float | None
    mean_absolute_percentage_error: float | None
    p90_absolute_percentage_error: float | None
    median_signed_percentage_error: float | None
    interval_hit_rate: float | None
    median_interval_width_pct_of_actual: float | None
    fallback_lookback_rate: float | None
    area_filter_fallback_rate: float | None
    by_rooms: dict[str, dict]

    def public_dict(self) -> dict:
        return asdict(self)


@dataclass(slots=True)
class PolicyValidationResult:
    policy: HistoricalValidationPolicy
    metrics: ValidationMetrics
    predictions: list[HistoricalPrediction] = field(default_factory=list)

    def public_dict(self, *, include_predictions: bool = False) -> dict:
        payload = {
            "policy": asdict(self.policy),
            "metrics": self.metrics.public_dict(),
        }
        if include_predictions:
            payload["predictions"] = [p.public_dict() for p in self.predictions]
        return payload


def benchmark_policies(
    records: Iterable[QAResult],
    policies: Iterable[HistoricalValidationPolicy],
    *,
    target_start: date | None = None,
    target_end: date | None = None,
) -> list[PolicyValidationResult]:
    eligible = _eligible_records(records)
    return [
        validate_policy(eligible, policy, target_start=target_start, target_end=target_end)
        for policy in policies
    ]


def validate_policy(
    records: Iterable[QAResult],
    policy: HistoricalValidationPolicy,
    *,
    target_start: date | None = None,
    target_end: date | None = None,
) -> PolicyValidationResult:
    """Walk-forward validation with strict date leakage prevention.

    For each historical target sale, only sales dated strictly BEFORE the target
    date are eligible as comparables. Current listings and present-day project
    offers are deliberately excluded because historical snapshots are unavailable.
    This therefore validates the sold-comparable component, not the final
    multi-lane market-range reconciliation.
    """

    eligible = _eligible_records(records)
    targets = [
        r for r in eligible
        if (target_start is None or r.transaction.deal_date >= target_start)
        and (target_end is None or r.transaction.deal_date < target_end)
    ]

    predictions: list[HistoricalPrediction] = []
    for target in targets:
        prediction = _predict_one(target, eligible, policy)
        if prediction is not None:
            predictions.append(prediction)

    metrics = _metrics(targets, predictions, policy)
    return PolicyValidationResult(policy=policy, metrics=metrics, predictions=predictions)


def choose_best_by_calibration_mdape(results: Iterable[PolicyValidationResult]) -> PolicyValidationResult | None:
    """Select the lowest calibration MdAPE only; no opaque composite score."""

    usable = [
        r for r in results
        if r.metrics.median_absolute_percentage_error is not None
        and r.metrics.predicted_targets > 0
    ]
    if not usable:
        return None
    return min(
        usable,
        key=lambda r: (
            r.metrics.median_absolute_percentage_error,
            r.metrics.mean_absolute_percentage_error if r.metrics.mean_absolute_percentage_error is not None else inf,
            -r.metrics.predicted_targets,
        ),
    )


def _eligible_records(records: Iterable[QAResult]) -> list[QAResult]:
    out: list[QAResult] = []
    for result in records:
        tx = result.transaction
        if result.status is not QualityStatus.USABLE:
            continue
        if result.normalized_property_type != "standard_apartment":
            continue
        if tx.deal_date is None or tx.deal_amount is None or tx.deal_amount <= 0:
            continue
        if tx.area is None or tx.area <= 1 or tx.rooms is None or tx.rooms <= 0:
            continue
        if tx.latitude is None or tx.longitude is None:
            continue
        out.append(result)
    return sorted(out, key=lambda r: (r.transaction.deal_date, r.transaction.source_index))


def _predict_one(
    target: QAResult,
    all_records: list[QAResult],
    policy: HistoricalValidationPolicy,
) -> HistoricalPrediction | None:
    tx = target.transaction
    assert tx.deal_date is not None
    assert tx.deal_amount is not None
    assert tx.area is not None
    assert tx.rooms is not None
    assert tx.latitude is not None and tx.longitude is not None

    target_group = _group_key(target)
    selected_clusters: list[dict] = []
    used_area_filter = False
    area_filter_fallback = False
    lookback_used = policy.primary_lookback_months

    for lookback in (policy.primary_lookback_months, policy.fallback_lookback_months):
        base = _candidate_clusters(target, all_records, lookback, policy.exclude_target_building)
        if policy.area_band_pct is not None:
            filtered = [
                c for c in base
                if abs(c["median_area"] - tx.area) / tx.area <= policy.area_band_pct
            ]
            if len(filtered) >= policy.min_clusters_for_area_filter:
                working = filtered
                used_area_filter = True
            else:
                working = base
                area_filter_fallback = True
        else:
            working = base

        if len(working) >= policy.min_independent_clusters:
            selected_clusters = working
            lookback_used = lookback
            break

    if len(selected_clusters) < policy.min_independent_clusters:
        return None

    selected_clusters.sort(
        key=lambda c: (
            c["distance_m"],
            -c["newest_date"].toordinal(),
            abs(c["median_area"] - tx.area) / tx.area,
            c["group_key"],
        )
    )
    if policy.max_clusters is not None:
        selected_clusters = selected_clusters[: policy.max_clusters]

    if len(selected_clusters) < policy.min_independent_clusters:
        return None

    indications = [c["median_ppsqm"] * tx.area for c in selected_clusters]
    predicted = median(indications)
    lower = min(indications)
    upper = max(indications)
    actual = tx.deal_amount
    absolute_error = abs(predicted - actual)
    signed_pct = (predicted - actual) / actual

    return HistoricalPrediction(
        policy_name=policy.name,
        target_source_index=tx.source_index,
        target_asset_id=tx.asset_id,
        target_group_key=target_group,
        target_date=tx.deal_date,
        rooms=tx.rooms,
        target_area=tx.area,
        actual_price=_round_money(actual),
        predicted_price=_round_money(predicted),
        interval_lower=_round_money(lower),
        interval_upper=_round_money(upper),
        absolute_error=_round_money(absolute_error),
        absolute_percentage_error=absolute_error / actual,
        signed_percentage_error=signed_pct,
        interval_contains_actual=lower <= actual <= upper,
        selected_cluster_count=len(selected_clusters),
        selected_cluster_keys=[c["group_key"] for c in selected_clusters],
        lookback_months_used=lookback_used,
        used_area_filter=used_area_filter,
        area_filter_fallback=area_filter_fallback,
    )


def _candidate_clusters(
    target: QAResult,
    all_records: list[QAResult],
    lookback_months: int,
    exclude_target_building: bool,
) -> list[dict]:
    tx = target.transaction
    assert tx.deal_date is not None
    assert tx.rooms is not None
    assert tx.latitude is not None and tx.longitude is not None

    cutoff = _subtract_months(tx.deal_date, lookback_months)
    target_group = _group_key(target)
    grouped: dict[str, list[QAResult]] = defaultdict(list)

    for result in all_records:
        other = result.transaction
        if other.deal_date is None or other.deal_date >= tx.deal_date or other.deal_date < cutoff:
            continue
        if other.rooms != tx.rooms:
            continue
        key = _group_key(result)
        if exclude_target_building and key == target_group:
            continue
        grouped[key].append(result)

    clusters: list[dict] = []
    for key, rows in grouped.items():
        ppsqm = [r.transaction.deal_amount / r.transaction.area for r in rows]  # type: ignore[operator]
        areas = [r.transaction.area for r in rows if r.transaction.area is not None]
        dates = [r.transaction.deal_date for r in rows if r.transaction.deal_date is not None]
        lats = [r.transaction.latitude for r in rows if r.transaction.latitude is not None]
        lngs = [r.transaction.longitude for r in rows if r.transaction.longitude is not None]
        if not ppsqm or not areas or not dates or not lats or not lngs:
            continue
        lat = median(lats)
        lng = median(lngs)
        clusters.append(
            {
                "group_key": key,
                "median_ppsqm": median(ppsqm),
                "median_area": median(areas),
                "newest_date": max(dates),
                "distance_m": haversine_m(tx.latitude, tx.longitude, lat, lng),
                "record_count": len(rows),
            }
        )
    return clusters


def _group_key(result: QAResult) -> str:
    tx = result.transaction
    if result.normalized_address:
        return result.normalized_address
    if tx.latitude is not None and tx.longitude is not None:
        return f"coord:{tx.latitude:.6f},{tx.longitude:.6f}"
    if tx.asset_id:
        return f"asset:{tx.asset_id}"
    return f"source-index:{tx.source_index}"


def _metrics(
    targets: list[QAResult],
    predictions: list[HistoricalPrediction],
    policy: HistoricalValidationPolicy,
) -> ValidationMetrics:
    if not predictions:
        return ValidationMetrics(
            eligible_targets=len(targets),
            predicted_targets=0,
            prediction_coverage=0.0,
            median_absolute_error=None,
            median_absolute_percentage_error=None,
            mean_absolute_percentage_error=None,
            p90_absolute_percentage_error=None,
            median_signed_percentage_error=None,
            interval_hit_rate=None,
            median_interval_width_pct_of_actual=None,
            fallback_lookback_rate=None,
            area_filter_fallback_rate=None,
            by_rooms={},
        )

    apes = [p.absolute_percentage_error for p in predictions]
    abs_errors = [p.absolute_error for p in predictions]
    signed = [p.signed_percentage_error for p in predictions]
    widths = [
        (p.interval_upper - p.interval_lower) / p.actual_price
        for p in predictions
        if p.actual_price > 0
    ]
    by_rooms: dict[str, dict] = {}
    room_groups: dict[float, list[HistoricalPrediction]] = defaultdict(list)
    for p in predictions:
        room_groups[p.rooms].append(p)
    for rooms, rows in sorted(room_groups.items()):
        room_apes = [p.absolute_percentage_error for p in rows]
        room_signed = [p.signed_percentage_error for p in rows]
        by_rooms[str(int(rooms) if float(rooms).is_integer() else rooms)] = {
            "predicted_targets": len(rows),
            "median_absolute_percentage_error": median(room_apes),
            "mean_absolute_percentage_error": mean(room_apes),
            "median_signed_percentage_error": median(room_signed),
            "interval_hit_rate": mean(1.0 if p.interval_contains_actual else 0.0 for p in rows),
        }

    return ValidationMetrics(
        eligible_targets=len(targets),
        predicted_targets=len(predictions),
        prediction_coverage=len(predictions) / len(targets) if targets else 0.0,
        median_absolute_error=median(abs_errors),
        median_absolute_percentage_error=median(apes),
        mean_absolute_percentage_error=mean(apes),
        p90_absolute_percentage_error=_percentile(apes, 90),
        median_signed_percentage_error=median(signed),
        interval_hit_rate=mean(1.0 if p.interval_contains_actual else 0.0 for p in predictions),
        median_interval_width_pct_of_actual=median(widths) if widths else None,
        fallback_lookback_rate=mean(
            1.0 if p.lookback_months_used == policy.fallback_lookback_months else 0.0
            for p in predictions
        ),
        area_filter_fallback_rate=(
            mean(1.0 if p.area_filter_fallback else 0.0 for p in predictions)
            if policy.area_band_pct is not None
            else None
        ),
        by_rooms=by_rooms,
    )


def _percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise ValueError("values must not be empty")
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * percentile / 100.0
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _subtract_months(value: date, months: int) -> date:
    year = value.year
    month = value.month - months
    while month <= 0:
        month += 12
        year -= 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _round_money(value: float) -> float:
    return float(round(value / 1000.0) * 1000)
