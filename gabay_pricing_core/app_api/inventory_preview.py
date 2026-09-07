"""Stateless inventory-preview for the generic project-start launcher.

Reuses pricing_core.normalize_inventory_rows verbatim -- no parsing/normalization
logic is duplicated or altered here. Deliberately writes nothing to the
database: this only answers "what did the uploaded workbook contain?" so the
launcher can show real counts before the user picks a project context. The
legacy /api/v1/projects/{id}/inventory/import-file endpoint (which does persist
a DB InventoryVersionRow, for the separate Ashkelon demo flow) is untouched.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from pricing_core import normalize_inventory_rows
from pricing_core.inventory import NormalizedInventoryUnit


def pricing_route_of(unit_type: str | None) -> str:
    """Mirrors the frontend's pricingRouteOf(): the only two routes today."""
    return "standard_family" if unit_type == "standard_apartment" else "special_review"


def _unit_sort_key(unit_number: str) -> tuple[int, str]:
    try:
        return (0, f"{int(float(unit_number)):09d}")
    except (TypeError, ValueError):
        return (1, unit_number)


def compute_inventory_fingerprint(normalized: list[NormalizedInventoryUnit]) -> str:
    """Deterministic fingerprint over stable, pricing-relevant fields only
    (unit number/rooms/internal area/balcony area/floor/orientation/unit
    type). Sorted by unit number before hashing so row order in the source
    file never changes the result. Never depends on filename, sheet name, or
    any other metadata -- two workbooks with the same physical apartment mix
    always produce the same fingerprint, and a single changed number (area,
    floor, an added/removed/retyped unit) always changes it."""

    rows = sorted(normalized, key=lambda r: _unit_sort_key(r.unit.unit_number))
    canonical = [
        {
            "unit_number": r.unit.unit_number,
            "rooms": r.unit.rooms,
            "internal_area": r.unit.internal_area,
            "balcony_area": r.unit.balcony_area,
            "floor": r.unit.floor,
            "orientation": r.unit.orientation,
            "unit_type": r.unit.unit_type,
        }
        for r in rows
    ]
    canonical_json = json.dumps(canonical, sort_keys=True, ensure_ascii=True, default=str)
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def build_inventory_preview(matrix: list[list[Any]]) -> dict:
    normalized: list[NormalizedInventoryUnit] = normalize_inventory_rows(matrix)

    units = []
    route_counts = {"standard_family": 0, "special_review": 0}
    family_counts: dict[str, int] = {}
    for record in normalized:
        u = record.unit
        route = pricing_route_of(u.unit_type)
        route_counts[route] += 1
        family_key = f"{u.unit_type}|{u.rooms:g}r" if u.rooms is not None else f"{u.unit_type}|unknown"
        family_counts[family_key] = family_counts.get(family_key, 0) + 1
        units.append({
            "unit_number": u.unit_number,
            "unit_type": u.unit_type,
            "rooms": u.rooms,
            "internal_area": u.internal_area,
            "balcony_area": u.balcony_area,
            "floor": u.floor,
            "orientation": u.orientation,
            "pricing_route": route,
        })

    return {
        "total_units": len(units),
        "standard_unit_count": route_counts["standard_family"],
        "special_unit_count": route_counts["special_review"],
        "family_counts": family_counts,
        "units": units,
        "fingerprint": compute_inventory_fingerprint(normalized),
    }
