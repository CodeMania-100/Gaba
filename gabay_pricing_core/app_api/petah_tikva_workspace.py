from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from pricing_core import compare_decision_scenarios, normalize_inventory_rows, run_sold_qa

from .competitor_register import build_competitor_landscape
from .special_market_indication_data import build_indications_for_all_units
from .special_unit_context import build_special_unit_market_context
from .standard_attribute_enrichment import build_standard_attribute_enrichment

# petah_tikva_pricing.py lives at the gabay_pricing_core root (sibling of pricing_core/),
# shared by this module and run_petah_tikva_standard_price_list_v1.py so the baseline and
# any on-demand scenario are always priced through the exact same code path. Inserted by
# absolute path (not relied on via cwd/PYTHONPATH) so `uvicorn app_api.main:app` starts
# correctly regardless of the working directory it's launched from.
_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from petah_tikva_pricing import (  # noqa: E402
    BASELINE_POSITION_PCT,
    price_standard_units_at_position,
    price_standard_units_baseline,
    standard_unit_market_pairs,
)

CENTER = "מרכז העיר"

DEMO_DISCLAIMER = (
    "Demo project. The assignment supplied no exact project address, so this workspace uses a "
    "neighborhood-level demo location only (commercial submarket המרכז השקט / official "
    "neighborhood מרכז העיר, פתח תקווה) -- no specific street address is claimed for the subject "
    "project. חפץ חיים 25 is a real Petah Tikva competitor project and appears only in the "
    "competitor register/map below, never as the subject address. The 50% market-range-position "
    "baseline is an engineering control, not Gabay commercial strategy. The 32 standard units use "
    "the 3R/5R market-range engine above; the 7 special (garden/duplex/triplex) units are analyzed "
    "individually via a separate, additive market-indication engine -- each has a suggested price, "
    "but every special-unit indication requires review before being treated as a commercial decision."
)

# User-facing (Hebrew) subject-project identity -- neighborhood-level only, no
# fictional street address. חפץ חיים 25 is a real competitor (see the
# competitor register) and must never be reused here as the subject address.
SUBJECT_PROJECT_NAME = "פרויקט הדגמה – המרכז השקט"
SUBJECT_LOCATION_NOTE = (
    "מיקום הפרויקט לצורך ההדגמה מבוסס על הנחת עבודה; כתובת מדויקת לא סופקה במטלה."
)

SOURCE_REGISTRY = {
    "sold": "GovMap / Tax Authority citywide completed-sale feed, frozen via freeze_petah_tikva_sold_v1.py.",
    "current_asking": "Madlan current listings, frozen via freeze_petah_tikva_asking_v1.py.",
    "new_development": "Developer sites + Yad1 competitor register, frozen via freeze_petah_tikva_competitors_v1.py (v1 includes Yad1 evidence).",
}


def _pricing_core_data_dir() -> Path:
    # app_api/petah_tikva_workspace.py -> app_api -> gabay_pricing_core
    return Path(__file__).resolve().parents[1]


def _frozen_dir() -> Path:
    return _pricing_core_data_dir() / "data" / "frozen"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_market_map_geocodes(frozen_dir: Path) -> dict | None:
    """Passthrough of the frozen, one-time geocoding pass (see
    build_map_geocodes_v1.py) -- never recomputed or geocoded live here.
    Returns None (rather than raising) if the geocode file hasn't been
    generated yet, so the rest of the workspace payload still builds."""
    path = frozen_dir / "map_geocodes_v1.json"
    if not path.exists():
        return None
    return _load(path)


