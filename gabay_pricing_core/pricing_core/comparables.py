from __future__ import annotations

from dataclasses import dataclass, asdict, field
from datetime import date, datetime
from math import asin, cos, inf, radians, sin, sqrt
from statistics import median
from typing import Any, Iterable
from collections import defaultdict

from .geographic_scope import GeographicScopeAssessment, GeographicScopeStatus
from .market_regime import MarketRegime, MarketRegimeAssessment
from .models import ProjectLocation, QAResult, QualityStatus, Unit


@dataclass(slots=True)
class ComparableCandidate:
    lane: str
    source: str
    source_id: str | None
    source_url: str | None
    price: float | None
    rooms: float | None
    area: float | None
    floor: str | None
    property_type: str | None
    latitude: float | None
    longitude: float | None
    event_date: date | None
    project_name: str | None = None
    neighborhood: str | None = None
    address: str | None = None
    distance_m: float | None = None
    area_difference_pct: float | None = None
    floor_difference: float | None = None
    quality_status: str = "usable"
    reasons: list[str] | None = None
    raw: dict[str, Any] | None = None
    gush: int | None = None
    helka: int | None = None
    market_context: dict[str, Any] | None = None
    geographic_context: dict[str, Any] | None = None

    def public_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload.pop("raw", None)
        if payload.get("event_date") is not None:
            payload["event_date"] = payload["event_date"].isoformat()
        return payload


@dataclass(slots=True)
class CandidateSelectionTrace:
    """Observability record of one raw evidence row's eligibility decision.

    This does not introduce a second definition of "eligible comparable": it is
    produced inline by the same predicates `_sold_candidates`/`_madlan_listing_candidates`/
    `_project_candidates` already evaluate, for every row they look at (not only the
    ones that pass). ``rank`` is filled in by ``build_comparable_set`` once the lane's
    candidate list has been sorted, so it reflects the actual ranking order used.
    """

    lane: str
    source: str
    source_id: str | None
    included: bool
    reasons: list[str] = field(default_factory=list)
    rank: int | None = None

    def public_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class SoldBuildingCluster:
    address: str
    record_count: int
    newest_sale_date: date | None
    oldest_sale_date: date | None
    median_price: float | None
    median_price_per_sqm: float | None
    median_area: float | None
    distance_m: float | None
    source_ids: list[str]

    def public_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        if self.newest_sale_date is not None:
            payload["newest_sale_date"] = self.newest_sale_date.isoformat()
        if self.oldest_sale_date is not None:
            payload["oldest_sale_date"] = self.oldest_sale_date.isoformat()
        return payload


@dataclass(slots=True)
class ComparableSet:
    target_unit: Unit
    target_location: ProjectLocation
    sold: list[ComparableCandidate]
    sold_building_clusters: list[SoldBuildingCluster]
    current_asking: list[ComparableCandidate]
    new_development: list[ComparableCandidate]
    excluded_counts: dict[str, int]
    ranking_policy: list[str]
    source_context: dict[str, Any] = field(default_factory=dict)
    selection_trace: list[CandidateSelectionTrace] = field(default_factory=list)

    def public_dict(self) -> dict[str, Any]:
        return {
            "target_unit": asdict(self.target_unit),
            "target_location": asdict(self.target_location),
            "ranking_policy": self.ranking_policy,
            "excluded_counts": self.excluded_counts,
            "source_context": self.source_context,
            "sold": [c.public_dict() for c in self.sold],
            "sold_building_clusters": [c.public_dict() for c in self.sold_building_clusters],
            "current_asking": [c.public_dict() for c in self.current_asking],
            "new_development": [c.public_dict() for c in self.new_development],
            "selection_trace": [t.public_dict() for t in self.selection_trace],
        }


