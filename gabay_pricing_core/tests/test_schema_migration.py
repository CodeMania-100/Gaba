"""Regression test for the Milestone 1 -> 1A schema upgrade.

Builds a SQLite database using the *exact* Milestone-1 (pre-1A) column set for every
table that later gained columns, by hand, via raw sqlite3 DDL -- deliberately not
using the current ORM models, since those already contain the 1A columns. This is
the only way to faithfully reproduce "a real, already-existing Milestone 1 database"
independent of how the models evolve from here.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app_api import create_app
from app_api.database import build_database
from app_api.migrations import apply_schema_migrations

FAMILY_3R = "standard_apartment|3r|69sqm"


def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")


# --- Milestone 1 (pre-1A) schema, frozen here on purpose ---------------------------

_MILESTONE_1_DDL = """
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    demo_key TEXT,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    neighborhood TEXT,
    address TEXT,
    latitude REAL,
    longitude REAL,
    location_source TEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);

CREATE TABLE inventory_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    source_filename TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    imported_at DATETIME NOT NULL
);

CREATE TABLE units (
    id TEXT PRIMARY KEY,
    inventory_version_id TEXT NOT NULL,
    unit_number TEXT NOT NULL,
    floor TEXT,
    rooms REAL,
    internal_area REAL,
    balcony_area REAL,
    orientation TEXT,
    parking INTEGER,
    storage INTEGER,
    unit_type TEXT,
    notes TEXT,
    source_row_numbers_json TEXT NOT NULL,
    derivation_reasons_json TEXT NOT NULL,
    raw_rows_json TEXT NOT NULL
);

CREATE TABLE market_snapshots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL,
    location_city TEXT NOT NULL,
    location_neighborhood TEXT,
    location_latitude REAL,
    location_longitude REAL,
    location_source TEXT,
    snapshot_created_at DATETIME NOT NULL,
    pricing_as_of TEXT NOT NULL,
    pricing_as_of_basis TEXT NOT NULL,
    pricing_as_of_excluded_sources_json TEXT NOT NULL,
    demo_disclaimer TEXT NOT NULL,
    created_at DATETIME NOT NULL
);

CREATE TABLE source_runs (
    id TEXT PRIMARY KEY,
    market_snapshot_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    lane TEXT NOT NULL,
    status TEXT NOT NULL,
    raw_count INTEGER NOT NULL,
    usable_count INTEGER NOT NULL,
    rejected_count INTEGER NOT NULL,
    source_filename TEXT,
    relative_source_path TEXT,
    sha256 TEXT,
    collected_at DATETIME,
    collected_at_basis TEXT,
    error_code TEXT,
    safe_error_message TEXT,
    started_at DATETIME NOT NULL,
    completed_at DATETIME
);

-- Deliberately missing comparable_attributes_json (added in 1A).
CREATE TABLE evidence_records (
    id TEXT PRIMARY KEY,
    market_snapshot_id TEXT NOT NULL,
    source_run_id TEXT NOT NULL,
    lane TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_record_id TEXT,
    quality_status TEXT NOT NULL,
    quality_reasons_json TEXT NOT NULL,
    address TEXT,
    price REAL,
    rooms REAL,
    area REAL,
    floor TEXT,
    event_date TEXT,
    neighborhood TEXT,
    project_name TEXT,
    distance_m REAL,
    raw_payload_json TEXT NOT NULL,
    normalized_payload_json TEXT
);

-- Deliberately missing internal_sale_plus_amount_ils / minimum_not_below_last_realized_sale.
CREATE TABLE strategy_profiles (
    id TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL,
    family_key TEXT NOT NULL,
    name TEXT NOT NULL,
    basis TEXT NOT NULL,
    range_position_pct REAL,
    competitor_reference_ils REAL,
    competitor_reference_source_id TEXT,
    competitor_reference_name TEXT,
    competitor_delta_ils REAL NOT NULL,
    negotiation_buffer_ils REAL NOT NULL,
    floor_rule_json TEXT,
    minimum_price_ils REAL,
    maximum_price_ils REAL,
    rationale TEXT NOT NULL,
    source TEXT NOT NULL,
    note TEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);

