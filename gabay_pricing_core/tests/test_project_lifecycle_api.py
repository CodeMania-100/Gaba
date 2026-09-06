from pathlib import Path

from fastapi.testclient import TestClient

from app_api import create_app

REPO_ROOT = Path(__file__).resolve().parents[2]
REAL_XLSX = REPO_ROOT / "חוברת1.xlsx"

FAMILY_3R = "standard_apartment|3r|69sqm"
FAMILY_5R = "standard_apartment|5r|111.1sqm"


def client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(f"sqlite:///{tmp_path / 'lifecycle.db'}"))


def _set_family(c: TestClient, scenario_id: str, family_id: str, range_position_pct: float) -> None:
    r = c.put(
        f"/api/v1/scenarios/{scenario_id}/family-decisions/{family_id}",
        json={
            "name": f"engineering_test_{range_position_pct:g}pct",
            "basis": "market_range_position",
            "rationale": "Engineering validation only, not a Gabay strategy.",
            "range_position_pct": range_position_pct,
        },
    )
    assert r.status_code == 200, r.text


def _bootstrap_project(c: TestClient) -> tuple[dict, dict]:
    project = c.post("/api/v1/projects", json={"name": "Assignment Demo Project", "city": "אשקלון"}).json()
    with REAL_XLSX.open("rb") as f:
        imported = c.post(
            f"/api/v1/projects/{project['id']}/inventory/import-file",
            files={"file": ("חוברת1.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        ).json()
    snapshot = c.post(f"/api/v1/projects/{project['id']}/demo-market-snapshot").json()
    return project, {"inventory": imported, "snapshot": snapshot}


def _priced_family_count(price_list: dict, family: str) -> int:
    return sum(
        1 for u in price_list["units"]
        if u.get("family_key") == family and u.get("status") not in ("sold", "reserved", "on_hold", "withdrawn")
    )


def test_full_lifecycle_sale_new_review_and_frozen_old_session(tmp_path):
    assert REAL_XLSX.exists()
    c = client(tmp_path)
    project, ctx = _bootstrap_project(c)
    inventory, snapshot = ctx["inventory"], ctx["snapshot"]

    # --- Session A: the original 39-unit review, everything AVAILABLE -------------
    session_a = c.post("/api/v1/pricing-sessions", json={
        "project_id": project["id"],
        "inventory_version_id": inventory["id"],
        "market_snapshot_id": snapshot["id"],
    }).json()
    assert session_a["project_state_snapshot_id"] is not None  # auto-created

    scenario_a = c.post(f"/api/v1/pricing-sessions/{session_a['id']}/scenarios", json={"name": "Review September"}).json()
    _set_family(c, scenario_a["id"], FAMILY_3R, 50.0)
    _set_family(c, scenario_a["id"], FAMILY_5R, 50.0)
    c.post(f"/api/v1/scenarios/{scenario_a['id']}/reprice")

    price_list_a_before = c.get(f"/api/v1/scenarios/{scenario_a['id']}/price-list").json()
    assert price_list_a_before["available_count"] == 39
    assert price_list_a_before["sold_count"] == 0
    assert _priced_family_count(price_list_a_before, FAMILY_3R) == 24

    evidence_unit4_before = c.get(f"/api/v1/scenarios/{scenario_a['id']}/units/4/evidence").json()
    external_range_before = evidence_unit4_before["market_range"]["supported_range"]
    assert evidence_unit4_before["own_project_sales"] == []

    # --- Record a simulated sale for unit 17: engineering test data, not a real ----
    # --- Gabay transaction. --------------------------------------------------------
    sale = c.post(f"/api/v1/projects/{project['id']}/sales", json={
        "unit_number": "17",
        "contract_date": "2026-08-15",
        "contract_price_ils": 1_550_000,
        "source": "engineering_test",
        "note": "Simulated lifecycle event for backend milestone validation, not a real Gabay sale.",
    }).json()
    assert sale["unit_number"] == "17"
    assert sale["source"] == "engineering_test"

    # Duplicate sale is rejected.
    dup = c.post(f"/api/v1/projects/{project['id']}/sales", json={
        "unit_number": "17",
        "contract_date": "2026-08-16",
        "contract_price_ils": 1_600_000,
        "source": "engineering_test",
    })
    assert dup.status_code == 409

    # Generic lifecycle endpoint cannot create SOLD...
    bad_status = c.post(f"/api/v1/projects/{project['id']}/units/5/lifecycle-events", json={
        "status": "SOLD", "source": "engineering_test",
    })
    assert bad_status.status_code == 422

    # ...and cannot touch a unit that is already SOLD, for any requested status.
    already_sold = c.post(f"/api/v1/projects/{project['id']}/units/17/lifecycle-events", json={
        "status": "WITHDRAWN", "source": "engineering_test",
    })
    assert already_sold.status_code == 409

    # A legitimate lifecycle event for a different unit still works.
    reserved = c.post(f"/api/v1/projects/{project['id']}/units/7/lifecycle-events", json={
        "status": "RESERVED", "source": "engineering_test", "reason": "Simulated reservation for testing.",
    })
    assert reserved.status_code == 201

    # --- New state snapshot + new pricing review (session B) ----------------------
    state_snapshot_b = c.post(f"/api/v1/projects/{project['id']}/state-snapshots", json={
        "inventory_version_id": inventory["id"],
    }).json()
    statuses_b = {u["unit_number"]: u["status"] for u in state_snapshot_b["units"]}
    assert statuses_b["17"] == "SOLD"
    assert statuses_b["7"] == "RESERVED"
    assert statuses_b["4"] == "AVAILABLE"

    session_b = c.post("/api/v1/pricing-sessions", json={
        "project_id": project["id"],
        "inventory_version_id": inventory["id"],
        "market_snapshot_id": snapshot["id"],  # same market snapshot -- market did not move
        "project_state_snapshot_id": state_snapshot_b["id"],
    }).json()

    scenario_b = c.post(f"/api/v1/pricing-sessions/{session_b['id']}/scenarios", json={"name": "Review November"}).json()
    _set_family(c, scenario_b["id"], FAMILY_3R, 50.0)
    _set_family(c, scenario_b["id"], FAMILY_5R, 50.0)
    c.post(f"/api/v1/scenarios/{scenario_b['id']}/reprice")

    price_list_b = c.get(f"/api/v1/scenarios/{scenario_b['id']}/price-list").json()
    by_unit_b = {u["unit_number"]: u for u in price_list_b["units"]}

    # Unit 17 was not repriced; it is shown with its contract facts.
    assert by_unit_b["17"]["status"] == "sold"
    assert by_unit_b["17"]["contract_price_ils"] == 1_550_000
    assert by_unit_b["7"]["status"] == "reserved"

    # Remaining 3-room count fell 24 -> 23; reserved unit 7 is 5-room so untouched there.
    assert _priced_family_count(price_list_b, FAMILY_3R) == 23
    assert price_list_b["available_count"] == 37  # 39 - sold(1) - reserved(1)
    assert price_list_b["sold_count"] == 1
    assert price_list_b["reserved_count"] == 1

    # Realized vs available value are kept separate, never double-counted.
    assert price_list_b["realized_contract_value_ils"] == 1_550_000
    # Unit 17 is standard-3R: real sold/current-asking evidence lanes disagree on
    # price band (see test_pricing_workflow_api), so it has no proposed price in A
    # either -- its recorded SALE below is an explicit contract fact, independent of
    # (and unaffected by) that market-range disagreement.
    unit17_proposed_in_a = next(u for u in price_list_a_before["units"] if u["unit_number"] == "17")["proposed_list_price_ils"]
    assert unit17_proposed_in_a is None
    total_proposed_a = price_list_a_before["available_proposed_list_value_ils"]
    # Unit 7 (standard-5R, real priced 1,921,000) is excluded from B's available value
    # once reserved -- that alone drops B's available total below A's.
    assert price_list_b["available_proposed_list_value_ils"] < total_proposed_a

    # --- Unit 17 becomes own-project-sale evidence for other 3-room units ---------
    evidence_unit4_after = c.get(f"/api/v1/scenarios/{scenario_b['id']}/units/4/evidence").json()
    own_sale_units = {s["unit_number"] for s in evidence_unit4_after["own_project_sales"]}
    assert "17" in own_sale_units
    assert evidence_unit4_after["own_project_sales_summary"]["latest_sale"]["unit_number"] == "17"

    # External market evidence is untouched by the internal sale -- same range.
    assert evidence_unit4_after["market_range"]["supported_range"] == external_range_before

    # --- Old session (A) remains completely unchanged ------------------------------
    price_list_a_after = c.get(f"/api/v1/scenarios/{scenario_a['id']}/price-list").json()
    assert price_list_a_after == price_list_a_before
    by_unit_a_after = {u["unit_number"]: u for u in price_list_a_after["units"]}
    assert by_unit_a_after["17"]["status"] not in ("sold", "reserved", "on_hold", "withdrawn")
    assert price_list_a_after["available_count"] == 39

    evidence_unit4_a_after = c.get(f"/api/v1/scenarios/{scenario_a['id']}/units/4/evidence").json()
    assert evidence_unit4_a_after["own_project_sales"] == []

    # --- Session comparison distinguishes state change from strategy change -------
    compare_before_strategy_change = c.get("/api/v1/pricing-sessions/compare", params={
        "session_a": session_a["id"], "scenario_a": scenario_a["id"],
        "session_b": session_b["id"], "scenario_b": scenario_b["id"],
    }).json()
    assert compare_before_strategy_change["market_snapshot_changed"] is False
    assert "17" in compare_before_strategy_change["state_diff"]["newly_sold"]
    assert "7" in compare_before_strategy_change["state_diff"]["newly_reserved"]
    fam_row = next(f for f in compare_before_strategy_change["family_comparison"] if f["family_key"] == FAMILY_3R)
    assert fam_row["strategy_changed"] is False

    # --- Change strategy only in the new session, reprice, and confirm isolation ---
    _set_family(c, scenario_b["id"], FAMILY_3R, 75.0)
    c.post(f"/api/v1/scenarios/{scenario_b['id']}/reprice")

    price_list_a_final = c.get(f"/api/v1/scenarios/{scenario_a['id']}/price-list").json()
    assert price_list_a_final == price_list_a_before  # still completely unchanged

    compare_after_strategy_change = c.get("/api/v1/pricing-sessions/compare", params={
        "session_a": session_a["id"], "scenario_a": scenario_a["id"],
        "session_b": session_b["id"], "scenario_b": scenario_b["id"],
    }).json()
    fam_row_after = next(f for f in compare_after_strategy_change["family_comparison"] if f["family_key"] == FAMILY_3R)
    assert fam_row_after["strategy_changed"] is True