def build_comparable_set(
    target_unit: Unit,
    target_location: ProjectLocation,
    sold_qa: Iterable[QAResult],
    madlan_listings: Iterable[dict],
    madlan_projects: Iterable[dict],
    as_of: date | None = None,
    source_context: dict[str, Any] | None = None,
    sold_market_context_by_source_index: dict[int, MarketRegimeAssessment] | None = None,
    sold_geographic_context_by_source_index: dict[int, GeographicScopeAssessment] | None = None,
) -> ComparableSet:
    """Build ranked comparable candidates without inventing weighted scores.

    Eligibility is intentionally conservative. Ranking is lexicographic rather than
    a black-box weighted score: geography first, then recency, then area/floor similarity.
    The function ranks evidence; it does not yet calculate a price range.

    ``sold_market_context_by_source_index`` is an optional, frozen government-program
    market-regime assessment per sold record (keyed by the record's immutable
    ``source_index``, never ``asset_id``). ``None`` (the default) reproduces prior
    behavior exactly -- the regime gate only activates when a caller explicitly
    supplies a classified snapshot's context (see app_api.pricing_service).

    ``sold_geographic_context_by_source_index`` is the equivalent frozen, per-record
    geographic-scope assessment (also keyed by ``source_index``). ``None`` reproduces
    prior behavior exactly -- only a citywide source with a resolved local-parcel
    whitelist (currently the standard 3-room family) supplies this.
    """

    as_of = as_of or date.today()
    sold, sold_excluded, sold_trace = _sold_candidates(
        target_unit, target_location, sold_qa,
        sold_market_context_by_source_index, sold_geographic_context_by_source_index,
    )
    current, current_excluded, current_trace = _madlan_listing_candidates(target_unit, target_location, madlan_listings)
    projects, project_excluded, project_trace = _project_candidates(target_unit, target_location, madlan_projects)

    sold.sort(key=lambda c: _rank_key(c, target_unit, as_of, use_recency=True))
    current.sort(key=lambda c: _rank_key(c, target_unit, as_of, use_recency=False))
    projects.sort(key=lambda c: _rank_key(c, target_unit, as_of, use_recency=False))

    clusters = build_sold_building_clusters(sold)

    selection_trace = (
        _ranked_trace(sold, sold_trace)
        + _ranked_trace(current, current_trace)
        + _ranked_trace(projects, project_trace)
    )

    return ComparableSet(
        target_unit=target_unit,
        target_location=target_location,
        sold=sold,
        sold_building_clusters=clusters,
        current_asking=current,
        new_development=projects,
        excluded_counts={
            "sold": sold_excluded,
            "current_asking": current_excluded,
            "new_development": project_excluded,
        },
        ranking_policy=[
            "Exact room count and compatible property type are eligibility gates.",
            "Usable evidence only enters the primary comparable lanes.",
            "Geographic distance ranks before structural similarity when coordinates are available.",
            "For completed sales, recency ranks before area/floor tie-breakers after geography.",
            "No weighted relevance score or hidden price premium is used.",
        ],
        source_context=source_context or {},
        selection_trace=selection_trace,
    )


def _ranked_trace(
    sorted_candidates: list[ComparableCandidate],
    trace_entries: list[tuple[CandidateSelectionTrace, ComparableCandidate | None]],
) -> list[CandidateSelectionTrace]:
    """Attach the real post-sort rank (1-based) to each included trace entry."""

    rank_by_identity = {id(c): i + 1 for i, c in enumerate(sorted_candidates)}
    out: list[CandidateSelectionTrace] = []
    for entry, candidate in trace_entries:
        if candidate is not None:
            entry.rank = rank_by_identity.get(id(candidate))
        out.append(entry)
    return out