def _sold_raw_rows(family_data: dict) -> list[dict]:
    """Adapt the frozen sold-evidence snapshot's transactions into the raw dict
    shape ``run_sold_qa`` expects, exactly mirroring the mapping already used and
    validated in run_petah_tikva_market_ranges_v1.py -- kept in sync so the
    workspace payload's exposed QA status/reasons are the real sold-QA engine's
    output, not re-derived logic.

    cityName is intentionally omitted: the frozen scope's city spelling
    ("פתח תקוה", single vav) differs from the demo address ("פתח תקווה", double
    vav). comparables._sold_candidates rejects any candidate whose tx.city
    differs from the target location's city, so feeding a mismatched spelling
    in would silently zero out the sold lane. Every transaction here was
    already scoped to this family's rooms/area/date/neighborhood at freeze
    time, so city is redundant for gating.
    """

    neighborhood = family_data["scope"]["official_neighborhood"]
    rows = []
    for t in family_data["transactions"]:
        rows.append({
            "dealDate": t.get("deal_date"),
            "dealAmount": t.get("amount"),
            "pricePerSqm": t.get("ppsm"),
            "address": t.get("address"),
            "neighborhoodName": neighborhood,
            "rooms": t.get("rooms"),
            "floor": t.get("floor"),
            "area": t.get("area"),
            "propertyType": t.get("property_type"),
            "isFirstHand": t.get("first_hand"),
            "gush": t.get("gush"),
            "helka": t.get("helka"),
            "tatHelka": t.get("tat_helka"),
            "assetId": t.get("asset_id"),
            "scrapedAt": t.get("scraped_at"),
        })
    return rows


def _sold_evidence_section(sold_doc: dict, family: str) -> dict:
    family_data = sold_doc["families"][family]
    qa = run_sold_qa(_sold_raw_rows(family_data))
    records = []
    for result in qa.records:
        tx = result.transaction
        records.append({
            "source": "govmap_tax_authority_citywide",
            "address": result.normalized_address,
            "event_date": tx.deal_date.isoformat() if tx.deal_date else None,
            "rooms": tx.rooms,
            "area": tx.area,
            "price": tx.deal_amount,
            "price_per_sqm": tx.price_per_sqm,
            "gush": tx.gush,
            "helka": tx.helka,
            "tat_helka": tx.tat_helka,
            "asset_id": tx.asset_id,
            "quality_status": result.status.value,
            "quality_reasons": result.reasons,
        })
    return {
        "family": family,
        "scope": family_data["scope"],
        "funnel": {
            "raw_scoped_to_family_and_neighborhood": qa.summary["raw_records"],
            "qa_usable": qa.summary["primary_usable_records"],
            "qa_review": qa.summary["review_records"],
            "qa_rejected": qa.summary["rejected_records"],
            "independent_location_groups_at_freeze": family_data["independent_location_count"],
        },
        "dedupe_policy": sold_doc["dedupe_policy"],
        "records": records,
    }


def _asking_evidence_section(asking_doc: dict, family: str) -> dict:
    family_data = asking_doc["families"][family]
    return {
        "family": family,
        "methodology": asking_doc["methodology"],
        "funnel": {
            **family_data["funnel"],
            "independent_location_count": family_data["independent_location_count"],
        },
        "rejection_reason_counts": family_data["rejection_reason_counts"],
        "accepted_records": family_data["accepted_listings"],
        "rejected_records": family_data["rejected_listings"],
    }


def _competitor_evidence_section(competitor_doc: dict, family: str) -> dict:
    return {
        "family": family,
        "methodology": competitor_doc["methodology"],
        "summary": competitor_doc["summary"].get(family),
        # All records for this family -- primary-quantitative, geo-warning,
        # context-only, and any other status -- so exclusion/warning reasons
        # stay visible; nothing is filtered out for the UI.
        "records": [r for r in competitor_doc["records"] if r.get("family") == family],
    }


# One already-collected, saved Yad2 "nearby-deals" response, preserved as a single
# documented example (see task: "preserve one targeted example", "do not make more
# API calls"). It was collected for the separate special-unit workstream (anchor =
# apartment 3, a garden unit), not for the standard 3R/5R lanes -- kept here purely
# as a methodology illustration of what the endpoint can surface, not as new
# standard-unit evidence.
NEARBY_DEALS_EXAMPLE_FILE = (
    "gov_source_tests/data_source_test/yad2_petah_special/nearby_deals/apt3_garden.json"
)


