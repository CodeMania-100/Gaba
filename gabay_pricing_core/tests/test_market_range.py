from __future__ import annotations

from datetime import date

from pricing_core import (
    ComparableCandidate,
    ComparableSet,
    ProjectLocation,
    RangeStatus,
    Unit,
    build_market_range,
)


def target(unit_type: str = "standard_apartment") -> Unit:
    return Unit(
        unit_number="17",
        floor=4,
        rooms=3,
        internal_area=69,
        balcony_area=12,
        orientation="מזרח",
        unit_type=unit_type,
    )


def location() -> ProjectLocation:
    return ProjectLocation(
        city="אשקלון",
        neighborhood="עיר היין",
        latitude=31.68114,
        longitude=34.60005,
        source="candidate_demo_assumption",
    )


def candidate(
    lane: str,
    source_id: str,
    price: float,
    area: float | None,
    *,
    address: str | None,
    neighborhood: str | None = "עיר היין",
    event_date: date | None = None,
    project_name: str | None = None,
    distance_m: float = 300,
    latitude: float | None = 31.681,
    longitude: float | None = 34.600,
    gush: int | None = None,
    helka: int | None = None,
) -> ComparableCandidate:
    return ComparableCandidate(
        lane=lane,
        source="test",
        source_id=source_id,
        source_url=None,
        price=price,
        rooms=3,
        area=area,
        floor="4",
        property_type="standard_apartment",
        latitude=latitude,
        longitude=longitude,
        event_date=event_date,
        project_name=project_name,
        neighborhood=neighborhood,
        address=address,
        distance_m=distance_m,
        area_difference_pct=None,
        floor_difference=0,
        quality_status="usable",
        reasons=[],
        raw={"pricePerSqm": price / area if area else None},
        gush=gush,
        helka=helka,
    )


def comp(sold=None, asking=None, projects=None, unit=None) -> ComparableSet:
    return ComparableSet(
        target_unit=unit or target(),
        target_location=location(),
        sold=sold or [],
        sold_building_clusters=[],
        current_asking=asking or [],
        new_development=projects or [],
        excluded_counts={},
        ranking_policy=[],
        source_context={"sold_query_scope": {"city": "אשקלון", "neighborhoods": ["עיר היין"]}},
    )


def test_same_sold_building_contributes_once_to_range():
    # Areas moved within the ±15% target-area tolerance (target=69 -> 58.65-79.35).
    sold = [
        candidate("sold", "a", 1_600_000, 72, address="A", neighborhood=None, event_date=date(2026, 6, 1)),
        candidate("sold", "b", 1_680_000, 72, address="A", neighborhood=None, event_date=date(2026, 5, 1)),
        candidate("sold", "c", 1_520_000, 72, address="B", neighborhood=None, event_date=date(2026, 4, 1)),
    ]
    result = build_market_range(comp(sold=sold), as_of=date(2026, 9, 4))
    assert len(result.sold.primary_contributors) == 2
    assert result.sold.primary_contributors[0].group_key in {"A", "B"}


def test_current_asking_uses_exact_neighborhood_not_citywide_rows():
    asking = [
        candidate("current_asking", "wine", 1_600_000, 80, address="Wine 1", neighborhood="עיר היין"),
        candidate("current_asking", "wine2", 1_700_000, 85, address="Wine 2", neighborhood="עיר היין, אשקלון"),
        candidate("current_asking", "other", 900_000, 70, address="Other 1", neighborhood="אגמים"),
    ]
    result = build_market_range(comp(asking=asking), as_of=date(2026, 9, 4))
    keys = {c.group_key for c in result.current_asking.primary_contributors}
    assert keys == {"Wine 1", "Wine 2"}


def test_missing_area_new_development_offer_is_reference_only():
    projects = [
        candidate("new_development", "known", 1_772_000, 82, address="P1", project_name="P1"),
        candidate("new_development", "unknown", 1_680_000, None, address="P2", project_name="P2"),
    ]
    result = build_market_range(comp(projects=projects), as_of=date(2026, 9, 4))
    assert len(result.new_development.primary_contributors) == 1
    assert len(result.new_development.reference_records) == 1
    assert result.new_development.reference_records[0]["project_name"] == "P2"