def build_sold_building_clusters(candidates: Iterable[ComparableCandidate]) -> list[SoldBuildingCluster]:
    by_address: dict[str, list[ComparableCandidate]] = defaultdict(list)
    for candidate in candidates:
        if candidate.lane != "sold":
            continue
        key = sold_group_key(candidate)
        if key:
            by_address[key].append(candidate)

    clusters: list[SoldBuildingCluster] = []
    for address, rows in by_address.items():
        dates = sorted([r.event_date for r in rows if r.event_date is not None])
        prices = [r.price for r in rows if r.price is not None]
        areas = [r.area for r in rows if r.area is not None]
        ppsqm = []
        for r in rows:
            if r.raw and r.raw.get("pricePerSqm") is not None:
                try:
                    ppsqm.append(float(r.raw["pricePerSqm"]))
                except (TypeError, ValueError):
                    pass
        distances = [r.distance_m for r in rows if r.distance_m is not None]
        source_ids = sorted({r.source_id for r in rows if r.source_id})
        clusters.append(
            SoldBuildingCluster(
                address=address,
                record_count=len(rows),
                newest_sale_date=dates[-1] if dates else None,
                oldest_sale_date=dates[0] if dates else None,
                median_price=median(prices) if prices else None,
                median_price_per_sqm=median(ppsqm) if ppsqm else None,
                median_area=median(areas) if areas else None,
                distance_m=min(distances) if distances else None,
                source_ids=source_ids,
            )
        )

    clusters.sort(
        key=lambda c: (
            c.distance_m if c.distance_m is not None else inf,
            -(c.newest_sale_date.toordinal()) if c.newest_sale_date else inf,
        )
    )
    return clusters



def sold_group_key(candidate: ComparableCandidate) -> str | None:
    """Return the most defensible available building/location grouping key.

    Hierarchy: address, then coordinates, then cadastral parcel (gush/helka), then
    unresolved. A transaction's ``source_id``/``assetId`` identifies the record, not
    an independent building or location, and is deliberately never used here --
    using it would let identical-looking records with distinct asset ids inflate
    independence counts.
    """

    if candidate.address:
        return candidate.address
    if candidate.latitude is not None and candidate.longitude is not None:
        # Source coordinates repeat exactly for the same geocoded location in the
        # tested feeds. Six decimals is ~0.1 m latitude precision and is used only
        # as a grouping identifier, not as a claim about cadastral boundaries.
        return f"coord:{candidate.latitude:.6f},{candidate.longitude:.6f}"
    if candidate.gush is not None and candidate.helka is not None:
        # Conservative fallback: where building identity is unavailable, the
        # cadastral parcel is the narrowest defensible independently-verified
        # location grouping. Multiple buildings sharing one parcel still count
        # only once, so this never overstates independence.
        return f"parcel:{candidate.gush}/{candidate.helka}"
    return None


def sold_group_basis(candidate: ComparableCandidate) -> str:
    """How ``sold_group_key`` resolved this candidate's location identity --
    surfaced separately so evidence quality is never presented as uniform."""

    if candidate.address:
        return "address"
    if candidate.latitude is not None and candidate.longitude is not None:
        return "coordinates"
    if candidate.gush is not None and candidate.helka is not None:
        return "cadastral_parcel"
    return "unresolved"

