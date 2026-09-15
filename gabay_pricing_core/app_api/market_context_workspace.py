"""The generalized workspace assembler behind
GET /api/v1/demo/market-contexts/{slug}/workspace.

For Petah Tikva this is a pure, zero-diff wrapper around the existing,
completely unmodified build_petah_tikva_workspace_payload() -- one key
(`market_context`) is added on top, nothing about that function's own
behavior changes. For the three multi-city contexts, this module reuses the
already city-agnostic pieces of the Petah Tikva pipeline (shared inventory
loading/normalization, the standard/special split, the special-unit price-
list row shape, the strategy/metadata conventions) and delegates everything
that actually varies by city to the multi_city_* adapter modules -- none of
which recompute evidence or invent a pricing rule; they only reshape the
already-frozen multi-city package into the same payload contract.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pricing_core import normalize_inventory_rows

from . import multi_city_special_market as special_market
from . import multi_city_standard_market as standard_market
from .commercial_terms_enrichment import build_commercial_intelligence_payload
from .market_context_registry import MarketContextRegistration
from .multi_city_competitor_register import build_multi_city_competitor_landscape
from .multi_city_map_coordinate_enrichment import load_evidence_coordinate_enrichment, resolve_evidence_coordinate
from .multi_city_precision_overlay import apply_comparable_overlay
from .petah_tikva_workspace import _special_price_list_row, _unit_sort_key, build_petah_tikva_workspace_payload


def _pricing_core_data_dir() -> Path:
    # app_api/market_context_workspace.py -> app_api -> gabay_pricing_core
    return Path(__file__).resolve().parents[1]


def _load_inventory(root: Path) -> tuple[list, list]:
    """The one inventory source shared by every context -- returns
    (all_normalized_units, special_units). Never a per-city inventory."""

    import json

    inventory_rows = json.loads((root / "inventory_source_rows.json").read_text(encoding="utf-8"))
    normalized = normalize_inventory_rows(inventory_rows)
    special_units = [n.unit for n in normalized if n.unit.unit_type != "standard_apartment"]
    standard_units = [n.unit for n in normalized if n.unit.unit_type == "standard_apartment"]
    return standard_units, special_units


_STANDARD_UNIT_STRATEGY_EXPLANATION = [
    "אינדיקציית שוק סטנדרטית: חושבה ממנוע טווח השוק הקפוא עבור הקשר השוק הנבחר "
    "(standard_market/<city>) -- נקודת האינדיקציה היא 50% מהטווח הנתמך, באותה אמנה "
    "הקיימת כבר בפתח תקווה. שיטת התמחור והמתודולוגיה לא השתנו."
]


def _standard_price_list_row(unit, family_block: dict[str, Any], family_label: str) -> dict[str, Any]:
    point = family_block["market_indication_point_ils"]
    confidence = family_block["market"]["confidence"]
    return {
        "unit_number": unit.unit_number,
        "family": family_label,
        "family_key": "standard_3r" if family_label == "3R" else "standard_5r",
        "floor": unit.floor,
        "rooms": unit.rooms,
        "internal_area_sqm": unit.internal_area,
        "balcony_area_sqm": unit.balcony_area,
        "orientation": unit.orientation,
        "parking": unit.parking,
        "storage": unit.storage,
        "market_range": {
            "lower": family_block["market"]["supported_lower"],
            "upper": family_block["market"]["supported_upper"],
            "confidence": confidence,
        },
        "strategy_basis": "market_range_position",
        "commercial_base_price_ils": point,
        "adjustments": [],
        "proposed_list_price_ils": point,
        "status": "priced",
        "requires_review": confidence in ("low", "insufficient"),
        "warnings": [],
        "explanation": _STANDARD_UNIT_STRATEGY_EXPLANATION,
        "override": None,
        "locked": False,
    }


_SOLD_FUNNEL_STAGES = [
    "raw/source records", "scoped by city/neighborhood", "room/area/recency filters",
    "QA", "duplicate/source-pair handling", "independent locations/buildings", "quantitative contributors",
]
_ASKING_FUNNEL_STAGES = ["raw listings", "target size", "target submarket", "deduped listings/locations", "quantitative contributors"]
_NEW_DEV_FUNNEL_STAGES = ["discovered records", "exact target geography", "exact price + area", "deduped by project", "independent projects", "quantitative contributors"]


def _lane_contributor_count(family_block: dict[str, Any], lane: str) -> int:
    lane_obj = family_block["evidence_lanes"].get(lane)
    return lane_obj["primary_contributor_count"] if lane_obj else 0


# ---------------------------------------------------------------------------
# Per-record contributor status (visibility pass) -- the frozen engine
# already computes, per family/lane, exactly which records became a primary
# contributor and what area-normalized/target-equivalent indication each
# contributing group produced (market_summary.json's own
# lanes.<lane>.primary_contributors[].{source_ids,target_equivalent_
# indication}); completed_sales additionally carries a per-record
# candidate_outcomes list with an explicit exclusion_reasons array. Nothing
# here recomputes eligibility or a range -- this only joins each already-
# built evidence record back onto that existing computation by stable id, so
# "נכנסה לחישוב: כן/לא" and the target-equivalent figure can be shown
# honestly on the map/register without a second contributor-selection rule.
# ---------------------------------------------------------------------------


def _contributor_group_lookup(lane_obj: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    if not lane_obj:
        return lookup
    for group in lane_obj.get("primary_contributors") or []:
        for source_id in group.get("source_ids") or []:
            lookup[source_id] = group
    return lookup


def _sold_candidate_outcome_lookup(lane_obj: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    if not lane_obj:
        return lookup
    for outcome in lane_obj.get("candidate_outcomes") or []:
        source_id = outcome.get("source_id")
        if source_id:
            lookup[source_id] = outcome
    return lookup


def _annotate_sold_contributor_status(record: dict[str, Any], lane_obj: dict[str, Any] | None) -> dict[str, Any]:
    """Joined by `source_id` -- confirmed by direct comparison against the
    frozen market_summary.json that completed-sale contributor identity is
    keyed by source_id, not record_uid (the two datasets' record_uid values
    are independently generated and never referenced by the lane)."""

    contributor_groups = _contributor_group_lookup(lane_obj)
    outcomes = _sold_candidate_outcome_lookup(lane_obj)
    source_id = record.get("source_id")
    group = contributor_groups.get(source_id) if source_id else None

    if group is not None:
        record["contributes_to_pricing"] = True
        record["target_equivalent_indication_ils"] = group.get("target_equivalent_indication")
        record["non_contribution_reason"] = None
    else:
        record["contributes_to_pricing"] = False
        record["target_equivalent_indication_ils"] = None
        outcome = outcomes.get(source_id) if source_id else None
        if outcome and outcome.get("exclusion_reasons"):
            record["non_contribution_reason"] = "; ".join(outcome["exclusion_reasons"])
        elif record.get("quality_status") != "usable":
            record["non_contribution_reason"] = record.get("qa_note") or record.get("quality_status")
        else:
            record["non_contribution_reason"] = "not_a_primary_contributor"
    return record


def _apply_asking_coordinate_enrichment(
    record: dict[str, Any], evidence_coord_lookup: dict[tuple[str, str], dict[str, Any]], city: str,
) -> dict[str, Any]:
    """deriveAskingPoints (lib/marketMap.ts) reads latitude/longitude/
    coordinate_precision straight off the evidence record itself (unlike
    sold/special evidence, which are joined through market_map_geocodes by
    address) -- so the one-time evidence-coordinate enrichment is applied
    directly here, overriding only these three fields, never the record's
    other, already-real facts. A record whose address wasn't resolved keeps
    its original (near-always submarket-centroid) coordinate untouched."""

    resolved = resolve_evidence_coordinate(evidence_coord_lookup, city, record.get("address"))
    if resolved:
        lat, lng, coordinate_precision = resolved
        record["latitude"] = lat
        record["longitude"] = lng
        record["coordinate_precision"] = coordinate_precision
    return record


def _annotate_asking_contributor_status(record: dict[str, Any], lane_obj: dict[str, Any] | None) -> dict[str, Any]:
    """Joined by `record_uid` -- confirmed by direct comparison against the
    frozen market_summary.json that current-asking contributor identity is
    keyed by this dataset's own record_uid (also used as `listing_id`).

    Deliberately never touches `exclusion_reasons` (that field stays exactly
    the QA/status-based split build_asking_evidence_record already computed,
    which is what the accepted_records/rejected_records split below keys
    off) -- "accepted but not a primary contributor" is real supporting
    context, not a QA rejection, so it is surfaced as its own
    non_contribution_reason value instead of being folded into
    exclusion_reasons (see task vocabulary item 11: מידע תומך / הקשר, a
    distinct bucket from לא נכנסה לחישוב)."""

    contributor_groups = _contributor_group_lookup(lane_obj)
    record_uid = record.get("record_uid")
    group = contributor_groups.get(record_uid) if record_uid else None

    if group is not None:
        record["contributes_to_pricing"] = True
        record["target_equivalent_indication_ils"] = group.get("target_equivalent_indication")
        record["non_contribution_reason"] = None
    else:
        record["contributes_to_pricing"] = False
        record["target_equivalent_indication_ils"] = None
        if record["exclusion_reasons"]:
            record["non_contribution_reason"] = "; ".join(record["exclusion_reasons"])
        else:
            record["non_contribution_reason"] = "accepted_but_not_primary_contributor"
    return record


def _build_funnel(root: Path, context: MarketContextRegistration, family_blocks: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Real counts only (never fabricated placeholders) -- raw CSV row
    counts plus each lane's own already-computed primary_contributor_count,
    the same convention app_api.petah_tikva_workspace._build_data_quality_
    section already uses for Petah Tikva."""

    funnel: dict[str, Any] = {"sold": {}, "current_asking": {}, "new_development": {}}
    for family in ("3R", "5R"):
        block = family_blocks[family]
        sold_rows = standard_market.load_completed_sales(root, context.standard_market_dir, family)
        asking_rows = standard_market.load_current_asking(root, context.standard_market_dir, family)
        competitors = standard_market.load_new_development_competitors(root, context.standard_market_dir)

        funnel["sold"][family] = {
            "stages": _SOLD_FUNNEL_STAGES,
            "raw_source_records": len(sold_rows),
            "independent_locations_at_freeze": len({r.get("group_key") for r in sold_rows if r.get("group_key")}),
            "quantitative_contributors": _lane_contributor_count(block, "sold"),
        }
        funnel["current_asking"][family] = {
            "stages": _ASKING_FUNNEL_STAGES,
            "raw_listings": len(asking_rows),
            "accepted_target_size_and_submarket": len(asking_rows),
            "independent_locations": len({r.get("group_key") for r in asking_rows if r.get("group_key")}),
            "quantitative_contributors": _lane_contributor_count(block, "current_asking"),
        }
        relevant_key = "relevant_to_3r" if family == "3R" else "relevant_to_5r"
        quantitative_key = "quantitative_for_3r" if family == "3R" else "quantitative_for_5r"
        funnel["new_development"][family] = {
            "stages": _NEW_DEV_FUNNEL_STAGES,
            "discovered_records": len(competitors),
            "exact_target_geography_projects": len([c for c in competitors if c.get("submarket_tier") == "exact_submarket"]),
            "quantitative_projects_any_tier": len([c for c in competitors if c.get(relevant_key) and c.get(quantitative_key)]),
            "quantitative_contributors": _lane_contributor_count(block, "new_development"),
        }
    return funnel


