"""Special-unit (garden/duplex/triplex) market context -- presentation only.

No special pricing engine is built here. This module reshapes the frozen
data/frozen/special_unit_master_data_v1.json package -- which consolidates
curated_special_review (QA-corrected sold baskets + curated current-asking
pool) and expanded_market_evidence (segment-tagged current-asking records +
new-development competitors with unit-specific prices where available) -- per
assignment special unit, with an explicit, already-source-tagged direct vs
broadened split. It never computes a price, range, or premium from any
record here.

Path note: the task originally asked for special_review_evidence_v1.json /
special_evidence_bundle_v4.json as separate files. Neither exists on disk --
data_files in the master JSON documents them as logical datasets already
consolidated into this one frozen file, which is why no separate files were
recreated.

Isolation invariant (see task): this module's output (special_unit_market_
context) is a completely separate payload branch from standard_attribute_
enrichment. Nothing here is merged into, or read by, the standard 3R/5R
pipeline, and nothing from the standard family pipeline is treated as a
special-unit comparable -- the only thing shared is a read-only "family
anchor" context block (see FAMILY_ANCHOR_UNITS), explicitly labeled and never
included in direct_comparables/broadened_comparables.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .first_researcher_context import build_first_researcher_context_for_units

MASTER_DATA_FILENAME = "special_unit_master_data_v1.json"

UNIT_CATEGORY = {
    "1": "garden",
    "2": "garden",
    "3": "garden",
    "36": "triplex",
    "37": "triplex",
    "38": "duplex",
    "39": "duplex",
}

# Which expanded_market_evidence.current_asking_evidence "segment" tag(s)
# apply to each unit. Triplex units pull both the dedicated "direct typology"
# segment and the general broadened segment; everything else has one segment.
UNIT_SEGMENTS = {
    "1": ["APT1/2"],
    "2": ["APT1/2"],
    "3": ["APT3"],
    "36": ["APT36/37 direct typology", "APT36/37"],
    "37": ["APT36/37 direct typology", "APT36/37"],
    "38": ["APT38"],
    "39": ["APT39"],
}

# Which curated_special_review.baskets entry applies to each unit. Garden
# units have no registered-sale basket in the source data (gardens are
# ground/podium units with no clean multi-level sold-transaction search
# performed) -- their sold context is honestly empty rather than invented.
UNIT_BASKET_KEY = {"36": "APT36_37", "37": "APT36_37", "38": "APT38", "39": "APT39"}

DEFAULT_ROUTE_BY_CATEGORY = {"garden": "garden_review", "duplex": "duplex_special_review", "triplex": "broadened_premium_unit_review"}

# Item: "A standard family anchor may be displayed as contextual reference
# only where explicitly appropriate: Apt1/2 -> standard 3R family anchor,
# Apt39 -> standard 5R family anchor." Never used as a comparable or premium
# input -- see build_special_unit_market_context's family_anchor_context,
# which is a distinct, labeled field, structurally separate from
# direct_comparables/broadened_comparables.
FAMILY_ANCHOR_UNITS = {"1": "3R", "2": "3R", "39": "5R"}
FAMILY_ANCHOR_LABEL = "עוגן שוק למשפחה — להקשר בלבד"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _is_direct(evidence_class: str) -> bool:
    return evidence_class.startswith("direct_") or evidence_class.startswith("near_exact_")


def _qa_flag_subjects(subject_field: str) -> set[str]:
    """"APT36_37/APT38" -> {"36","37","38"}; "APT39" -> {"39"}."""
    units: set[str] = set()
    for part in subject_field.split("/"):
        for token in part.replace("APT", "").split("_"):
            if token.isdigit():
                units.add(token)
    return units


def build_special_unit_market_context(
    root: Path, special_units: list, families: list[dict[str, Any]], indications: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    """`special_units` are the real, normalized assignment inventory Unit
    objects (already built in build_petah_tikva_workspace_payload) --
    subject specs always come from there, never from this file's own
    "subjects" QA block. `families` is the already-computed standard 3R/5R
    families list from the same payload, used only to build the read-only
    family-anchor context for units 1/2/39. `indications` is the already-
    computed (by app_api.special_market_indication_data.
    build_indications_for_all_units) per-unit market_indication dict, passed
    in rather than recomputed here so the caller can reuse the same result
    for the price-list rows and this context section."""

    path = root / "data" / "frozen" / MASTER_DATA_FILENAME
    try:
        master = _load(path)
    except FileNotFoundError:
        return {"available": False, "units": {}}

    curated = master["curated_special_review"]
    expanded = master["expanded_market_evidence"]
    baskets = curated["baskets"]
    qa_flags = curated["qa_flags"]
    sold_context_additions = expanded["sold_context_additions"]

    asking_by_segment: dict[str, list[dict[str, Any]]] = {}
    for record in expanded["current_asking_evidence"]:
        asking_by_segment.setdefault(record["segment"], []).append(record)

    family_by_label = {f["family"]: f for f in families}

    unit_numbers = [str(unit.unit_number) for unit in special_units if str(unit.unit_number) in UNIT_CATEGORY]
    first_researcher_context = build_first_researcher_context_for_units(master, unit_numbers)

    units: dict[str, Any] = {}
    for unit in special_units:
        unit_number = str(unit.unit_number)
        category = UNIT_CATEGORY.get(unit_number)
        if category is None:
            continue

        segment_records: list[dict[str, Any]] = []
        for segment in UNIT_SEGMENTS.get(unit_number, []):
            segment_records.extend(asking_by_segment.get(segment, []))
        direct = [r for r in segment_records if _is_direct(r["evidence_class"])]
        broadened = [r for r in segment_records if not _is_direct(r["evidence_class"])]

        basket_key = UNIT_BASKET_KEY.get(unit_number)
        basket = baskets.get(basket_key) if basket_key else None
        sold_selected = (basket.get("selected_sold") or basket.get("selected_broadened_sold") or []) if basket else []
        sold_rejected = (basket.get("rejected_sold") or []) if basket else []
        route = (basket.get("route") if basket else None) or DEFAULT_ROUTE_BY_CATEGORY[category]
        sold_evidence_gap = basket.get("evidence_gap") if basket else None
        direct_sold_triplex_count = basket.get("direct_sold_triplex_count") if basket else None

        deal_ids_in_basket = {r.get("deal_id") for r in sold_selected}
        unit_sold_context_additions = [a for a in sold_context_additions if a.get("target_deal_id") in deal_ids_in_basket]

        unit_qa_flags = [f for f in qa_flags if unit_number in _qa_flag_subjects(f["subject"])]

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
            "route": route,
            "direct_comparables": direct,
            "broadened_comparables": broadened,
            "sold_selected": sold_selected,
            "sold_rejected": sold_rejected,
            "sold_evidence_gap": sold_evidence_gap,
            "direct_sold_triplex_count": direct_sold_triplex_count,
            "sold_context_additions": unit_sold_context_additions,
            "qa_flags": unit_qa_flags,
            "family_anchor_context": family_anchor_context,
            "market_indication": indications.get(unit_number),
            "first_researcher_context": first_researcher_context.get(unit_number, []),
        }

    return {
        "available": True,
        "version": master["version"],
        "source": "special_unit_master_data_v1 (curated_special_review + expanded_market_evidence)",
        "implementation_invariants": master["implementation_invariants"],
        "direct_triplex_status": expanded.get("direct_triplex_status"),
        "units": units,
    }