def _nearby_deals_enrichment_note(root: Path) -> dict:
    path = root.parent / NEARBY_DEALS_EXAMPLE_FILE
    record_count = None
    try:
        raw = _load(path)
        record_count = len(raw.get("data", {}).get("completed", []))
    except FileNotFoundError:
        pass
    return {
        "method": "Yad2 nearby-deals (via RapidAPI 'yad21' -- an access method, not a separate source)",
        "purpose": "Targeted coverage around a subject/comparable location, not a citywide collection.",
        "example_anchor": "apartment 3 (garden unit) special-unit anchor",
        "example_file": NEARBY_DEALS_EXAMPLE_FILE,
        "example_record_count": record_count,
        "cross_check": "Matched by address/date/price against the existing government (GovMap/Tax Authority) snapshot.",
        "result": (
            "Additional registered transaction records found near the anchor; no exact duplicates "
            "confirmed against the tested government-snapshot slice."
        ),
        "independence": (
            "Underlying registry independence from the government snapshot is not established, so this "
            "enrichment is retained as additional context inside the Completed Sales (sold) lane rather "
            "than counted as a fourth, separate market lane."
        ),
    }


SOURCE_CATALOG = [
    {"name": "Government transactions (GovMap / Tax Authority)", "lane": "sold"},
    {"name": "Madlan current asking listings", "lane": "current_asking"},
    {"name": "Yad2 / Yad1 new-development market + competitor listings", "lane": "new_development"},
    {"name": "Yad2 targeted nearby-deals (RapidAPI access)", "lane": "sold (enrichment only, not a separate lane)"},
    {"name": "GIS_Dira / official program & parcel validation", "lane": "sold (geographic-scope QA context)"},
    {"name": "Developer / project websites", "lane": "new_development (field-level verification)"},
]

PIPELINE_STAGES = [
    "Normalize",
    "QA",
    "Dedupe",
    "Geography / size filtering",
    "Independent grouping",
    "Three market lanes",
    "Consensus",
    "Company strategy",
    "Unit price list",
]


def _lane_contributor_count(market_ranges_doc: dict, family: str, lane: str) -> int:
    return market_ranges_doc["families"][family]["market_range"]["lanes"][lane]["primary_contributor_count"]


def _build_data_quality_section(
    root: Path,
    sold_doc: dict,
    asking_doc: dict,
    competitor_doc: dict,
    market_ranges_doc: dict,
) -> dict:
    """Real counts only, re-shaped from what the frozen artifacts already
    contain (sold/asking freeze files, competitor summary, market-range lane
    contributor counts) -- nothing here is recomputed or invented."""

    funnel = {"sold": {}, "current_asking": {}, "new_development": {}}
    for family in ("3R", "5R"):
        sold_fam = sold_doc["families"][family]
        funnel["sold"][family] = {
            "stages": [
                "raw/source records", "scoped by city/neighborhood", "room/area/recency filters",
                "QA", "duplicate/source-pair handling", "independent locations/buildings",
                "quantitative contributors",
            ],
            "raw_source_records": sold_fam["transaction_count"],
            "independent_locations_at_freeze": sold_fam["independent_location_count"],
            "quantitative_contributors": _lane_contributor_count(market_ranges_doc, family, "sold"),
        }

        asking_fam = asking_doc["families"][family]
        funnel["current_asking"][family] = {
            "stages": [
                "raw listings", "target size", "target submarket",
                "deduped listings/locations", "quantitative contributors",
            ],
            "raw_listings": asking_fam["funnel"]["source_rows"],
            "accepted_target_size_and_submarket": asking_fam["accepted_listing_count"],
            "independent_locations": asking_fam["independent_location_count"],
            "quantitative_contributors": _lane_contributor_count(market_ranges_doc, family, "current_asking"),
        }

        comp_summary = competitor_doc["summary"][family]
        funnel["new_development"][family] = {
            "stages": [
                "discovered records", "exact target geography", "exact price + area",
                "deduped by project", "independent projects", "quantitative contributors",
            ],
            "discovered_records": comp_summary["project_records"],
            "exact_target_geography_projects": comp_summary["tier1_quantitative_projects"],
            # All geo tiers, for context only (tier2/adjacent-submarket projects never enter the
            # range) -- the number that matters for the final lane is quantitative_contributors below.
            "quantitative_projects_any_tier": comp_summary["quantitative_independent_projects"],
            "quantitative_contributors": _lane_contributor_count(market_ranges_doc, family, "new_development"),
        }

    case_study_3r = {
        "title": "3R new-development evidence upgrade (evidence-driven repricing, unchanged methodology)",
        "before": {
            "new_development": "insufficient for consensus",
            "market_confidence": "medium",
            "support_lanes": ["current_asking", "sold"],
        },
        "new_evidence": "Two independent, exact-target-neighborhood Yad2 projects with known price and area.",
        "processing": (
            "Duplicate ads from the same project (זאב ברנדה, 2 listings) collapsed into one independent "
            "contributor by the existing, unmodified project-grouping rule; no consensus threshold changed."
        ),
        "after": {
            "support_lanes": ["current_asking", "new_development", "sold"],
            "market_confidence": "high",
            "supported_range_ils": {
                "lower": market_ranges_doc["families"]["3R"]["market_range"]["supported_range"]["lower"],
                "upper": market_ranges_doc["families"]["3R"]["market_range"]["supported_range"]["upper"],
            },
        },
        "standard_revenue_change_ils": {
            "before": 68744000.0,
            "after": 67280000.0,
        },
    }

    return {
        "source_catalog": SOURCE_CATALOG,
        "pipeline_stages": PIPELINE_STAGES,
        "funnel": funnel,
        "nearby_deals_enrichment": _nearby_deals_enrichment_note(root),
        "case_study_3r_new_development": case_study_3r,
    }