def _sold_candidates(
    target: Unit,
    location: ProjectLocation,
    rows: Iterable[QAResult],
    sold_market_context_by_source_index: dict[int, MarketRegimeAssessment] | None = None,
    sold_geographic_context_by_source_index: dict[int, GeographicScopeAssessment] | None = None,
) -> tuple[list[ComparableCandidate], int, list[tuple[CandidateSelectionTrace, ComparableCandidate | None]]]:
    candidates: list[ComparableCandidate] = []
    excluded = 0
    trace: list[tuple[CandidateSelectionTrace, ComparableCandidate | None]] = []
    source = "govmap_via_nadlan_deals"
    for result in rows:
        tx = result.transaction
        if result.status is not QualityStatus.USABLE:
            excluded += 1
            reasons = [f"quality_status:{result.status.value}"] + [f"qa_reason:{r}" for r in result.reasons]
            trace.append((CandidateSelectionTrace("sold", source, tx.asset_id, False, reasons), None))
            continue
        if result.normalized_property_type != "standard_apartment":
            excluded += 1
            trace.append((
                CandidateSelectionTrace(
                    "sold", source, tx.asset_id, False,
                    [f"property_type_not_standard_apartment:{result.normalized_property_type}"],
                ),
                None,
            ))
            continue
        if target.rooms is not None and tx.rooms != target.rooms:
            excluded += 1
            trace.append((
                CandidateSelectionTrace(
                    "sold", source, tx.asset_id, False,
                    [f"room_count_mismatch:target={target.rooms}:actual={tx.rooms}"],
                ),
                None,
            ))
            continue
        if location.city and tx.city and tx.city != location.city:
            excluded += 1
            trace.append((
                CandidateSelectionTrace(
                    "sold", source, tx.asset_id, False,
                    [f"city_mismatch:target={location.city}:actual={tx.city}"],
                ),
                None,
            ))
            continue
        geo_assessment: GeographicScopeAssessment | None = None
        if sold_geographic_context_by_source_index is not None:
            geo_assessment = sold_geographic_context_by_source_index.get(tx.source_index)
            geo_status = geo_assessment.scope_status if geo_assessment is not None else GeographicScopeStatus.UNRESOLVED
            if geo_status is not GeographicScopeStatus.VERIFIED_LOCAL:
                excluded += 1
                trace.append((
                    CandidateSelectionTrace("sold", source, tx.asset_id, False, [f"geographic_scope:{geo_status.value}"]),
                    None,
                ))
                continue
        market_assessment: MarketRegimeAssessment | None = None
        if sold_market_context_by_source_index is not None:
            market_assessment = sold_market_context_by_source_index.get(tx.source_index)
            regime = market_assessment.regime if market_assessment is not None else MarketRegime.UNRESOLVED
            if regime is not MarketRegime.MARKET_LIKE:
                excluded += 1
                trace.append((
                    CandidateSelectionTrace("sold", source, tx.asset_id, False, [f"market_regime:{regime.value}"]),
                    None,
                ))
                continue
        candidate = _candidate(
            lane="sold",
            source=source,
            source_id=tx.asset_id,
            source_url=None,
            price=tx.deal_amount,
            rooms=tx.rooms,
            area=tx.area,
            floor=tx.floor,
            property_type=result.normalized_property_type,
            lat=tx.latitude,
            lng=tx.longitude,
            event_date=tx.deal_date,
            neighborhood=tx.neighborhood,
            address=result.normalized_address,
            target=target,
            location=location,
            quality_status=result.status.value,
            reasons=list(result.reasons),
            raw=tx.raw,
            gush=_parcel_int(tx.gush),
            helka=_parcel_int(tx.helka),
            market_context=market_assessment.public_dict() if market_assessment is not None else None,
            geographic_context=geo_assessment.public_dict() if geo_assessment is not None else None,
        )
        candidates.append(candidate)
        trace.append((CandidateSelectionTrace("sold", source, tx.asset_id, True, ["eligible_comparable"]), candidate))
    return candidates, excluded, trace