_STANDARD_COORDINATE_PRECISION = {"submarket_centroid_fallback": "approximate", "selected_submarket_centroid_fallback": "approximate"}
_SPECIAL_COORDINATE_PRECISION = {
    "NEIGHBORHOOD_CENTROID": "approximate",
    "PROJECT": "address",
    # One-time map-coordinate enrichment (see
    # app_api/multi_city_map_coordinate_enrichment.py) geocoded from the
    # project's own address/street text already on file -- never a curated
    # PROJECT coordinate, so kept as its own honest precision tier.
    "GEOCODED_ADDRESS": "address",
    "GEOCODED_STREET": "street",
}


def _resolved_row_coordinate(
    evidence_coord_lookup: dict[tuple[str, str], dict[str, Any]], city: str, address: str | None,
    fallback_lat: float | None, fallback_lng: float | None, fallback_precision_raw: str | None,
) -> tuple[float | None, float | None, str]:
    """Prefers the one-time evidence-coordinate enrichment pass (see
    multi_city_map_coordinate_enrichment.resolve_evidence_coordinate) over
    the row's own frozen (near-always centroid) lat/lng -- never the reverse,
    and never touching the row's own original fields. Falls back to the raw
    coordinate/precision exactly as before when this address wasn't
    resolved."""

    resolved = resolve_evidence_coordinate(evidence_coord_lookup, city, address)
    if resolved:
        lat, lng, coordinate_precision = resolved
        return lat, lng, _SPECIAL_COORDINATE_PRECISION.get(coordinate_precision, "approximate")
    return fallback_lat, fallback_lng, _STANDARD_COORDINATE_PRECISION.get(fallback_precision_raw, "approximate")


