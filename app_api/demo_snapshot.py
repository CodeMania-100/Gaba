from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any

from pricing_core import ProjectLocation, QAResult, QualityStatus, SoldQAOutput, SoldTransaction, haversine_m, run_sold_qa
from pricing_core.comparison import ComparableAttributes

from .db_models import EvidenceRecordRow, MarketSnapshotRow, ProjectRow, SourceRunRow
from .source_manifest import DEMO_SOURCE_MANIFEST, SourceManifestEntry, default_demo_data_dir, resolve_source_path

DEMO_DISCLAIMER = (
    "Demo market selected for the assignment. The supplied apartment mix did not include a "
    "project location. עיר היין, אשקלון is a candidate-selected demo market; this does not "
    "claim the supplied 39-unit workbook belongs to a real Gabay project there."
)

# Only these primary sources actually feed pricing_core.build_comparable_set; only their
# own embedded collection timestamps may ever drive pricing_as_of.
PRIMARY_SOURCE_KEYS = ("govmap_sold_3room", "govmap_sold_5room", "madlan_listings", "madlan_projects")

# Which of the primary sources carry a real, trustworthy per-record collection
# timestamp field. madlan_projects deliberately has none: its only "seen" field
# (firstTimeSeen) is a known bogus sentinel (1990-01-01) that pricing_core.comparables
# already discards -- so it never participates in pricing_as_of.
_TIMESTAMP_FIELDS_BY_SOURCE: dict[str, tuple[str, ...]] = {
    "govmap_sold_3room": ("scrapedAt",),
    "govmap_sold_5room": ("scrapedAt",),
    "madlan_listings": ("scrapedAt", "firstSeen"),
    "yad2_listings": ("scrapedAt", "publishedAt"),
    "tax_enrichment": ("scrapedAt",),
}


class RequiredSourceMissingError(RuntimeError):
    pass


@dataclass
class _LoadedSource:
    entry: SourceManifestEntry
    records: Any = None
    sha256: str | None = None
    collected_at: datetime | None = None
    collected_at_basis: str | None = None
    error: str | None = None


def build_demo_market_snapshot(db, project: ProjectRow, demo_data_dir: Path | None = None) -> MarketSnapshotRow:
    """Ingest the frozen real market files into one immutable market snapshot.

    Required primary sources (the ones pricing_core.build_comparable_set actually
    consumes) abort snapshot creation with a clear error if missing. Optional
    secondary/reference sources are recorded as 'unavailable' and do not block
    the snapshot.
    """

    demo_data_dir = demo_data_dir or default_demo_data_dir()
    loaded: dict[str, _LoadedSource] = {
        entry.source_key: _load_source(entry, demo_data_dir) for entry in DEMO_SOURCE_MANIFEST
    }

    sold_3_qa = run_sold_qa(loaded["govmap_sold_3room"].records)
    sold_5_qa = run_sold_qa(loaded["govmap_sold_5room"].records)
    madlan_listings = loaded["madlan_listings"].records
    madlan_projects = loaded["madlan_projects"].records

    location = _demo_location(madlan_listings)
    pricing_as_of, pricing_as_of_basis, excluded_sources = _derive_pricing_as_of(loaded)

    snapshot = MarketSnapshotRow(
        project_id=project.id,
        status="complete",
        location_city=location.city,
        location_neighborhood=location.neighborhood,
        location_latitude=location.latitude,
        location_longitude=location.longitude,
        location_source=location.source,
        pricing_as_of=pricing_as_of.isoformat(),
        pricing_as_of_basis=pricing_as_of_basis,
        pricing_as_of_excluded_sources_json=json.dumps(excluded_sources, ensure_ascii=False),
        demo_disclaimer=DEMO_DISCLAIMER,
    )
    db.add(snapshot)
    db.flush()

    _persist_sold_source(db, snapshot, "govmap_sold_3room", loaded["govmap_sold_3room"], sold_3_qa, location)
    _persist_sold_source(db, snapshot, "govmap_sold_5room", loaded["govmap_sold_5room"], sold_5_qa, location)
    _persist_listing_source(db, snapshot, "madlan_listings", loaded["madlan_listings"], location)
    _persist_project_source(db, snapshot, "madlan_projects", loaded["madlan_projects"], location)

    for key in (
        "yad2_listings",
        "xplan_area",
        "xplan_point",
        "construction_competitor_matches",
        "construction_summary",
        "tax_enrichment",
    ):
        _persist_reference_source(db, snapshot, key, loaded[key])

    db.flush()
    return snapshot