def _madlan_listing_candidates(
    target: Unit, location: ProjectLocation, rows: Iterable[dict]
) -> tuple[list[ComparableCandidate], int, list[tuple[CandidateSelectionTrace, ComparableCandidate | None]]]:
    candidates: list[ComparableCandidate] = []
    excluded = 0
    trace: list[tuple[CandidateSelectionTrace, ComparableCandidate | None]] = []
    source = "madlan_listing"
    for raw in rows:
        source_id = _text(raw.get("id"))
        if (raw.get("cityHebrew") or raw.get("city")) not in {location.city, "Ashkelon" if location.city == "אשקלון" else location.city}:
            excluded += 1
            trace.append((CandidateSelectionTrace("current_asking", source, source_id, False, ["city_mismatch"]), None))
            continue
        if raw.get("propertyType") != "flat":
            excluded += 1
            trace.append((
                CandidateSelectionTrace("current_asking", source, source_id, False, [f"property_type_not_flat:{raw.get('propertyType')}"]),
                None,
            ))
            continue
        rooms = _num(raw.get("rooms"))
        if target.rooms is not None and rooms != target.rooms:
            excluded += 1
            trace.append((
                CandidateSelectionTrace("current_asking", source, source_id, False, [f"room_count_mismatch:target={target.rooms}:actual={rooms}"]),
                None,
            ))
            continue
        area = _num(raw.get("areaSqm"))
        price = _num(raw.get("price"))
        if area is None or area <= 1 or price is None or price <= 0:
            excluded += 1
            trace.append((
                CandidateSelectionTrace("current_asking", source, source_id, False, ["missing_or_invalid_price_or_area"]),
                None,
            ))
            continue
        lat, lng = _normalize_israel_coords(_num(raw.get("latitude")), _num(raw.get("longitude")))
        candidate = _candidate(
            lane="current_asking",
            source=source,
            source_id=source_id,
            source_url=_text(raw.get("url")),
            price=price,
            rooms=rooms,
            area=area,
            floor=_text(raw.get("floor")),
            property_type="standard_apartment",
            lat=lat,
            lng=lng,
            event_date=_date_from_timestamp(raw.get("firstSeen") or raw.get("scrapedAt")),
            neighborhood=_text(raw.get("neighbourhood")),
            address=_text(raw.get("address")),
            target=target,
            location=location,
            raw=raw,
        )
        candidates.append(candidate)
        trace.append((CandidateSelectionTrace("current_asking", source, source_id, True, ["eligible_comparable"]), candidate))
    return candidates, excluded, trace


def _project_candidates(
    target: Unit, location: ProjectLocation, projects: Iterable[dict]
) -> tuple[list[ComparableCandidate], int, list[tuple[CandidateSelectionTrace, ComparableCandidate | None]]]:
    candidates: list[ComparableCandidate] = []
    excluded = 0
    trace: list[tuple[CandidateSelectionTrace, ComparableCandidate | None]] = []
    source = "madlan_project"
    for project in projects:
        address = project.get("addressDetails") or {}
        project_id = _text(project.get("id"))
        if address.get("city") != location.city:
            excluded += 1
            trace.append((CandidateSelectionTrace("new_development", source, project_id, False, ["city_mismatch"]), None))
            continue
        point = project.get("locationPoint") or {}
        lat, lng = _normalize_israel_coords(_num(point.get("lat")), _num(point.get("lng")))
        project_name = _text(project.get("projectName"))
        project_url = _text(project.get("url"))
        project_offers = 0
        for i, offer in enumerate(project.get("apartmentType") or []):
            offer_id = f"{project.get('id')}:{i}"
            rooms = _num(offer.get("beds"))
            if target.rooms is not None and rooms != target.rooms:
                trace.append((
                    CandidateSelectionTrace("new_development", source, offer_id, False, [f"room_count_mismatch:target={target.rooms}:actual={rooms}"]),
                    None,
                ))
                continue
            if offer.get("type") != "FLAT":
                trace.append((
                    CandidateSelectionTrace("new_development", source, offer_id, False, [f"offer_type_not_flat:{offer.get('type')}"]),
                    None,
                ))
                continue
            price = _num(offer.get("price"))
            if price is None or price <= 0:
                # Do not assign a project-level priceRange to a unit type unless the unit itself is priced.
                trace.append((
                    CandidateSelectionTrace("new_development", source, offer_id, False, ["offer_not_explicitly_priced"]),
                    None,
                ))
                continue
            project_offers += 1
            candidate = _candidate(
                lane="new_development",
                source=source,
                source_id=offer_id,
                source_url=project_url,
                price=price,
                rooms=rooms,
                area=_num(offer.get("size")),
                floor=None,
                property_type="standard_apartment",
                lat=lat,
                lng=lng,
                event_date=_project_event_date(project.get("firstTimeSeen")),
                project_name=project_name,
                neighborhood=_text(address.get("neighbourhood")),
                address=_project_address(address),
                target=target,
                location=location,
                raw=project,
            )
            candidates.append(candidate)
            trace.append((CandidateSelectionTrace("new_development", source, offer_id, True, ["eligible_comparable"]), candidate))
        if project_offers == 0:
            excluded += 1
    return candidates, excluded, trace


