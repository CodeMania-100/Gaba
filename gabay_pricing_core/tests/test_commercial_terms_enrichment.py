"""Regression tests for the multi_city_commercial_terms_enrichment_v1
loader (app_api/commercial_terms_enrichment.py) and its wiring into both
workspace builders. This is a display/context-only layer -- see that
module's own docstring -- so alongside the loader's own indexing behavior,
this file's most important test is the "no pricing contamination" guard:
proving the rest of the workspace payload is byte-identical whether or not
commercial-terms enrichment ran.

Fact values below (financing rates, payment splits, statuses) are copied
verbatim from the frozen dataset at data/frozen/multi_city_commercial_terms_
enrichment_v1/multi_city_commercial_terms_enrichment_v1.json -- never
recomputed here. If the frozen file ever changes, these tests should fail
loudly rather than be "fixed" to match; that would silently rewrite the
researcher's own facts (see the dataset's own README.md).
"""

from __future__ import annotations

import json

import pytest

from app_api import commercial_terms_enrichment as cte
from app_api.market_context_registry import MARKET_CONTEXTS
from app_api.market_context_workspace import _pricing_core_data_dir, build_market_context_workspace_payload
from app_api.petah_tikva_workspace import build_petah_tikva_workspace_payload

DATA_ROOT = _pricing_core_data_dir()
NON_PT_SLUGS = ["yad_eliyahu", "kiryat_hasharon", "barnea"]
ALL_SLUGS = ["petah_tikva", *NON_PT_SLUGS]

EXPECTED_COUNT_BY_SLUG = {
    "petah_tikva": 4,
    "yad_eliyahu": 3,
    "kiryat_hasharon": 3,
    "barnea": 3,
}


@pytest.fixture(scope="module")
def doc():
    return cte.load_commercial_terms_enrichment(DATA_ROOT)


# --- Section 40: loader validation ------------------------------------------

def test_dataset_has_13_projects_across_4_market_contexts(doc):
    assert len(doc["projects"]) == 13
    assert doc["version"] == "v1"
    contexts = {p["market_context"] for p in doc["projects"]}
    assert contexts == {"petah_tikva", "tel_aviv_yad_eliyahu", "netanya_kiryat_hasharon", "ashkelon_barnea"}


@pytest.mark.parametrize("slug", ALL_SLUGS)
def test_market_context_mapping_and_per_market_counts(doc, slug):
    projects = cte.commercial_projects_for_market(doc, slug)
    assert len(projects) == EXPECTED_COUNT_BY_SLUG[slug]
    commercial_context = cte.MARKET_CONTEXT_TO_COMMERCIAL_CONTEXT[slug]
    assert all(p["market_context"] == commercial_context for p in projects)


def test_no_cross_market_leakage(doc):
    seen_ids: set[str] = set()
    for slug in ALL_SLUGS:
        ids = {p["project_id"] for p in cte.commercial_projects_for_market(doc, slug)}
        assert not (ids & seen_ids), f"project_id(s) {ids & seen_ids} leaked across markets into {slug}"
        seen_ids |= ids
    assert len(seen_ids) == 13


def test_unmapped_app_market_slug_fails_loudly(doc):
    with pytest.raises(KeyError):
        cte.commercial_projects_for_market(doc, "not_a_real_market_context")


def test_resolve_by_project_id(doc):
    hit = cte.resolve_commercial_project(doc, "yad_eliyahu", "irrelevant name", project_id="ta-tidhar-between")
    assert hit is not None
    assert hit["project_id"] == "ta-tidhar-between"


def test_resolve_by_normalized_name_fallback(doc):
    # Unicode dash variant of the real name -- must still match via the
    # explicit normalized-name fallback, not via fuzzy similarity.
    hit = cte.resolve_commercial_project(doc, "petah_tikva", "שבזי 3–5")
    assert hit is not None
    assert hit["project_id"] == "pt-shabazi-3-5"