def _build_map_geocodes(
    root: Path, context: MarketContextRegistration,
    sold_rows_by_family: dict[str, list[dict]], competitor_projects: list[dict],
    special_asking_rows: list[dict], special_sold_rows: list[dict],
    evidence_coord_lookup: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any]:
    """Synthesizes the exact MapGeocodeFile shape the frontend already
    consumes (lib/marketMap.ts) directly from this dataset's own per-row
    lat/lng columns -- unlike Petah Tikva, this package needs no separate
    one-time geocoding pass at all, since every record already carries
    coordinates.

    Every sold/special row here now prefers the one-time evidence-coordinate
    enrichment pass (see app_api/multi_city_map_coordinate_enrichment.py,
    build_multi_city_evidence_coordinate_enrichment_v1.py) over its own
    frozen coordinate when that address was successfully geocoded --
    otherwise it keeps its existing submarket/neighborhood-centroid
    fallback, honestly labeled "approximate". Competitor projects go through
    a separate, already-applied enrichment upstream in
    build_multi_city_competitor_landscape (their coordinate_precision on the
    row is already GEOCODED_ADDRESS/GEOCODED_STREET/PROJECT where resolved).
    No coordinate is ever inferred, fabricated, or spread out for
    appearance -- every value below is read straight from a real, frozen,
    or once-geocoded source."""

    sold_resolved = []
    for family_rows in sold_rows_by_family.values():
        for row in family_rows:
            lat, lng, precision = _resolved_row_coordinate(
                evidence_coord_lookup, context.city, row.get("address"),
                _to_float(row.get("latitude")), _to_float(row.get("longitude")), row.get("coordinate_precision"),
            )
            rec = standard_market.build_map_geocode_record(f"sold:{row.get('record_uid')}", row.get("address"), lat, lng, precision)
            if rec:
                sold_resolved.append(rec)

    competitor_resolved = []
    for project in competitor_projects:
        precision = _SPECIAL_COORDINATE_PRECISION.get(project.get("coordinate_precision"), "approximate")
        rec = standard_market.build_map_geocode_record(
            f"competitor:{project.get('project_name')}", project.get("address") or project.get("project_name"),
            _to_float(project.get("latitude")), _to_float(project.get("longitude")), precision,
        )
        if rec:
            # deriveCompetitorPoints joins by project_name, not address --
            # `address` field on the geocode record must literally BE the
            # project_name for that join to succeed (see marketMap.ts).
            rec["address"] = project.get("project_name")
            competitor_resolved.append(rec)

    def _special_resolved(rows: list[dict]) -> list[dict]:
        out = []
        for row in rows:
            lat, lng, precision = _resolved_row_coordinate(
                evidence_coord_lookup, context.city, row.get("address"),
                _to_float(row.get("lat")), _to_float(row.get("lng")), row.get("coordinate_precision"),
            )
            rec = standard_market.build_map_geocode_record(f"special:{row.get('listing_id') or row.get('record_id')}", row.get("address"), lat, lng, precision)
            if rec:
                out.append(rec)
        return out

    return {
        "version": "multi_city_synthetic_geocodes_v1",
        "generated_at": None,
        "geocoder": "pre-embedded per-record coordinates (multi_city_integration_final) -- no live geocoding performed",
        "validation": {"note": "Every coordinate in this package resolves to a neighborhood/submarket centroid, not an exact address, unless coordinate_precision was PROJECT."},
        "sold_evidence_coverage": {
            "usable_transactions_total": sum(len(rows) for rows in sold_rows_by_family.values()),
            "unique_addresses_total": len({r.get("address") for rows in sold_rows_by_family.values() for r in rows}),
            "unique_addresses_resolved": len({r["address"] for r in sold_resolved}),
        },
        "competitors": {"resolved": competitor_resolved, "unresolved": []},
        "sold": {"resolved": sold_resolved, "unresolved": []},
        "special_sold_evidence_coverage": {"unique_addresses_total": len({r.get("address") for r in special_sold_rows}), "unique_addresses_resolved": len(_special_resolved(special_sold_rows))},
        "special_asking_evidence_coverage": {"unique_addresses_total": len({r.get("address") for r in special_asking_rows}), "unique_addresses_resolved": len(_special_resolved(special_asking_rows))},
        "special_sold": {"resolved": _special_resolved(special_sold_rows), "unresolved": []},
        "special_asking": {"resolved": _special_resolved(special_asking_rows), "unresolved": []},
    }


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# standard_attribute_enrichment for multi-city contexts (visibility pass) --
# Petah Tikva's own standard_attribute_enrichment.py reshapes a separate,
# PT-only curated research file (data/frozen/standard_unit_attribute_
# enrichment_v1.json) that has no multi-city equivalent; this workspace
# previously left the section entirely empty for the three non-PT contexts,
# which silently starved ProductComparisonSection.tsx's per-competitor
# תואם/שונה/לא ידוע comparison cards (lib/standardEnrichment.ts's
# pickStrongestComparables reads exactly these two arrays) even though the
# real facts they need already exist on competitor_landscape.projects and
# the raw current_asking rows. This reshapes those already-known fields into
# the exact same contract PT's own file uses (unit_variants[].rooms/
# internal_area/balcony_area/floor/orientation/parking/storage/price,
# project_level.status/delivery/payment_terms, starting_price_context) --
# no new research, no new computation, field names/values read straight
# from competitor_projects_v2.json / current_asking_*.csv.
# ---------------------------------------------------------------------------


