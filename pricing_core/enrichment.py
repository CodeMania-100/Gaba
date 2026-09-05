from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Any, Iterable


@dataclass(slots=True)
class TaxEnrichmentMatch:
    """Cross-source match from a geocoded GovMap base sale to an enriched Tax row.

    This object is intentionally provenance-preserving: it never mutates or
    overwrites the base transaction. Only a unique direct match is eligible to
    expose enriched attributes for downstream QA. Near matches remain
    diagnostic-only.
    """

    base_source_index: int
    status: str
    match_basis: str | None = None
    enriched_source_index: int | None = None
    can_use_attributes: bool = False
    conflicts: list[str] = field(default_factory=list)
    year_built: int | None = None
    building_floors: int | None = None
    is_first_hand: bool | None = None
    prev_deals: list[dict[str, Any]] | None = None
    trend: dict[str, Any] | None = None
    future_completion_context: bool = False
    same_day_prev_deal_complexity: bool = False
    diagnostic_candidate_indices: list[int] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def match_tax_enrichment(
    base_records: Iterable[dict[str, Any]],
    enriched_records: Iterable[dict[str, Any]],
) -> list[TaxEnrichmentMatch]:
    """Match enriched Tax Authority rows to base GovMap rows conservatively.

    Direct attribute use requires an exact sale shape (date, amount, rooms,
    area; floor compatible when both sources know it) PLUS either:

    * the same non-null deal/asset id, or
    * the same full registered unit (gush/helka/tat-helka).

    Same-parcel near-twins (<=1 day, <=0.1% amount difference) are surfaced for
    diagnostics only because the public registry can contain both duplicate-like
    rows and genuinely distinct adjacent units.
    """

    base = list(base_records)
    enriched = list(enriched_records)
    matches: list[TaxEnrichmentMatch] = []

    for base_index, row in enumerate(base):
        source_index = _source_index(row, base_index)
        direct: list[tuple[int, dict[str, Any], str]] = []

        for enriched_index, candidate in enumerate(enriched):
            basis = _direct_match_basis(row, candidate)
            if basis is not None:
                direct.append((enriched_index, candidate, basis))

        if len(direct) == 1:
            enriched_index, candidate, basis = direct[0]
            matches.append(
                _build_direct_match(
                    source_index=source_index,
                    base=row,
                    enriched_index=enriched_index,
                    enriched=candidate,
                    basis=basis,
                )
            )
            continue

        if len(direct) > 1:
            matches.append(
                TaxEnrichmentMatch(
                    base_source_index=source_index,
                    status="ambiguous_direct",
                    can_use_attributes=False,
                    diagnostic_candidate_indices=[item[0] for item in direct],
                )
            )
            continue

        near = [
            idx
            for idx, candidate in enumerate(enriched)
            if _near_parcel_match(row, candidate)
        ]
        if len(near) == 1:
            matches.append(
                TaxEnrichmentMatch(
                    base_source_index=source_index,
                    status="diagnostic_near_match",
                    match_basis="near_parcel_sale",
                    enriched_source_index=near[0],
                    can_use_attributes=False,
                    diagnostic_candidate_indices=near,
                )
            )
        elif len(near) > 1:
            matches.append(
                TaxEnrichmentMatch(
                    base_source_index=source_index,
                    status="ambiguous_near_match",
                    match_basis="near_parcel_sale",
                    can_use_attributes=False,
                    diagnostic_candidate_indices=near,
                )
            )
        else:
            matches.append(
                TaxEnrichmentMatch(
                    base_source_index=source_index,
                    status="unmatched",
                    can_use_attributes=False,
                )
            )

    # A single enriched row must never silently enrich multiple base rows.
    reverse: dict[int, list[int]] = {}
    for result_index, match in enumerate(matches):
        if match.status == "matched_direct" and match.enriched_source_index is not None:
            reverse.setdefault(match.enriched_source_index, []).append(result_index)

    for result_indices in reverse.values():
        if len(result_indices) <= 1:
            continue
        for result_index in result_indices:
            match = matches[result_index]
            match.status = "ambiguous_reverse_collision"
            match.can_use_attributes = False
            _clear_attributes(match)

    return matches


def _build_direct_match(
    *,
    source_index: int,
    base: dict[str, Any],
    enriched_index: int,
    enriched: dict[str, Any],
    basis: str,
) -> TaxEnrichmentMatch:
    prev = enriched.get("prevDeals") if isinstance(enriched.get("prevDeals"), list) else None
    deal_date = _date(enriched.get("dealDate")) or _date(base.get("dealDate"))
    year_built = _int(enriched.get("yearBuilt"))
    conflicts = _source_conflicts(base, enriched)

    return TaxEnrichmentMatch(
        base_source_index=source_index,
        status="matched_direct",
        match_basis=basis,
        enriched_source_index=enriched_index,
        can_use_attributes=True,
        conflicts=conflicts,
        year_built=year_built,
        building_floors=_int(enriched.get("buildingFloors")),
        is_first_hand=enriched.get("isFirstHand") if isinstance(enriched.get("isFirstHand"), bool) else None,
        prev_deals=prev,
        trend=enriched.get("trend") if isinstance(enriched.get("trend"), dict) else None,
        future_completion_context=bool(deal_date and year_built and year_built > deal_date.year),
        same_day_prev_deal_complexity=bool(
            deal_date
            and prev
            and any(_date(item.get("dealDate")) == deal_date for item in prev)
        ),
    )


