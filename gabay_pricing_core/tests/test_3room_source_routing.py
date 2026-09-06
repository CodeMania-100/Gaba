"""Real-data acceptance test for the standard-3R sold-source routing correction.

The standard 3-room family's completed-sale evidence now comes from the citywide
tax_enriched_ashkelon_3room_36m.json source, restricted to a frozen, official-parcel
local-scope whitelist (data/diagnostics/three_room_verified_demo_scope_v1.json) --
never from wine_city_sold_raw.json (kept as reference-only corroboration), and never
by dynamically inferring locality from a Hebrew neighborhood label at runtime.
"""

from __future__ import annotations

import calendar
import json
from datetime import date
from pathlib import Path

from pricing_core import QualityStatus, run_sold_qa, sold_group_key
from pricing_core.geographic_scope import GeographicScopeStatus, assess_geographic_scope, local_scope_from_dict
from pricing_core.market_regime import (
    CITY_WINE_STANDARD_3ROOM_69M2_PROGRAM_REGIME_V1,
    assess_market_regime,
    compute_observed_ppsm,
    parcel_context_from_dict,
)

from app_api.pricing_service import SOLD_SOURCE_BY_ROOMS, SOLD_SOURCES_WITH_GEOGRAPHIC_SCOPE

REPO_ROOT = Path(__file__).resolve().parents[1]
ENRICHED_PATH = REPO_ROOT / "tax_enriched_ashkelon_3room_36m.json"
PARCEL_FILE = REPO_ROOT / "data" / "diagnostics" / "three_room_program_overlap_parcels.json"
SCOPE_FILE = REPO_ROOT / "data" / "diagnostics" / "three_room_verified_demo_scope_v1.json"

AS_OF = date(2026, 9, 4)
TARGET_AREA = 69.0
AREA_TOLERANCE_PCT = 0.15
LOOKBACK_MONTHS = 24

EXPECTED_GROUPS = {
    # sold_group_key() returns the bare address for the address tier (no prefix) to
    # stay backward compatible with SoldBuildingCluster's existing display format --
    # only the coordinate/parcel fallback tiers carry a prefix.
    "הרב יוסף שרביט 5": 7,
    "הרב יוסף שרביט 7": 5,
    "ניר עוז 14": 5,
    "parcel:1197/82": 2,
    "parcel:1197/86": 1,
    "parcel:1197/90": 1,
}


def _subtract_months(value: date, months: int) -> date:
    year = value.year
    month = value.month - months
    while month <= 0:
        month += 12
        year -= 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def test_active_3room_source_is_the_enriched_file_not_wine_city():
    assert SOLD_SOURCE_BY_ROOMS[3] == "tax_enriched_sold_3room"
    assert SOLD_SOURCE_BY_ROOMS[3] != "govmap_sold_3room"
    assert "tax_enriched_sold_3room" in SOLD_SOURCES_WITH_GEOGRAPHIC_SCOPE
    # 5R stays untouched by this correction.
    assert SOLD_SOURCE_BY_ROOMS[5] == "govmap_sold_5room"
    assert "govmap_sold_5room" not in SOLD_SOURCES_WITH_GEOGRAPHIC_SCOPE