def _special_price_list_row(unit, indication: dict | None) -> dict:
    """One special (garden/duplex/triplex) unit's price-list row. Uses the
    deterministic special_market_indication result when a suggested price
    was computed; falls back to the pending-review row otherwise (e.g. no
    numeric evidence at all for that unit). Never a standard 3R/5R row --
    market_range here is the special-unit indicative range, a different
    methodology, never the standard supported market range."""

    has_indication = bool(indication) and indication.get("suggested_price_ils") is not None
    if has_indication:
        market_range = {
            "lower": indication["indicative_lower_ils"],
            "upper": indication["indicative_upper_ils"],
            "confidence": indication["confidence"],
        }
        status = "special_indication_available"
        warnings: list[str] = []
        explanation = [
            "אינדיקציית שוק ליחידה מיוחדת: חושבה מראיות ייעודיות ליחידות מיוחדות (עסקאות רב-מפלסיות/הצעות/פרויקטים "
            "חדשים תואמים) בלבד — לא ממקורות התמחור הסטנדרטי, ולא באמצעות שיטת הטווח הנתמך הסטנדרטית.",
        ]
    else:
        market_range = None
        status = "manual_special_pricing_pending"
        warnings = ["special_unit_requires_individual_pricing_review"]
        explanation = [
            "Special unit (garden/duplex/triplex): out of scope for the standard-unit market-range "
            "pricing workstream. Awaiting a separate individual-review pricing pass."
        ]

    return {
        "unit_number": unit.unit_number,
        "family": unit.unit_type,
        "family_key": None,
        "floor": unit.floor,
        "rooms": unit.rooms,
        "internal_area_sqm": unit.internal_area,
        "balcony_area_sqm": unit.balcony_area,
        "orientation": unit.orientation,
        "parking": unit.parking,
        "storage": unit.storage,
        "market_range": market_range,
        "strategy_basis": None,
        "commercial_base_price_ils": None,
        "adjustments": [],
        "proposed_list_price_ils": indication["suggested_price_ils"] if has_indication else None,
        "status": status,
        "requires_review": True,
        "warnings": warnings,
        "explanation": explanation,
        "override": None,
        "locked": False,
    }