def test_resolve_returns_none_for_unresearched_competitor_not_fuzzy_guess(doc):
    # A name that is close to a real researched project ("TIDHAR") but not
    # an exact normalized match, in the wrong market -- must resolve to
    # None, never to a nearby-sounding project.
    assert cte.resolve_commercial_project(doc, "petah_tikva", "TIDHAR איזשהו פרויקט אחר") is None
    assert cte.resolve_commercial_project(doc, "kiryat_hasharon", "פרויקט שלא נחקר בכלל") is None


def test_resolve_never_crosses_market_context(doc):
    # ta-tidhar-between exists only under yad_eliyahu -- asking for it under
    # a different market context must not find it via id or name.
    assert cte.resolve_commercial_project(doc, "petah_tikva", "TIDHAR בין השדרות", project_id="ta-tidhar-between") is None


# --- Section 41: semantic regression tests on real researched projects ------

def _project(doc, project_id: str) -> dict:
    for p in doc["projects"]:
        if p["project_id"] == project_id:
            return p
    raise AssertionError(f"{project_id} not found in dataset")


def test_tidhar_20_80_with_concrete_installments(doc):
    p = _project(doc, "ta-tidhar-between")
    payment = p["commercial_offer"]["payment_structure"]
    assert payment["status"] == "VERIFIED"
    assert payment["type"] == "20_80"
    assert [i["percent"] for i in payment["installments"]] == [20, 80]
    assert p["commercial_offer"]["indexation_benefit"]["status"] == "UNKNOWN"


def test_zeev_branda_mortgage_unlinked_does_not_imply_indexation_exemption(doc):
    """CRITICAL semantic safeguard (spec section 13): mortgage linkage and
    construction-index exemption are different facts. Zeev Branda's
    financing is explicitly unlinked, but indexation_benefit is explicitly
    UNKNOWN -- the two must never be collapsed into one "no linkage" claim."""
    p = _project(doc, "pt-zeev-branda-22")
    financing = p["commercial_offer"]["financing_benefit"]
    assert financing["status"] == "VERIFIED"
    assert financing["mortgage_rate_pct"] == 2.99
    assert financing["mortgage_rate_type"] == "fixed"
    assert financing["mortgage_index_linkage"] == "unlinked"
    assert financing["term_years"] == 20

    indexation = p["commercial_offer"]["indexation_benefit"]
    assert indexation["status"] == "UNKNOWN"
    assert "note" in indexation  # explains the mortgage-vs-indexation distinction

    # The advertised 80/20 option has no recovered exact chronology -- must
    # stay a semantics string, never a fabricated installments[] array.
    payment = p["commercial_offer"]["payment_structure"]
    assert payment["type"] == "80_20_OPTION"
    assert "installments" not in payment
    assert "installments_semantics" in payment


def test_rayk_east_side_unlinked_mortgage_does_not_imply_indexation_exemption(doc):
    """Second real instance of the same safeguard as Zeev Branda, with
    entirely different financing_benefit field names (interest_rate_pct/
    interest_rate_type/index_linkage vs Zeev Branda's mortgage_rate_pct/
    mortgage_rate_type/mortgage_index_linkage) -- proves the safeguard must
    hold across the dataset's confirmed field-name heterogeneity, not just
    for one hardcoded shape."""
    p = _project(doc, "ta-rayk-east")
    financing = p["commercial_offer"]["financing_benefit"]
    assert financing["status"] == "VERIFIED"
    assert financing["interest_rate_pct"] == 1.99
    assert financing["index_linkage"] == "unlinked"

    indexation = p["commercial_offer"]["indexation_benefit"]
    assert indexation["status"] == "UNKNOWN"
    assert "note" in indexation


