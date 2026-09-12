"""Special-unit (garden/duplex/triplex) evidence adapter for the frozen
multi-city package (data/multi_city_integration_final/special_full_v2/).

This module's only job is to *normalize* this dataset's fields into the
vocabulary pricing_core.special_market_indication's existing, unmodified
classifier functions already expect -- it never reimplements their tiering
policy itself. validation_status (or, for new-development variants,
verification_status) is research/QA metadata used only as a gate (does a row
get considered further, or excluded outright); the tier a surviving row
receives always comes from calling classify_asking_tier() /
classify_sold_eligibility()+classify_sold_tier() /
classify_new_development_variant() -- never from an adapter-owned
validation_status -> tier lookup table.

Eligibility gates are lane-specific (sold evidence has no price_type column
at all in this dataset -- deal_amount is the price -- so the asking/
developer price-semantics vocabulary is never forced onto it):

  CURRENT ASKING:  city -> segment -> QA/conflict -> price_type -> numeric
                   completeness -> normalize validation_status into
                   evidence_class -> classify_asking_tier()
  SOLD:            city -> segment -> QA/rejection -> numeric completeness
                   -> normalize validation_status into numeric_status ->
                   classify_sold_eligibility() -> classify_sold_tier()
  NEW DEVELOPMENT: city -> segment/applicability -> QA/conflict ->
                   price_type -> numeric completeness ->
                   classify_new_development_variant()

This module must never import or read special_unit_master_data_v1.json (the
Petah Tikva file) -- that is what makes "no PT fallback" true by
construction rather than by a runtime check.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

from pricing_core.special_market_indication import (
    ExcludedRecord,
    NormalizedComparable,
    classify_asking_tier,
    classify_new_development_variant,
    classify_sold_eligibility,
    classify_sold_tier,
    compute_special_unit_indication,
)
from dataclasses import asdict

from .multi_city_standard_market import MULTI_CITY_ROOT_DIRNAME
from .special_unit_context import DEFAULT_ROUTE_BY_CATEGORY, FAMILY_ANCHOR_LABEL, FAMILY_ANCHOR_UNITS, UNIT_CATEGORY

# Price semantics (task-wide vocabulary, mirrored in frontend/lib/priceSemantics.ts).
# Only these three are ever eligible to be a quantitative price/area contributor.
QUANTITATIVE_PRICE_TYPES = frozenset({"VERIFIED_UNIT_PRICE", "DEVELOPER_UNIT_OFFER", "CURRENT_ASKING"})
NON_QUANTITATIVE_PRICE_TYPES = frozenset({"STARTING_PRICE", "CONTEXT_ONLY", "HISTORICAL_MARKETING_PRICE"})


def _special_dir(pricing_core_data_dir: Path, special_dir: str) -> Path:
    return pricing_core_data_dir / "data" / MULTI_CITY_ROOT_DIRNAME / "special_full_v2" / special_dir


def _shared_special_dir(pricing_core_data_dir: Path) -> Path:
    return pricing_core_data_dir / "data" / MULTI_CITY_ROOT_DIRNAME / "special_full_v2"


def _load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_asking_rows(pricing_core_data_dir: Path, special_dir: str) -> list[dict[str, str]]:
    return _load_csv(_special_dir(pricing_core_data_dir, special_dir) / "asking_special_v2.csv")


def load_sold_rows(pricing_core_data_dir: Path, special_dir: str) -> list[dict[str, str]]:
    return _load_csv(_special_dir(pricing_core_data_dir, special_dir) / "sold_special_v2.csv")


def load_competitor_unit_variants(pricing_core_data_dir: Path) -> list[dict[str, str]]:
    """Shared across all three multi-city contexts (not per-city), each row
    carrying its own `city` field -- callers filter by city themselves."""

    return _load_csv(_shared_special_dir(pricing_core_data_dir) / "competitor_unit_variants_v2.csv")


def load_competitor_projects(pricing_core_data_dir: Path) -> list[dict[str, Any]]:
    return _load_json(_shared_special_dir(pricing_core_data_dir) / "competitor_projects_v2.json")["projects"]


def normalize_segment_string_to_units(segment_field: str | None) -> set[str]:
    """"APT38;APT39;APT36_37" -> {"38","39","36","37"}; "APT3" -> {"3"}.
    Every segment token in this dataset literally encodes apartment numbers
    once the "APT" prefix is stripped and the remainder split on "_" -- no
    lookup table is needed the way Petah Tikva's own slash-separated labels
    ("APT36/37 direct typology") required one."""

    units: set[str] = set()
    for token in (segment_field or "").split(";"):
        token = token.strip()
        if not token.startswith("APT"):
            continue
        for piece in token[3:].split("_"):
            if piece.isdigit():
                units.add(piece)
    return units


def _coerce_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _coerce_bool(value: Any) -> bool | None:
    """Some JSON fields in this dataset are inconsistently typed as real
    booleans vs. the strings "true"/"false" -- in the very same array
    (confirmed by direct read of competitor_projects_v2.json). Never trust
    the JSON type; always coerce defensively."""

    if isinstance(value, bool):
        return value
    if value is None:
        return None
    text = str(value).strip().lower()
    if text == "true":
        return True
    if text == "false":
        return False
    return None


# --- CURRENT ASKING ----------------------------------------------------------

# Rows whose validation_status is one of these are excluded at the QA gate,
# before price-type or evidence-class translation is even attempted.
_ASKING_QA_EXCLUDED_STATUSES = frozenset({"CONTEXT_ONLY", "CONFLICT", "HISTORICAL_CONTEXT"})

# Translates this dataset's validation_status into a string
# classify_asking_tier(evidence_class) already knows how to classify --
# never a direct validation_status -> tier lookup. Every value observed
# across all three cities' asking_special_v2.csv files is covered.
_ASKING_EVIDENCE_CLASS_TRANSLATION = {
    "DIRECT": "direct_current_verified",
    "DIRECT_LISTING_PRODUCT_VERIFIED": "direct_listing_product_verified",
    "DIRECT_SEARCH_RESULT_PRODUCT_VERIFIED": "direct_search_result_product_verified",
    "SIZE_RELAXED": "size_relaxed_current",
    "PRODUCT_BROADENED": "broadened_product_current",
}


def build_asking_inputs(rows: list[dict[str, str]], unit_number: str, city: str, subject_area: float) -> tuple[list[NormalizedComparable], list[ExcludedRecord]]:
    comparables: list[NormalizedComparable] = []
    excluded: list[ExcludedRecord] = []

    for row in rows:
        label = row.get("address") or row.get("listing_id") or "—"

        if row.get("city") != city:
            excluded.append(ExcludedRecord(lane="current_asking", label=label, reason="city_mismatch", raw=row))
            continue
        if unit_number not in normalize_segment_string_to_units(row.get("relevant_segments")):
            continue  # not applicable to this unit at all -- not even worth excluding-with-reason

        status = row.get("validation_status", "")
        if status in _ASKING_QA_EXCLUDED_STATUSES or status not in _ASKING_EVIDENCE_CLASS_TRANSLATION:
            excluded.append(ExcludedRecord(lane="current_asking", label=label, reason=f"qa_status_excluded:{status or 'unknown'}", raw=row))
            continue

        price_type = row.get("price_type")
        if price_type not in QUANTITATIVE_PRICE_TYPES:
            excluded.append(ExcludedRecord(lane="current_asking", label=label, reason=f"price_type_not_quantitative:{price_type}", raw=row))
            continue

        price = _coerce_float(row.get("price"))
        area = _coerce_float(row.get("internal_area"))
        if price is None or area is None or price <= 0 or area <= 0:
            excluded.append(ExcludedRecord(lane="current_asking", label=label, reason="numeric_completeness_failed", raw=row))
            continue

        evidence_class = _ASKING_EVIDENCE_CLASS_TRANSLATION[status]
        tier = classify_asking_tier(evidence_class)
        comparables.append(NormalizedComparable.build(
            lane="current_asking", tier=tier, label=label, price=price, area=area, subject_area=subject_area,
            note=f"validation_status={status} -> evidence_class={evidence_class}", raw=row,
        ))

    return comparables, excluded


# --- SOLD ---------------------------------------------------------------------

# Confirmed by user decision: type-relaxed/broadened sold evidence is
# tolerated by the engine's own documented methodology (pricing_core.
# special_market_indication's module docstring, section C) -- typology
# uncertainty alone is never a reason to reject a sold row. Only evidence
# explicitly marked context-only (i.e. not a real observed transaction) is
# excluded.
_SOLD_NUMERIC_STATUS_TRANSLATION = {
    "PRODUCT_TYPE_UNVERIFIED": "usable",
    "PRODUCT_BROADENED": "usable",
    "GEOGRAPHY_BROADENED": "usable",
    "CONTEXT_ONLY": "context_only_excluded",
}


def build_sold_inputs(rows: list[dict[str, str]], unit_number: str, city: str, subject_area: float) -> tuple[list[NormalizedComparable], list[ExcludedRecord]]:
    comparables: list[NormalizedComparable] = []
    excluded: list[ExcludedRecord] = []

    for row in rows:
        label = row.get("address") or row.get("record_id") or "—"

        if row.get("city") != city:
            excluded.append(ExcludedRecord(lane="sold", label=label, reason="city_mismatch", raw=row))
            continue
        if unit_number not in normalize_segment_string_to_units(row.get("relevant_segments")):
            continue

        price = _coerce_float(row.get("deal_amount"))
        area = _coerce_float(row.get("internal_area"))
        if price is None or area is None or price <= 0 or area <= 0:
            excluded.append(ExcludedRecord(lane="sold", label=label, reason="numeric_completeness_failed", raw=row))
            continue

        status = row.get("validation_status", "")
        numeric_status = _SOLD_NUMERIC_STATUS_TRANSLATION.get(status, "unknown")
        usable, note = classify_sold_eligibility(numeric_status)
        if not usable:
            excluded.append(ExcludedRecord(lane="sold", label=label, reason=note or f"qa_status_excluded:{status or 'unknown'}", raw=row))
            continue

        comparables.append(NormalizedComparable.build(
            lane="sold", tier=classify_sold_tier(), label=label, price=price, area=area, subject_area=subject_area,
            note=f"validation_status={status} -> numeric_status={numeric_status}", raw=row,
        ))

    return comparables, excluded


# --- NEW DEVELOPMENT ------------------------------------------------------------

# Translates this dataset's own product-type vocabulary (confirmed by direct
# read of competitor_unit_variants_v2.csv's `unit_type` column: garden_
# apartment, garden_duplex, penthouse, large_apartment, standard_apartment)
# into the category vocabulary classify_new_development_variant's SAME_
# CATEGORY/BROADENED_CATEGORY tables already use (garden/duplex/roof_duplex/
# penthouse/triplex) -- never a direct category->tier mapping, only a
# vocabulary translation feeding the existing, unmodified classifier.
# "large_apartment"/"standard_apartment" are deliberately left untranslated:
# they correctly fail every SAME_CATEGORY/BROADENED_CATEGORY membership test
# and classify_new_development_variant() returns None (not applicable to
# any special unit), which is the right outcome for a plain-family product.
_NEW_DEV_CATEGORY_TRANSLATION = {
    "garden_apartment": "garden",
    "garden_duplex": "duplex",
    "roof_duplex": "roof_duplex",
    "duplex": "duplex",
    "penthouse": "penthouse",
    "triplex": "triplex",
}


def build_new_development_inputs(
    rows: list[dict[str, str]], unit_number: str, city: str, subject_category: str, subject_rooms: float, subject_area: float,
) -> tuple[list[NormalizedComparable], list[ExcludedRecord]]:
    comparables: list[NormalizedComparable] = []
    excluded: list[ExcludedRecord] = []

    for row in rows:
        label = f"{row.get('project_name', '—')} ({row.get('unit_type', '')})"

        if row.get("city") != city:
            continue  # this file is shared across all 3 cities; a plain non-match is not "contamination", just irrelevant
        segments = row.get("applicable_segments") or ""
        if not segments or unit_number not in normalize_segment_string_to_units(segments):
            continue  # empty applicable_segments = a standard-family row (out of scope here); non-empty but non-matching = a different special unit

        verification_status = (row.get("verification_status") or "").upper()
        if "CONTEXT_ONLY" in verification_status or "HISTORICAL" in verification_status:
            excluded.append(ExcludedRecord(lane="new_development", label=label, reason=f"qa_status_excluded:{verification_status}", raw=row))
            continue

        price_type = row.get("price_type")
        if price_type not in QUANTITATIVE_PRICE_TYPES:
            excluded.append(ExcludedRecord(lane="new_development", label=label, reason=f"price_type_not_quantitative:{price_type}", raw=row))
            continue

        price = _coerce_float(row.get("price_ils"))
        area = _coerce_float(row.get("internal_area_sqm"))
        quantitative_flag = _coerce_bool(row.get("quantitative_unit_price_area"))
        if price is None or area is None or price <= 0 or area <= 0 or quantitative_flag is False:
            excluded.append(ExcludedRecord(lane="new_development", label=label, reason="numeric_completeness_failed", raw=row))
            continue

        variant_rooms = _coerce_float(row.get("rooms"))
        raw_unit_type = row.get("unit_type") or "unknown"
        variant_category = _NEW_DEV_CATEGORY_TRANSLATION.get(raw_unit_type, raw_unit_type)
        if variant_rooms is None:
            excluded.append(ExcludedRecord(lane="new_development", label=label, reason="numeric_completeness_failed", raw=row))
            continue

        tier = classify_new_development_variant(subject_category, subject_rooms, subject_area, variant_category, variant_rooms, area)
        if tier is None:
            continue  # not applicable to this subject's category at all -- not a rejection, just out of scope

        comparables.append(NormalizedComparable.build(
            lane="new_development", tier=tier, label=label, price=price, area=area, subject_area=subject_area,
            note=f"price_type={price_type}", raw=row,
        ))

    return comparables, excluded


def build_special_unit_inputs(
    pricing_core_data_dir: Path,
    special_dir: str,
    city: str,
    unit_number: str,
    category: str,
    subject_rooms: float,
    subject_area: float,
) -> dict[str, Any]:
    """Returns {sold_comparables, sold_excluded, asking_comparables,
    asking_excluded, new_development_comparables, new_development_excluded}
    for one special unit in one context -- ready to feed
    pricing_core.special_market_indication.compute_special_unit_indication.
    """

    asking_rows = load_asking_rows(pricing_core_data_dir, special_dir)
    sold_rows = load_sold_rows(pricing_core_data_dir, special_dir)
    variant_rows = load_competitor_unit_variants(pricing_core_data_dir)

    asking_c, asking_x = build_asking_inputs(asking_rows, unit_number, city, subject_area)
    sold_c, sold_x = build_sold_inputs(sold_rows, unit_number, city, subject_area)
    nd_c, nd_x = build_new_development_inputs(variant_rows, unit_number, city, category, subject_rooms, subject_area)

    return {
        "sold_comparables": sold_c, "sold_excluded": sold_x,
        "asking_comparables": asking_c, "asking_excluded": asking_x,
        "new_development_comparables": nd_c, "new_development_excluded": nd_x,
    }


# --- Special-unit product-comparison universe (drawer + Tab ג) ----------------

EVIDENCE_ORIGIN_CURRENT_RESALE = "current_resale"
EVIDENCE_ORIGIN_COMPLETED_SALE_CONTEXT = "completed_sale_context"
EVIDENCE_ORIGIN_NEW_DEVELOPMENT_MODEL = "new_development_model"


def build_special_product_comparison_universe(
    pricing_core_data_dir: Path, special_dir: str, city: str, unit_number: str,
) -> list[dict[str, Any]]:
    """The full V2 universe for one special unit's product comparison (drawer
    highlighted-comparable card AND Tab ג's special-unit mode -- both read
    this same function, never two independent derivations). Union of three
    sources, each row tagged with its evidence origin so the UI never
    flattens a current listing, a completed sale, and a new-development
    model into one undifferentiated list. Every row is included as evidence/
    context regardless of quantitative eligibility (see
    build_special_unit_inputs above for the separate quantitative-only
    filter that feeds the pricing engine) -- this universe is for display
    and MATCH/DIFFERENT/UNKNOWN comparison, not for computing a price.
    """

    universe: list[dict[str, Any]] = []

    for row in load_asking_rows(pricing_core_data_dir, special_dir):
        if row.get("city") == city and unit_number in normalize_segment_string_to_units(row.get("relevant_segments")):
            universe.append({**row, "evidence_origin": EVIDENCE_ORIGIN_CURRENT_RESALE, "record_key": row.get("listing_id")})

    for row in load_sold_rows(pricing_core_data_dir, special_dir):
        if row.get("city") == city and unit_number in normalize_segment_string_to_units(row.get("relevant_segments")):
            universe.append({**row, "evidence_origin": EVIDENCE_ORIGIN_COMPLETED_SALE_CONTEXT, "record_key": row.get("record_id")})

    for row in load_competitor_unit_variants(pricing_core_data_dir):
        segments = row.get("applicable_segments") or ""
        if row.get("city") == city and segments and unit_number in normalize_segment_string_to_units(segments):
            universe.append({**row, "evidence_origin": EVIDENCE_ORIGIN_NEW_DEVELOPMENT_MODEL, "record_key": row.get("project_id")})

    return universe


# --- Special-unit market indication + context (per context) -------------------

def compute_multi_city_indications_for_units(
    pricing_core_data_dir: Path, special_dir: str, city: str, special_units: list,
) -> dict[str, dict[str, Any]]:
    """Runs the existing, unmodified pricing_core.special_market_indication
    engine for every real special assignment unit, fed exclusively by this
    context's own city-scoped evidence -- never special_unit_master_data_v1
    .json (Petah Tikva's file), which this function never imports or reads."""

    indications: dict[str, dict[str, Any]] = {}
    for unit in special_units:
        unit_number = str(unit.unit_number)
        category = UNIT_CATEGORY.get(unit_number)
        if category is None:
            continue
        inputs = build_special_unit_inputs(
            pricing_core_data_dir, special_dir, city, unit_number, category, unit.rooms, unit.internal_area,
        )
        indication = compute_special_unit_indication(
            unit_number=unit_number, category=category, subject_internal_area_sqm=unit.internal_area,
            sold_comparables=inputs["sold_comparables"], asking_comparables=inputs["asking_comparables"],
            new_development_comparables=inputs["new_development_comparables"],
            excluded=inputs["sold_excluded"] + inputs["asking_excluded"] + inputs["new_development_excluded"],
        )
        indications[unit_number] = asdict(indication)
    return indications


def _is_direct_evidence_class(validation_status: str) -> bool:
    translated = _ASKING_EVIDENCE_CLASS_TRANSLATION.get(validation_status)
    return bool(translated) and (translated.startswith("direct_") or translated.startswith("near_exact_"))


def build_multi_city_special_unit_market_context(
    pricing_core_data_dir: Path, special_dir: str, city: str, special_units: list,
    families: list[dict[str, Any]], indications: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Multi-city analog of app_api.special_unit_context.
    build_special_unit_market_context, producing the same per-unit
    SpecialUnitContext shape the frontend already renders. UNIT_CATEGORY/
    FAMILY_ANCHOR_UNITS are imported read-only from special_unit_context.py
    (apartment identity is shared across every context -- only the evidence
    differs), which stays completely untouched by this module. PT-only
    hand-researched extras (qa_flags, first_researcher_context,
    sold_context_additions, direct_sold_triplex_count) have no multi-city
    equivalent and are returned empty rather than fabricated."""

    asking_rows = load_asking_rows(pricing_core_data_dir, special_dir)
    sold_rows = load_sold_rows(pricing_core_data_dir, special_dir)
    family_by_label = {f["family"]: f for f in families}

    units: dict[str, Any] = {}
    for unit in special_units:
        unit_number = str(unit.unit_number)
        category = UNIT_CATEGORY.get(unit_number)
        if category is None:
            continue

        segment_asking = [
            r for r in asking_rows
            if r.get("city") == city and unit_number in normalize_segment_string_to_units(r.get("relevant_segments"))
        ]
        direct = [r for r in segment_asking if _is_direct_evidence_class(r.get("validation_status", ""))]
        broadened = [r for r in segment_asking if not _is_direct_evidence_class(r.get("validation_status", ""))]

        segment_sold = [
            r for r in sold_rows
            if r.get("city") == city and unit_number in normalize_segment_string_to_units(r.get("relevant_segments"))
        ]
        sold_selected = [r for r in segment_sold if r.get("validation_status") != "CONTEXT_ONLY"]
        sold_rejected = [r for r in segment_sold if r.get("validation_status") == "CONTEXT_ONLY"]

        family_anchor_context = None
        anchor_family_label = FAMILY_ANCHOR_UNITS.get(unit_number)
        if anchor_family_label and anchor_family_label in family_by_label:
            fam = family_by_label[anchor_family_label]
            family_anchor_context = {
                "label": FAMILY_ANCHOR_LABEL,
                "family": fam["family"],
                "supported_lower": fam["market"]["supported_lower"],
                "supported_upper": fam["market"]["supported_upper"],
                "confidence": fam["market"]["confidence"],
            }

        units[unit_number] = {
            "category": category,
            "route": DEFAULT_ROUTE_BY_CATEGORY[category],
            "direct_comparables": direct,
            "broadened_comparables": broadened,
            "sold_selected": sold_selected,
            "sold_rejected": sold_rejected,
            "sold_evidence_gap": None,
            "direct_sold_triplex_count": None,
            "sold_context_additions": [],
            "qa_flags": [],
            "family_anchor_context": family_anchor_context,
            "market_indication": indications.get(unit_number),
            "first_researcher_context": [],
        }

    return {
        "available": True,
        "version": "multi_city_special_unit_context_v1",
        "source": "special_full_v2 (asking_special_v2.csv + sold_special_v2.csv + competitor_unit_variants_v2.csv), precision_overlay_v3",
        "implementation_invariants": [
            "No Petah Tikva fallback: special_unit_master_data_v1.json is never read by this code path.",
            "validation_status is a QA/inclusion gate only; tiers always come from the unmodified pricing_core.special_market_indication classifiers.",
        ],
        "direct_triplex_status": None,
        "units": units,
    }

    return universe