def build_petah_tikva_workspace_payload(data_dir: Path | None = None) -> dict:
    """Assemble the single Petah Tikva workspace payload from the frozen
    artifacts only. Never recomputes evidence or pricing methodology -- every
    number here was already produced by pricing_core via the dedicated
    run_petah_tikva_*_v1.py scripts and frozen to data/frozen/*.json. The one
    exception is sold-lane QA status/reasons, which are regenerated here by
    calling the same run_sold_qa(...) used to build the frozen market ranges,
    purely so per-transaction QA provenance can be displayed (see
    _sold_raw_rows docstring).
    """

    root = data_dir or _pricing_core_data_dir()
    frozen = root / "data" / "frozen"

    sold_doc = _load(frozen / "petah_tikva_standard_sold_evidence_v1.json")
    asking_doc = _load(frozen / "petah_tikva_standard_asking_evidence_v1.json")
    competitor_doc = _load(frozen / "petah_tikva_standard_competitor_evidence_v1.json")
    market_ranges_doc = _load(frozen / "petah_tikva_standard_market_ranges_v1.json")
    price_list_doc = _load(frozen / "petah_tikva_standard_price_list_v1.json")

    inventory_rows = _load(root / "inventory_source_rows.json")
    normalized = normalize_inventory_rows(inventory_rows)
    special_units = [n.unit for n in normalized if n.unit.unit_type != "standard_apartment"]

    # Deterministic special-unit market indication (pricing_core.special_
    # market_indication) -- a fully separate, additive calculation path from
    # the standard 3R/5R engine below. Computed once here and reused both in
    # the price-list rows and in special_unit_market_context.
    special_indications = build_indications_for_all_units(root, special_units)

    standard_rows = [
        {**row, "override": None, "locked": False}
        for row in price_list_doc["price_list"]
    ]
    special_rows = [
        _special_price_list_row(unit, special_indications.get(str(unit.unit_number)))
        for unit in sorted(special_units, key=lambda u: u.unit_number)
    ]
    full_price_list = sorted(standard_rows + special_rows, key=lambda r: _unit_sort_key(r["unit_number"]))

    families = []
    for family in ("3R", "5R"):
        market_family = market_ranges_doc["families"][family]
        family_key_value = next(
            r["family_key"] for r in price_list_doc["price_list"] if r["family"] == family
        )
        price_family_summary = next(
            s for s in price_list_doc["family_summaries"] if s["family_key"] == family_key_value
        )
        strategy_decision = next(
            d for d in price_list_doc["plan"]["family_decisions"]
            if d["family_key"] == family_key_value
        )
        families.append({
            "family": family,
            "family_key": price_family_summary["family_key"],
            "target": market_family["target"],
            "market": {
                "status": market_family["summary"]["status"],
                "confidence": market_family["summary"]["confidence"],
                "supported_lower": market_family["summary"]["supported_lower"],
                "supported_upper": market_family["summary"]["supported_upper"],
                "support_lanes": market_family["summary"]["support_lanes"],
            },
            "evidence_lanes": {
                "sold": market_family["market_range"]["lanes"]["sold"],
                "current_asking": market_family["market_range"]["lanes"]["current_asking"],
                "new_development": market_family["market_range"]["lanes"]["new_development"],
            },
            "strategy": {
                "basis": strategy_decision["strategy"]["basis"],
                "name": strategy_decision["strategy"]["name"],
                "range_position_pct": strategy_decision["strategy"]["range_position_pct"],
                "rationale": strategy_decision["rationale"],
                "is_engineering_demo_baseline": True,
                "is_gabay_commercial_strategy": False,
            },
            "proposed_family_price_ils": price_family_summary["average_proposed_price_ils"],
            "total_family_list_value_ils": price_family_summary["total_proposed_list_value_ils"],
            "unit_count": price_family_summary["unit_count"],
            "priced_unit_count": price_family_summary["priced_unit_count"],
            "review_unit_count": price_family_summary["review_unit_count"],
            "warnings": market_family["market_range"]["warnings"],
        })

    evidence_provenance = {
        "sold": {family: _sold_evidence_section(sold_doc, family) for family in ("3R", "5R")},
        "current_asking": {family: _asking_evidence_section(asking_doc, family) for family in ("3R", "5R")},
        "new_development": {family: _competitor_evidence_section(competitor_doc, family) for family in ("3R", "5R")},
        "funnel_stages": [
            "raw", "qa", "geography", "area_and_recency", "independent_groups", "contributor",
        ],
        "source_registry": SOURCE_REGISTRY,
    }

    competitor_landscape = build_competitor_landscape(root, market_ranges_doc)

    payload = {
        "version": "petah_tikva_workspace_payload_v1",
        "project": {
            "name": SUBJECT_PROJECT_NAME,
            "address": None,
            "city": "פתח תקווה",
            "commercial_area": "המרכז השקט",
            "official_neighborhood": CENTER,
            "location_note": SUBJECT_LOCATION_NOTE,
            "demo_location_assumption": True,
            "total_units": len(normalized),
            "standard_units_priced": price_list_doc["unit_count"],
            "special_units_pending": len(special_units),
            "total_standard_unit_revenue_ils": price_list_doc["total_standard_unit_revenue_ils"],
            "disclaimer": DEMO_DISCLAIMER,
        },
        "families": families,
        "evidence_provenance": evidence_provenance,
        "data_quality": _build_data_quality_section(root, sold_doc, asking_doc, competitor_doc, market_ranges_doc),
        "competitor_landscape": competitor_landscape,
        "standard_attribute_enrichment": build_standard_attribute_enrichment(root, competitor_landscape),
        "special_unit_market_context": build_special_unit_market_context(root, special_units, families, special_indications),
        "price_list": full_price_list,
        "market_map_geocodes": _load_market_map_geocodes(frozen),
        "strategy": {
            "note": price_list_doc["plan"]["note"],
            "disclaimer": price_list_doc["disclaimer"],
            "is_engineering_demo_baseline": True,
            "is_gabay_commercial_strategy": False,
            "override_lock_support": (
                "pricing_core.governance.apply_overrides/reprice_unlocked_preserving_locks remain "
                "applicable to this price list unchanged; no override has been applied to this frozen sample."
            ),
        },
        "metadata": {
            "methodology_versions": {
                "sold_evidence": sold_doc["version"],
                "current_asking_evidence": asking_doc["version"],
                "competitor_evidence": competitor_doc["version"],
                "market_range": market_ranges_doc["families"]["3R"]["market_range"]["methodology"]["version"],
                "price_list": price_list_doc["version"],
            },
            "frozen_timestamps": {
                "sold_evidence_frozen_at": sold_doc["frozen_at"],
                "current_asking_evidence_frozen_at": asking_doc["frozen_at"],
                "competitor_evidence_frozen_at": competitor_doc["frozen_at"],
                "competitor_checked_at": competitor_doc["checked_at"],
                "market_ranges_generated_at": market_ranges_doc["generated_at"],
                "market_ranges_as_of": market_ranges_doc["as_of"],
                "price_list_generated_at": price_list_doc["generated_at"],
            },
            "demo_assumptions": {
                "sold": sold_doc["demo_location"],
                "current_asking": asking_doc["demo_location"],
                "competitor": competitor_doc["demo_location"],
                "market_ranges": market_ranges_doc["demo_location"],
            },
            "program_check": sold_doc["program_check"],
        },
    }
    return payload


