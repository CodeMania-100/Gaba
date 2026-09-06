from __future__ import annotations

from datetime import date

from pricing_core import ProjectLocation, Unit, build_comparable_set, run_sold_qa, sold_group_basis, sold_group_key
from pricing_core.comparables import ComparableCandidate
from pricing_core.geographic_scope import GeographicScopeAssessment, GeographicScopeStatus
from pricing_core.market_regime import MarketRegime, MarketRegimeAssessment


def sold(**overrides):
    base = {
        "dealDate": "2026-01-10",
        "dealAmount": 1700000,
        "pricePerSqm": 21250,
        "address": "Near 1",
        "cityName": "אשקלון",
        "neighborhoodName": None,
        "rooms": 3,
        "floor": "4",
        "area": 80,
        "propertyType": "דירה בבית קומות",
        "isFirstHand": None,
        "gush": "1",
        "helka": "1",
        "tatHelka": "1",
        "assetId": "A",
        "lat": 31.6810,
        "lng": 34.6000,
    }
    base.update(overrides)
    return base


def target():
    return Unit(unit_number="17", floor=4, rooms=3, internal_area=69, balcony_area=12, orientation="מזרח")


def loc():
    return ProjectLocation(city="אשקלון", neighborhood="עיר היין", latitude=31.68114, longitude=34.60005, source="candidate_demo_assumption")


def test_nonstandard_sold_property_type_does_not_enter_primary_lane():
    qa = run_sold_qa([sold(propertyType="קוטג' דו משפחתי")])
    result = build_comparable_set(target(), loc(), qa.records, [], [], as_of=date(2026, 9, 4))
    assert result.sold == []
    assert result.excluded_counts["sold"] == 1


def test_nearby_sale_ranks_before_distant_structurally_identical_sale():
    qa = run_sold_qa([
        sold(assetId="near", lat=31.6810, lng=34.6000, area=80, tatHelka="1"),
        sold(assetId="far", lat=31.6500, lng=34.5600, area=69, tatHelka="2"),
    ])
    result = build_comparable_set(target(), loc(), qa.records, [], [], as_of=date(2026, 9, 4))
    assert [c.source_id for c in result.sold][:2] == ["near", "far"]


def test_at_same_location_recent_near_area_ranks_before_old_exact_area():
    qa = run_sold_qa([
        sold(assetId="recent", dealDate="2026-07-01", area=80, tatHelka="1"),
        sold(assetId="old", dealDate="2021-07-01", area=69, tatHelka="2"),
    ])
    result = build_comparable_set(target(), loc(), qa.records, [], [], as_of=date(2026, 9, 4))
    assert [c.source_id for c in result.sold][:2] == ["recent", "old"]


def test_project_level_price_is_not_assigned_to_unpriced_unit_type():
    project = {
        "id": "P1",
        "projectName": "Project",
        "addressDetails": {"city": "אשקלון", "neighbourhood": "עיר היין, אשקלון"},
        "locationPoint": {"lat": 31.681, "lng": 34.600},
        "priceRange": {"min": 1680000, "max": 1680000},
        "apartmentType": [{"beds": 3, "size": 76, "type": "FLAT", "price": None}],
        "url": "https://example.invalid/project",
    }
    result = build_comparable_set(target(), loc(), [], [], [project], as_of=date(2026, 9, 4))
    assert result.new_development == []


def test_same_building_sales_are_exposed_as_one_cluster():
    qa = run_sold_qa([
        sold(assetId="a", dealDate="2026-07-01", dealAmount=1700000, pricePerSqm=21250, tatHelka="11"),
        sold(assetId="b", dealDate="2026-06-01", dealAmount=1760000, pricePerSqm=22000, tatHelka="12", floor="7"),
        sold(assetId="c", dealDate="2026-05-01", dealAmount=1740000, pricePerSqm=21750, tatHelka="13", floor="8"),
        sold(assetId="other", dealDate="2026-07-02", address="Other 2", lat=31.682, lng=34.601, tatHelka="14"),
    ])
    result = build_comparable_set(target(), loc(), qa.records, [], [], as_of=date(2026, 9, 4))
    near_cluster = next(c for c in result.sold_building_clusters if c.address == "Near 1")
    assert near_cluster.record_count == 3
    assert near_cluster.median_price == 1740000
    assert near_cluster.newest_sale_date.isoformat() == "2026-07-01"
    assert len(result.sold_building_clusters) == 2


def test_missing_address_sold_records_at_same_coordinates_form_one_cluster():
    qa = run_sold_qa([
        sold(assetId="a", address=None, dealDate="2026-07-01", tatHelka="11", lat=31.681234, lng=34.600987),
        sold(assetId="b", address=None, dealDate="2026-06-01", tatHelka="12", lat=31.681234, lng=34.600987),
        sold(assetId="c", address=None, dealDate="2026-05-01", tatHelka="13", lat=31.682000, lng=34.601000),
    ])
    result = build_comparable_set(target(), loc(), qa.records, [], [], as_of=date(2026, 9, 4))
    assert len(result.sold_building_clusters) == 2
    assert sorted(c.record_count for c in result.sold_building_clusters) == [1, 2]


def _geo(status: GeographicScopeStatus) -> GeographicScopeAssessment:
    return GeographicScopeAssessment(scope_version="test_scope_v1", scope_status=status)


def _regime(regime: MarketRegime) -> MarketRegimeAssessment:
    return MarketRegimeAssessment(
        regime=regime, program_overlap=True, official_reference_ppsm_values=[10000.0],
        nearest_official_reference_ppsm=10000.0, observed_ppsm=21000.0, delta_to_official_pct=110.0,
        policy_version="test_policy_v1", reasoning=["test"], source="test",
    )


