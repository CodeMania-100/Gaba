from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date
from enum import Enum
from itertools import combinations
from math import inf
from statistics import median
from typing import Iterable
import calendar

from .comparables import ComparableCandidate, ComparableSet, sold_group_key


class EvidenceConfidence(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INSUFFICIENT = "insufficient"


class RangeStatus(str, Enum):
    CONSENSUS = "consensus"
    NO_CONSENSUS = "no_consensus"
    INSUFFICIENT = "insufficient_evidence"
    MANUAL_REVIEW = "manual_review_required"


@dataclass(slots=True)
class RangeMethodology:
    """Versioned, explicit methodology controls.

    These values govern evidence freshness/fallback only. They are not price
    premiums, discounts, or source weights.
    """

    version: str = "market-range-v1"
    sold_primary_lookback_months: int = 24
    sold_fallback_lookback_months: int = 60
    min_independent_sold_buildings: int = 2
    min_independent_contributors_for_medium: int = 2
    min_independent_contributors_for_high: int = 3


@dataclass(slots=True)
class EvidenceContribution:
    lane: str
    group_key: str
    source_ids: list[str]
    observed_prices: list[float]
    observed_areas: list[float]
    representative_observed_price: float | None
    representative_observed_area: float | None
    representative_price_per_sqm: float | None
    area_normalized_indication_ils: float | None
    newest_event_date: date | None = None
    neighborhood: str | None = None
    distance_m: float | None = None
    reasons: list[str] = field(default_factory=list)

    @property
    def target_equivalent_indication(self) -> float | None:
        # Deprecated alias. "Target equivalent" overstated what this normalization
        # does (area only -- balcony/floor/parking/orientation may still differ).
        # Kept for attribute-level access by any older internal code; public JSON
        # payloads carry both keys via public_dict() below.
        return self.area_normalized_indication_ils

    def public_dict(self) -> dict:
        payload = asdict(self)
        if self.newest_event_date is not None:
            payload["newest_event_date"] = self.newest_event_date.isoformat()
        payload["target_equivalent_indication"] = payload["area_normalized_indication_ils"]
        return payload


@dataclass(slots=True)
class LaneRange:
    lane: str
    confidence: EvidenceConfidence
    lower: float | None
    center: float | None
    upper: float | None
    primary_contributors: list[EvidenceContribution]
    reference_records: list[dict]
    warnings: list[str]
    methodology_notes: list[str]
    can_enter_consensus: bool

    def public_dict(self) -> dict:
        return {
            "lane": self.lane,
            "confidence": self.confidence.value,
            "range": {
                "lower": self.lower,
                "center": self.center,
                "upper": self.upper,
            },
            "primary_contributor_count": len(self.primary_contributors),
            "primary_contributors": [c.public_dict() for c in self.primary_contributors],
            "reference_records": self.reference_records,
            "warnings": self.warnings,
            "methodology_notes": self.methodology_notes,
            "can_enter_consensus": self.can_enter_consensus,
        }


@dataclass(slots=True)
class MarketRangeResult:
    status: RangeStatus
    confidence: EvidenceConfidence
    methodology: RangeMethodology
    target_unit_number: str
    target_internal_area: float | None
    supported_lower: float | None
    supported_upper: float | None
    support_lanes: list[str]
    sold: LaneRange
    current_asking: LaneRange
    new_development: LaneRange
    warnings: list[str]
    assumptions: list[str]
    decision_notes: list[str]

    def public_dict(self) -> dict:
        return {
            "status": self.status.value,
            "confidence": self.confidence.value,
            "methodology": asdict(self.methodology),
            "target_unit_number": self.target_unit_number,
            "target_internal_area": self.target_internal_area,
            "supported_range": {
                "lower": self.supported_lower,
                "upper": self.supported_upper,
                "support_lanes": self.support_lanes,
            },
            "lanes": {
                "sold": self.sold.public_dict(),
                "current_asking": self.current_asking.public_dict(),
                "new_development": self.new_development.public_dict(),
            },
            "warnings": self.warnings,
            "assumptions": self.assumptions,
            "decision_notes": self.decision_notes,
        }


def build_market_range(
    comparable_set: ComparableSet,
    *,
    as_of: date | None = None,
    methodology: RangeMethodology | None = None,
) -> MarketRangeResult:
    """Create a transparent market-supported interval from independent evidence lanes.

    The function intentionally does not apply a company strategy and does not
    invent floor/balcony/parking premiums. Where source area is known, it emits a
    target-equivalent *indication* using observed price-per-sqm x target internal
    area. This is a transparent normalization, not a claim that area pricing is
    perfectly linear. The limitation is surfaced in the output.

    A final supported interval is only produced when at least two sufficiently
    independent evidence lanes overlap. No numerical source weights are used.
    """

    methodology = methodology or RangeMethodology()
    as_of = as_of or date.today()
    target = comparable_set.target_unit

    if target.unit_type and target.unit_type != "standard_apartment":
        empty = _empty_lane("sold", "Special units are not forced through the standard-apartment range engine.")
        empty_ask = _empty_lane("current_asking", "Special units require separately relevant evidence.")
        empty_dev = _empty_lane("new_development", "Special units require separately relevant evidence.")
        return MarketRangeResult(
            status=RangeStatus.MANUAL_REVIEW,
            confidence=EvidenceConfidence.INSUFFICIENT,
            methodology=methodology,
            target_unit_number=target.unit_number,
            target_internal_area=target.internal_area,
            supported_lower=None,
            supported_upper=None,
            support_lanes=[],
            sold=empty,
            current_asking=empty_ask,
            new_development=empty_dev,
            warnings=["special_unit_requires_individual_pricing_review"],
            assumptions=[],
            decision_notes=["No standard-apartment market range was calculated for this unit."],
        )

    if target.internal_area is None or target.internal_area <= 0:
        empty = _empty_lane("sold", "Target internal area is required for area-normalized indications.")
        empty_ask = _empty_lane("current_asking", "Target internal area is required for area-normalized indications.")
        empty_dev = _empty_lane("new_development", "Target internal area is required for area-normalized indications.")
        return MarketRangeResult(
            status=RangeStatus.INSUFFICIENT,
            confidence=EvidenceConfidence.INSUFFICIENT,
            methodology=methodology,
            target_unit_number=target.unit_number,
            target_internal_area=target.internal_area,
            supported_lower=None,
            supported_upper=None,
            support_lanes=[],
            sold=empty,
            current_asking=empty_ask,
            new_development=empty_dev,
            warnings=["target_internal_area_missing"],
            assumptions=[],
            decision_notes=["A market range cannot be normalized without a target internal area."],
        )

    sold = _sold_lane(comparable_set, target.internal_area, as_of, methodology)
    asking = _asking_lane(comparable_set, target.internal_area, methodology)
    new_dev = _new_development_lane(comparable_set, target.internal_area, methodology)

    consensus_lanes = [lane for lane in (sold, asking, new_dev) if lane.can_enter_consensus]
    supported = _consensus_interval(consensus_lanes)

    warnings: list[str] = []
    decision_notes: list[str] = []
    if supported is None:
        if len(consensus_lanes) < 2:
            status = RangeStatus.INSUFFICIENT
            confidence = EvidenceConfidence.LOW if consensus_lanes else EvidenceConfidence.INSUFFICIENT
            warnings.append("fewer_than_two_independent_lanes_support_consensus")
            decision_notes.append("No single market-supported range is produced when fewer than two evidence lanes are sufficiently independent.")
        else:
            status = RangeStatus.NO_CONSENSUS
            confidence = EvidenceConfidence.LOW
            warnings.append("independent_evidence_lanes_do_not_form_one_consensus_interval")
            decision_notes.append("Evidence lanes disagree materially; preserve lane ranges separately and require pricing review rather than forcing a blended number.")
        lower = upper = None
        support_lanes: list[str] = []
    else:
        lower, upper, support_lanes = supported
        status = RangeStatus.CONSENSUS
        confidence = EvidenceConfidence.HIGH if len(support_lanes) >= 3 else EvidenceConfidence.MEDIUM
        decision_notes.append(
            "The supported range is the overlap shared by independent evidence lanes; no numerical source weights are applied."
        )

    supporting_lane_objects = [lane for lane in (sold, asking, new_dev) if lane.lane in support_lanes]
    supporting_area_extrapolation = [
        lane for lane in supporting_lane_objects
        if "target_area_outside_observed_area_envelope" in lane.warnings
    ]
    if supporting_area_extrapolation:
        warnings.append("target_is_smaller_or_larger_than_observed_primary_comparable_areas")
    if support_lanes and len(supporting_area_extrapolation) == len(supporting_lane_objects):
        # The lanes agree numerically, but both/all require an area extrapolation.
        # Preserve the range while lowering confidence rather than pretending the
        # overlap is directly observed for the target size.
        confidence = EvidenceConfidence.LOW
        warnings.append("supported_range_requires_area_extrapolation_in_all_supporting_lanes")
        decision_notes.append("The overlap is directionally useful but is not directly observed at the target unit size; manual pricing review is recommended.")

    if target.balcony_area is not None and target.balcony_area > 0:
        warnings.append("target_balcony_present_without_verified_monetary_adjustment")

    assumptions = [
        "Target-equivalent indications use observed price-per-sqm multiplied by the target INTERNAL area only when source area is known.",
        "Balcony, orientation, parking, storage and floor are not assigned monetary premiums unless a verified company rule or market-derived adjustment is supplied.",
        "Closed sales, current asking and new-development evidence remain separate; the supported range is based on overlap, not a weighted average.",
        "Project/unit offers with missing area remain visible as reference evidence but do not create an area-normalized target indication.",
    ]

    return MarketRangeResult(
        status=status,
        confidence=confidence,
        methodology=methodology,
        target_unit_number=target.unit_number,
        target_internal_area=target.internal_area,
        supported_lower=_round_money(lower),
        supported_upper=_round_money(upper),
        support_lanes=support_lanes,
        sold=sold,
        current_asking=asking,
        new_development=new_dev,
        warnings=warnings,
        assumptions=assumptions,
        decision_notes=decision_notes,
    )


def _sold_lane(comp: ComparableSet, target_area: float, as_of: date, method: RangeMethodology) -> LaneRange:
    primary_cutoff = _subtract_months(as_of, method.sold_primary_lookback_months)
    fallback_cutoff = _subtract_months(as_of, method.sold_fallback_lookback_months)

    target_neighborhood = _normalize_neighborhood(comp.target_location.neighborhood, comp.target_location.city)
    sold_scope = (comp.source_context or {}).get("sold_query_scope") or {}
    scoped_neighborhoods = {
        _normalize_neighborhood(n, comp.target_location.city)
        for n in (sold_scope.get("neighborhoods") or [])
        if n
    }
    explicitly_scoped_to_target = bool(target_neighborhood and target_neighborhood in scoped_neighborhoods)
    exact_labeled = [
        c for c in comp.sold
        if _normalize_neighborhood(c.neighborhood, comp.target_location.city) == target_neighborhood
    ]

    if not explicitly_scoped_to_target and not exact_labeled:
        return LaneRange(
            lane="sold",
            confidence=EvidenceConfidence.INSUFFICIENT,
            lower=None,
            center=None,
            upper=None,
            primary_contributors=[],
            reference_records=[c.public_dict() for c in comp.sold[:10]],
            warnings=["sold_evidence_not_verified_as_target_neighborhood_scope"],
            methodology_notes=[
                "Completed-sale evidence must be explicitly collected for the target neighborhood or carry a matching neighborhood label before it can create a primary lane range.",
                "Citywide completed sales may remain visible as context but do not drive the target range.",
            ],
            can_enter_consensus=False,
        )

    sold_pool = comp.sold if explicitly_scoped_to_target else exact_labeled
    recent = [c for c in sold_pool if c.event_date is not None and c.event_date >= primary_cutoff and _valid_price_area(c)]
    grouped = _group_candidates(recent, key=lambda c: sold_group_key(c) or f"record:{id(c)}")
    used_fallback = False

    if len(grouped) < method.min_independent_sold_buildings:
        widened = [c for c in sold_pool if c.event_date is not None and c.event_date >= fallback_cutoff and _valid_price_area(c)]
        grouped = _group_candidates(widened, key=lambda c: sold_group_key(c) or f"record:{id(c)}")
        used_fallback = True

    contributions = [_contribution_from_group("sold", key, rows, target_area) for key, rows in grouped.items()]
    contributions.sort(key=lambda c: (c.distance_m if c.distance_m is not None else inf, -(c.newest_event_date.toordinal()) if c.newest_event_date else inf))

    warnings: list[str] = []
    notes = [
        f"Each building contributes once, using the median observed price-per-sqm within the selected sale window.",
        f"Primary completed-sale lookback is {method.sold_primary_lookback_months} months; fallback is {method.sold_fallback_lookback_months} months only when independent-building evidence is insufficient.",
    ]
    if used_fallback:
        warnings.append("sold_recency_window_expanded")
    if sold_pool and all(c.neighborhood is None for c in sold_pool):
        if explicitly_scoped_to_target:
            warnings.append("sold_neighborhood_labels_missing_but_source_run_is_target_neighborhood_scoped")
        else:
            warnings.append("sold_neighborhood_labels_missing_geographic_anchor_used")

    lane = _finish_lane("sold", contributions, [], warnings, notes, method, target_area)

    # A query that intentionally covers the target plus adjacent neighborhoods is
    # useful local evidence, but it is not the same as verified exact-neighborhood
    # attribution when returned records lack/mislabel neighborhood names. Preserve
    # the evidence while capping confidence rather than pretending precision.
    if explicitly_scoped_to_target and len(scoped_neighborhoods) > 1 and not exact_labeled:
        lane.warnings.append("sold_scope_includes_target_plus_adjacent_neighborhoods_without_exact_record_labels")
        lane.methodology_notes.append(
            "The source run targeted the project neighborhood plus adjacent areas; returned coordinates drive geographic ranking, but exact neighborhood attribution is unverified."
        )
        if lane.confidence is EvidenceConfidence.HIGH:
            lane.confidence = EvidenceConfidence.MEDIUM

    return lane


def _asking_lane(comp: ComparableSet, target_area: float, method: RangeMethodology) -> LaneRange:
    target_neighborhood = _normalize_neighborhood(comp.target_location.neighborhood, comp.target_location.city)
    exact = [
        c for c in comp.current_asking
        if _normalize_neighborhood(c.neighborhood, comp.target_location.city) == target_neighborhood
        and _valid_price_area(c)
    ]
    warnings: list[str] = []
    notes = ["Current asking evidence uses exact normalized neighborhood matches when available."]

    if not exact:
        return LaneRange(
            lane="current_asking",
            confidence=EvidenceConfidence.INSUFFICIENT,
            lower=None,
            center=None,
            upper=None,
            primary_contributors=[],
            reference_records=[c.public_dict() for c in comp.current_asking[:10]],
            warnings=["no_exact_neighborhood_current_asking_evidence"],
            methodology_notes=notes,
            can_enter_consensus=False,
        )

    grouped = _group_candidates(exact, key=lambda c: c.address or c.source_id or f"record:{id(c)}")
    contributions = [_contribution_from_group("current_asking", key, rows, target_area) for key, rows in grouped.items()]
    contributions.sort(key=lambda c: c.distance_m if c.distance_m is not None else inf)
    return _finish_lane("current_asking", contributions, [], warnings, notes, method, target_area)


def _new_development_lane(comp: ComparableSet, target_area: float, method: RangeMethodology) -> LaneRange:
    target_neighborhood = _normalize_neighborhood(comp.target_location.neighborhood, comp.target_location.city)
    exact = [
        c for c in comp.new_development
        if _normalize_neighborhood(c.neighborhood, comp.target_location.city) == target_neighborhood
    ]
    nearby_reference = [c for c in comp.new_development if c not in exact]

    known_area = [c for c in exact if _valid_price_area(c)]
    missing_area = [c for c in exact if c.price is not None and (c.area is None or c.area <= 0)]
    grouped = _group_candidates(known_area, key=lambda c: c.project_name or c.source_id or f"record:{id(c)}")
    contributions = [_contribution_from_group("new_development", key, rows, target_area) for key, rows in grouped.items()]
    contributions.sort(key=lambda c: c.distance_m if c.distance_m is not None else inf)

    references = [c.public_dict() for c in missing_area + nearby_reference]
    warnings: list[str] = []
    if missing_area:
        warnings.append("new_development_offer_area_missing_reference_only")
    if nearby_reference:
        warnings.append("other_neighborhood_new_development_kept_as_reference")
    notes = [
        "Only explicitly priced unit offers are used.",
        "Exact-neighborhood offers with known unit area can create target-equivalent indications.",
        "Offers with missing area or from other neighborhoods remain visible as reference evidence and do not create a normalized range contribution.",
    ]
    return _finish_lane("new_development", contributions, references, warnings, notes, method, target_area)


def _finish_lane(
    lane: str,
    contributions: list[EvidenceContribution],
    references: list[dict],
    warnings: list[str],
    notes: list[str],
    method: RangeMethodology,
    target_area: float,
) -> LaneRange:
    values = [c.area_normalized_indication_ils for c in contributions if c.area_normalized_indication_ils is not None]
    areas = [a for c in contributions for a in c.observed_areas if a is not None]

    if not values:
        confidence = EvidenceConfidence.INSUFFICIENT
        low = center = high = None
        can_enter = False
    else:
        low = min(values)
        center = median(values)
        high = max(values)

        if len(contributions) < method.min_independent_contributors_for_medium:
            confidence = EvidenceConfidence.LOW
        elif len(contributions) >= method.min_independent_contributors_for_high:
            confidence = EvidenceConfidence.HIGH
        else:
            confidence = EvidenceConfidence.MEDIUM

        if areas and not (min(areas) <= target_area <= max(areas)):
            warnings.append("target_area_outside_observed_area_envelope")
            if confidence is EvidenceConfidence.HIGH:
                confidence = EvidenceConfidence.MEDIUM

        can_enter = confidence in {EvidenceConfidence.HIGH, EvidenceConfidence.MEDIUM}

    return LaneRange(
        lane=lane,
        confidence=confidence,
        lower=_round_money(low),
        center=_round_money(center),
        upper=_round_money(high),
        primary_contributors=contributions,
        reference_records=references,
        warnings=warnings,
        methodology_notes=notes,
        can_enter_consensus=can_enter,
    )


def _contribution_from_group(lane: str, key: str, rows: list[ComparableCandidate], target_area: float) -> EvidenceContribution:
    prices = [float(c.price) for c in rows if c.price is not None and c.price > 0]
    areas = [float(c.area) for c in rows if c.area is not None and c.area > 0]
    ppsqm = [float(c.price) / float(c.area) for c in rows if c.price is not None and c.area is not None and c.price > 0 and c.area > 0]
    dates = [c.event_date for c in rows if c.event_date is not None]
    distances = [c.distance_m for c in rows if c.distance_m is not None]
    source_ids = sorted({c.source_id for c in rows if c.source_id})
    neighborhoods = [c.neighborhood for c in rows if c.neighborhood]

    representative_ppsqm = median(ppsqm) if ppsqm else None
    indication = representative_ppsqm * target_area if representative_ppsqm is not None else None
    return EvidenceContribution(
        lane=lane,
        group_key=key,
        source_ids=source_ids,
        observed_prices=prices,
        observed_areas=areas,
        representative_observed_price=median(prices) if prices else None,
        representative_observed_area=median(areas) if areas else None,
        representative_price_per_sqm=round(representative_ppsqm, 2) if representative_ppsqm is not None else None,
        area_normalized_indication_ils=_round_money(indication),
        newest_event_date=max(dates) if dates else None,
        neighborhood=neighborhoods[0] if neighborhoods else None,
        distance_m=min(distances) if distances else None,
        reasons=["independent_group_contribution", "area_normalized_using_observed_price_per_sqm"],
    )


def _group_candidates(rows: Iterable[ComparableCandidate], key) -> dict[str, list[ComparableCandidate]]:
    grouped: dict[str, list[ComparableCandidate]] = {}
    for row in rows:
        grouped.setdefault(str(key(row)), []).append(row)
    return grouped


def _valid_price_area(c: ComparableCandidate) -> bool:
    return c.price is not None and c.price > 0 and c.area is not None and c.area > 1


def _normalize_neighborhood(value: str | None, city: str | None) -> str | None:
    if not value:
        return None
    text = " ".join(str(value).replace("׳", "'").replace("״", '"').split()).strip()
    if city:
        suffixes = [f", {city}", f" {city}"]
        for suffix in suffixes:
            if text.endswith(suffix):
                text = text[: -len(suffix)].strip(" ,")
    return text or None


def _consensus_interval(lanes: list[LaneRange]) -> tuple[float, float, list[str]] | None:
    """Return one overlap region supported by the maximum number of eligible lanes.

    If equally strong overlap exists in disconnected regions, return None rather
    than arbitrarily choosing one region.
    """

    eligible = [l for l in lanes if l.lower is not None and l.upper is not None]
    if len(eligible) < 2:
        return None

    best_support = 1
    intersections: list[tuple[float, float, tuple[str, ...]]] = []
    for size in range(2, len(eligible) + 1):
        for combo in combinations(eligible, size):
            low = max(l.lower for l in combo if l.lower is not None)
            high = min(l.upper for l in combo if l.upper is not None)
            if low <= high:
                names = tuple(sorted(l.lane for l in combo))
                if size > best_support:
                    best_support = size
                    intersections = [(low, high, names)]
                elif size == best_support:
                    intersections.append((low, high, names))

    if best_support < 2 or not intersections:
        return None

    # Merge regions that overlap/touch. If more than one disconnected maximum-support
    # region remains, the evidence is fragmented and should not be forced into one range.
    regions = sorted(intersections, key=lambda x: (x[0], x[1]))
    merged: list[tuple[float, float, set[str]]] = []
    for low, high, names in regions:
        if not merged or low > merged[-1][1]:
            merged.append((low, high, set(names)))
        else:
            prev_low, prev_high, prev_names = merged[-1]
            merged[-1] = (min(prev_low, low), max(prev_high, high), prev_names | set(names))

    if len(merged) != 1:
        return None
    low, high, names = merged[0]
    return low, high, sorted(names)


def _empty_lane(lane: str, note: str) -> LaneRange:
    return LaneRange(
        lane=lane,
        confidence=EvidenceConfidence.INSUFFICIENT,
        lower=None,
        center=None,
        upper=None,
        primary_contributors=[],
        reference_records=[],
        warnings=[],
        methodology_notes=[note],
        can_enter_consensus=False,
    )


def _subtract_months(value: date, months: int) -> date:
    year = value.year
    month = value.month - months
    while month <= 0:
        month += 12
        year -= 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _round_money(value: float | None) -> float | None:
    if value is None:
        return None
    # Avoid false precision in a market-supported range. Round to the nearest ₪1,000.
    return float(round(value / 1000.0) * 1000)