def build_petah_tikva_scenario_payload(
    range_position_pct: float,
    scenario_name: str | None = None,
    data_dir: Path | None = None,
) -> dict:
    """Price the 32 standard units at an explicit company market-range position.

    Entirely in-memory: never writes to data/frozen/*.json, so the frozen
    baseline price list is untouched by this call and a page refresh always
    sees the same frozen baseline again. Reuses the exact same
    pricing_core.decision.price_project_decision engine (via
    petah_tikva_pricing.py) as the frozen baseline itself and
    pricing_core.decision.compare_decision_scenarios for the before/after
    impact -- no pricing math is re-derived here or in the frontend. The 7
    special units are not part of this function's output; the workspace UI
    keeps showing them as special_review from the (unchanged) baseline payload.
    """

    root = data_dir or _pricing_core_data_dir()
    pairs = standard_unit_market_pairs(root)

    _baseline_plan, baseline_result = price_standard_units_baseline(pairs)
    name = scenario_name or f"petah_tikva_standard_scenario_{float(range_position_pct):g}pct"
    scenario_plan, scenario_result = price_standard_units_at_position(
        pairs,
        range_position_pct,
        plan_name=name,
        note=(
            "Explicit company market-positioning scenario (demo). A commercial positioning "
            "choice inside the already-supported, unmodified evidence range -- it does not "
            "change market evidence, evidence-lane consensus, or the frozen baseline price list."
        ),
        rationale=(
            f"Demo company-strategy control: price at {float(range_position_pct):g}% of the "
            "supported market range for this family."
        ),
    )
    impact = compare_decision_scenarios(baseline_result, scenario_result)

    units_by_number = {u.unit_number: u for u, _ in pairs}
    baseline_price_by_unit = {u.unit_number: u.proposed_list_price_ils for u in baseline_result.units}

    def _family_label(unit) -> str:
        return "3R" if unit.rooms == 3 else "5R"

    price_list = []
    for unit_result in sorted(scenario_result.units, key=lambda r: _unit_sort_key(r.unit_number)):
        unit = units_by_number[unit_result.unit_number]
        price_list.append({
            "unit_number": unit_result.unit_number,
            "family": _family_label(unit),
            "family_key": unit_result.family_key,
            "floor": unit.floor,
            "rooms": unit.rooms,
            "internal_area_sqm": unit.internal_area,
            "balcony_area_sqm": unit.balcony_area,
            "orientation": unit.orientation,
            "parking": unit.parking,
            "storage": unit.storage,
            "market_range": {
                "lower": unit_result.supported_lower,
                "upper": unit_result.supported_upper,
                "confidence": unit_result.market_confidence.value,
            },
            "strategy_basis": scenario_plan.by_family()[unit_result.family_key].strategy.basis.value,
            "commercial_base_price_ils": unit_result.commercial_base_price_ils,
            "adjustments": [
                {"kind": a.kind, "amount_ils": a.amount_ils, "source": a.source, "explanation": a.explanation}
                for a in unit_result.adjustments
            ],
            "proposed_list_price_ils": unit_result.proposed_list_price_ils,
            "baseline_price_ils": baseline_price_by_unit.get(unit_result.unit_number),
            "status": unit_result.status.value,
            "requires_review": unit_result.requires_review,
            "warnings": unit_result.warnings,
            "explanation": unit_result.decision_trace,
            # Same governance contract as the baseline payload -- no override/lock
            # has been applied to this ephemeral scenario either.
            "override": None,
            "locked": False,
        })

    families = []
    for label in ("3R", "5R"):
        row_key = next(r["family_key"] for r in price_list if r["family"] == label)
        b_summary = next(s for s in baseline_result.family_summaries if s.family_key == row_key)
        s_summary = next(s for s in scenario_result.family_summaries if s.family_key == row_key)
        families.append({
            "family": label,
            "family_key": row_key,
            "proposed_family_price_ils": s_summary.average_proposed_price_ils,
            "baseline_proposed_family_price_ils": b_summary.average_proposed_price_ils,
            "total_family_list_value_ils": s_summary.total_proposed_list_value_ils,
            "baseline_total_family_list_value_ils": b_summary.total_proposed_list_value_ils,
            "unit_count": s_summary.unit_count,
        })

    resolved_position = scenario_plan.family_decisions[0].strategy.range_position_pct
    baseline_total = baseline_result.project_metrics["total_proposed_list_value_ils"]
    scenario_total = scenario_result.project_metrics["total_proposed_list_value_ils"]
    delta_pct = round((impact.total_list_value_delta_ils / baseline_total) * 100, 3) if baseline_total else None

    return {
        "version": "petah_tikva_scenario_v1",
        "scenario_name": name,
        "range_position_pct": resolved_position,
        "is_baseline_position": resolved_position == BASELINE_POSITION_PCT,
        "strategy_disclaimer": (
            "Demo company-strategy positioning choice inside the unmodified, frozen supported "
            "market range. This is not a re-evaluation of market evidence."
        ),
        "families": families,
        "price_list": price_list,
        "total_standard_unit_revenue_ils": scenario_total,
        "comparison": {
            "baseline_total_standard_unit_revenue_ils": baseline_total,
            "scenario_total_standard_unit_revenue_ils": scenario_total,
            "delta_ils": impact.total_list_value_delta_ils,
            "delta_pct": delta_pct,
            "units_changed_count": impact.changed_unit_count,
        },
        "impact": impact.public_dict(),
    }


def _unit_sort_key(value: str) -> tuple[int, str]:
    try:
        return (0, f"{int(float(value)):09d}")
    except (TypeError, ValueError):
        return (1, str(value))
