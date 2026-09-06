from __future__ import annotations

from pricing_core.geographic_scope import (
    GeographicScopeStatus,
    assess_geographic_scope,
    geographic_assessment_from_dict,
    local_scope_from_dict,
)

SCOPE_RAW = {
    "version": "test_local_scope_v1",
    "source_file": "test_source.json",
    "city": "אשקלון",
    "assignment_location_assumption": "עיר היין",
    "verified_official_zone": "אשקלון מזרח",
    "scope_basis": "official_parcel_project_neighborhood",
    "coordinates_available": False,
    "exact_target_neighborhood_verified": False,
    "included_parcels": [[1196, 79], [1197, 87]],
}


def scope():
    return local_scope_from_dict(SCOPE_RAW)


def test_parcel_in_whitelist_is_verified_local():
    result = assess_geographic_scope(gush=1196, helka=79, source_neighborhood=None, scope=scope())
    assert result.scope_status is GeographicScopeStatus.VERIFIED_LOCAL
    assert result.official_scope_label == "אשקלון מזרח"
    assert result.official_scope_source == "housing_program_gis_project_context"


def test_cross_vocabulary_neighborhood_label_mismatch_is_not_a_conflict():
    """A tax-authority statistical zone name and an official GIS/project zone name are
    different classification systems. A string mismatch between them must never be
    read as geographic conflict -- admission is decided solely by the frozen parcel
    whitelist. This is the exact real-data situation: every verified-local record in
    the demo's enriched 3-room source carries source_neighborhood='אזור תעשיה צפוני'
    while the official zone is 'אשקלון מזרח'."""

    result = assess_geographic_scope(
        gush=1197, helka=87, source_neighborhood="אזור תעשיה צפוני", scope=scope()
    )
    assert result.scope_status is GeographicScopeStatus.VERIFIED_LOCAL
    assert result.official_scope_label == "אשקלון מזרח"
    assert result.source_neighborhood_label == "אזור תעשיה צפוני"
    assert result.source_neighborhood_system == "tax_authority_source"


def test_parcel_outside_whitelist_is_outside_verified_scope():
    result = assess_geographic_scope(gush=1199, helka=67, source_neighborhood="ניצנים", scope=scope())
    assert result.scope_status is GeographicScopeStatus.OUTSIDE_VERIFIED_SCOPE
    assert result.official_scope_label is None
    assert result.source_neighborhood_label == "ניצנים"


def test_missing_parcel_is_unresolved():
    result = assess_geographic_scope(gush=None, helka=None, source_neighborhood=None, scope=scope())
    assert result.scope_status is GeographicScopeStatus.UNRESOLVED
    assert result.gush is None and result.helka is None


def test_public_dict_round_trips_through_from_dict():
    original = assess_geographic_scope(gush=1196, helka=79, source_neighborhood="אזור תעשיה צפוני", scope=scope())
    restored = geographic_assessment_from_dict(original.public_dict())
    assert restored == original


def test_scope_never_looks_at_price():
    """assess_geographic_scope's signature has no price/ppsm parameter at all --
    this test documents that geography is independent of price by construction."""

    import inspect

    params = inspect.signature(assess_geographic_scope).parameters
    assert "price" not in params and "ppsm" not in params and "observed_ppsm" not in params