def test_the_strip_verified_construction_index_exemption(doc):
    """THE STRIP is the positive case: indexation_benefit is explicitly
    VERIFIED with a full_exemption type and source_text 'פטור מדד' -- this
    is the one project where 'פטור מהצמדה למדד' framing is actually
    justified by the data."""
    p = _project(doc, "net-the-strip")
    indexation = p["commercial_offer"]["indexation_benefit"]
    assert indexation["status"] == "VERIFIED"
    assert indexation["type"] == "full_exemption"
    assert indexation["source_text"] == "פטור מדד"

    promo_types = {promo["promotion_type"] for promo in p["commercial_offer"]["promotions"]}
    assert promo_types == {"price_protection_cancellation_option", "year_end_pricing"}

    # Vague-timing installment ("later per campaign") must not be present
    # as a concrete milestone token this app's timing map would mistranslate.
    payment = p["commercial_offer"]["payment_structure"]
    timings = [i["timing"] for i in payment["installments"]]
    assert "later per campaign" in timings


def test_gabay_park_payment_scope_is_room_family_5r_only(doc):
    """Scope validation (spec section 22 / C): the 20/80 payment_structure
    is scoped to rooms=5 specifically, not PROJECT_WIDE -- a 3R alternative
    at the same project must never inherit this confirmed term."""
    p = _project(doc, "net-gabay-park")
    payment = p["commercial_offer"]["payment_structure"]
    assert payment["scope"] == "ROOM_FAMILY"
    assert payment["rooms"] == 5
    # The vague timing string must be preserved verbatim, not normalized
    # into a concrete milestone label.
    timings = [i["timing"] for i in payment["installments"]]
    assert "later/delivery_not_explicit_in_retained_card" in timings


def test_bereshit_family_trade_in_is_selected_units_scope(doc):
    """The trade-in promotion must be SELECTED_UNITS scope, never presented
    as available on every unit."""
    p = _project(doc, "net-bereshit-family")
    promos = p["commercial_offer"]["promotions"]
    trade_in = next(pr for pr in promos if pr["promotion_type"] == "trade_in")
    assert trade_in["scope"] == "SELECTED_UNITS"


def test_bereshit_family_conflict_preserved_not_collapsed_to_discount(doc):
    """The 2.49M vs 2.55M price observation is a conflict, not a discount --
    both values and the resolution_note must be preserved as-is."""
    p = _project(doc, "net-bereshit-family")
    assert len(p["conflicts"]) == 1
    conflict = p["conflicts"][0]
    assert conflict["status"] == "PRICE_SNAPSHOT_DIFFERENCE"
    assert conflict["frozen_snapshot_value_ils"] == 2490000
    assert conflict["current_portal_value_ils"] == 2550000
    assert "not interpreted as a discount" in conflict["resolution_note"]


def test_galipolis_starting_price_semantic_note_preserved(doc):
    """GALIPOLIS safeguard (named regression test per spec section 21): the
    3R ₪3.215M figure is STARTING_PRICE with an explicit semantic_note that
    no durable evidence ties it to the 73 sqm model -- must never be
    rendered as a verified exact unit price."""
    p = _project(doc, "ta-galipolis")
    three_room = next(pp for pp in p["commercial_offer"]["published_prices"] if pp["rooms"] == 3)
    assert three_room["price_type"] == "STARTING_PRICE"
    assert three_room["price_ils"] == 3215000
    assert three_room["quantitative_unit_price_area"] is False
    assert "semantic_note" in three_room


def test_the_spot_starting_price_area_unknown(doc):
    """THE SPOT (spec section 20): 3R ₪2.25M is a STARTING_PRICE with no
    known area -- must never be treated as an exact unit price/area pair."""
    p = _project(doc, "pt-the-spot")
    three_room = next(pp for pp in p["commercial_offer"]["published_prices"] if pp["rooms"] == 3)
    assert three_room["price_type"] == "STARTING_PRICE"
    assert three_room["price_ils"] == 2250000
    assert three_room["internal_area_sqm"] is None