def test_full_real_data_pipeline_reproduces_21_transactions_6_groups():
    raw = json.loads(ENRICHED_PATH.read_text(encoding="utf-8"))
    assert len(raw) == 975

    qa = run_sold_qa(raw)
    usable = [r for r in qa.records if r.status == QualityStatus.USABLE]
    assert len(usable) == 652, "run_sold_qa's real usable count changed -- stop and report, do not rewrite blindly."

    eligible = [
        r for r in usable
        if r.normalized_property_type == "standard_apartment" and r.transaction.rooms == 3 and r.transaction.city == "אשקלון"
    ]

    scope = local_scope_from_dict(json.loads(SCOPE_FILE.read_text(encoding="utf-8")))
    assert len(scope.included_parcels) == 11

    parcels = {
        (p.gush, p.helka): p
        for p in (parcel_context_from_dict(raw_parcel) for raw_parcel in json.loads(PARCEL_FILE.read_text(encoding="utf-8"))["parcels"])
    }
    policy = CITY_WINE_STANDARD_3ROOM_69M2_PROGRAM_REGIME_V1
    cutoff = _subtract_months(AS_OF, LOOKBACK_MONTHS)

    survivors = []
    for r in eligible:
        tx = r.transaction
        gush = int(tx.gush) if tx.gush is not None else None
        helka = int(tx.helka) if tx.helka is not None else None
        geo = assess_geographic_scope(gush=gush, helka=helka, source_neighborhood=tx.neighborhood, scope=scope)
        if geo.scope_status is not GeographicScopeStatus.VERIFIED_LOCAL:
            continue
        parcel = parcels.get((gush, helka))
        observed = compute_observed_ppsm(tx.price_per_sqm, tx.deal_amount, tx.area)
        regime = assess_market_regime(parcel=parcel, observed_ppsm=observed, policy=policy, source=str(ENRICHED_PATH))
        if regime.regime.value != "market_like":
            continue
        if tx.area is None or not (TARGET_AREA * (1 - AREA_TOLERANCE_PCT) <= tx.area <= TARGET_AREA * (1 + AREA_TOLERANCE_PCT)):
            continue
        if tx.deal_date is None or tx.deal_date < cutoff:
            continue
        survivors.append(r)

    assert len(survivors) == 21

    class _FakeCandidate:
        pass

    groups: dict[str | None, list] = {}
    for r in survivors:
        tx = r.transaction
        fc = _FakeCandidate()
        fc.address = r.normalized_address
        fc.latitude = tx.latitude
        fc.longitude = tx.longitude
        fc.gush = int(tx.gush) if tx.gush is not None else None
        fc.helka = int(tx.helka) if tx.helka is not None else None
        key = sold_group_key(fc)
        groups.setdefault(key, []).append(tx.source_index)

    assert None not in groups, "every survivor must resolve to address, coordinates, or a cadastral parcel"
    assert len(groups) == 6
    actual_counts = {k: len(v) for k, v in groups.items()}
    assert actual_counts == EXPECTED_GROUPS


def test_niznanim_parcel_is_outside_verified_scope():
    scope = local_scope_from_dict(json.loads(SCOPE_FILE.read_text(encoding="utf-8")))
    # (1199, 67) is officially resolved as Neighborhood == "ניצנים", not "אשקלון מזרח".
    result = assess_geographic_scope(gush=1199, helka=67, source_neighborhood=None, scope=scope)
    assert result.scope_status is GeographicScopeStatus.OUTSIDE_VERIFIED_SCOPE


def test_agamim_mizrach_parcel_is_outside_verified_scope():
    scope = local_scope_from_dict(json.loads(SCOPE_FILE.read_text(encoding="utf-8")))
    # (1475, 58) is officially resolved as Neighborhood == "אגמים מזרח", not "אשקלון מזרח".
    result = assess_geographic_scope(gush=1475, helka=58, source_neighborhood=None, scope=scope)
    assert result.scope_status is GeographicScopeStatus.OUTSIDE_VERIFIED_SCOPE


def test_missing_cadastral_reference_is_unresolved_not_outside_scope():
    scope = local_scope_from_dict(json.loads(SCOPE_FILE.read_text(encoding="utf-8")))
    result = assess_geographic_scope(gush=None, helka=None, source_neighborhood=None, scope=scope)
    assert result.scope_status is GeographicScopeStatus.UNRESOLVED


def test_parcel_context_coverage_gap_is_fixed_for_1200_63_and_1200_73():
    parcels = {
        (p.gush, p.helka): p
        for p in (parcel_context_from_dict(raw_parcel) for raw_parcel in json.loads(PARCEL_FILE.read_text(encoding="utf-8"))["parcels"])
    }
    for gush, helka in ((1200, 63), (1200, 73)):
        parcel = parcels.get((gush, helka))
        assert parcel is not None, f"({gush},{helka}) must be resolved -- copied verbatim from the 5R investigation"
        assert parcel.resolved is True
        assert len(parcel.projects) > 0
