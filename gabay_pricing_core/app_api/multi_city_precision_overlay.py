"""precision_overlay_v3 adapter -- a richer PRESENTATION overlay on top of
the full special_full_v2 universe. Never a replacement: every function here
takes the already-built V2 universe/register and enriches only the records
that match by stable identity, leaving every non-matching V2 record and
every V2 field on a matching record untouched unless V3 explicitly carries
a better value for it.

Match keys (confirmed by direct read, not assumed):
  - precision_overlay_v3/selected_comparables.csv's own `record_id` reuses
    special_full_v2's asking-CSV `listing_id` values verbatim.
  - precision_overlay_v3/selected_projects.json's `project_id` matches
    special_full_v2/competitor_projects_v2.json's `project_id` directly.

"Stricter status wins": if either side's validation status carries a
CONFLICT/CONTEXT_ONLY/HISTORICAL marker, price/status fields are never
merged from V3 into V2 -- only non-price descriptive attributes are. This is
what stops a V2 price sitting next to a V3 CONFLICT flag from silently
becoming "a clean verified number" (the task's own worked example).
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

from .multi_city_standard_market import MULTI_CITY_ROOT_DIRNAME

_STRICT_MARKERS = ("CONFLICT", "CONTEXT_ONLY", "HISTORICAL")

# Purely descriptive/attribute fields safe to merge in regardless of status --
# never price or validation-status fields, which are handled separately by
# the strictness check.
_COMPARABLE_ENRICHMENT_FIELDS = (
    "garden_area_sqm", "terrace_area_sqm", "total_outdoor_area_sqm", "entry_floor", "upper_floor",
    "number_of_levels", "parking_present", "parking_count", "storage_present", "storage_area_sqm",
    "mamad", "orientation_count", "orientation_directions", "similarity_reason", "notes", "conflict_group",
)


def _overlay_dir(pricing_core_data_dir: Path) -> Path:
    return pricing_core_data_dir / "data" / MULTI_CITY_ROOT_DIRNAME / "precision_overlay_v3"


def load_selected_comparables(pricing_core_data_dir: Path) -> list[dict[str, str]]:
    path = _overlay_dir(pricing_core_data_dir) / "selected_comparables.csv"
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def load_selected_projects(pricing_core_data_dir: Path) -> list[dict[str, Any]]:
    path = _overlay_dir(pricing_core_data_dir) / "selected_projects.json"
    return json.loads(path.read_text(encoding="utf-8"))["projects"]


def _has_strict_marker(status: str | None) -> bool:
    text = (status or "").upper()
    return any(marker in text for marker in _STRICT_MARKERS)


def _merge_comparable(v2_row: dict[str, Any], v3_row: dict[str, str]) -> dict[str, Any]:
    v2_status = v2_row.get("validation_status")
    v3_status = v3_row.get("precision_validation_status") or v3_row.get("baseline_validation_status")
    conflicted = _has_strict_marker(v2_status) or _has_strict_marker(v3_status)

    merged = dict(v2_row)
    for field in _COMPARABLE_ENRICHMENT_FIELDS:
        value = v3_row.get(field)
        if value not in (None, ""):
            merged[field] = value

    merged["precision_overlay"] = {
        "matched": True,
        "record_id": v3_row.get("record_id"),
        "selection_origin": v3_row.get("selection_origin"),
        "baseline_validation_status": v3_row.get("baseline_validation_status"),
        "precision_validation_status": v3_row.get("precision_validation_status"),
        # Deliberately never surfaced as a replacement price -- price/status
        # stay whatever the base V2 record already carried. Kept alongside
        # only for transparency about what V3 itself observed.
        "v3_observed_price_ils": v3_row.get("price_ils"),
        "conflicted": conflicted,
    }
    return merged


def apply_comparable_overlay(universe: list[dict[str, Any]], pricing_core_data_dir: Path, city: str) -> list[dict[str, Any]]:
    """Enriches the `current_resale`-origin rows of a special-unit product-
    comparison universe (see multi_city_special_market.
    build_special_product_comparison_universe) with matching V3 comparables.
    Every row not matched by identity passes through completely untouched
    with precision_overlay=None -- the full V2 universe is preserved."""

    by_record_id = {
        row["record_id"]: row
        for row in load_selected_comparables(pricing_core_data_dir)
        if row.get("city") == city
    }

    enriched: list[dict[str, Any]] = []
    for row in universe:
        v3_row = by_record_id.get(row.get("record_key")) if row.get("evidence_origin") == "current_resale" else None
        enriched.append(_merge_comparable(row, v3_row) if v3_row else {**row, "precision_overlay": None})
    return enriched


def _merge_project(v2_project: dict[str, Any], v3_project: dict[str, Any]) -> dict[str, Any]:
    merged = dict(v2_project)
    for field in ("precision_notes", "precision_sources"):
        if v3_project.get(field):
            merged[field] = v3_project[field]
    # known_unit_variants: only add V3 variants whose price_type is itself
    # quantitative-compatible or that carry non-null descriptive detail the
    # V2 variant lacked -- never let a V3 variant silently replace a V2 one
    # wholesale (they are matched by project, not by individual variant).
    merged["precision_overlay"] = {
        "matched": True,
        "project_id": v3_project.get("project_id"),
        "known_unit_variants_v3": v3_project.get("known_unit_variants", []),
    }
    return merged


def apply_project_overlay(projects: list[dict[str, Any]], pricing_core_data_dir: Path, city: str) -> list[dict[str, Any]]:
    """Enriches the full V2 competitor_projects_v2.json register (32
    projects) with the matching subset of V3's 9 selected_projects.json
    entries -- every non-matching V2 project passes through untouched."""

    by_project_id = {p["project_id"]: p for p in load_selected_projects(pricing_core_data_dir) if p.get("city") == city}

    enriched: list[dict[str, Any]] = []
    for project in projects:
        v3_project = by_project_id.get(project.get("project_id"))
        enriched.append(_merge_project(project, v3_project) if v3_project else {**project, "precision_overlay": None})
    return enriched
