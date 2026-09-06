from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Iterable

from .models import Unit


@dataclass(slots=True)
class NormalizedInventoryUnit:
    unit: Unit
    source_row_numbers: list[int]
    derivation_reasons: list[str] = field(default_factory=list)
    raw_rows: list[dict[str, Any]] = field(default_factory=list)

    def public_dict(self) -> dict[str, Any]:
        return {
            "unit": asdict(self.unit),
            "source_row_numbers": self.source_row_numbers,
            "derivation_reasons": self.derivation_reasons,
            "raw_rows": self.raw_rows,
        }


def normalize_inventory_rows(matrix: list[list[Any]]) -> list[NormalizedInventoryUnit]:
    """Normalize the supplied apartment-mix table into one record per apartment.

    The function preserves unknown values as unknown. Multi-floor duplex/triplex
    units are consolidated from their component rows. A supplied total row takes
    precedence over arithmetic. If no total row exists and every component area
    is known, an arithmetic total is derived and explicitly labelled.
    """

    if not matrix:
        return []
    headers = [str(h).strip() if h is not None else "" for h in matrix[0]]
    required = ["מס' קומה", "מספר דירה", "מס' חדרים", 'שטח דירה (מ"ר)', "שטח מרפסת", "כיווני אוויר", "הערות"]
    missing = [h for h in required if h not in headers]
    if missing:
        raise ValueError(f"Missing required inventory columns: {missing}")

    idx = {name: headers.index(name) for name in required}
    grouped: dict[str, list[dict[str, Any]]] = {}

    for excel_row, values in enumerate(matrix[1:], start=2):
        if not values or all(v in (None, "") for v in values):
            continue
        apt = _text(_get(values, idx["מספר דירה"]))
        if not apt:
            continue
        row = {
            "excel_row": excel_row,
            "floor": _get(values, idx["מס' קומה"]),
            "unit_number": apt,
            "rooms": _number(_get(values, idx["מס' חדרים"])),
            "internal_area": _number(_get(values, idx['שטח דירה (מ"ר)'])),
            "balcony_area": _number(_get(values, idx["שטח מרפסת"])),
            "orientation": _text(_get(values, idx["כיווני אוויר"])),
            "notes": _text(_get(values, idx["הערות"])),
        }
        grouped.setdefault(apt, []).append(row)

    normalized: list[NormalizedInventoryUnit] = []
    for apt, rows in sorted(grouped.items(), key=lambda item: _sort_unit_number(item[0])):
        total_rows = [r for r in rows if _is_total_floor(r["floor"])]
        components = [r for r in rows if not _is_total_floor(r["floor"])]
        reasons: list[str] = []

        unit_type = _detect_unit_type(rows)

        internal_area = None
        if total_rows and total_rows[0]["internal_area"] is not None:
            internal_area = total_rows[0]["internal_area"]
            reasons.append("used_supplied_total_internal_area")
        elif len(components) > 1 and components and all(r["internal_area"] is not None for r in components):
            internal_area = round(sum(float(r["internal_area"]) for r in components), 4)
            reasons.append("derived_internal_area_sum_from_component_rows")
        elif components:
            internal_area = components[0]["internal_area"]

        balcony_area = None
        if len(components) > 1 and components and all(r["balcony_area"] is not None for r in components):
            balcony_area = round(sum(float(r["balcony_area"]) for r in components), 4)
            reasons.append("derived_balcony_area_sum_from_component_rows")
        elif components:
            balcony_area = components[0]["balcony_area"]

        rooms = _first_non_null([r["rooms"] for r in total_rows] + [r["rooms"] for r in components])
        non_null_rooms = {r["rooms"] for r in rows if r["rooms"] is not None}
        if len(non_null_rooms) > 1:
            reasons.append("inconsistent_room_count_across_source_rows")

        orientation = _first_non_null([r["orientation"] for r in total_rows])
        if orientation is None:
            unique_orientations = {r["orientation"] for r in components if r["orientation"]}
            if len(unique_orientations) == 1:
                orientation = next(iter(unique_orientations))
            elif len(unique_orientations) > 1:
                reasons.append("multiple_component_orientations_preserved_as_unknown")

        floor = _consolidated_floor(components)
        notes = _first_non_null([r["notes"] for r in total_rows] + [r["notes"] for r in components])

        unit = Unit(
            unit_number=apt,
            floor=floor,
            rooms=rooms,
            internal_area=internal_area,
            balcony_area=balcony_area,
            orientation=orientation,
            parking=None,
            storage=None,
            unit_type=unit_type,
            notes=notes,
        )
        normalized.append(
            NormalizedInventoryUnit(
                unit=unit,
                source_row_numbers=[r["excel_row"] for r in rows],
                derivation_reasons=reasons,
                raw_rows=rows,
            )
        )
    return normalized


def _detect_unit_type(rows: Iterable[dict[str, Any]]) -> str:
    notes = " ".join((r.get("notes") or "") for r in rows)
    if "טריפלקס" in notes:
        return "triplex"
    if "דופלקס" in notes:
        return "duplex"
    if "דירת גן" in notes:
        return "garden_apartment"
    return "standard_apartment"


def _consolidated_floor(components: list[dict[str, Any]]) -> str | int | None:
    floors = [r["floor"] for r in components if r.get("floor") not in (None, "")]
    if not floors:
        return None
    if len(floors) == 1:
        return floors[0]
    numeric: list[int] = []
    for value in floors:
        try:
            numeric.append(int(float(value)))
        except (TypeError, ValueError):
            return " / ".join(str(v) for v in floors)
    return f"{min(numeric)}-{max(numeric)}"


def _is_total_floor(value: Any) -> bool:
    return _text(value) in {'סה"כ', "סה״כ"}


def _first_non_null(values: Iterable[Any]) -> Any:
    for value in values:
        if value is not None and value != "":
            return value
    return None


def _get(values: list[Any], index: int) -> Any:
    return values[index] if index < len(values) else None


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if text.endswith(".0"):
        try:
            if float(text).is_integer():
                text = str(int(float(text)))
        except ValueError:
            pass
    return text or None


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _sort_unit_number(value: str) -> tuple[int, str]:
    try:
        return int(float(value)), value
    except ValueError:
        return 10**9, value