def _direct_match_basis(base: dict[str, Any], enriched: dict[str, Any]) -> str | None:
    if not _same_core_sale(base, enriched):
        return None

    base_asset = _text(base.get("assetId"))
    enriched_asset = _text(enriched.get("assetId"))
    same_asset = bool(base_asset and enriched_asset and base_asset == enriched_asset)

    same_registered = (
        _text(base.get("gush")) is not None
        and _text(base.get("helka")) is not None
        and _text(base.get("tatHelka")) is not None
        and _text(base.get("gush")) == _text(enriched.get("gush"))
        and _text(base.get("helka")) == _text(enriched.get("helka"))
        and _text(base.get("tatHelka")) == _text(enriched.get("tatHelka"))
    )

    if same_asset and same_registered:
        return "asset_id+registered_unit"
    if same_asset:
        return "asset_id"
    if same_registered:
        return "registered_unit"
    return None


def _same_core_sale(base: dict[str, Any], enriched: dict[str, Any]) -> bool:
    return (
        _date(base.get("dealDate")) is not None
        and _date(base.get("dealDate")) == _date(enriched.get("dealDate"))
        and _number(base.get("dealAmount")) is not None
        and _number(base.get("dealAmount")) == _number(enriched.get("dealAmount"))
        and _number(base.get("rooms")) == _number(enriched.get("rooms"))
        and _number(base.get("area")) == _number(enriched.get("area"))
        and _floor_compatible(base.get("floor"), enriched.get("floor"))
    )


def _near_parcel_match(base: dict[str, Any], enriched: dict[str, Any]) -> bool:
    base_date = _date(base.get("dealDate"))
    enriched_date = _date(enriched.get("dealDate"))
    base_amount = _number(base.get("dealAmount"))
    enriched_amount = _number(enriched.get("dealAmount"))
    if base_date is None or enriched_date is None or base_amount is None or enriched_amount is None:
        return False
    if abs((base_date - enriched_date).days) > 1:
        return False
    if _relative_difference(base_amount, enriched_amount) > 0.001:
        return False
    if _number(base.get("rooms")) != _number(enriched.get("rooms")):
        return False
    if _number(base.get("area")) != _number(enriched.get("area")):
        return False
    if _text(base.get("gush")) != _text(enriched.get("gush")):
        return False
    if _text(base.get("helka")) != _text(enriched.get("helka")):
        return False
    return _floor_compatible(base.get("floor"), enriched.get("floor"))


def _source_conflicts(base: dict[str, Any], enriched: dict[str, Any]) -> list[str]:
    conflicts = []
    for field in ("gush", "helka", "tatHelka", "assetId", "propertyType"):
        left = _text(base.get(field))
        right = _text(enriched.get(field))
        if left is not None and right is not None and left != right:
            conflicts.append(f"{field}_conflict")

    left_floor = _floor_number(base.get("floor"))
    right_floor = _floor_number(enriched.get("floor"))
    if left_floor is not None and right_floor is not None and left_floor != right_floor:
        conflicts.append("floor_conflict")
    return conflicts


def _clear_attributes(match: TaxEnrichmentMatch) -> None:
    match.year_built = None
    match.building_floors = None
    match.is_first_hand = None
    match.prev_deals = None
    match.trend = None
    match.future_completion_context = False
    match.same_day_prev_deal_complexity = False


def _floor_compatible(left: Any, right: Any) -> bool:
    a = _floor_number(left)
    b = _floor_number(right)
    if a is None or b is None:
        return True
    return a == b


def _floor_number(value: Any) -> float | None:
    number = _number(value)
    if number is not None:
        return number
    text = _text(value)
    if text is None:
        return None
    mapping = {
        "קרקע": 0,
        "ראשונה": 1,
        "שניה": 2,
        "שנייה": 2,
        "שלישית": 3,
        "רביעית": 4,
        "חמישית": 5,
        "שישית": 6,
        "שביעית": 7,
        "שמינית": 8,
        "תשיעית": 9,
        "עשירית": 10,
        "אחת עשרה": 11,
        "שתים עשרה": 12,
        "שתיים עשרה": 12,
        "שלוש עשרה": 13,
        "ארבע עשרה": 14,
        "חמש עשרה": 15,
        "שש עשרה": 16,
        "שבע עשרה": 17,
        "שמונה עשרה": 18,
        "תשע עשרה": 19,
        "עשרים": 20,
        "עשרים ואחת": 21,
        "עשרים ושתיים": 22,
        "עשרים ושלוש": 23,
    }
    return float(mapping[text]) if text in mapping else None


def _source_index(row: dict[str, Any], fallback: int) -> int:
    value = row.get("source_index", row.get("sourceIndex"))
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _relative_difference(a: float, b: float) -> float:
    return abs(a - b) / max(abs(a), abs(b), 1.0)


def _date(value: Any) -> date | None:
    text = _text(value)
    if text is None:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value: Any) -> int | None:
    number = _number(value)
    if number is None:
        return None
    return int(number)


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