def test_two_independent_lane_ranges_must_overlap_to_create_supported_range():
    # Areas moved within the ±15% target-area tolerance (target=69 -> 58.65-79.35).
    sold = [
        candidate("sold", "s1", 1_500_000, 75, address="S1", neighborhood=None, event_date=date(2026, 6, 1)),
        candidate("sold", "s2", 1_600_000, 72, address="S2", neighborhood=None, event_date=date(2026, 5, 1)),
    ]
    asking = [
        candidate("current_asking", "a1", 1_550_000, 78, address="A1"),
        candidate("current_asking", "a2", 1_650_000, 82, address="A2"),
    ]
    result = build_market_range(comp(sold=sold, asking=asking), as_of=date(2026, 9, 4))
    assert result.status is RangeStatus.CONSENSUS
    assert set(result.support_lanes) == {"sold", "current_asking"}
    assert result.supported_lower is not None
    assert result.supported_upper is not None


def test_disagreeing_independent_lanes_do_not_get_weighted_into_fake_middle_price():
    # Areas moved within the ±15% target-area tolerance (target=69 -> 58.65-79.35).
    sold = [
        candidate("sold", "s1", 900_000, 75, address="S1", neighborhood=None, event_date=date(2026, 6, 1)),
        candidate("sold", "s2", 950_000, 72, address="S2", neighborhood=None, event_date=date(2026, 5, 1)),
    ]
    asking = [
        candidate("current_asking", "a1", 2_000_000, 75, address="A1"),
        candidate("current_asking", "a2", 2_100_000, 80, address="A2"),
    ]
    result = build_market_range(comp(sold=sold, asking=asking), as_of=date(2026, 9, 4))
    assert result.status is RangeStatus.NO_CONSENSUS
    assert result.supported_lower is None
    assert result.supported_upper is None


def test_balcony_is_not_assigned_an_invented_monetary_premium():
    asking = [
        candidate("current_asking", "a1", 1_600_000, 80, address="A1"),
        candidate("current_asking", "a2", 1_600_000, 80, address="A2"),
    ]
    result = build_market_range(comp(asking=asking), as_of=date(2026, 9, 4))
    expected = round((1_600_000 / 80 * 69) / 1000) * 1000
    assert result.current_asking.center == expected
    assert any("Balcony" in text for text in result.assumptions)


def test_special_unit_requires_individual_review_instead_of_standard_range():
    result = build_market_range(comp(unit=target(unit_type="triplex")), as_of=date(2026, 9, 4))
    assert result.status is RangeStatus.MANUAL_REVIEW
    assert result.supported_lower is None
    assert result.supported_upper is None


def test_citywide_sold_evidence_cannot_silently_drive_neighborhood_range():
    sold = [
        candidate("sold", "s1", 1_500_000, 75, address="S1", neighborhood=None, event_date=date(2026, 6, 1)),
        candidate("sold", "s2", 1_600_000, 80, address="S2", neighborhood=None, event_date=date(2026, 5, 1)),
    ]
    c = comp(sold=sold)
    c.source_context = {"sold_query_scope": {"city": "אשקלון", "neighborhoods": []}}
    result = build_market_range(c, as_of=date(2026, 9, 4))
    assert result.sold.can_enter_consensus is False
    assert result.sold.lower is None
    assert "sold_evidence_not_verified_as_target_neighborhood_scope" in result.sold.warnings


def test_missing_address_sales_share_coordinate_group_in_range():
    # Areas moved within the ±15% target-area tolerance (target=69 -> 58.65-79.35).
    sold = [
        candidate("sold", "a", 1_600_000, 70, address=None, neighborhood=None, event_date=date(2026, 6, 1)),
        candidate("sold", "b", 1_680_000, 70, address=None, neighborhood=None, event_date=date(2026, 5, 1)),
    ]
    sold[0].latitude = sold[1].latitude = 31.681234
    sold[0].longitude = sold[1].longitude = 34.600987
    result = build_market_range(comp(sold=sold), as_of=date(2026, 9, 4))
    assert len(result.sold.primary_contributors) == 1
    assert result.sold.primary_contributors[0].group_key.startswith("coord:")


