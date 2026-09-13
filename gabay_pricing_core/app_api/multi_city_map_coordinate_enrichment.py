"""multi_city_competitor_coordinate_enrichment_v1 adapter -- a map-only
coordinate overlay on top of the full special_full_v2 competitor register.
Never a replacement: every function here takes the already-reshaped V2
project list and improves only the map coordinate of records that match by
stable `project_id`, leaving every non-matching project and every other V2
field completely untouched.

This is the SAME architectural pattern as multi_city_precision_overlay's
apply_project_overlay -- a separate frozen file, matched by stable ID,
merged additively -- deliberately kept as its own module because it enriches
a different, narrower thing (map display coordinate only, never pricing or
commercial facts) and is produced by a different offline process (one-time
Nominatim geocoding of the address/street text already present in
competitor_projects_v2.json -- see
build_multi_city_competitor_coordinate_enrichment_v1.py -- not curated
research).

Resolution priority enforced here:
  1. project already at coordinate_precision == "PROJECT" -- an exact,
     curated coordinate. Never touched, regardless of whether an enrichment
     entry exists for it.
  2. an enrichment entry exists (GEOCODED_ADDRESS or GEOCODED_STREET) --
     overrides latitude/longitude/coordinate_precision only.
  3. neither -- the project's existing NEIGHBORHOOD_CENTROID coordinate
     passes through unchanged.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .multi_city_standard_market import MULTI_CITY_ROOT_DIRNAME

ENRICHMENT_FILENAME = "multi_city_competitor_coordinate_enrichment_v1.json"

# P0 "coordinate coverage" follow-up: a second, lower-priority overlay for
# projects the primary (address-on-file) pass above could never even
# attempt -- those with no address/street on file at all. See
# build_multi_city_competitor_url_location_enrichment_v1.py's own docstring
# for the full investigation; as of that pass this file resolves 0 projects
# (every candidate's own source page named only a neighborhood, never a
# street, except one whose named street does not exist in Netanya per the
# geocoder) -- kept wired in so a future rerun (a source page updated, or
# OSM gaining the missing street) improves coverage with no code change.
URL_LOCATION_ENRICHMENT_FILENAME = "multi_city_competitor_url_location_enrichment_v1.json"

# Kept in sync with the two precision tags the geocoding script writes
# (see build_multi_city_competitor_coordinate_enrichment_v1.py); never
# reuses the source dataset's own "PROJECT" value.
_GEOCODED_PRECISIONS = {"GEOCODED_ADDRESS", "GEOCODED_STREET"}


def load_map_coordinate_enrichment(pricing_core_data_dir: Path) -> dict[str, dict[str, Any]]:
    path = pricing_core_data_dir / "data" / "frozen" / ENRICHMENT_FILENAME
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {entry["project_id"]: entry for entry in payload.get("resolved", [])}


def load_url_location_enrichment(pricing_core_data_dir: Path) -> dict[str, dict[str, Any]]:
    path = pricing_core_data_dir / "data" / "frozen" / URL_LOCATION_ENRICHMENT_FILENAME
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {entry["project_id"]: entry for entry in payload.get("resolved", [])}


def _merge_coordinate(project: dict[str, Any], enrichment: dict[str, Any]) -> dict[str, Any]:
    merged = dict(project)
    merged["latitude"] = enrichment["lat"]
    merged["longitude"] = enrichment["lng"]
    merged["coordinate_precision"] = enrichment["coordinate_precision"]
    merged["coordinate_note"] = (
        f"Geocoded once from the project's own {enrichment['input_kind']} text already on file "
        f"({enrichment['query_text']!r}); no new commercial fact was collected. Source: "
        f"{enrichment['geocoder']}."
    )
    merged["map_coordinate_enrichment"] = {
        "matched": True,
        "input_kind": enrichment["input_kind"],
        "query_text": enrichment["query_text"],
        "resolved_label": enrichment.get("resolved_label"),
        "geocoder": enrichment.get("geocoder"),
    }
    return merged


def apply_map_coordinate_enrichment(projects: list[dict[str, Any]], pricing_core_data_dir: Path) -> list[dict[str, Any]]:
    """Enriches the map display coordinate of the full V2 competitor register
    with the matching subset of the one-time geocoding pass's resolved
    entries. A project already at PROJECT precision is never touched even if
    a resolved entry exists for it; a project with no resolved entry passes
    through with its existing neighborhood-centroid coordinate untouched.

    Two overlays are tried, in priority order, per project -- never both:
    the primary address/street-on-file pass, then (only if that one has no
    entry) the source_url-derived pass above, which exists precisely for
    the projects the primary pass could never attempt (no address/street on
    file to begin with). Whichever one has an entry wins; a project with an
    entry in neither keeps its existing neighborhood-centroid coordinate."""

    by_project_id = load_map_coordinate_enrichment(pricing_core_data_dir)
    url_location_by_project_id = load_url_location_enrichment(pricing_core_data_dir)

    enriched: list[dict[str, Any]] = []
    for project in projects:
        if project.get("coordinate_precision") == "PROJECT":
            enriched.append({**project, "map_coordinate_enrichment": None})
            continue
        entry = by_project_id.get(project.get("project_id")) or url_location_by_project_id.get(project.get("project_id"))
        enriched.append(_merge_coordinate(project, entry) if entry else {**project, "map_coordinate_enrichment": None})
    return enriched


# ---------------------------------------------------------------------------
# multi_city_evidence_coordinate_enrichment_v1 adapter -- the companion
# one-time pass for standard sold/asking and special sold/asking evidence
# (see build_multi_city_evidence_coordinate_enrichment_v1.py). Keyed by
# (city, address) rather than a per-record id, since several evidence rows
# legitimately share one building address (multiple transactions, multiple
# listings) and this is the exact grain the geocoding pass itself used --
# never a per-row geocode, never a guess. Every source CSV row keeps its own
# original latitude/longitude/coordinate_precision fields untouched; this
# only supplies a *separate* improved coordinate a caller may choose to
# prefer, exactly mirroring apply_map_coordinate_enrichment above.
# ---------------------------------------------------------------------------

EVIDENCE_ENRICHMENT_FILENAME = "multi_city_evidence_coordinate_enrichment_v1.json"


def load_evidence_coordinate_enrichment(pricing_core_data_dir: Path) -> dict[tuple[str, str], dict[str, Any]]:
    path = pricing_core_data_dir / "data" / "frozen" / EVIDENCE_ENRICHMENT_FILENAME
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {(entry["city"], entry["address"]): entry for entry in payload.get("resolved", [])}


def resolve_evidence_coordinate(
    lookup: dict[tuple[str, str], dict[str, Any]], city: str, address: str | None,
) -> tuple[float, float, str] | None:
    """Returns (lat, lng, coordinate_precision) when this (city, address) was
    geocoded to a real address/street coordinate, else None -- the caller
    keeps whatever fallback coordinate it already had. coordinate_precision
    is one of the same "GEOCODED_ADDRESS"/"GEOCODED_STREET" tags the
    competitor enrichment uses, mapped by the same frontend precision dict
    (see market_context_workspace._SPECIAL_COORDINATE_PRECISION)."""

    if not address:
        return None
    entry = lookup.get((city, address))
    if not entry:
        return None
    return entry["lat"], entry["lng"], entry["coordinate_precision"]