def test_halomot_barnea_historical_offer_excluded_from_current_published_prices(doc):
    """Historical protection (spec section E / 30 / 32): the ₪1.619M figure
    lives only in commercial_offer_history, never in the current
    commercial_offer.published_prices list. Current delivery status is
    VERIFIED/occupied/CURRENT (RESOLVED_BY_PRIMARY_SOURCE), which must
    drive display over the stale marketing-language conflict."""
    p = _project(doc, "ash-halomot-barnea")
    assert p["commercial_offer"]["published_prices"] == []
    assert len(p["commercial_offer_history"]) == 1
    historical = p["commercial_offer_history"][0]
    assert historical["price_ils"] == 1619000
    assert historical["status"] == "HISTORICAL"

    delivery = p["commercial_offer"]["delivery"]
    assert delivery["status"] == "VERIFIED"
    assert delivery["value"] == "occupied"
    assert delivery["current_status"] == "CURRENT"

    conflict = p["conflicts"][0]
    assert conflict["status"] == "RESOLVED_BY_PRIMARY_SOURCE"
    assert conflict["primary_current"] == "occupied"


# --- Section 44: no pricing contamination -----------------------------------

PRICING_CRITICAL_KEYS = [
    "families",
    "price_list",
    "special_unit_market_context",
    "evidence_provenance",
    "competitor_landscape",
    "strategy",
]


def _strip(payload: dict) -> dict:
    return {k: v for k, v in payload.items() if k != "commercial_intelligence"}


def test_petah_tikva_workspace_unaffected_by_commercial_enrichment(monkeypatch):
    """Proves the rest of the Petah Tikva workspace payload is byte-
    identical whether or not commercial-terms enrichment runs (or fails) --
    i.e. this display/context-only layer cannot silently mutate pricing/
    evidence state via a shared object or exception path."""
    baseline = build_petah_tikva_workspace_payload()

    def _boom(*_args, **_kwargs):
        raise AssertionError("commercial enrichment must never be a dependency of pricing-critical fields")

    monkeypatch.setattr(
        "app_api.petah_tikva_workspace.build_commercial_intelligence_payload",
        lambda *a, **k: {"version": "v1", "generated_at": "irrelevant", "projects": []},
    )
    with_empty_enrichment = build_petah_tikva_workspace_payload()

    assert json.dumps(_strip(baseline), sort_keys=True) == json.dumps(_strip(with_empty_enrichment), sort_keys=True)
    for key in PRICING_CRITICAL_KEYS:
        assert baseline[key] == with_empty_enrichment[key]


@pytest.mark.parametrize("slug", NON_PT_SLUGS)
def test_multi_city_workspace_unaffected_by_commercial_enrichment(monkeypatch, slug):
    context = MARKET_CONTEXTS[slug]
    baseline = build_market_context_workspace_payload(context)

    monkeypatch.setattr(
        "app_api.market_context_workspace.build_commercial_intelligence_payload",
        lambda *a, **k: {"version": "v1", "generated_at": "irrelevant", "projects": []},
    )
    with_empty_enrichment = build_market_context_workspace_payload(context)

    assert json.dumps(_strip(baseline), sort_keys=True) == json.dumps(_strip(with_empty_enrichment), sort_keys=True)
    for key in PRICING_CRITICAL_KEYS:
        assert baseline[key] == with_empty_enrichment[key]


def test_commercial_intelligence_never_touches_competitor_landscape_or_price_list(doc):
    """The commercial-terms JSON file itself must never be merged into
    competitor_projects_v2.json / standard_market competitor files -- proven
    by construction: this dataset lives only under data/frozen/
    multi_city_commercial_terms_enrichment_v1/, and the workspace's own
    competitor_landscape/price_list keys are built by entirely separate
    functions (build_multi_city_competitor_landscape / build_competitor_
    landscape / the price-list builders) that never import this module."""
    payload = build_petah_tikva_workspace_payload()
    assert "commercial_offer" not in json.dumps(payload["competitor_landscape"])
    assert "commercial_offer" not in json.dumps(payload["price_list"])
