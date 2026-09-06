from pathlib import Path

from fastapi.testclient import TestClient

from app_api import create_app

REPO_ROOT = Path(__file__).resolve().parents[2]
REAL_XLSX = REPO_ROOT / "חוברת1.xlsx"

FAMILY_3R = "standard_apartment|3r|69sqm"
FAMILY_5R = "standard_apartment|5r|111.1sqm"


def client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(f"sqlite:///{tmp_path / 'workflow.db'}"))


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


def test_full_vertical_slice_matches_checkpoint_numbers(tmp_path):
    assert REAL_XLSX.exists(), "expected the real חוברת1.xlsx at the repo root"
    c = client(tmp_path)

    project = c.post("/api/v1/projects", json={"name": "Assignment Demo Project", "city": "אשקלון"}).json()

    with REAL_XLSX.open("rb") as f:
        imported = c.post(
            f"/api/v1/projects/{project['id']}/inventory/import-file",
            files={"file": ("חוברת1.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        ).json()
    assert len(imported["units"]) == 39

    snapshot = c.post(f"/api/v1/projects/{project['id']}/demo-market-snapshot").json()
    assert snapshot["location"]["city"] == "אשקלון"
    assert snapshot["location"]["neighborhood"] == "עיר היין"
    required_sources = {
        r["source_key"]: r for r in snapshot["source_runs"]
        if r["source_key"].startswith(("govmap", "madlan", "tax_enriched_sold", "wine_city_sold"))
    }
    assert all(r["status"] == "success" for r in required_sources.values())
    assert snapshot["pricing_as_of_basis"].startswith("max_embedded_collection_timestamp_across_primary_sources")

    fetched_snapshot = c.get(f"/api/v1/market-snapshots/{snapshot['id']}").json()
    assert fetched_snapshot["id"] == snapshot["id"]

    session = c.post("/api/v1/pricing-sessions", json={
        "project_id": project["id"],
        "inventory_version_id": imported["id"],
        "market_snapshot_id": snapshot["id"],
    }).json()

    baseline = c.post(f"/api/v1/pricing-sessions/{session['id']}/scenarios", json={"name": "Baseline"}).json()

    # Read-only before repricing.
    not_priced = c.get(f"/api/v1/scenarios/{baseline['id']}/price-list").json()
    assert not_priced == {"status": "not_priced"}

    _set_family(c, baseline["id"], FAMILY_3R, 50.0)
    _set_family(c, baseline["id"], FAMILY_5R, 50.0)

    repriced = c.post(f"/api/v1/scenarios/{baseline['id']}/reprice").json()
    # The standard-3R sold lane now correctly requires 69m2 +-15% area relevance and a
    # verified local geographic scope (see pricing_core.geographic_scope). Under that
    # correction, the family's sold evidence (medium confidence, 6 independent
    # locations) and current-asking evidence disagree on price band, so the family
    # produces no single-lane consensus and cannot be auto-priced -- only the 5-room
    # family (8 units) is priced; the 7 special units remain manual_review as always.
    assert repriced["project_metrics"]["priced_unit_count"] == 8
    assert repriced["project_metrics"]["manual_review_count"] == 7

    price_list = c.get(f"/api/v1/scenarios/{baseline['id']}/price-list").json()
    assert price_list["status"] == "priced"
    assert len(price_list["units"]) == 39
    statuses = {u["unit_number"]: u["status"] for u in price_list["units"]}
    # Unit 17 is standard-3R; real evidence lanes disagree (see above), so it is
    # honestly reported as insufficient rather than forced into a fake price.
    assert statuses["17"] == "insufficient_evidence"
    assert statuses["7"] == "priced"  # standard-5R
    # Special units (garden/duplex/triplex) must never be auto-priced.
    special_count = sum(1 for u in price_list["units"] if u["status"] == "manual_review")
    assert special_count == 7

    families = c.get(f"/api/v1/scenarios/{baseline['id']}/families").json()
    assert families["status"] == "priced"

    # Unit 17 (standard-3R): real disagreement between independent evidence lanes is
    # surfaced, not hidden -- sold and current-asking do not overlap.
    evidence17 = c.get(f"/api/v1/scenarios/{baseline['id']}/units/17/evidence").json()
    assert evidence17["market_range"]["status"] == "no_consensus"
    assert evidence17["market_range"]["supported_range"]["lower"] is None
    assert evidence17["market_range"]["supported_range"]["upper"] is None
    assert evidence17["market_range"]["lanes"]["sold"]["confidence"] == "medium"
    included17 = [r for r in evidence17["candidate_records"] if r["included"]]
    assert included17, "unit 17 should have at least one included real evidence record"
    assert any(r["evidence"] is not None for r in included17)

    # Unit 7 (standard-5R, unaffected by the 3R routing correction) still gets a real
    # consensus range with real evidence.
    evidence7 = c.get(f"/api/v1/scenarios/{baseline['id']}/units/7/evidence").json()
    assert evidence7["status"] == "priced"
    assert evidence7["market_range"]["status"] == "consensus"
    assert evidence7["market_range"]["supported_range"]["lower"] == 1802000.0
    assert evidence7["market_range"]["supported_range"]["upper"] == 2040000.0
    included7 = [r for r in evidence7["candidate_records"] if r["included"]]
    assert included7, "unit 7 should have at least one included real evidence record"
    assert any(r["evidence"] is not None for r in included7)

    scenario2 = c.post(f"/api/v1/pricing-sessions/{session['id']}/scenarios", json={
        "name": "Higher 5-room positioning",
        "parent_scenario_id": baseline["id"],
    }).json()
    _set_family(c, scenario2["id"], FAMILY_5R, 90.0)
    c.post(f"/api/v1/scenarios/{scenario2['id']}/reprice")

    impact = c.get(f"/api/v1/scenarios/{scenario2['id']}/impact", params={"against": baseline["id"]}).json()
    assert impact["changed_unit_count"] == 8
    breakdown = impact["family_changed_breakdown"]
    assert breakdown[FAMILY_5R] == {"changed": 8, "unchanged": 0}
    # 3R stays unpriced (unchanged) in both scenarios; special units are untouched.
    assert breakdown[FAMILY_3R] == {"changed": 0, "unchanged": 24}
    special_unchanged = sum(
        bucket["unchanged"] for key, bucket in breakdown.items() if key not in {FAMILY_3R, FAMILY_5R}
    )
    assert special_unchanged == 7