def _mc_unit_variants(project: dict[str, Any]) -> list[dict[str, Any]]:
    variants = []
    for v in project.get("known_unit_variants") or []:
        price = _to_float(v.get("price_ils"))
        if price is None:
            continue
        variants.append({
            "rooms": _to_float(v.get("rooms")),
            "internal_area": _to_float(v.get("internal_area_sqm")),
            "balcony_area": _to_float(v.get("balcony_area_sqm")),
            "garden_area": _to_float(v.get("garden_area_sqm")),
            "floor": v.get("floor"),
            "orientation": v.get("orientation"),
            "parking": v.get("parking"),
            "storage": v.get("storage"),
            "price": price,
            "price_basis": v.get("price_basis"),
        })
    return variants


def _mc_starting_price_context(variants: list[dict[str, Any]]) -> dict[str, Any] | None:
    starting = [v for v in variants if v.get("price_basis") == "starting price"]
    if not starting:
        return None
    cheapest = min(starting, key=lambda v: v["price"])
    applies_to = f"{int(cheapest['rooms'])} חדרים" if cheapest.get("rooms") else "כלל הפרויקט"
    return {"value": cheapest["price"], "applies_to": applies_to}


def _mc_new_development_comparable(project: dict[str, Any]) -> dict[str, Any]:
    variants = _mc_unit_variants(project)
    payment_terms = project.get("payment_terms") or []
    return {
        "project": project.get("project_name"),
        "address": project.get("address"),
        "register_classification": project.get("display_classification"),
        "unit_variants": variants,
        "project_level": {
            "status": project.get("construction_status") or project.get("project_status"),
            "delivery": project.get("estimated_delivery"),
            "payment_terms": "; ".join(str(t) for t in payment_terms) if payment_terms else None,
        },
        "starting_price_context": _mc_starting_price_context(variants),
        "provenance": [{"source": s} for s in (project.get("source_urls") or [])],
        "qa_notes": project.get("warnings") or [],
    }