def sold_result_to_normalized_payload(result: QAResult) -> dict[str, Any]:
    """The exact normalized representation the QA pass derived from raw -- what the
    pricing core actually consumes. Kept separate from the untouched raw payload."""

    tx = result.transaction
    return {
        "source_index": tx.source_index,
        "deal_date": tx.deal_date.isoformat() if tx.deal_date else None,
        "deal_amount": tx.deal_amount,
        "price_per_sqm": tx.price_per_sqm,
        "address": tx.address,
        "city": tx.city,
        "neighborhood": tx.neighborhood,
        "rooms": tx.rooms,
        "floor": tx.floor,
        "area": tx.area,
        "property_type": tx.property_type,
        "is_first_hand": tx.is_first_hand,
        "gush": tx.gush,
        "helka": tx.helka,
        "tat_helka": tx.tat_helka,
        "asset_id": tx.asset_id,
        "latitude": tx.latitude,
        "longitude": tx.longitude,
        "scraped_at": tx.scraped_at,
        "normalized_address": result.normalized_address,
        "normalized_property_type": result.normalized_property_type,
        "related_source_indices": list(result.related_source_indices),
    }


def normalized_payload_to_qa_result(normalized: dict[str, Any], raw_payload: dict[str, Any], quality_status: str, quality_reasons: list[str]) -> QAResult:
    """Reconstruct the exact QAResult the QA pass produced, from persisted state --
    never by re-deriving normalization from raw at read time."""

    tx = SoldTransaction(
        source_index=normalized["source_index"],
        deal_date=date.fromisoformat(normalized["deal_date"]) if normalized.get("deal_date") else None,
        deal_amount=normalized.get("deal_amount"),
        price_per_sqm=normalized.get("price_per_sqm"),
        address=normalized.get("address"),
        city=normalized.get("city"),
        neighborhood=normalized.get("neighborhood"),
        rooms=normalized.get("rooms"),
        floor=normalized.get("floor"),
        area=normalized.get("area"),
        property_type=normalized.get("property_type"),
        is_first_hand=normalized.get("is_first_hand"),
        gush=normalized.get("gush"),
        helka=normalized.get("helka"),
        tat_helka=normalized.get("tat_helka"),
        asset_id=normalized.get("asset_id"),
        latitude=normalized.get("latitude"),
        longitude=normalized.get("longitude"),
        scraped_at=normalized.get("scraped_at"),
        raw=raw_payload,
    )
    return QAResult(
        transaction=tx,
        status=QualityStatus(quality_status),
        reasons=list(quality_reasons),
        normalized_address=normalized.get("normalized_address"),
        normalized_property_type=normalized.get("normalized_property_type"),
        related_source_indices=list(normalized.get("related_source_indices") or []),
    )


def _load_source(entry: SourceManifestEntry, demo_data_dir: Path) -> _LoadedSource:
    path = resolve_source_path(entry, demo_data_dir)
    if not path.exists():
        if entry.required:
            raise RequiredSourceMissingError(
                f"required source '{entry.source_key}' not found at {entry.relative_path} under {demo_data_dir}"
            )
        return _LoadedSource(entry=entry, error="source_file_not_found")

    try:
        raw_text = path.read_text(encoding="utf-8")
        records = json.loads(raw_text)
    except Exception as exc:  # noqa: BLE001 -- surfaced as a failed source run, never a crash
        if entry.required:
            raise RequiredSourceMissingError(f"required source '{entry.source_key}' failed to parse: {exc}") from exc
        return _LoadedSource(entry=entry, error=f"parse_error:{exc}")

    sha256 = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()
    collected_at, basis = _collected_at_for(entry.source_key, records, path)
    return _LoadedSource(entry=entry, records=records, sha256=sha256, collected_at=collected_at, collected_at_basis=basis)