def test_same_parcel_no_address_no_coords_groups_as_one_independent_location():
    """Cadastral parcel is the narrowest defensible fallback when building identity
    is unavailable -- two sales on the same parcel with different asset ids (and no
    address/coordinates) must still count as ONE independent location, not two."""

    sold = [
        candidate("sold", "asset-1", 1_500_000, 70, address=None, neighborhood=None,
                  event_date=date(2026, 6, 1), latitude=None, longitude=None, gush=1197, helka=82),
        candidate("sold", "asset-2", 1_600_000, 71, address=None, neighborhood=None,
                  event_date=date(2026, 5, 1), latitude=None, longitude=None, gush=1197, helka=82),
    ]
    c = comp(sold=sold)
    c.source_context = {"sold_query_scope": {"city": "אשקלון", "scope_type": "verified_official_parcel_zone"}}
    result = build_market_range(c, as_of=date(2026, 9, 4))
    assert len(result.sold.primary_contributors) == 1
    assert result.sold.primary_contributors[0].group_key == "parcel:1197/82"


def test_different_parcels_no_address_no_coords_are_two_independent_locations():
    sold = [
        candidate("sold", "asset-1", 1_500_000, 70, address=None, neighborhood=None,
                  event_date=date(2026, 6, 1), latitude=None, longitude=None, gush=1197, helka=82),
        candidate("sold", "asset-2", 1_600_000, 71, address=None, neighborhood=None,
                  event_date=date(2026, 5, 1), latitude=None, longitude=None, gush=1197, helka=90),
    ]
    c = comp(sold=sold)
    c.source_context = {"sold_query_scope": {"city": "אשקלון", "scope_type": "verified_official_parcel_zone"}}
    result = build_market_range(c, as_of=date(2026, 9, 4))
    assert len(result.sold.primary_contributors) == 2
    assert {contrib.group_key for contrib in result.sold.primary_contributors} == {"parcel:1197/82", "parcel:1197/90"}


def test_verified_official_parcel_zone_scope_type_admits_sold_pool_and_caps_confidence():
    """A citywide source with no coordinates and no exact-neighborhood record labels
    can still form a primary sold lane when the query scope declares
    scope_type=verified_official_parcel_zone -- but confidence is capped at medium,
    never HIGH, and the coordinates/verification-limitation warnings are present."""

    sold = [
        candidate("sold", "a1", 1_500_000, 70, address="Addr 1", neighborhood="אזור תעשיה צפוני", event_date=date(2026, 6, 1)),
        candidate("sold", "a2", 1_520_000, 71, address="Addr 2", neighborhood="אזור תעשיה צפוני", event_date=date(2026, 6, 1)),
        candidate("sold", "a3", 1_540_000, 72, address="Addr 3", neighborhood="אזור תעשיה צפוני", event_date=date(2026, 6, 1)),
    ]
    c = comp(sold=sold)
    c.source_context = {
        "sold_query_scope": {
            "city": "אשקלון",
            "scope_type": "verified_official_parcel_zone",
            "official_zone": "אשקלון מזרח",
            "coordinates_available": False,
        }
    }
    result = build_market_range(c, as_of=date(2026, 9, 4))
    assert result.sold.can_enter_consensus is True
    assert result.sold.confidence.value != "high"
    assert "sold_scope_verified_by_official_parcel_zone_not_exact_target_neighborhood" in result.sold.warnings
    assert "sold_source_coordinates_unavailable" in result.sold.warnings


def test_target_plus_adjacent_sold_scope_without_exact_labels_caps_confidence():
    # Areas moved within the ±15% target-area tolerance (target=69 -> 58.65-79.35).
    sold = [
        candidate("sold", "s1", 1_500_000, 75, address="S1", neighborhood=None, event_date=date(2026, 6, 1)),
        candidate("sold", "s2", 1_600_000, 72, address="S2", neighborhood=None, event_date=date(2026, 5, 1)),
        candidate("sold", "s3", 1_620_000, 73, address="S3", neighborhood=None, event_date=date(2026, 4, 1)),
    ]
    c = comp(sold=sold)
    c.source_context = {"sold_query_scope": {"city": "אשקלון", "neighborhoods": ["עיר היין", "רמת כרמים"]}}
    result = build_market_range(c, as_of=date(2026, 9, 4))
    assert result.sold.confidence.value == "medium"
    assert "sold_scope_includes_target_plus_adjacent_neighborhoods_without_exact_record_labels" in result.sold.warnings