def _candidate(
    *, lane: str, source: str, source_id: str | None, source_url: str | None,
    price: float | None, rooms: float | None, area: float | None, floor: str | None,
    property_type: str | None, lat: float | None, lng: float | None,
    event_date: date | None, target: Unit, location: ProjectLocation,
    project_name: str | None = None, neighborhood: str | None = None,
    address: str | None = None, quality_status: str = "usable",
    reasons: list[str] | None = None, raw: dict[str, Any] | None = None,
    gush: int | None = None, helka: int | None = None,
    market_context: dict[str, Any] | None = None,
    geographic_context: dict[str, Any] | None = None,
) -> ComparableCandidate:
    distance = None
    if None not in (location.latitude, location.longitude, lat, lng):
        distance = haversine_m(location.latitude, location.longitude, lat, lng)
    area_diff = None
    if target.internal_area and area:
        area_diff = abs(area - target.internal_area) / target.internal_area
    floor_diff = _floor_difference(target.floor, floor)
    return ComparableCandidate(
        lane=lane,
        source=source,
        source_id=source_id,
        source_url=source_url,
        price=price,
        rooms=rooms,
        area=area,
        floor=floor,
        property_type=property_type,
        latitude=lat,
        longitude=lng,
        event_date=event_date,
        project_name=project_name,
        neighborhood=neighborhood,
        address=address,
        distance_m=round(distance, 1) if distance is not None else None,
        area_difference_pct=round(area_diff, 4) if area_diff is not None else None,
        floor_difference=floor_diff,
        quality_status=quality_status,
        reasons=reasons or [],
        raw=raw,
        gush=gush,
        helka=helka,
        market_context=market_context,
        geographic_context=geographic_context,
    )


def _rank_key(candidate: ComparableCandidate, target: Unit, as_of: date, use_recency: bool) -> tuple:
    distance = candidate.distance_m if candidate.distance_m is not None else inf
    recency_days = (as_of - candidate.event_date).days if use_recency and candidate.event_date else inf
    if recency_days < 0:
        recency_days = 0
    area_diff = candidate.area_difference_pct if candidate.area_difference_pct is not None else inf
    floor_diff = candidate.floor_difference if candidate.floor_difference is not None else inf
    return (distance, recency_days, area_diff, floor_diff, candidate.price or inf)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6_371_000.0
    p1, p2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lon2 - lon1)
    a = sin(dphi / 2) ** 2 + cos(p1) * cos(p2) * sin(dlambda / 2) ** 2
    return 2 * radius * asin(sqrt(a))


def _floor_difference(target_floor: str | int | None, comp_floor: str | None) -> float | None:
    try:
        return abs(float(target_floor) - float(comp_floor))
    except (TypeError, ValueError):
        return None


def _normalize_israel_coords(lat: float | None, lng: float | None) -> tuple[float | None, float | None]:
    if lat is None or lng is None:
        return lat, lng
    normal = 29 <= lat <= 34.6 and 34 <= lng <= 36.6
    reversed_ok = 29 <= lng <= 34.6 and 34 <= lat <= 36.6
    if not normal and reversed_ok:
        return lng, lat
    return lat, lng


def _project_address(address: dict) -> str | None:
    street = _text(address.get("streetName"))
    number = _text(address.get("streetNumber"))
    if street and number:
        return f"{street} {number}"
    return street



def _project_event_date(value: Any) -> date | None:
    text = _text(value)
    if text and text.startswith("1990-01-01"):
        # Observed Madlan-project actor sentinel/default, not a credible project date.
        return None
    return _date_from_timestamp(value)

def _date_from_timestamp(value: Any) -> date | None:
    text = _text(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None


def _parcel_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _num(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
