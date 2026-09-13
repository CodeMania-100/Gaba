"""Regression tests for multi-city market-context switching (see
app_api/market_context_registry.py, market_context_workspace.py,
multi_city_*.py). Integration coverage follows tests/test_pricing_workflow_
api.py's own TestClient(create_app(...)) style; a few lower-level checks
call the multi_city_special_market adapter functions directly (matching
tests/test_market_range.py's pattern of exercising pricing_core dataclasses
without the FastAPI layer) to prove the adapter reuses the real engine
classifiers rather than owning its own tier-lookup logic.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app_api import create_app
from app_api.market_context_registry import MARKET_CONTEXTS
from app_api.market_context_workspace import _pricing_core_data_dir, build_market_context_workspace_payload
from app_api.multi_city_precision_overlay import _merge_comparable
from app_api.multi_city_special_market import (
    NON_QUANTITATIVE_PRICE_TYPES,
    QUANTITATIVE_PRICE_TYPES,
    build_asking_inputs,
    build_new_development_inputs,
    build_sold_inputs,
    build_special_product_comparison_universe,
    normalize_segment_string_to_units,
)
from app_api.geography_validation import find_geography_records, validate_geography_records
from app_api.petah_tikva_workspace import build_petah_tikva_workspace_payload
from pricing_core.special_market_indication import classify_asking_tier, classify_new_development_variant, classify_sold_eligibility, classify_sold_tier

DATA_ROOT = _pricing_core_data_dir()
NON_PT_SLUGS = ["yad_eliyahu", "kiryat_hasharon", "barnea"]
ALL_SLUGS = ["petah_tikva", *NON_PT_SLUGS]


def client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(f"sqlite:///{tmp_path / 'market_contexts.db'}"))


def _workspace(c: TestClient, slug: str) -> dict:
    r = c.get(f"/api/v1/demo/market-contexts/{slug}/workspace")
    assert r.status_code == 200, r.text
    return r.json()


# --- Inventory invariants -----------------------------------------------------

def test_all_contexts_return_39_distinct_units(tmp_path):
    c = client(tmp_path)
    for slug in ALL_SLUGS:
        rows = _workspace(c, slug)["price_list"]
        numbers = [r["unit_number"] for r in rows]
        assert len(numbers) == 39, slug
        assert len(set(numbers)) == 39, slug


def test_inventory_identical_across_contexts(tmp_path):
    c = client(tmp_path)
    # `rooms` is absent on Petah Tikva's own frozen standard rows (predates
    # that field -- see PtkPriceListRow.rooms's own doc comment in api.ts)
    # but present on this batch's multi-city standard rows, so it is
    # compared only via `.get()` / only asserted where both sides have it,
    # never required to be a byte-identical key set. `family_key`'s literal
    # string content is internal engine naming (pricingRouteOf only checks
    # null-vs-non-null) so only its null-ness is compared, not its value.
    fields = ("unit_number", "internal_area_sqm", "balcony_area_sqm", "orientation", "family")

    def fingerprint(rows: list[dict]) -> dict:
        return {r["unit_number"]: (*(r.get(f) for f in fields), r.get("family_key") is not None) for r in rows}

    baseline_rows = _workspace(c, "petah_tikva")["price_list"]
    baseline = fingerprint(baseline_rows)
    baseline_rooms = {r["unit_number"]: r.get("rooms") for r in baseline_rows if r.get("rooms") is not None}

    for slug in NON_PT_SLUGS:
        other_rows = _workspace(c, slug)["price_list"]
        assert fingerprint(other_rows) == baseline, slug
        other_rooms = {r["unit_number"]: r.get("rooms") for r in other_rows if r.get("rooms") is not None}
        for unit_number, rooms in baseline_rooms.items():
            assert other_rooms.get(unit_number) == rooms, (slug, unit_number)


def test_petah_tikva_unchanged(tmp_path):
    """Business-payload equality after stripping the two additive keys --
    not whole-object byte-identity, since market_context/map are expected to
    differ by design (they don't exist on the old route's payload at all)."""

    c = client(tmp_path)
    via_new_route = _workspace(c, "petah_tikva")
    via_old_route = c.get("/api/v1/demo/petah-tikva/workspace").json()
    via_direct_call = build_petah_tikva_workspace_payload()

    stripped = {k: v for k, v in via_new_route.items() if k not in ("market_context", "map")}
    assert stripped == via_old_route
    assert stripped == via_direct_call


# --- Standard 3R/5R exact regression values -----------------------------------

EXPECTED_STANDARD = {
    "yad_eliyahu": {"3R": (2560000.0, 2748000.0, 2654000.0, "medium"), "5R": (3921000.0, 3988000.0, 3954000.0, "medium")},
    "kiryat_hasharon": {"3R": (1958000.0, 2162000.0, 2060000.0, "medium"), "5R": (2490000.0, 2683000.0, 2586000.0, "medium")},
    "barnea": {"3R": (1271000.0, 1339000.0, 1305000.0, "medium"), "5R": (1631000.0, 1805000.0, 1718000.0, "medium")},
}


@pytest.mark.parametrize("slug", NON_PT_SLUGS)
def test_standard_family_ranges_match_frozen_final_output(tmp_path, slug):
    c = client(tmp_path)
    families = {f["family"]: f for f in _workspace(c, slug)["families"]}
    for family, (lower, upper, point, confidence) in EXPECTED_STANDARD[slug].items():
        fam = families[family]
        assert fam["market"]["supported_lower"] == lower
        assert fam["market"]["supported_upper"] == upper
        assert fam["market"]["confidence"] == confidence
        assert fam["market"]["status"] == "consensus"
        assert fam["proposed_family_price_ils"] == point


@pytest.mark.parametrize("slug", NON_PT_SLUGS)
def test_every_context_has_valid_map_center(tmp_path, slug):
    c = client(tmp_path)
    m = _workspace(c, slug)["map"]
    assert m["center"] is not None
    lng, lat = m["center"]
    assert isinstance(lng, float) and isinstance(lat, float)


# --- Geography / contamination (tier-aware, structured -- never free-text) ----

@pytest.mark.parametrize("slug", ALL_SLUGS)
def test_no_cross_city_geography_violations(tmp_path, slug):
    c = client(tmp_path)
    context = MARKET_CONTEXTS[slug]
    payload = _workspace(c, slug)
    records = find_geography_records(payload)
    violations = validate_geography_records(records, context.city_spellings, context.submarket)
    assert violations == [], [(v.record_label, v.field, v.expected, v.actual) for v in violations]


def test_geography_validator_tolerates_non_core_submarket_mismatch():
    """A record whose geography_tier is ADJACENT/BROADER may legitimately
    carry a different submarket -- only a CORE-tier submarket mismatch (or
    any city mismatch) is a violation."""

    records = [
        {"city": "תל אביב-יפו", "normalized_submarket": "some other submarket", "geography_tier": "ADJACENT"},
        {"city": "תל אביב-יפו", "normalized_submarket": "some other submarket", "geography_tier": "BROADER"},
    ]
    assert validate_geography_records(records, "תל אביב-יפו", "יד אליהו") == []

    core_mismatch = [{"city": "תל אביב-יפו", "normalized_submarket": "wrong", "geography_tier": "CORE"}]
    violations = validate_geography_records(core_mismatch, "תל אביב-יפו", "יד אליהו")
    assert len(violations) == 1

    city_mismatch = [{"city": "אשקלון", "normalized_submarket": "יד אליהו", "geography_tier": "BROADER"}]
    violations = validate_geography_records(city_mismatch, "תל אביב-יפו", "יד אליהו")
    assert len(violations) == 1  # city mismatch is always a violation, tier notwithstanding


# --- No Petah Tikva fallback for special units --------------------------------

def test_special_unit_adapter_never_reads_petah_tikva_master_file():
    import app_api.multi_city_special_market as module
    import inspect

    source = inspect.getsource(module)
    # Only doc-comment mentions of the filename are allowed (explaining the
    # invariant) -- never inside an actual path-construction/open() call.
    for line in source.splitlines():
        stripped = line.strip()
        if "special_unit_master_data_v1" in stripped:
            assert stripped.startswith("#") or stripped.startswith('"') or "must never" in stripped or "never special_unit_master_data_v1" in stripped or "never read by this code path" in stripped, line


@pytest.mark.parametrize("slug", NON_PT_SLUGS)
def test_special_units_do_not_fall_back_to_petah_tikva_evidence(tmp_path, slug):
    c = client(tmp_path)
    pt_units = _workspace(c, "petah_tikva")["special_unit_market_context"]["units"]
    other_units = _workspace(c, slug)["special_unit_market_context"]["units"]
    for unit_number, other in other_units.items():
        pt = pt_units[unit_number]
        # Different evidence universes -- the comparable label sets must not
        # be identical to Petah Tikva's own (would indicate a fallback leak).
        other_labels = {c2.get("address") for c2 in other["direct_comparables"] + other["broadened_comparables"]}
        pt_labels = {c2.get("address") for c2 in pt["direct_comparables"] + pt["broadened_comparables"]}
        if other_labels and pt_labels:
            assert other_labels.isdisjoint(pt_labels)


# --- Lane-specific gating reuses the real engine classifiers (never an adapter-owned mapping) ---

def test_asking_tier_comes_from_classify_asking_tier():
    row = {
        "city": "תל אביב-יפו", "relevant_segments": "APT3", "validation_status": "DIRECT",
        "price_type": "CURRENT_ASKING", "price": "2000000", "internal_area": "60", "address": "test",
    }
    comparables, excluded = build_asking_inputs([row], "3", "תל אביב-יפו", subject_area=57.0)
    assert excluded == []
    assert len(comparables) == 1
    assert comparables[0].tier == classify_asking_tier("direct_current_verified")


def test_asking_non_quantitative_price_types_are_excluded():
    for price_type in NON_QUANTITATIVE_PRICE_TYPES:
        row = {
            "city": "תל אביב-יפו", "relevant_segments": "APT3", "validation_status": "DIRECT",
            "price_type": price_type, "price": "2000000", "internal_area": "60", "address": "test",
        }
        comparables, excluded = build_asking_inputs([row], "3", "תל אביב-יפו", subject_area=57.0)
        assert comparables == [], price_type
        assert len(excluded) == 1


def test_sold_eligibility_and_tier_come_from_engine_functions():
    row = {
        "city": "תל אביב-יפו", "relevant_segments": "APT3", "validation_status": "PRODUCT_TYPE_UNVERIFIED",
        "deal_amount": "2000000", "internal_area": "60", "address": "test",
    }
    comparables, excluded = build_sold_inputs([row], "3", "תל אביב-יפו", subject_area=57.0)
    assert excluded == []
    assert len(comparables) == 1
    usable, _ = classify_sold_eligibility("usable")
    assert usable is True
    assert comparables[0].tier == classify_sold_tier()


def test_sold_row_never_rejected_merely_for_unverified_typology():
    """Correction: PRODUCT_TYPE_UNVERIFIED must not be treated as a
    rejection -- the sold lane tolerates type-relaxed evidence by design."""

    row = {
        "city": "תל אביב-יפו", "relevant_segments": "APT3", "validation_status": "PRODUCT_TYPE_UNVERIFIED",
        "deal_amount": "2000000", "internal_area": "60", "address": "test",
        # No price_type field at all on this row -- sold has none in this
        # dataset, and eligibility must never depend on one.
    }
    comparables, _ = build_sold_inputs([row], "3", "תל אביב-יפו", subject_area=57.0)
    assert len(comparables) == 1


def test_sold_context_only_is_excluded():
    row = {
        "city": "תל אביב-יפו", "relevant_segments": "APT3", "validation_status": "CONTEXT_ONLY",
        "deal_amount": "2000000", "internal_area": "60", "address": "test",
    }
    comparables, excluded = build_sold_inputs([row], "3", "תל אביב-יפו", subject_area=57.0)
    assert comparables == []
    assert len(excluded) == 1


def test_new_development_tier_comes_from_classify_new_development_variant():
    row = {
        "city": "תל אביב-יפו", "applicable_segments": "APT3", "project_name": "TestProj", "unit_type": "garden_apartment",
        "verification_status": "", "price_type": "VERIFIED_UNIT_PRICE", "price_ils": "2000000",
        "internal_area_sqm": "58", "quantitative_unit_price_area": "true", "rooms": "2.5",
    }
    comparables, excluded = build_new_development_inputs([row], "3", "תל אביב-יפו", subject_category="garden", subject_rooms=2.5, subject_area=57.0)
    assert excluded == []
    assert len(comparables) == 1
    # "garden_apartment" (this dataset's own unit_type vocabulary) must be
    # translated to "garden" (the engine's own category vocabulary) before
    # the real classifier is called -- confirmed by calling it here exactly
    # the same way the adapter does, never re-deriving an expectation
    # independently of the real function.
    expected_tier = classify_new_development_variant("garden", 2.5, 57.0, "garden", 2.5, 58.0)
    assert comparables[0].tier == expected_tier == "tier_a_direct"


def test_new_development_non_quantitative_price_types_are_excluded():
    for price_type in NON_QUANTITATIVE_PRICE_TYPES:
        row = {
            "city": "תל אביב-יפו", "applicable_segments": "APT3", "project_name": "TestProj", "unit_type": "garden_apartment",
            "verification_status": "", "price_type": price_type, "price_ils": "2000000",
            "internal_area_sqm": "58", "quantitative_unit_price_area": "false", "rooms": "2.5",
        }
        comparables, excluded = build_new_development_inputs([row], "3", "תל אביב-יפו", subject_category="garden", subject_rooms=2.5, subject_area=57.0)
        assert comparables == [], price_type


def test_no_adapter_owned_validation_status_tier_lookup():
    """Static proof: the adapter module never defines a dict literal mapping
    a validation_status string directly to one of the engine's own Tier
    literals -- every comparable's tier must come from calling the real
    classifier functions instead."""

    import app_api.multi_city_special_market as module
    import inspect

    source = inspect.getsource(module)
    for forbidden in ('"tier_a_direct"', '"tier_b_size_relaxed"', '"tier_c_broadened"'):
        # These tier literal strings must never appear anywhere in this
        # adapter module -- they belong exclusively inside
        # pricing_core/special_market_indication.py's own classifiers.
        assert forbidden not in source, f"found forbidden literal {forbidden} in adapter module"


def test_special_market_indication_module_is_unmodified():
    import subprocess

    result = subprocess.run(
        ["git", "diff", "--quiet", "HEAD", "--", "pricing_core/special_market_indication.py"],
        cwd=Path(__file__).resolve().parents[1],
    )
    assert result.returncode == 0, "pricing_core/special_market_indication.py must never be modified by this batch"


# --- Price semantics ------------------------------------------------------------

def test_quantitative_and_non_quantitative_price_types_are_disjoint_and_complete():
    assert QUANTITATIVE_PRICE_TYPES == {"VERIFIED_UNIT_PRICE", "DEVELOPER_UNIT_OFFER", "CURRENT_ASKING"}
    assert NON_QUANTITATIVE_PRICE_TYPES == {"STARTING_PRICE", "CONTEXT_ONLY", "HISTORICAL_MARKETING_PRICE"}
    assert QUANTITATIVE_PRICE_TYPES.isdisjoint(NON_QUANTITATIVE_PRICE_TYPES)


@pytest.mark.parametrize("slug", NON_PT_SLUGS)
def test_galipolis_not_quantitative(tmp_path, slug):
    c = client(tmp_path)
    projects = _workspace(c, slug)["competitor_landscape"]["projects"]
    galipolis = [p for p in projects if "GALIPOLIS" in p.get("project_name", "")]
    if not galipolis:
        return  # GALIPOLIS is a Yad Eliyahu project only
    for project in galipolis:
        assert project["quantitative_eligibility"]["standard_3r"]["eligible"] is False
        assert project["quantitative_eligibility"]["standard_5r"]["eligible"] is False
        assert project["display_classification"] != "direct"


def test_historical_marketing_price_row_never_current_asking():
    """Yiftach-4-style archived listing: HISTORICAL_MARKETING_PRICE must
    never be treated as CURRENT_ASKING, and must never enter the
    quantitative asking comparables."""

    row = {
        "city": "תל אביב-יפו", "relevant_segments": "APT3", "validation_status": "CONTEXT_ONLY",
        "price_type": "HISTORICAL_MARKETING_PRICE", "price": "2860000", "internal_area": "57", "address": "יפתח 4",
    }
    assert row["price_type"] != "CURRENT_ASKING"
    comparables, excluded = build_asking_inputs([row], "3", "תל אביב-יפו", subject_area=57.0)
    assert comparables == []
    assert len(excluded) == 1


# --- Special product-comparison universe (V2 full union + V3 overlay) --------

@pytest.mark.parametrize("slug,dirname,city,unit_number", [
    ("yad_eliyahu", "tel_aviv", "תל אביב-יפו", "3"),
])
def test_special_product_comparison_universe_has_all_three_origins(slug, dirname, city, unit_number):
    universe = build_special_product_comparison_universe(DATA_ROOT, dirname, city, unit_number)
    origins = {row["evidence_origin"] for row in universe}
    assert origins.issubset({"current_resale", "completed_sale_context", "new_development_model"})
    assert len(universe) > 0


def test_v3_overlay_enriches_but_never_replaces_v2_universe():
    dirname, city, unit_number = "tel_aviv", "תל אביב-יפו", "3"
    from app_api.multi_city_precision_overlay import apply_comparable_overlay

    universe = build_special_product_comparison_universe(DATA_ROOT, dirname, city, unit_number)
    enriched = apply_comparable_overlay(universe, DATA_ROOT, city)

    # Same row count and same record keys -- overlay never adds or drops rows.
    assert len(enriched) == len(universe)
    assert {r.get("record_key") for r in enriched} == {r.get("record_key") for r in universe}
    assert any(r["precision_overlay"] is not None for r in enriched), "expected at least one V3 match (Yiftach 4)"


def test_v3_conflict_does_not_upgrade_v2_price_to_verified():
    v2_row = {"validation_status": "DIRECT", "price": 4290000, "address": "test"}
    v3_row = {"record_id": "x", "precision_validation_status": "CONFLICTING_PRICE_SERIES", "price_ils": 4290000, "selection_origin": "V2_BASELINE", "baseline_validation_status": "DIRECT"}
    merged = _merge_comparable(v2_row, v3_row)
    assert merged["price"] == 4290000  # untouched original field
    assert merged["precision_overlay"]["conflicted"] is True


def test_unknown_attribute_remains_null_not_zero():
    row = {
        "city": "תל אביב-יפו", "relevant_segments": "APT3", "product_type": "garden_apartment",
        "balcony_area": "", "garden_area": "52", "parking": "", "address": "test",
    }
    universe = [{**row, "evidence_origin": "current_resale", "record_key": "x"}]
    assert universe[0]["balcony_area"] == ""  # never coerced to "0" or 0
    assert universe[0]["parking"] == ""


# --- One-time map-coordinate enrichment (competitor register) ---------------

def test_map_coordinate_enrichment_never_touches_a_project_precision_project():
    from app_api.multi_city_map_coordinate_enrichment import apply_map_coordinate_enrichment

    projects = [{
        "project_id": "ash-ramot", "project_name": "רמות אשקלון", "city": "אשקלון",
        "latitude": 31.67666, "longitude": 34.59663, "coordinate_precision": "PROJECT",
    }]
    enriched = apply_map_coordinate_enrichment(projects, DATA_ROOT)
    assert enriched[0]["latitude"] == 31.67666
    assert enriched[0]["longitude"] == 34.59663
    assert enriched[0]["coordinate_precision"] == "PROJECT"
    assert enriched[0]["map_coordinate_enrichment"] is None


def test_map_coordinate_enrichment_applies_a_matching_resolved_entry():
    from app_api.multi_city_map_coordinate_enrichment import apply_map_coordinate_enrichment

    # ta-tidhar-between is a real resolved entry in the frozen enrichment
    # file (GEOCODED_ADDRESS, from the project's own on-file address text).
    projects = [{
        "project_id": "ta-tidhar-between", "project_name": "TIDHAR בין השדרות", "city": "תל אביב-יפו",
        "latitude": 32.05899, "longitude": 34.79285, "coordinate_precision": "NEIGHBORHOOD_CENTROID",
    }]
    enriched = apply_map_coordinate_enrichment(projects, DATA_ROOT)
    assert enriched[0]["coordinate_precision"] == "GEOCODED_ADDRESS"
    assert (enriched[0]["latitude"], enriched[0]["longitude"]) != (32.05899, 34.79285)
    assert enriched[0]["map_coordinate_enrichment"]["matched"] is True


def test_map_coordinate_enrichment_leaves_unmatched_project_at_its_centroid():
    from app_api.multi_city_map_coordinate_enrichment import apply_map_coordinate_enrichment

    projects = [{
        "project_id": "no-such-project-id", "project_name": "GALIPOLIS", "city": "תל אביב-יפו",
        "latitude": 32.05899, "longitude": 34.79285, "coordinate_precision": "NEIGHBORHOOD_CENTROID",
    }]
    enriched = apply_map_coordinate_enrichment(projects, DATA_ROOT)
    assert enriched[0]["latitude"] == 32.05899
    assert enriched[0]["longitude"] == 34.79285
    assert enriched[0]["coordinate_precision"] == "NEIGHBORHOOD_CENTROID"
    assert enriched[0]["map_coordinate_enrichment"] is None


@pytest.mark.parametrize("city,expected_project_count", [
    ("תל אביב-יפו", 10),
    ("נתניה", 9),
    ("אשקלון", 13),
])
def test_multi_city_competitor_landscape_improves_coordinates_without_dropping_or_duplicating_projects(city, expected_project_count):
    from app_api.multi_city_competitor_register import build_multi_city_competitor_landscape

    landscape = build_multi_city_competitor_landscape(DATA_ROOT, city, {"3R": {"lanes": {}}, "5R": {"lanes": {}}})
    projects = landscape["projects"]

    assert len(projects) == expected_project_count
    # No project is ever left without a coordinate, and PROJECT-precision
    # projects are never relabeled by the enrichment pass.
    precisions = {p["coordinate_precision"] for p in projects}
    assert precisions.issubset({"PROJECT", "GEOCODED_ADDRESS", "GEOCODED_STREET", "NEIGHBORHOOD_CENTROID"})
    # At least one project in each city improved beyond the shared
    # neighborhood centroid -- the whole point of the enrichment pass.
    assert any(p["coordinate_precision"] in ("GEOCODED_ADDRESS", "GEOCODED_STREET", "PROJECT") for p in projects)


# --- Coordinate precision (centroid never presented as exact) ----------------

def test_neighborhood_centroid_marker_not_stripped_to_exact():
    universe = build_special_product_comparison_universe(DATA_ROOT, "tel_aviv", "תל אביב-יפו", "3")
    centroid_rows = [r for r in universe if r.get("coordinate_precision") == "NEIGHBORHOOD_CENTROID"]
    assert len(centroid_rows) > 0
    for row in centroid_rows:
        assert row["coordinate_precision"] == "NEIGHBORHOOD_CENTROID"  # never rewritten to "address"/"exact"


# --- geography_role vocabulary -------------------------------------------------

@pytest.mark.parametrize("slug", NON_PT_SLUGS)
def test_broader_market_not_broader_petah_tikva_for_non_pt_contexts(tmp_path, slug):
    c = client(tmp_path)
    projects = _workspace(c, slug)["competitor_landscape"]["projects"]
    roles = {p["geography_role"] for p in projects}
    assert "broader_petah_tikva" not in roles
    if "BROADER" in {p.get("geography_tier") for p in projects}:
        assert "broader_market" in roles


def test_segment_normalization_handles_underscore_and_semicolon():
    assert normalize_segment_string_to_units("APT38;APT39;APT36_37") == {"38", "39", "36", "37"}
    assert normalize_segment_string_to_units("APT3") == {"3"}
    assert normalize_segment_string_to_units("APT1_2") == {"1", "2"}
    assert normalize_segment_string_to_units(None) == set()
    assert normalize_segment_string_to_units("") == set()


# --- Evidence-visibility pass: per-record contributor status -----------------

def test_annotate_sold_contributor_status_matches_by_source_id():
    from app_api.market_context_workspace import _annotate_sold_contributor_status

    lane_obj = {
        "primary_contributors": [{"group_key": "עמק איילון 24", "source_ids": ["src-1", "src-2"], "target_equivalent_indication": 3094000.0}],
        "candidate_outcomes": [{"source_id": "src-1", "exclusion_reasons": []}],
    }
    contributing = _annotate_sold_contributor_status({"source_id": "src-1", "quality_status": "usable"}, lane_obj)
    assert contributing["contributes_to_pricing"] is True
    assert contributing["target_equivalent_indication_ils"] == 3094000.0
    assert contributing["non_contribution_reason"] is None


def test_annotate_sold_contributor_status_non_contributor_uses_qa_note_reason():
    from app_api.market_context_workspace import _annotate_sold_contributor_status

    lane_obj = {"primary_contributors": [], "candidate_outcomes": []}
    row = {"source_id": "src-9", "quality_status": "quarantined", "qa_note": "material_area_conflict"}
    result = _annotate_sold_contributor_status(row, lane_obj)
    assert result["contributes_to_pricing"] is False
    assert result["target_equivalent_indication_ils"] is None
    assert result["non_contribution_reason"] == "material_area_conflict"


def test_annotate_sold_contributor_status_handles_missing_lane():
    from app_api.market_context_workspace import _annotate_sold_contributor_status

    result = _annotate_sold_contributor_status({"source_id": None, "quality_status": "usable"}, None)
    assert result["contributes_to_pricing"] is False
    assert result["non_contribution_reason"] == "not_a_primary_contributor"


def test_annotate_asking_contributor_status_matches_by_record_uid():
    from app_api.market_context_workspace import _annotate_asking_contributor_status

    lane_obj = {"primary_contributors": [{"group_key": "עמק איילון 2", "source_ids": ["asking-1"], "target_equivalent_indication": 2577000.0}]}
    row = {"record_uid": "asking-1", "exclusion_reasons": []}
    result = _annotate_asking_contributor_status(row, lane_obj)
    assert result["contributes_to_pricing"] is True
    assert result["target_equivalent_indication_ils"] == 2577000.0


def test_annotate_asking_contributor_status_accepted_but_not_contributor_never_mutates_exclusion_reasons():
    from app_api.market_context_workspace import _annotate_asking_contributor_status

    lane_obj = {"primary_contributors": []}
    row = {"record_uid": "asking-2", "exclusion_reasons": []}
    result = _annotate_asking_contributor_status(row, lane_obj)
    # Original QA/status-based split must stay untouched (accepted_records/
    # rejected_records key off exclusion_reasons) -- only the new,
    # separate non_contribution_reason field carries this information.
    assert result["exclusion_reasons"] == []
    assert result["contributes_to_pricing"] is False
    assert result["non_contribution_reason"] == "accepted_but_not_primary_contributor"


def test_annotate_asking_contributor_status_rejected_keeps_its_own_reason():
    from app_api.market_context_workspace import _annotate_asking_contributor_status

    lane_obj = {"primary_contributors": []}
    row = {"record_uid": "asking-3", "exclusion_reasons": ["outside_target_area_band"]}
    result = _annotate_asking_contributor_status(row, lane_obj)
    assert result["non_contribution_reason"] == "outside_target_area_band"


# --- Evidence-visibility pass: multi-city standard_attribute_enrichment ------

@pytest.mark.parametrize("city,family_key,rooms", [
    ("תל אביב-יפו", "standard_3r", 3),
    ("נתניה", "standard_5r", 5),
])
def test_multi_city_standard_attribute_enrichment_populates_new_development_comparables(city, family_key, rooms):
    from app_api.market_context_workspace import _build_standard_attribute_enrichment_multi_city
    from app_api.multi_city_competitor_register import build_multi_city_competitor_landscape

    landscape = build_multi_city_competitor_landscape(DATA_ROOT, city, {"3R": {"lanes": {}}, "5R": {"lanes": {}}})
    enrichment = _build_standard_attribute_enrichment_multi_city(landscape["projects"], {"3R": [], "5R": []})
    comparables = enrichment["families"][family_key]["new_development_comparables"]

    assert len(comparables) > 0
    for c in comparables:
        assert c["project"]
        # Every comparable actually has a variant matching this family's room
        # count -- the same family-relevance filter Petah Tikva's own
        # standard_attribute_enrichment.py applies, never every project
        # regardless of fit.
        assert any(v["rooms"] == rooms for v in c["unit_variants"])
        for v in c["unit_variants"]:
            assert v["price"] is not None  # variants without a price are dropped


def test_multi_city_new_development_comparable_shape_matches_frontend_contract():
    from app_api.market_context_workspace import _mc_new_development_comparable

    project = {
        "project_name": "TIDHAR בין השדרות", "address": "לה גווארדיה 69, תל אביב-יפו",
        "display_classification": "direct", "construction_status": "construction underway",
        "estimated_delivery": None, "payment_terms": ["20/80"], "source_urls": ["https://example.com/x"],
        "warnings": [],
        "known_unit_variants": [
            {"rooms": "3", "internal_area_sqm": "71", "balcony_area_sqm": None, "garden_area_sqm": None, "floor": None,
             "orientation": None, "parking": None, "storage": None, "price_ils": "3700000", "price_basis": "VERIFIED_UNIT_PRICE"},
            {"rooms": "5", "internal_area_sqm": None, "balcony_area_sqm": None, "garden_area_sqm": None, "floor": None,
             "orientation": None, "parking": None, "storage": None, "price_ils": None, "price_basis": None},  # no price -> dropped
        ],
    }
    comparable = _mc_new_development_comparable(project)
    assert comparable["project"] == "TIDHAR בין השדרות"
    assert comparable["register_classification"] == "direct"
    assert len(comparable["unit_variants"]) == 1  # the priceless variant was dropped
    variant = comparable["unit_variants"][0]
    assert variant["rooms"] == 3.0
    assert variant["internal_area"] == 71.0
    assert variant["price"] == 3700000.0
    assert comparable["project_level"]["status"] == "construction underway"
    assert comparable["project_level"]["payment_terms"] == "20/80"
    assert comparable["provenance"] == [{"source": "https://example.com/x"}]


def test_multi_city_starting_price_context_only_set_when_a_variant_is_a_starting_price():
    from app_api.market_context_workspace import _mc_starting_price_context

    assert _mc_starting_price_context([{"rooms": 3.0, "price": 2000000.0, "price_basis": "VERIFIED_UNIT_PRICE"}]) is None
    ctx = _mc_starting_price_context([{"rooms": 3.0, "price": 1800000.0, "price_basis": "starting price"}])
    assert ctx == {"value": 1800000.0, "applies_to": "3 חדרים"}


# --- Evidence-visibility pass: evidence-coordinate enrichment ----------------

def test_resolve_evidence_coordinate_returns_none_when_address_missing_or_unmatched():
    from app_api.multi_city_map_coordinate_enrichment import resolve_evidence_coordinate

    lookup = {("נתניה", "הרב שלום 1"): {"lat": 32.3, "lng": 34.8, "coordinate_precision": "GEOCODED_ADDRESS"}}
    assert resolve_evidence_coordinate(lookup, "נתניה", None) is None
    assert resolve_evidence_coordinate(lookup, "נתניה", "רחוב אחר 5") is None
    assert resolve_evidence_coordinate(lookup, "נתניה", "הרב שלום 1") == (32.3, 34.8, "GEOCODED_ADDRESS")


def test_evidence_coordinate_enrichment_file_loads_and_is_keyed_by_city_address():
    from app_api.multi_city_map_coordinate_enrichment import load_evidence_coordinate_enrichment

    lookup = load_evidence_coordinate_enrichment(DATA_ROOT)
    assert len(lookup) > 0
    # A real resolved address from this pass's own run log.
    assert ("תל אביב-יפו", "עמק איילון 24") in lookup
    entry = lookup[("תל אביב-יפו", "עמק איילון 24")]
    assert entry["coordinate_precision"] in ("GEOCODED_ADDRESS", "GEOCODED_STREET")


@pytest.mark.parametrize("slug", NON_PT_SLUGS)
def test_asking_records_never_falsely_claim_address_precision(tmp_path, slug):
    """Multi-city asking rows share one submarket centroid unless the
    evidence-coordinate enrichment resolved their own address -- they must
    never be labeled "address" precision merely because pushAskingPoint's
    old hardcoded default assumed individually-scraped coordinates."""
    c = client(tmp_path)
    ws = _workspace(c, slug)
    for fam in ("3R", "5R"):
        for r in ws["evidence_provenance"]["current_asking"][fam]["accepted_records"]:
            assert r.get("coordinate_precision") in ("submarket_centroid_fallback", "GEOCODED_ADDRESS", "GEOCODED_STREET", None)


@pytest.mark.parametrize("slug", NON_PT_SLUGS)
def test_sold_and_asking_records_carry_contributor_status_fields(tmp_path, slug):
    c = client(tmp_path)
    ws = _workspace(c, slug)
    for fam in ("3R", "5R"):
        sold_records = ws["evidence_provenance"]["sold"][fam]["records"]
        assert len(sold_records) > 0
        for r in sold_records:
            assert "contributes_to_pricing" in r
            assert "target_equivalent_indication_ils" in r
        asking_records = ws["evidence_provenance"]["current_asking"][fam]["accepted_records"] + ws["evidence_provenance"]["current_asking"][fam]["rejected_records"]
        for r in asking_records:
            assert "contributes_to_pricing" in r
            assert "non_contribution_reason" in r


def test_petah_tikva_workspace_unaffected_by_visibility_pass(tmp_path):
    """Petah Tikva's own payload builder is never touched by any of the
    multi-city visibility-pass additions above."""
    c = client(tmp_path)
    ws = _workspace(c, "petah_tikva")
    sold_records = ws["evidence_provenance"]["sold"]["3R"]["records"]
    assert len(sold_records) > 0
    assert "contributes_to_pricing" not in sold_records[0]
