"""Assembles pricing_core.special_market_indication inputs from the frozen
special_unit_master_data_v1.json package and the real, normalized assignment
inventory. This is the only place that parses the master file's free-text
new-development fields (special_products / unit_specific_prices) -- I/O and
text-extraction glue, kept out of pricing_core so that module stays pure
math/classification.

Isolation invariant: this module reads special_unit_market_context inputs
only. It never reads standard 3R/5R evidence, and its output is never fed
into pricing_core.market_range or the standard price list.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from dataclasses import asdict

from pricing_core.special_market_indication import (
    ExcludedRecord,
    NormalizedComparable,
    classify_asking_tier,
    classify_new_development_variant,
    classify_sold_eligibility,
    classify_sold_tier,
    compute_special_unit_indication,
)

from .special_unit_context import UNIT_BASKET_KEY, UNIT_CATEGORY, UNIT_SEGMENTS, MASTER_DATA_FILENAME

# Subject rooms per unit, from the real normalized assignment inventory
# (matches app_api.petah_tikva_workspace's special_units list -- passed in
# by the caller as `unit.rooms`/`unit.internal_area`, never re-derived here).

_CATEGORY_KEYWORDS = [
    ("roof duplex", "roof_duplex"),
    ("duplex", "duplex"),
    ("penthouse", "penthouse"),
    ("garden", "garden"),
]


def _infer_category(segment_text: str) -> str:
    t = segment_text.lower()
    for keyword, category in _CATEGORY_KEYWORDS:
        if keyword in t:
            return category
    return "unknown"


def _parse_money_ils(segment_text: str) -> float | None:
    m = re.search(r"₪\s*([\d.]+)\s*M", segment_text)
    return float(m.group(1)) * 1_000_000 if m else None


def _parse_variant_segments(text: str | None) -> list[dict[str, Any]]:
    """"5R duplex 150m² floors 9-10; 6R duplex 160m² floors 9-10" -> two
    {rooms, area, category, raw} dicts. A segment without both a room-count
    token and an area token is skipped (not guessed)."""

    if not text:
        return []
    out = []
    for segment in text.split(";"):
        segment = segment.strip()
        rooms_m = re.search(r"(\d+(?:\.\d+)?)\s*R\b", segment)
        area_m = re.search(r"(\d+(?:\.\d+)?)\s*m", segment)
        if not rooms_m or not area_m:
            continue
        out.append({"rooms": float(rooms_m.group(1)), "area": float(area_m.group(1)), "category": _infer_category(segment), "raw": segment})
    return out


def _parse_price_segments(text: str | None) -> list[dict[str, Any]]:
    """"5R duplex ₪3.85M; 6R duplex ₪4.00M" -> {rooms, price, category, raw}
    dicts. A segment without both a room-count token and a parseable ₪...M
    price is skipped (never guessed, e.g. "6R price not public")."""

    if not text:
        return []
    out = []
    for segment in text.split(";"):
        segment = segment.strip()
        rooms_m = re.search(r"(\d+(?:\.\d+)?)\s*R\b", segment)
        price = _parse_money_ils(segment)
        if not rooms_m or price is None:
            continue
        # A price segment sometimes carries its own area (e.g. "6R 159m²
        # from ₪3.69M") -- captured here so a self-contained price+area pair
        # doesn't depend on a separate special_products variant existing.
        area_m = re.search(r"(\d+(?:\.\d+)?)\s*m", segment)
        out.append({
            "rooms": float(rooms_m.group(1)),
            "price": price,
            "category": _infer_category(segment),
            "area": float(area_m.group(1)) if area_m else None,
            "raw": segment,
        })
    return out


def _load(path: Path) -> Any:
    import json

    return json.loads(path.read_text(encoding="utf-8"))


def build_new_development_inputs(
    competitors: list[dict[str, Any]], subject_category: str, subject_rooms: float, subject_area: float
) -> tuple[list[NormalizedComparable], list[ExcludedRecord]]:
    comparables: list[NormalizedComparable] = []
    excluded: list[ExcludedRecord] = []

    for competitor in competitors:
        project = competitor["project_name"]
        variants = _parse_variant_segments(competitor.get("special_products"))
        prices = _parse_price_segments(competitor.get("unit_specific_prices"))

        # Index variants by (rooms, category) for the join. Ambiguity (>1
        # variant sharing a key) is not expected in this dataset and is
        # handled by "first wins" with the collision still usable, since a
        # rooms+category key mapping to one area is the common case here.
        variants_by_key: dict[tuple[float, str], dict[str, Any]] = {}
        for v in variants:
            variants_by_key.setdefault((v["rooms"], v["category"]), v)

        matched_variant_keys: set[tuple[float, str]] = set()

        for price_entry in prices:
            key = (price_entry["rooms"], price_entry["category"])
            variant = variants_by_key.get(key)
            area = price_entry.get("area") if variant is None else variant["area"]
            category = price_entry["category"]
            if variant is not None:
                matched_variant_keys.add(key)

            if area is None:
                excluded.append(ExcludedRecord(
                    lane="new_development", label=f"{project} ({price_entry['raw']})",
                    reason="unit-specific price found but no matching floorplan area could be joined -- excluded from area-normalized calculation",
                    raw={"competitor": project, "price_segment": price_entry["raw"]},
                ))
                continue

            tier = classify_new_development_variant(subject_category, subject_rooms, subject_area, category, price_entry["rooms"], area)
            if tier is None:
                continue  # not applicable to this subject's category at all

            comparables.append(NormalizedComparable.build(
                lane="new_development", tier=tier, label=f"{project} ({price_entry['raw']})",
                price=price_entry["price"], area=area, subject_area=subject_area,
                note=f"floorplan: '{(variant or {}).get('raw', price_entry['raw'])}'",
                raw={"competitor": project, "price_segment": price_entry["raw"], "variant_segment": (variant or {}).get("raw")},
            ))

        # Variants relevant to this subject's category but with no joined
        # price at all: real product-type/size context, but no numeric
        # price -- reported as excluded ("context-only"), never guessed from
        # project_start_price.
        for key, variant in variants_by_key.items():
            if key in matched_variant_keys:
                continue
            tier = classify_new_development_variant(subject_category, subject_rooms, subject_area, variant["category"], variant["rooms"], variant["area"])
            if tier is None:
                continue
            start_price = competitor.get("project_start_price")
            excluded.append(ExcludedRecord(
                lane="new_development", label=f"{project} ({variant['raw']})",
                reason=(
                    f"matching floorplan known (rooms={variant['rooms']:g}, area={variant['area']:g} m²) but no unit-specific price "
                    f"published -- project_start_price ({start_price or 'none published'}) is competitive context only, never used numerically"
                ),
                raw={"competitor": project, "variant_segment": variant["raw"], "project_start_price": start_price},
            ))

    return comparables, excluded


def build_sold_inputs(basket: dict[str, Any] | None, subject_area: float) -> tuple[list[NormalizedComparable], list[ExcludedRecord]]:
    comparables: list[NormalizedComparable] = []
    excluded: list[ExcludedRecord] = []
    if basket is None:
        return comparables, excluded

    selected = basket.get("selected_sold") or basket.get("selected_broadened_sold") or []
    for record in selected:
        price = record.get("price")
        area = record.get("internal_area")
        if price is None or area is None:
            excluded.append(ExcludedRecord(lane="sold", label=record.get("address", "—"), reason="missing numeric price or internal area", raw=record))
            continue
        usable, note = classify_sold_eligibility(record.get("numeric_status", ""))
        if not usable:
            # Prefer the record's own human-readable exclusion_reason (set by
            # apply_sold_basket_typology_exclusions_v1.py for a specific,
            # verified typology/property-form finding) over the generic
            # classify_sold_eligibility() fallback text.
            reason = record.get("exclusion_reason") or note or "excluded by numeric_status"
            excluded.append(ExcludedRecord(lane="sold", label=record.get("address", "—"), reason=reason, raw=record))
            continue
        comparables.append(NormalizedComparable.build(
            lane="sold", tier=classify_sold_tier(), label=record.get("address", "—"), price=price, area=area, subject_area=subject_area,
            note=note or "", raw=record,
        ))

    for record in basket.get("rejected_sold") or []:
        excluded.append(ExcludedRecord(lane="sold", label=record.get("address", "—"), reason=record.get("reason", "rejected"), raw=record))

    return comparables, excluded


def build_asking_inputs(
    asking_by_segment: dict[str, list[dict[str, Any]]], segments: list[str], subject_area: float
) -> tuple[list[NormalizedComparable], list[ExcludedRecord]]:
    comparables: list[NormalizedComparable] = []
    excluded: list[ExcludedRecord] = []
    for segment in segments:
        for record in asking_by_segment.get(segment, []):
            price = record.get("price_ils")
            area = record.get("area_m2")
            if price is None or area is None:
                excluded.append(ExcludedRecord(lane="current_asking", label=record.get("address") or record.get("type", "—"), reason="missing numeric price or area", raw=record))
                continue
            tier = classify_asking_tier(record["evidence_class"])
            comparables.append(NormalizedComparable.build(
                lane="current_asking", tier=tier, label=record.get("address") or record.get("type", "—"), price=price, area=area,
                subject_area=subject_area, note=f"evidence_class={record['evidence_class']}", raw=record,
            ))
    return comparables, excluded


def load_master_data(root: Path) -> dict[str, Any]:
    return _load(root / "data" / "frozen" / MASTER_DATA_FILENAME)


def build_inputs_for_unit(master: dict[str, Any], unit_number: str, subject_rooms: float, subject_area: float):
    """Returns (category, sold_comparables, sold_excluded, asking_comparables,
    asking_excluded, new_dev_comparables, new_dev_excluded)."""

    category = UNIT_CATEGORY[unit_number]
    curated = master["curated_special_review"]
    expanded = master["expanded_market_evidence"]

    basket_key = UNIT_BASKET_KEY.get(unit_number)
    basket = curated["baskets"].get(basket_key) if basket_key else None
    sold_c, sold_x = build_sold_inputs(basket, subject_area)

    asking_by_segment: dict[str, list[dict[str, Any]]] = {}
    for record in expanded["current_asking_evidence"]:
        asking_by_segment.setdefault(record["segment"], []).append(record)
    asking_c, asking_x = build_asking_inputs(asking_by_segment, UNIT_SEGMENTS.get(unit_number, []), subject_area)

    nd_c, nd_x = build_new_development_inputs(expanded["competitors"], category, subject_rooms, subject_area)

    return category, sold_c, sold_x, asking_c, asking_x, nd_c, nd_x


def build_indications_for_all_units(root: Path, special_units: list) -> dict[str, dict[str, Any]]:
    """Runs pricing_core.special_market_indication for every real special
    assignment unit and returns a JSON-serializable dict keyed by unit
    number. This is the only function app_api should call to get special-
    unit suggested prices -- it is completely separate from
    standard_attribute_enrichment / the standard 3R/5R pipeline."""

    master = load_master_data(root)
    indications: dict[str, dict[str, Any]] = {}
    for unit in special_units:
        unit_number = str(unit.unit_number)
        if unit_number not in UNIT_CATEGORY:
            continue
        category, sold_c, sold_x, asking_c, asking_x, nd_c, nd_x = build_inputs_for_unit(
            master, unit_number, unit.rooms, unit.internal_area
        )
        indication = compute_special_unit_indication(
            unit_number=unit_number, category=category, subject_internal_area_sqm=unit.internal_area,
            sold_comparables=sold_c, asking_comparables=asking_c, new_development_comparables=nd_c,
            excluded=sold_x + asking_x + nd_x,
        )
        indications[unit_number] = asdict(indication)
    return indications