def _mc_current_asking_comparable(row: dict[str, str]) -> dict[str, Any]:
    return {
        "address": row.get("address"),
        "asking_price": _to_float(row.get("price_ils")),
        "rooms": _to_float(row.get("rooms")),
        "built_area": _to_float(row.get("area_sqm")),
        "advertised_area": None,
        "balcony_area": _to_float(row.get("balcony_area_sqm")),
        "garden_area": None,
        "floor": row.get("floor") or None,
        "orientation": None,
        "parking_count": None,
        "storage": None,
        "elevator": None,
        "mamad": None,
        "condition": None,
    }


def _build_standard_attribute_enrichment_multi_city(
    competitor_projects: list[dict[str, Any]], asking_rows_by_family: dict[str, list[dict[str, str]]],
) -> dict[str, Any]:
    families: dict[str, Any] = {}
    for family_key, rooms_target in (("standard_3r", 3), ("standard_5r", 5)):
        family_label = "3R" if family_key == "standard_3r" else "5R"
        # Same family-relevance filter Petah Tikva's own build_standard_
        # attribute_enrichment applies (competitor_families): only include a
        # project when at least one of its own unit variants is actually
        # this family's room count -- never every project regardless of fit.
        nd_comparables = [
            _mc_new_development_comparable(p)
            for p in competitor_projects
            if any(_to_float(v.get("rooms")) == rooms_target for v in (p.get("known_unit_variants") or []))
        ]
        families[family_key] = {
            "subject_reference": None,
            "current_asking_comparables": [_mc_current_asking_comparable(r) for r in asking_rows_by_family[family_label]],
            "new_development_comparables": nd_comparables,
            "matched_observations": {},
            "floor_observations": [],
            "research_gaps": [],
        }
    return {
        "version": "multi_city_v1",
        "retrieved_at": None,
        "scope": None,
        "methodology_guards": [
            "No coefficient/price-per-attribute is derived here -- every value is a straight passthrough of an "
            "already-collected competitor/asking field, reshaped only for display.",
        ],
        "existing_standard_universe_context": None,
        "new_development_floor_pair_search": None,
        "families": families,
    }


