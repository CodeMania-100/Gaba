"""multi_city_commercial_terms_enrichment_v1 loader -- a commercial-
intelligence layer only: payment structure, financing, indexation benefit,
discount, included product benefits, promotions and delivery/status for a
curated set of 13 high-relevance competitors across all four market
contexts. This module is read-only and additive, exactly like the SAME
architectural pattern already used for map-coordinate enrichment (see
multi_city_map_coordinate_enrichment.py's own docstring): a separate frozen
file, matched by stable id (with a name fallback), merged as its own
workspace branch -- never merged into competitor_projects_v2.json,
standard_market/*/competitors.json, or any special-unit evidence file, and
never read by any pricing/evidence/consensus code.

Hard invariant (see the dataset's own README.md / baseline_policy):
  commercial terms -> UI context only
  commercial terms -X-> pricing engine, market indication, or evidence lanes

This loader never computes an effective price, a discount-equivalent price,
an NPV, an index-adjusted price, or any "commercial attractiveness" score --
it only shapes and indexes the frozen research for display.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

EXPECTED_VERSION = "v1"
ENRICHMENT_DIRNAME = "multi_city_commercial_terms_enrichment_v1"
ENRICHMENT_FILENAME = "multi_city_commercial_terms_enrichment_v1.json"

# The enrichment's own market_context keys are spelled differently from this
# app's existing market-context slugs (compare app_api/market_context_
# registry.py's MARKET_CONTEXTS). An explicit, exhaustive mapping -- never
# inferred from a city string -- so a typo or a future context addition
# fails loudly (KeyError) instead of silently resolving to the wrong market
# or no market at all.
MARKET_CONTEXT_TO_COMMERCIAL_CONTEXT: dict[str, str] = {
    "petah_tikva": "petah_tikva",
    "yad_eliyahu": "tel_aviv_yad_eliyahu",
    "kiryat_hasharon": "netanya_kiryat_hasharon",
    "barnea": "ashkelon_barnea",
}


def normalize_commercial_project_name(name: str) -> str:
    """The same dash-normalization convention already established elsewhere
    in this app (see frontend lib/competitorRegister.ts's
    normalizeProjectName) -- collapses the handful of Unicode dash
    characters this frozen data disagrees on into one plain hyphen. Never a
    fuzzy/similarity match; two names that differ by anything else still
    fail to match, by design."""
    return re.sub(r"[‐-―\-]", "-", name).strip()


def load_commercial_terms_enrichment(pricing_core_data_dir: Path) -> dict[str, Any]:
    """Loads the frozen JSON once per call (same no-caching convention as
    every other frozen-overlay loader in this app -- see
    multi_city_map_coordinate_enrichment.py) and validates its version.
    Raises ValueError on a version mismatch rather than silently trusting an
    unexpected schema."""
    path = pricing_core_data_dir / "data" / "frozen" / ENRICHMENT_DIRNAME / ENRICHMENT_FILENAME
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("version") != EXPECTED_VERSION:
        raise ValueError(f"{ENRICHMENT_FILENAME}: expected version {EXPECTED_VERSION!r}, found {doc.get('version')!r}")
    return doc


def _index_by_market(doc: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    by_market: dict[str, list[dict[str, Any]]] = {}
    for project in doc["projects"]:
        by_market.setdefault(project["market_context"], []).append(project)
    return by_market


def commercial_projects_for_market(doc: dict[str, Any], app_market_slug: str) -> list[dict[str, Any]]:
    """Only this market's own researched projects -- never another
    context's, and never every project regardless of market (the dataset is
    flat by project, not grouped under markets, so this is the one place
    that scoping happens). KeyError on an unmapped slug is intentional: a
    market context this loader doesn't know about must fail loudly, not
    silently return an empty/wrong list."""
    commercial_context = MARKET_CONTEXT_TO_COMMERCIAL_CONTEXT[app_market_slug]
    return list(_index_by_market(doc).get(commercial_context, []))


def resolve_commercial_project(
    doc: dict[str, Any], app_market_slug: str, project_name: str, project_id: str | None = None
) -> dict[str, Any] | None:
    """Resolves one existing competitor's commercial-terms record, scoped to
    its own market context only. Prefers project_id (exact match); falls
    back to a normalized exact-name match within the SAME market only when
    no id is given or the id doesn't hit. Never fuzzy string similarity,
    never a cross-market match, never a guess -- returns None when this
    competitor genuinely wasn't part of this research pass (13 of the many
    real competitors across all four contexts were researched)."""
    candidates = commercial_projects_for_market(doc, app_market_slug)
    if project_id is not None:
        for p in candidates:
            if p["project_id"] == project_id:
                return p
    target = normalize_commercial_project_name(project_name)
    for p in candidates:
        if normalize_commercial_project_name(p["project_name"]) == target:
            return p
    return None


def build_commercial_intelligence_payload(pricing_core_data_dir: Path, app_market_slug: str) -> dict[str, Any]:
    """workspace.commercial_intelligence for one market context. version/
    generated_at pass through from the frozen file so the UI can display/
    verify dataset provenance without hardcoding it. Deliberately a separate
    top-level workspace branch (never merged into competitor_landscape or
    standard_attribute_enrichment) -- see this module's own docstring for
    why the separation matters."""
    doc = load_commercial_terms_enrichment(pricing_core_data_dir)
    return {
        "version": doc["version"],
        "generated_at": doc["generated_at"],
        "projects": commercial_projects_for_market(doc, app_market_slug),
    }
