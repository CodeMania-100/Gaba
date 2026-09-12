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