def _collected_at_for(source_key: str, records: Any, path: Path) -> tuple[datetime, str]:
    keys = _TIMESTAMP_FIELDS_BY_SOURCE.get(source_key)
    if keys:
        found = _max_iso_timestamp(records, keys)
        if found is not None:
            return found, "source_embedded_timestamp"
    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return mtime, "file_mtime_fallback_no_embedded_timestamp"


def _max_iso_timestamp(records: Any, keys: tuple[str, ...]) -> datetime | None:
    values: list[datetime] = []
    rows = records if isinstance(records, list) else [records]
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key in keys:
            raw = row.get(key)
            if not raw:
                continue
            try:
                parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            except ValueError:
                continue
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            values.append(parsed)
    return max(values) if values else None


def _derive_pricing_as_of(loaded: dict[str, _LoadedSource]) -> tuple[date, str, list[dict[str, str]]]:
    candidates: list[tuple[str, datetime]] = []
    excluded: list[dict[str, str]] = []
    for key in PRIMARY_SOURCE_KEYS:
        source = loaded[key]
        if key in _TIMESTAMP_FIELDS_BY_SOURCE and source.collected_at_basis == "source_embedded_timestamp":
            candidates.append((key, source.collected_at))
        else:
            reason = (
                "no trustworthy embedded per-record collection timestamp field exists on this primary source"
                if key not in _TIMESTAMP_FIELDS_BY_SOURCE
                else "embedded timestamp lookup failed for this primary source; only a file-mtime fallback was available"
            )
            excluded.append({"source_key": key, "reason": reason})

    if not candidates:
        now = datetime.now(timezone.utc)
        return now.date(), "no_trustworthy_primary_source_timestamp_found_using_application_date", excluded

    best_key, best_dt = max(candidates, key=lambda kv: kv[1])
    basis = f"max_embedded_collection_timestamp_across_primary_sources(driving_source={best_key})"
    return best_dt.date(), basis, excluded


def _demo_location(listings: list[dict]) -> ProjectLocation:
    points: list[tuple[float, float]] = []
    for row in listings:
        if row.get("neighbourhood") != "עיר היין":
            continue
        try:
            lat, lng = float(row.get("latitude")), float(row.get("longitude"))
        except (TypeError, ValueError):
            continue
        lat, lng = _swap_if_reversed(lat, lng)
        points.append((lat, lng))
    if not points:
        raise RuntimeError("Could not derive the demo neighborhood anchor from madlan_listings")
    return ProjectLocation(
        city="אשקלון",
        neighborhood="עיר היין",
        latitude=median(p[0] for p in points),
        longitude=median(p[1] for p in points),
        source="candidate_demo_neighborhood_centroid_from_current_listings",
    )


def _swap_if_reversed(lat: float, lng: float) -> tuple[float, float]:
    normal = 29 <= lat <= 34.6 and 34 <= lng <= 36.6
    reversed_ok = 29 <= lng <= 34.6 and 34 <= lat <= 36.6
    if not normal and reversed_ok:
        return lng, lat
    return lat, lng


def _extract_comparable_attributes(
    source_type: str,
    raw: dict[str, Any],
    *,
    rooms: float | None,
    internal_area: float | None,
    floor: Any,
    property_type: str | None,
) -> ComparableAttributes:
    """Computed once, at ingestion time, from the exact parsing logic that exists
    right now. A later change to this function never rewrites an already-persisted
    snapshot's stored comparable_attributes_json -- only future snapshots see it."""

    if source_type == "madlan_listings":
        has_balcony = raw.get("hasBalcony")
        has_balcony = has_balcony if isinstance(has_balcony, bool) else None
        parking_count = _num(raw.get("parking"))
        has_garden = raw.get("hasGarden")
        return ComparableAttributes(
            rooms=rooms,
            internal_area=internal_area,
            floor=floor,
            balcony_present=has_balcony,
            balcony_area_sqm=0.0 if has_balcony is False else None,
            parking_present=None if parking_count is None else parking_count > 0,
            parking_count=None if parking_count is None else int(parking_count),
            garden=has_garden if isinstance(has_garden, bool) else None,
            property_type=property_type,
        )

    # GovMap sold records and Madlan new-development offers carry none of the
    # balcony/parking/storage/orientation/garden fields -- correctly left unknown
    # rather than guessed.
    return ComparableAttributes(rooms=rooms, internal_area=internal_area, floor=floor, property_type=property_type)