-- Deliberately missing project_state_snapshot_id.
CREATE TABLE pricing_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    inventory_version_id TEXT NOT NULL,
    market_snapshot_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at DATETIME NOT NULL
);

CREATE TABLE scenarios (
    id TEXT PRIMARY KEY,
    pricing_session_id TEXT NOT NULL,
    parent_scenario_id TEXT,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at DATETIME NOT NULL
);

CREATE TABLE unit_market_results (
    id TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL,
    unit_number TEXT NOT NULL,
    result_json TEXT NOT NULL,
    selection_trace_json TEXT NOT NULL,
    created_at DATETIME NOT NULL
);

CREATE TABLE unit_price_results (
    id TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL,
    unit_number TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at DATETIME NOT NULL
);

-- Deliberately missing non_priced_units_json.
CREATE TABLE scenario_pricing_runs (
    scenario_id TEXT PRIMARY KEY,
    plan_json TEXT NOT NULL,
    family_summaries_json TEXT NOT NULL,
    project_metrics_json TEXT NOT NULL,
    repriced_at DATETIME NOT NULL
);
"""


def _build_milestone_1_database(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(_MILESTONE_1_DDL)

        now = _now_str()

        conn.execute(
            "INSERT INTO projects (id, demo_key, name, city, neighborhood, address, latitude, longitude, "
            "location_source, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)",
            ("proj-1", "Legacy Project", "אשקלון", "עיר היין", now, now),
        )

        conn.execute(
            "INSERT INTO inventory_versions (id, project_id, version_number, source_filename, source_hash, "
            "status, imported_at) VALUES (?, ?, 1, ?, ?, 'complete', ?)",
            ("inv-1", "proj-1", "legacy.xlsx", "legacy-hash", now),
        )

        conn.execute(
            "INSERT INTO units (id, inventory_version_id, unit_number, floor, rooms, internal_area, "
            "balcony_area, orientation, parking, storage, unit_type, notes, source_row_numbers_json, "
            "derivation_reasons_json, raw_rows_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, '[]', '[]', '[]')",
            ("unit-1", "inv-1", "1", "4", 3, 69, 12, "מזרח", "standard_apartment"),
        )
        conn.execute(
            "INSERT INTO units (id, inventory_version_id, unit_number, floor, rooms, internal_area, "
            "balcony_area, orientation, parking, storage, unit_type, notes, source_row_numbers_json, "
            "derivation_reasons_json, raw_rows_json) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, '[]', '[]', '[]')",
            ("unit-2", "inv-1", "2", "קרקע", 3, 70.8, 100, "garden_apartment"),
        )

        conn.execute(
            "INSERT INTO market_snapshots (id, project_id, status, location_city, location_neighborhood, "
            "location_latitude, location_longitude, location_source, snapshot_created_at, pricing_as_of, "
            "pricing_as_of_basis, pricing_as_of_excluded_sources_json, demo_disclaimer, created_at) "
            "VALUES (?, ?, 'complete', ?, ?, ?, ?, 'legacy_test', ?, ?, 'legacy_test_basis', '[]', 'legacy demo disclaimer', ?)",
            ("snap-1", "proj-1", "אשקלון", "עיר היין", 31.68, 34.59, now, "2026-08-01", now),
        )

        conn.execute(
            "INSERT INTO source_runs (id, market_snapshot_id, source_key, lane, status, raw_count, "
            "usable_count, rejected_count, source_filename, relative_source_path, sha256, collected_at, "
            "collected_at_basis, error_code, safe_error_message, started_at, completed_at) "
            "VALUES (?, ?, 'madlan_listings', 'current_asking', 'success', 1, 1, 0, NULL, NULL, NULL, NULL, "
            "NULL, NULL, NULL, ?, ?)",
            ("run-1", "snap-1", now, now),
        )

        raw_listing = json.dumps({
            "id": "legacy-listing-1", "rooms": 3, "areaSqm": 69, "price": 1_500_000,
            "propertyType": "flat", "cityHebrew": "אשקלון", "neighbourhood": "עיר היין",
            "hasBalcony": True, "parking": 1, "floor": "4", "address": "Legacy St 1",
            "latitude": 31.68, "longitude": 34.59, "scrapedAt": "2026-08-01T00:00:00.000Z",
        }, ensure_ascii=False)
        conn.execute(
            "INSERT INTO evidence_records (id, market_snapshot_id, source_run_id, lane, source_type, "
            "source_record_id, quality_status, quality_reasons_json, address, price, rooms, area, floor, "
            "event_date, neighborhood, project_name, distance_m, raw_payload_json, normalized_payload_json) "
            "VALUES (?, ?, ?, 'current_asking', 'madlan_listings', 'legacy-listing-1', 'usable', '[]', "
            "'Legacy St 1', 1500000, 3, 69, '4', NULL, ?, NULL, 50.0, ?, NULL)",
            ("ev-1", "snap-1", "run-1", "עיר היין", raw_listing),
        )

        conn.execute(
            "INSERT INTO pricing_sessions (id, project_id, inventory_version_id, market_snapshot_id, "
            "status, created_at) VALUES (?, ?, ?, ?, 'draft', ?)",
            ("sess-1", "proj-1", "inv-1", "snap-1", now),
        )

        conn.execute(
            "INSERT INTO scenarios (id, pricing_session_id, parent_scenario_id, name, created_by, created_at) "
            "VALUES (?, ?, NULL, ?, 'legacy_user', ?)",
            ("scn-1", "sess-1", "Legacy Scenario", now),
        )

        conn.execute(
            "INSERT INTO strategy_profiles (id, scenario_id, family_key, name, basis, range_position_pct, "
            "competitor_reference_ils, competitor_reference_source_id, competitor_reference_name, "
            "competitor_delta_ils, negotiation_buffer_ils, floor_rule_json, minimum_price_ils, "
            "maximum_price_ils, rationale, source, note, created_at, updated_at) "
            "VALUES (?, ?, ?, 'legacy_50pct', 'market_range_position', 50.0, NULL, NULL, NULL, 0.0, 0.0, "
            "NULL, NULL, NULL, 'Legacy rationale recorded under Milestone 1.', 'marketing_input', NULL, ?, ?)",
            ("strat-1", "scn-1", FAMILY_3R, now, now),
        )

        # A previously-cached pricing run, proving old *cached* pricing data survives too.
        conn.execute(
            "INSERT INTO scenario_pricing_runs (scenario_id, plan_json, family_summaries_json, "
            "project_metrics_json, repriced_at) VALUES (?, '{}', '[]', '{}', ?)",
            ("scn-1", now),
        )

        conn.commit()
    finally:
        conn.close()


def _table_columns(db_path: Path, table: str) -> set[str]:
    conn = sqlite3.connect(db_path)
    try:
        return {row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')}
    finally:
        conn.close()


def _table_names(db_path: Path) -> set[str]:
    conn = sqlite3.connect(db_path)
    try:
        return {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    finally:
        conn.close()


def test_milestone_1_to_1a_migration_is_idempotent_and_preserves_data(tmp_path):
    db_path = tmp_path / "legacy.db"
    _build_milestone_1_database(db_path)

    # Sanity: the columns this whole test exists to add are genuinely absent first.
    assert "internal_sale_plus_amount_ils" not in _table_columns(db_path, "strategy_profiles")
    assert "project_state_snapshot_id" not in _table_columns(db_path, "pricing_sessions")
    assert "non_priced_units_json" not in _table_columns(db_path, "scenario_pricing_runs")
    assert "comparable_attributes_json" not in _table_columns(db_path, "evidence_records")
    assert "project_sales" not in _table_names(db_path)

    engine, SessionLocal = build_database(f"sqlite:///{db_path}")
    from app_api.database import Base
    Base.metadata.create_all(engine)  # creates the brand-new 1A tables only
    applied_first = apply_schema_migrations(engine)

    # 1) All expected columns were actually added.
    expected = {
        ("strategy_profiles", "internal_sale_plus_amount_ils"),
        ("strategy_profiles", "minimum_not_below_last_realized_sale"),
        ("pricing_sessions", "project_state_snapshot_id"),
        ("scenario_pricing_runs", "non_priced_units_json"),
        ("evidence_records", "comparable_attributes_json"),
    }
    assert expected.issubset({tuple(x.split(".")) for x in applied_first})

    # 2) New tables exist (created_all's job, confirmed here as part of the upgrade path).
    tables = _table_names(db_path)
    for new_table in ("unit_lifecycle_events", "project_sales", "project_state_snapshots", "project_state_units"):
        assert new_table in tables

    # 3) Old data is completely intact, and existing rows got safe defaults for the
    #    new NOT NULL columns rather than NULL or a crash.
    conn = sqlite3.connect(db_path)
    try:
        project = conn.execute("SELECT name, city FROM projects WHERE id='proj-1'").fetchone()
        assert project == ("Legacy Project", "אשקלון")

        unit_count = conn.execute("SELECT COUNT(*) FROM units WHERE inventory_version_id='inv-1'").fetchone()[0]
        assert unit_count == 2

        strat = conn.execute(
            "SELECT range_position_pct, rationale, internal_sale_plus_amount_ils, "
            "minimum_not_below_last_realized_sale FROM strategy_profiles WHERE id='strat-1'"
        ).fetchone()
        assert strat[0] == 50.0
        assert strat[1] == "Legacy rationale recorded under Milestone 1."
        assert strat[2] == 0.0
        assert strat[3] == 0

        session_row = conn.execute(
            "SELECT status, project_state_snapshot_id FROM pricing_sessions WHERE id='sess-1'"
        ).fetchone()
        assert session_row[0] == "draft"
        assert session_row[1] is None

        run_row = conn.execute(
            "SELECT non_priced_units_json FROM scenario_pricing_runs WHERE scenario_id='scn-1'"
        ).fetchone()
        assert run_row[0] == "[]"

        evidence_row = conn.execute(
            "SELECT address, comparable_attributes_json FROM evidence_records WHERE id='ev-1'"
        ).fetchone()
        assert evidence_row[0] == "Legacy St 1"
        assert evidence_row[1] is None
    finally:
        conn.close()

    # 4) The migrated database is fully usable through the real application: an old
    #    scenario reprices successfully (a legacy session with no project_state_snapshot
    #    treats every unit as available, matching pre-1A behavior exactly), and reading
    #    evidence for the pre-migration row (comparable_attributes_json = NULL) doesn't
    #    crash the new attribute-comparison code path.
    client = TestClient(create_app(f"sqlite:///{db_path}"))

    reprice = client.post("/api/v1/scenarios/scn-1/reprice")
    assert reprice.status_code == 200, reprice.text

    price_list = client.get("/api/v1/scenarios/scn-1/price-list").json()
    assert price_list["status"] == "priced"
    by_unit = {u["unit_number"]: u for u in price_list["units"]}
    assert by_unit["2"]["status"] == "manual_review"  # garden apartment, untouched by strategy
    assert by_unit["1"]["status"] not in ("sold", "reserved", "on_hold", "withdrawn")
    assert price_list["available_count"] == 2  # no state snapshot recorded -> both treated as available

    evidence = client.get("/api/v1/scenarios/scn-1/units/1/evidence").json()
    assert evidence["status"] == "priced"
    # The one pre-migration evidence row has no stored comparable attributes; the
    # endpoint must not crash and must report it as fully unknown, not guessed.
    listing_entries = [c for c in evidence["candidate_records"] if c["lane"] == "current_asking"]
    if listing_entries and listing_entries[0]["evidence"] is not None:
        comparison = {c["field"]: c["status"] for c in listing_entries[0]["attribute_comparison"]}
        assert comparison.get("balcony_present") == "UNKNOWN"

    # 5) Running the migration again is a true no-op.
    applied_second = apply_schema_migrations(engine)
    assert applied_second == []

    # And the database is still fully intact/functional afterward.
    price_list_again = client.get("/api/v1/scenarios/scn-1/price-list").json()
    assert price_list_again == price_list