def _build_multi_city_workspace_payload(context: MarketContextRegistration, root: Path) -> dict[str, Any]:
    standard_units, special_units = _load_inventory(root)
    location = standard_market.load_location(root, context.standard_market_dir)

    family_blocks: dict[str, dict[str, Any]] = {}
    for family in ("3R", "5R"):
        summary = standard_market.load_market_summary(root, context.standard_market_dir)["families"][family]
        family_blocks[family] = standard_market.build_family_market_block(family, summary)

    families_by_label = {fam: [u for u in standard_units if u.rooms == standard_market.FAMILY_ROOMS[fam]] for fam in ("3R", "5R")}

    families_payload = []
    for family in ("3R", "5R"):
        block = family_blocks[family]
        units_in_family = families_by_label[family]
        point = block["market_indication_point_ils"]
        families_payload.append({
            "family": family,
            "family_key": "standard_3r" if family == "3R" else "standard_5r",
            "target": block["target"],
            "market": block["market"],
            "evidence_lanes": block["evidence_lanes"],
            "strategy": {
                "basis": "market_range_position",
                "name": f"{context.slug}_standard_baseline",
                "range_position_pct": 50.0,
                "rationale": "בסיס הנדסי: 50% מהטווח הנתמך עבור הקשר השוק הנבחר -- אינה החלטת אסטרטגיה מסחרית.",
                "is_engineering_demo_baseline": True,
                "is_gabay_commercial_strategy": False,
            },
            "proposed_family_price_ils": point,
            "total_family_list_value_ils": (point or 0) * len(units_in_family),
            "unit_count": len(units_in_family),
            "priced_unit_count": len(units_in_family) if point is not None else 0,
            "review_unit_count": 0 if point is not None else len(units_in_family),
            "warnings": block["warnings"],
        })

    standard_rows = [
        _standard_price_list_row(unit, family_blocks[family], family)
        for family in ("3R", "5R")
        for unit in families_by_label[family]
    ]

    indications = special_market.compute_multi_city_indications_for_units(
        root, context.standard_market_dir, context.city, special_units,
    )
    special_rows = [
        _special_price_list_row(unit, indications.get(str(unit.unit_number)))
        for unit in sorted(special_units, key=lambda u: u.unit_number)
    ]
    full_price_list = sorted(standard_rows + special_rows, key=lambda r: _unit_sort_key(r["unit_number"]))

    special_unit_context = special_market.build_multi_city_special_unit_market_context(
        root, context.standard_market_dir, context.city, special_units, families_payload, indications,
    )
    # Special-unit product-comparison universe (V2 full union, origin-tagged,
    # V3-enriched) -- feeds both the drawer's highlighted-comparable card and
    # Tab ג's special-unit mode from this one shared derivation.
    for unit in special_units:
        unit_number = str(unit.unit_number)
        if unit_number not in special_unit_context["units"]:
            continue
        universe = special_market.build_special_product_comparison_universe(
            root, context.standard_market_dir, context.city, unit_number,
        )
        special_unit_context["units"][unit_number]["product_comparison_universe"] = apply_comparable_overlay(universe, root, context.city)

    market_summary_docs = {
        family: standard_market.load_market_summary(root, context.standard_market_dir)["families"][family]
        for family in ("3R", "5R")
    }
    competitor_landscape = build_multi_city_competitor_landscape(root, context.city, market_summary_docs)

    # Real per-record evidence (map markers + evidence tables), reshaped
    # into the exact field convention petah_tikva_workspace's own sections
    # already use -- see multi_city_standard_market.build_asking_evidence_
    # record / build_sold_evidence_record docstrings.
    sold_rows_by_family = {family: standard_market.load_completed_sales(root, context.standard_market_dir, family) for family in ("3R", "5R")}
    asking_rows_by_family = {family: standard_market.load_current_asking(root, context.standard_market_dir, family) for family in ("3R", "5R")}
    competitors_raw = standard_market.load_new_development_competitors(root, context.standard_market_dir)

    # One-time evidence-coordinate enrichment (see build_multi_city_evidence_
    # coordinate_enrichment_v1.py) -- loaded once per request, applied below
    # to asking records directly (deriveAskingPoints reads lat/lng straight
    # off the record) and inside _build_map_geocodes for sold/special rows
    # (which are joined by address through market_map_geocodes instead).
    evidence_coord_lookup = load_evidence_coordinate_enrichment(root)

    sold_records_by_family = {
        family: [
            _annotate_sold_contributor_status(standard_market.build_sold_evidence_record(r), family_blocks[family]["evidence_lanes"]["sold"])
            for r in sold_rows_by_family[family]
        ]
        for family in ("3R", "5R")
    }
    asking_records_by_family = {
        family: [
            _annotate_asking_contributor_status(
                _apply_asking_coordinate_enrichment(standard_market.build_asking_evidence_record(r), evidence_coord_lookup, context.city),
                family_blocks[family]["evidence_lanes"]["current_asking"],
            )
            for r in asking_rows_by_family[family]
        ]
        for family in ("3R", "5R")
    }

    evidence_provenance = {
        "sold": {family: {"family": family, "records": sold_records_by_family[family]} for family in ("3R", "5R")},
        "current_asking": {
            family: {
                "family": family,
                "accepted_records": [r for r in asking_records_by_family[family] if not r["exclusion_reasons"]],
                "rejected_records": [r for r in asking_records_by_family[family] if r["exclusion_reasons"]],
            }
            for family in ("3R", "5R")
        },
        "new_development": {family: {"family": family, "records": competitors_raw} for family in ("3R", "5R")},
        "funnel_stages": ["raw", "qa", "geography", "area_and_recency", "independent_groups", "contributor"],
        "source_registry": {
            "sold": "Frozen multi-city standard_market completed-sale evidence (see standard_market/<city>/completed_sales_*.csv).",
            "current_asking": "Frozen multi-city standard_market current-asking evidence (see standard_market/<city>/current_asking_*.csv).",
            "new_development": "Frozen multi-city standard_market competitor listings (see standard_market/<city>/competitors.json).",
        },
    }

    special_asking_rows_raw = special_market.load_asking_rows(root, context.standard_market_dir)
    special_sold_rows_raw = special_market.load_sold_rows(root, context.standard_market_dir)
    market_map_geocodes = _build_map_geocodes(
        root, context, sold_rows_by_family, competitor_landscape["projects"], special_asking_rows_raw, special_sold_rows_raw,
        evidence_coord_lookup,
    )

    map_center = location.get("center") or {}
    lng, lat = map_center.get("lng"), map_center.get("lat")

    total_units = len(standard_units) + len(special_units)
    total_standard_revenue = sum(
        (family_blocks[family]["market_indication_point_ils"] or 0) * len(families_by_label[family])
        for family in ("3R", "5R")
    )

    return {
        "version": "multi_city_workspace_payload_v1",
        "project": {
            "name": f"פרויקט הדגמה — {context.display_name}",
            "address": None,
            "city": context.city,
            "commercial_area": context.submarket,
            "official_neighborhood": context.submarket,
            "location_note": (
                "מיקום הפרויקט לצורך ההדגמה מבוסס על מרכז השוק הנבחר; כתובת מדויקת לא סופקה למטלה זו."
            ),
            "demo_location_assumption": True,
            "total_units": total_units,
            "standard_units_priced": len(standard_units),
            "special_units_pending": len(special_units),
            "total_standard_unit_revenue_ils": total_standard_revenue,
            "disclaimer": (
                "Demo market context. Standard 3R/5R evidence and ranges come from the frozen, "
                "validated multi_city_integration_final/standard_market package. Special-unit evidence "
                "comes exclusively from this context's own special_full_v2 data -- never from Petah "
                "Tikva. Pricing methodology and company strategy controls are unchanged from Petah Tikva."
            ),
        },
        "families": families_payload,
        "evidence_provenance": evidence_provenance,
        "data_quality": {
            "source_catalog": [
                {"name": "Frozen multi-city standard-market package", "lane": "sold / current_asking / new_development"},
                {"name": "Frozen multi-city special_full_v2 package", "lane": "special units (garden/duplex/triplex)"},
                {"name": "Frozen multi-city precision_overlay_v3 package", "lane": "presentation enrichment only"},
            ],
            "pipeline_stages": ["Normalize", "QA gate", "Price-type gate", "Classify (existing engine)", "Consensus", "Company strategy", "Unit price list"],
            "funnel": _build_funnel(root, context, family_blocks),
            "nearby_deals_enrichment": {
                "method": "N/A for this market context",
                "purpose": "N/A", "example_anchor": "N/A", "example_file": "N/A", "example_record_count": None,
                "cross_check": "N/A", "result": "N/A", "independence": "N/A",
            },
            "case_study_3r_new_development": None,
        },
        "competitor_landscape": competitor_landscape,
        "standard_attribute_enrichment": _build_standard_attribute_enrichment_multi_city(competitor_landscape["projects"], asking_rows_by_family),
        "special_unit_market_context": special_unit_context,
        "price_list": full_price_list,
        "market_map_geocodes": market_map_geocodes,
        "commercial_intelligence": build_commercial_intelligence_payload(root, context.slug),
        "strategy": {
            "note": "Company strategy controls are identical across every market context -- only market evidence/ranges change.",
            "disclaimer": "Pricing methodology is unchanged from Petah Tikva.",
            "is_engineering_demo_baseline": True,
            "is_gabay_commercial_strategy": False,
            "override_lock_support": "pricing_core.governance.apply_overrides/reprice_unlocked_preserving_locks remain applicable, unchanged.",
        },
        "metadata": {
            "methodology_versions": {"market_range": "market-range-v2-program-regime (frozen, multi-city package)"},
            "frozen_timestamps": {},
            "demo_assumptions": {},
            "program_check": None,
        },
        "map": {
            "center": [lng, lat] if lng is not None and lat is not None else None,
            "zoom": context.map_zoom,
        },
    }


def build_market_context_workspace_payload(context: MarketContextRegistration, data_dir: Path | None = None) -> dict[str, Any]:
    root = data_dir or _pricing_core_data_dir()

    market_context_block = {
        "slug": context.slug,
        "city": context.city,
        "submarket": context.submarket,
        "display_name": context.display_name,
        # Every spelling this context's own frozen records may legitimately
        # carry (see MarketContextRegistration.city_spellings) -- the
        # frontend guard uses this, not a hardcoded allow-list, to validate
        # the rest of the payload against.
        "city_spellings": sorted(context.city_spellings),
    }

    if context.is_petah_tikva:
        # Completely unmodified existing function -- only one additive key
        # is layered on top here. This is what makes "Petah Tikva unchanged"
        # a structural guarantee: nothing above this line touches Petah
        # Tikva's own frozen files or code path.
        payload = build_petah_tikva_workspace_payload(root)
        return {**payload, "market_context": market_context_block}

    payload = _build_multi_city_workspace_payload(context, root)
    return {**payload, "market_context": market_context_block}
