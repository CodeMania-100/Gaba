"""Builds the "מול אילו פרויקטים אנחנו מתחרים?" competitor_landscape section
for a multi-city context from special_full_v2/competitor_projects_v2.json
(the full 32-project register, shared across all three multi-city contexts,
each project carrying its own `city` field) -- reshaped into the exact
CompetitorLandscape/CompetitorRegisterProject contract the frontend already
renders for Petah Tikva (see app_api/competitor_register.py).

Not to be confused with standard_market/<dir>/competitors.json, which is a
completely different, much smaller dataset used only for the standard 3R/5R
new-development evidence lane (see multi_city_standard_market.py) -- the two
are never merged.

Field-name reconciliation (competitor_projects_v2.json -> the frontend's
existing PT-shaped fields), since this dataset's schema differs from Petah
Tikva's own competitor-register seed:
  developer_company    -> developer
  raw_neighborhood_label / normalized_submarket -> neighborhood
  area_range_sqm        -> area_sqm_range
  geography_tier (CORE/ADJACENT/BROADER) -> geography_role
      (CORE never maps to Petah Tikva's own "broader_petah_tikva" string --
      that value stays exclusively a Petah Tikva legacy string; BROADER maps
      to the new, city-generic "broader_market" instead)
  known_unit_variants[].price_type -> a synthesized price_basis ("starting
      price" only for STARTING_PRICE, so priceDisplayLabel's existing
      "החל מ־" prefix logic keeps working unmodified)
  payment_terms (array in this dataset, an object in Petah Tikva's) ->
      {"value": "; ".join(...)} or None when empty
  quantitative_eligibility / relevance -- neither field exists on this
      dataset's project objects at all; both are derived here from
      known_unit_variants (rooms + quantitative-compatible price_type) and
      room_range/product_types respectively, never invented from nothing.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from .multi_city_special_market import QUANTITATIVE_PRICE_TYPES, _coerce_bool, _coerce_float, load_competitor_projects
from .multi_city_precision_overlay import apply_project_overlay

DisplayClassification = Literal["direct", "relevant", "context"]

GEOGRAPHY_TIER_TO_ROLE = {
    "CORE": "core_exact_target",
    "ADJACENT": "adjacent_submarket",
    # Deliberately NOT "broader_petah_tikva" -- that string is a Petah Tikva
    # legacy value only, never emitted for a non-PT context (task
    # correction). The frontend's geography_role label dictionaries gain a
    # matching generic entry for this value.
    "BROADER": "broader_market",
}


def _project_is_quantitative_for_family(project: dict[str, Any], rooms_target: int) -> bool:
    for variant in project.get("known_unit_variants") or []:
        rooms = _coerce_float(variant.get("rooms"))
        price_type = variant.get("price_type")
        quantitative_flag = _coerce_bool(variant.get("quantitative_unit_price_area"))
        if rooms == rooms_target and price_type in QUANTITATIVE_PRICE_TYPES and quantitative_flag is not False:
            return True
    return False


def _quantitative_eligibility(project: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result = {}
    for key, rooms_target in (("standard_3r", 3), ("standard_5r", 5)):
        eligible = _project_is_quantitative_for_family(project, rooms_target)
        result[key] = {
            "eligible": eligible,
            "reason": (
                f"known_unit_variants includes a {rooms_target}-room variant with a quantitative-compatible price_type"
                if eligible
                else f"no {rooms_target}-room variant with a quantitative-compatible price_type and confirmed area"
            ),
        }
    return result


def _derive_relevance_tags(project: dict[str, Any]) -> list[str]:
    tags: list[str] = []
    room_range = project.get("room_range") or []
    if len(room_range) == 2 and room_range[0] is not None and room_range[1] is not None:
        lo, hi = room_range
        if lo <= 3 <= hi:
            tags.append("standard_3r")
        if lo <= 5 <= hi:
            tags.append("standard_5r")
    product_types = project.get("product_types") or []
    if "garden" in product_types:
        tags.append("garden")
    if any(t in product_types for t in ("duplex", "roof_duplex")):
        tags.append("duplex")
    if "penthouse" in product_types:
        tags.append("penthouse")
    if any(_coerce_float(v.get("internal_area_sqm")) and _coerce_float(v.get("internal_area_sqm")) >= 140 for v in (project.get("known_unit_variants") or [])):
        tags.append("large_premium")
    return tags


def classify_multi_city_project(geography_role: str, is_any_family_eligible: bool) -> DisplayClassification:
    """Same 3-tier rule as app_api.competitor_register.classify_project,
    just fed a role/eligibility already derived above instead of reading
    Petah Tikva's own precomputed seed fields."""

    if geography_role == "core_exact_target" and is_any_family_eligible:
        return "direct"
    if geography_role == "broader_market":
        return "context"
    return "relevant"