def _distance_m(location: ProjectLocation, lat: float | None, lng: float | None) -> float | None:
    if location.latitude is None or location.longitude is None or lat is None or lng is None:
        return None
    return round(haversine_m(location.latitude, location.longitude, lat, lng), 1)


def _persist_source_run(
    db,
    snapshot: MarketSnapshotRow,
    key: str,
    loaded: _LoadedSource,
    *,
    status: str,
    raw_count: int = 0,
    usable_count: int = 0,
    rejected_count: int = 0,
) -> SourceRunRow:
    entry = loaded.entry
    run = SourceRunRow(
        market_snapshot_id=snapshot.id,
        source_key=key,
        lane=entry.lane,
        status=status,
        raw_count=raw_count,
        usable_count=usable_count,
        rejected_count=rejected_count,
        source_filename=Path(entry.relative_path).name,
        relative_source_path=entry.relative_path,
        sha256=loaded.sha256,
        collected_at=loaded.collected_at,
        collected_at_basis=loaded.collected_at_basis,
        error_code=None if status == "success" else (loaded.error or status),
        safe_error_message=loaded.error,
        completed_at=datetime.now(timezone.utc),
    )
    db.add(run)
    db.flush()
    return run


def _persist_sold_source(db, snapshot: MarketSnapshotRow, key: str, loaded: _LoadedSource, qa_output: SoldQAOutput, location: ProjectLocation) -> None:
    summary = qa_output.summary
    run = _persist_source_run(
        db, snapshot, key, loaded,
        status="success",
        raw_count=summary["raw_records"],
        usable_count=summary["primary_usable_records"],
        rejected_count=summary["rejected_records"],
    )
    for result in qa_output.records:
        tx = result.transaction
        db.add(EvidenceRecordRow(
            market_snapshot_id=snapshot.id,
            source_run_id=run.id,
            lane="sold",
            source_type=key,
            source_record_id=tx.asset_id,
            quality_status=result.status.value,
            quality_reasons_json=json.dumps(result.reasons, ensure_ascii=False),
            address=result.normalized_address,
            price=tx.deal_amount,
            rooms=tx.rooms,
            area=tx.area,
            floor=tx.floor,
            event_date=tx.deal_date.isoformat() if tx.deal_date else None,
            neighborhood=tx.neighborhood,
            project_name=None,
            distance_m=_distance_m(location, tx.latitude, tx.longitude),
            raw_payload_json=json.dumps(tx.raw, ensure_ascii=False, default=str),
            normalized_payload_json=json.dumps(sold_result_to_normalized_payload(result), ensure_ascii=False),
            comparable_attributes_json=json.dumps(
                _extract_comparable_attributes(
                    key, tx.raw, rooms=tx.rooms, internal_area=tx.area, floor=tx.floor,
                    property_type=result.normalized_property_type,
                ).public_dict(),
                ensure_ascii=False,
            ),
        ))


def _persist_listing_source(db, snapshot: MarketSnapshotRow, key: str, loaded: _LoadedSource, location: ProjectLocation) -> None:
    records = loaded.records or []
    run = _persist_source_run(db, snapshot, key, loaded, status="success", raw_count=len(records), usable_count=len(records))
    for raw in records:
        lat, lng = _num(raw.get("latitude")), _num(raw.get("longitude"))
        if lat is not None and lng is not None:
            lat, lng = _swap_if_reversed(lat, lng)
        event = raw.get("firstSeen") or raw.get("scrapedAt")
        db.add(EvidenceRecordRow(
            market_snapshot_id=snapshot.id,
            source_run_id=run.id,
            lane="current_asking",
            source_type=key,
            source_record_id=_text(raw.get("id")),
            quality_status="usable",
            quality_reasons_json="[]",
            address=_text(raw.get("address")),
            price=_num(raw.get("price")),
            rooms=_num(raw.get("rooms")),
            area=_num(raw.get("areaSqm")),
            floor=_text(raw.get("floor")),
            event_date=_iso_date_or_none(event),
            neighborhood=_text(raw.get("neighbourhood")),
            project_name=None,
            distance_m=_distance_m(location, lat, lng),
            raw_payload_json=json.dumps(raw, ensure_ascii=False, default=str),
            normalized_payload_json=None,
            comparable_attributes_json=json.dumps(
                _extract_comparable_attributes(
                    key, raw, rooms=_num(raw.get("rooms")), internal_area=_num(raw.get("areaSqm")),
                    floor=_text(raw.get("floor")), property_type="standard_apartment",
                ).public_dict(),
                ensure_ascii=False,
            ),
        ))