def test_geographic_scope_gate_is_a_no_op_when_context_is_none():
    """None (the default) must reproduce prior behavior exactly -- the geographic
    gate only activates when a caller explicitly supplies a classified context."""

    qa = run_sold_qa([sold(assetId="a")])
    result = build_comparable_set(target(), loc(), qa.records, [], [], as_of=date(2026, 9, 4))
    assert len(result.sold) == 1


def test_outside_verified_scope_is_excluded_with_geographic_scope_reason_not_quality():
    qa = run_sold_qa([sold(assetId="a")])
    source_index = qa.records[0].transaction.source_index
    result = build_comparable_set(
        target(), loc(), qa.records, [], [], as_of=date(2026, 9, 4),
        sold_geographic_context_by_source_index={source_index: _geo(GeographicScopeStatus.OUTSIDE_VERIFIED_SCOPE)},
    )
    assert result.sold == []
    excluded = next(t for t in result.selection_trace if t.lane == "sold")
    assert excluded.included is False
    assert excluded.reasons == ["geographic_scope:outside_verified_scope"]


def test_unresolved_geography_is_excluded_when_source_index_missing_from_context_map():
    qa = run_sold_qa([sold(assetId="a")])
    result = build_comparable_set(
        target(), loc(), qa.records, [], [], as_of=date(2026, 9, 4),
        sold_geographic_context_by_source_index={},  # supplied but this record isn't in it
    )
    assert result.sold == []
    excluded = next(t for t in result.selection_trace if t.lane == "sold")
    assert excluded.reasons == ["geographic_scope:unresolved"]


def test_geographic_gate_runs_before_regime_gate():
    """A record excluded for geography must never reach the regime check -- if it
    did, an UNRESOLVED regime default would still exclude it, but for the wrong
    (misleading) reason."""

    qa = run_sold_qa([sold(assetId="a")])
    source_index = qa.records[0].transaction.source_index
    result = build_comparable_set(
        target(), loc(), qa.records, [], [], as_of=date(2026, 9, 4),
        sold_geographic_context_by_source_index={source_index: _geo(GeographicScopeStatus.OUTSIDE_VERIFIED_SCOPE)},
        sold_market_context_by_source_index={source_index: _regime(MarketRegime.MARKET_LIKE)},
    )
    excluded = next(t for t in result.selection_trace if t.lane == "sold")
    assert excluded.reasons == ["geographic_scope:outside_verified_scope"]


def test_market_like_and_verified_local_record_enters_pool_with_context_attached():
    qa = run_sold_qa([sold(assetId="a")])
    source_index = qa.records[0].transaction.source_index
    result = build_comparable_set(
        target(), loc(), qa.records, [], [], as_of=date(2026, 9, 4),
        sold_geographic_context_by_source_index={source_index: _geo(GeographicScopeStatus.VERIFIED_LOCAL)},
        sold_market_context_by_source_index={source_index: _regime(MarketRegime.MARKET_LIKE)},
    )
    assert len(result.sold) == 1
    assert result.sold[0].geographic_context["scope_status"] == "verified_local_by_official_parcel_scope"
    assert result.sold[0].market_context["regime"] == "market_like"


def test_context_keyed_by_source_index_not_asset_id():
    """A record with a null/duplicate assetId must still classify correctly because
    the lookup key is the immutable source_index, not the display asset id."""

    qa = run_sold_qa([sold(assetId=None, dealDate="2026-07-01", area=70)])
    source_index = qa.records[0].transaction.source_index
    result = build_comparable_set(
        target(), loc(), qa.records, [], [], as_of=date(2026, 9, 4),
        sold_geographic_context_by_source_index={source_index: _geo(GeographicScopeStatus.VERIFIED_LOCAL)},
    )
    assert len(result.sold) == 1
    assert result.sold[0].source_id is None


def _candidate_for_grouping(**overrides) -> ComparableCandidate:
    base = dict(
        lane="sold", source="test", source_id="X", source_url=None, price=1_000_000, rooms=3, area=70,
        floor=None, property_type="standard_apartment", latitude=None, longitude=None, event_date=None,
        address=None,
    )
    base.update(overrides)
    return ComparableCandidate(**base)


def test_group_key_hierarchy_address_then_coordinates_then_parcel():
    assert sold_group_key(_candidate_for_grouping(address="Main 1")) == "Main 1"
    assert sold_group_basis(_candidate_for_grouping(address="Main 1")) == "address"

    coord_only = _candidate_for_grouping(latitude=31.681234, longitude=34.600987)
    assert sold_group_key(coord_only) == "coord:31.681234,34.600987"
    assert sold_group_basis(coord_only) == "coordinates"

    parcel_only = _candidate_for_grouping(gush=1197, helka=82)
    assert sold_group_key(parcel_only) == "parcel:1197/82"
    assert sold_group_basis(parcel_only) == "cadastral_parcel"

    unresolved = _candidate_for_grouping()
    assert sold_group_key(unresolved) is None
    assert sold_group_basis(unresolved) == "unresolved"


def test_different_asset_ids_on_same_parcel_are_not_automatically_independent():
    """assetId must never be used as evidence of an independent building/location --
    two records on the same parcel with different asset ids still group together."""

    a = _candidate_for_grouping(source_id="asset-1", gush=1197, helka=82)
    b = _candidate_for_grouping(source_id="asset-2", gush=1197, helka=82)
    assert sold_group_key(a) == sold_group_key(b) == "parcel:1197/82"