def _reshape_price_basis(variant: dict[str, Any]) -> dict[str, Any]:
    price_type = variant.get("price_type")
    return {
        **variant,
        "price_ils": _coerce_float(variant.get("price_ils")),
        "price_basis": "starting price" if price_type == "STARTING_PRICE" else price_type,
    }


def _reshape_project(project: dict[str, Any]) -> dict[str, Any]:
    payment_terms = project.get("payment_terms") or []
    variants = [_reshape_price_basis(v) for v in (project.get("known_unit_variants") or [])]

    geography_role = GEOGRAPHY_TIER_TO_ROLE.get(project.get("geography_tier"), "broader_market")
    eligibility = _quantitative_eligibility(project)
    is_any_eligible = any(v["eligible"] for v in eligibility.values())
    classification = classify_multi_city_project(geography_role, is_any_eligible)

    return {
        **project,
        "developer": project.get("developer_company"),
        "neighborhood": project.get("raw_neighborhood_label") or project.get("normalized_submarket"),
        "area_sqm_range": project.get("area_range_sqm"),
        "floors_range": None,  # this dataset carries a single number_of_floors, not a range
        "known_unit_variants": variants,
        "payment_terms": {"value": "; ".join(str(t) for t in payment_terms)} if payment_terms else None,
        "geography_role": geography_role,
        "quantitative_eligibility": eligibility,
        "relevance": _derive_relevance_tags(project),
        "display_classification": classification,
    }


def build_multi_city_competitor_landscape(
    pricing_core_data_dir: Path, city: str, market_summary_docs: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """market_summary_docs: {"3R": market_summary_3R_family_block, "5R": ...}
    -- used only to read the frozen engine's own already-computed
    new_development contributor count (never recomputed here), exactly
    mirroring app_api.competitor_register.build_competitor_landscape's own
    _strict_contributor_count pattern."""

    raw_projects = [p for p in load_competitor_projects(pricing_core_data_dir) if p.get("city") == city]
    reshaped = [_reshape_project(p) for p in raw_projects]
    enriched = apply_project_overlay(reshaped, pricing_core_data_dir, city)

    classification_counts = {"direct": 0, "relevant": 0, "context": 0}
    geography_counts: dict[str, int] = {}
    relevance_counts = {"standard_3r": 0, "standard_5r": 0, "garden": 0, "duplex_or_premium": 0}

    for project in enriched:
        classification_counts[project["display_classification"]] += 1
        role = project["geography_role"]
        geography_counts[role] = geography_counts.get(role, 0) + 1
        relevance = project["relevance"]
        if "standard_3r" in relevance:
            relevance_counts["standard_3r"] += 1
        if "standard_5r" in relevance:
            relevance_counts["standard_5r"] += 1
        if "garden" in relevance:
            relevance_counts["garden"] += 1
        if {"duplex", "penthouse", "large_premium"}.intersection(relevance):
            relevance_counts["duplex_or_premium"] += 1

    return {
        "version": "multi_city_competitor_register_v2",
        "market": {"city": city},
        "usage_rules": (
            "כל פרויקט ברשימה עשוי להופיע בממשק המשתמש. רק פרויקט שכבר עומד באופן עצמאי בכללים "
            "המחמירים של מנוע טווח השוק (ללא שינוי) עשוי להשפיע על ערוץ הפיתוח החדש הכמותי."
        ),
        "project_count": len(enriched),
        "classification_counts": classification_counts,
        "geography_counts": geography_counts,
        "relevance_counts": relevance_counts,
        "quantitative_headline": {
            family: {
                "researched_project_count": relevance_counts["standard_3r" if family == "3R" else "standard_5r"],
                "strict_contributor_count": market_summary_docs[family]["lanes"]["new_development"]["primary_contributor_count"] if market_summary_docs[family]["lanes"].get("new_development") else 0,
            }
            for family in ("3R", "5R")
        },
        "projects": enriched,
    }
