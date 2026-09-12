"""Standard 3R/5R market-evidence adapter for the frozen multi-city package
(data/multi_city_integration_final/standard_market/<dir>/). Read-only
reshaping of already-frozen engine output -- nothing here recomputes a
market range. market_summary.json's own per-lane shape already matches the
frontend's PtkLaneRange contract field-for-field (lane, confidence, range,
primary_contributor_count, primary_contributors, reference_records,
warnings, methodology_notes, can_enter_consensus), so each lane object is
passed straight through, keyed by its own `lane` field rather than by a
hand-maintained rename table.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

MULTI_CITY_ROOT_DIRNAME = "multi_city_integration_final"


def _multi_city_root(pricing_core_data_dir: Path) -> Path:
    return pricing_core_data_dir / "data" / MULTI_CITY_ROOT_DIRNAME


def _standard_market_dir(pricing_core_data_dir: Path, standard_market_dir: str) -> Path:
    return _multi_city_root(pricing_core_data_dir) / "standard_market" / standard_market_dir


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_csv(path: Path) -> list[dict[str, str]]:
    # utf-8-sig: several of these frozen CSVs carry a UTF-8 BOM on their
    # first column (confirmed by direct read) -- utf-8 alone would leave a
    # stray U+FEFF prefixed onto that column's dict key.
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def load_location(pricing_core_data_dir: Path, standard_market_dir: str) -> dict[str, Any]:
    return _load_json(_standard_market_dir(pricing_core_data_dir, standard_market_dir) / "location.json")


def load_market_summary(pricing_core_data_dir: Path, standard_market_dir: str) -> dict[str, Any]:
    return _load_json(_standard_market_dir(pricing_core_data_dir, standard_market_dir) / "market_summary.json")


def load_completed_sales(pricing_core_data_dir: Path, standard_market_dir: str, family: str) -> list[dict[str, str]]:
    suffix = "3r" if family == "3R" else "5r"
    return _load_csv(_standard_market_dir(pricing_core_data_dir, standard_market_dir) / f"completed_sales_{suffix}.csv")


def load_current_asking(pricing_core_data_dir: Path, standard_market_dir: str, family: str) -> list[dict[str, str]]:
    suffix = "3r" if family == "3R" else "5r"
    return _load_csv(_standard_market_dir(pricing_core_data_dir, standard_market_dir) / f"current_asking_{suffix}.csv")


def load_new_development_competitors(pricing_core_data_dir: Path, standard_market_dir: str) -> list[dict[str, Any]]:
    """standard_market/<dir>/competitors.json -- a bare array (confirmed by
    direct read), used ONLY for the standard-family new-development evidence
    lane. Not to be confused with special_full_v2/competitor_projects_v2.json
    (the much larger, richer register used for the "מול אילו פרויקטים אנחנו
    מתחרים?" tab) -- two separate competitor universes, never merged."""

    return _load_json(_standard_market_dir(pricing_core_data_dir, standard_market_dir) / "competitors.json")


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def build_asking_evidence_record(row: dict[str, str]) -> dict[str, Any]:
    """Reshapes one current_asking_*.csv row into the exact field
    convention app_api.petah_tikva_workspace's own asking records already
    use (asking_price/asking_ppsm/listing_id/first_seen/...) -- this is what
    lib/marketMap.ts's pushAskingPoint() already reads, so the map needs no
    frontend changes to plot these markers. `listing_id` is set to this
    dataset's own `record_uid` deliberately: market_summary.json's lane
    `primary_contributors[].source_ids` already reference the same
    `record_uid` values, so "contributes to pricing" highlighting keeps
    working unmodified."""

    price = _to_float(row.get("price_ils"))
    area = _to_float(row.get("area_sqm"))
    lat, lng = _to_float(row.get("latitude")), _to_float(row.get("longitude"))
    return {
        "listing_id": row.get("record_uid"),
        "address": row.get("address"),
        "latitude": lat,
        "longitude": lng,
        "rooms": _to_float(row.get("rooms")),
        "asking_price": price,
        "asking_ppsm": (price / area) if price is not None and area else None,
        "area": area,
        "floor": row.get("floor") or None,
        "first_seen": row.get("published_at") or row.get("retrieved_at") or None,
        "url": row.get("source_url") or None,
        "exclusion_reasons": [] if row.get("status") == "accepted" else [row.get("status") or "excluded"],
    }


def build_sold_evidence_record(row: dict[str, str]) -> dict[str, Any]:
    """Reshapes one completed_sales_*.csv row into the exact field
    convention app_api.petah_tikva_workspace._sold_evidence_section's own
    records already use (address/event_date/price/price_per_sqm/area/
    quality_status) -- read directly by lib/marketMap.ts's
    deriveSoldPoints()."""

    price = _to_float(row.get("price_ils"))
    area = _to_float(row.get("area_sqm"))
    return {
        "address": row.get("address"),
        "event_date": row.get("event_date"),
        "price": price,
        "price_per_sqm": (price / area) if price is not None and area else None,
        "area": area,
        # This dataset's own `status` column (e.g. "accepted") already IS
        # the QA verdict -- never re-run sold QA here, this is frozen,
        # already-QA'd evidence, unlike Petah Tikva's citywide feed which
        # still needs live QA at request time (see petah_tikva_workspace.py
        # _sold_evidence_section's own docstring on that one exception).
        "quality_status": "usable" if row.get("status") == "accepted" else (row.get("status") or "rejected"),
    }


def build_map_geocode_record(record_id: str, address: str | None, lat: float | None, lng: float | None, precision: str) -> dict[str, Any] | None:
    if address is None or lat is None or lng is None:
        return None
    return {
        "record_id": record_id, "address": address, "lat": lat, "lng": lng,
        "coordinate_source": "geocoded_address", "precision": precision,
        "resolved_label": address, "verified": True,
    }


FAMILY_KEY = {"3R": "standard_3r", "5R": "standard_5r"}
FAMILY_ROOMS = {"3R": 3, "5R": 5}


def build_family_market_block(family: str, family_summary: dict[str, Any]) -> dict[str, Any]:
    """family_summary is market_summary.json["families"][family] -- the
    frozen engine's own already-computed result. Returns the exact
    `market`/`evidence_lanes`/`target`/`warnings` shape petah_tikva_workspace
    already produces, so the frontend needs zero changes to consume it."""

    supported = family_summary["supported_range"]
    evidence_lanes = {lane["lane"]: lane for lane in family_summary["lanes"].values()}

    return {
        "target": {
            "family": family,
            "rooms": FAMILY_ROOMS[family],
            "internal_area": family_summary["target_internal_area"],
            "balcony_area": family_summary.get("target_balcony_area"),
        },
        "market": {
            "status": family_summary["status"],
            "confidence": family_summary["confidence"],
            "supported_lower": supported["lower"],
            "supported_upper": supported["upper"],
            "support_lanes": supported["support_lanes"],
        },
        "evidence_lanes": {
            "sold": evidence_lanes.get("sold"),
            "current_asking": evidence_lanes.get("current_asking"),
            "new_development": evidence_lanes.get("new_development"),
        },
        "warnings": family_summary.get("warnings", []),
        # The frozen engine's own already-chosen point within the supported
        # range -- confirmed equal to the midpoint (50% position), the exact
        # same convention Petah Tikva's own baseline strategy already uses
        # (BASELINE_POSITION_PCT = 50.0 in petah_tikva_pricing.py). Every
        # standard unit in this family gets this one uniform commercial base
        # price -- never a per-unit recalculation.
        "market_indication_point_ils": family_summary["market_indication_point_ils"],
    }