def _persist_project_source(db, snapshot: MarketSnapshotRow, key: str, loaded: _LoadedSource, location: ProjectLocation) -> None:
    projects = loaded.records or []
    offer_count = sum(len(p.get("apartmentType") or []) for p in projects)
    run = _persist_source_run(db, snapshot, key, loaded, status="success", raw_count=offer_count, usable_count=offer_count)
    for project in projects:
        address = project.get("addressDetails") or {}
        point = project.get("locationPoint") or {}
        lat, lng = _num(point.get("lat")), _num(point.get("lng"))
        if lat is not None and lng is not None:
            lat, lng = _swap_if_reversed(lat, lng)
        project_name = _text(project.get("projectName"))
        street = _text(address.get("streetName"))
        number = _text(address.get("streetNumber"))
        proj_address = f"{street} {number}" if street and number else street
        for i, offer in enumerate(project.get("apartmentType") or []):
            db.add(EvidenceRecordRow(
                market_snapshot_id=snapshot.id,
                source_run_id=run.id,
                lane="new_development",
                source_type=key,
                source_record_id=f"{project.get('id')}:{i}",
                quality_status="usable",
                quality_reasons_json="[]",
                address=proj_address,
                price=_num(offer.get("price")),
                rooms=_num(offer.get("beds")),
                area=_num(offer.get("size")),
                floor=None,
                event_date=None,
                neighborhood=_text(address.get("neighbourhood")),
                project_name=project_name,
                distance_m=_distance_m(location, lat, lng),
                raw_payload_json=json.dumps(project, ensure_ascii=False, default=str),
                normalized_payload_json=None,
                comparable_attributes_json=json.dumps(
                    _extract_comparable_attributes(
                        key, offer, rooms=_num(offer.get("beds")), internal_area=_num(offer.get("size")),
                        floor=None, property_type="standard_apartment",
                    ).public_dict(),
                    ensure_ascii=False,
                ),
            ))


def _persist_reference_source(db, snapshot: MarketSnapshotRow, key: str, loaded: _LoadedSource) -> None:
    if loaded.records is None:
        _persist_source_run(db, snapshot, key, loaded, status="unavailable" if loaded.error == "source_file_not_found" else "failed")
        return

    rows = loaded.records if isinstance(loaded.records, list) else [loaded.records]
    run = _persist_source_run(db, snapshot, key, loaded, status="success", raw_count=len(rows), usable_count=len(rows))
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        db.add(EvidenceRecordRow(
            market_snapshot_id=snapshot.id,
            source_run_id=run.id,
            lane="reference",
            source_type=key,
            source_record_id=_reference_record_id(key, row, i),
            quality_status="reference_only",
            quality_reasons_json=json.dumps(["not_used_in_range_calculation"]),
            address=_text(row.get("address") or row.get("site_name")),
            price=_num(row.get("price")),
            rooms=_num(row.get("rooms")),
            area=_num(row.get("areaSqm") or row.get("area")),
            floor=_text(row.get("floor")),
            event_date=_iso_date_or_none(row.get("scrapedAt") or row.get("publishedAt") or row.get("dealDate")),
            neighborhood=_text(row.get("neighbourhood") or row.get("neighborhoodName")),
            project_name=_text(row.get("layer_name") or row.get("site_name")),
            distance_m=None,
            raw_payload_json=json.dumps(row, ensure_ascii=False, default=str),
            normalized_payload_json=None,
        ))


def _reference_record_id(key: str, row: dict, index: int) -> str:
    for field_name in ("listingId", "_id", "id", "layer_id", "assetId"):
        if row.get(field_name) is not None:
            return f"{key}:{row.get(field_name)}"
    return f"{key}:{index}"


def _iso_date_or_none(value: Any) -> str | None:
    text = _text(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        try:
            return date.fromisoformat(text[:10]).isoformat()
        except ValueError:
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
