from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from typing import Any

from sqlalchemy import delete, select

from pricing_core import (
    ComparableAttributes,
    FloorRule,
    FamilyStrategyDecision,
    OwnProjectSaleRecord,
    PricingBasis,
    ProjectDecisionPlan,
    ProjectLocation,
    StrategyProfile,
    Unit,
    build_comparable_set,
    build_comparable_price_gap,
    build_market_range,
    compare_against_own_sales,
    compare_decision_scenarios,
    family_key,
    price_project_decision,
    summarize_own_project_sales,
)

from .db_models import (
    EvidenceRecordRow,
    MarketSnapshotRow,
    PricingSessionRow,
    ProjectSaleRow,
    ProjectStateSnapshotRow,
    ProjectStateUnitRow,
    ScenarioPricingRunRow,
    ScenarioRow,
    StrategyProfileRow,
    UnitLifecycleEventRow,
    UnitMarketResultRow,
    UnitPriceResultRow,
    UnitRow,
)
from .demo_snapshot import normalized_payload_to_qa_result

# The two sold sources that pricing_core.comparables actually knows how to route by
# room count in this demo, mirroring scripts/run_project_dry_run.py exactly.
SOLD_SOURCE_BY_ROOMS = {3: "govmap_sold_3room", 5: "govmap_sold_5room"}

AVAILABLE = "AVAILABLE"
GENERIC_LIFECYCLE_STATUSES = {"AVAILABLE", "RESERVED", "ON_HOLD", "WITHDRAWN"}


class NotPricedError(RuntimeError):
    pass


class DuplicateSaleError(RuntimeError):
    pass


class UnitAlreadySoldError(RuntimeError):
    pass


def load_units(db, inventory_version_id: str) -> list[Unit]:
    rows = db.scalars(select(UnitRow).where(UnitRow.inventory_version_id == inventory_version_id)).all()
    units = [
        Unit(
            unit_number=r.unit_number,
            floor=r.floor,
            rooms=r.rooms,
            internal_area=r.internal_area,
            balcony_area=r.balcony_area,
            orientation=r.orientation,
            parking=r.parking,
            storage=None if r.storage is None else bool(r.storage),
            unit_type=r.unit_type,
            notes=r.notes,
        )
        for r in rows
    ]
    units.sort(key=lambda u: _unit_sort_key(u.unit_number))
    return units


# --- commercial state: live (snapshot-building only) vs session-frozen -------------


def resolve_commercial_state(db, project_id: str, unit_numbers: list[str], as_of: datetime) -> dict[str, dict]:
    """The one temporal-resolution primitive. For each unit, considers only events
    with effective_at <= as_of and picks the max by (effective_at, created_at, id) --
    a deterministic tie-break when two events share an effective_at. Defaults to
    AVAILABLE when no qualifying event exists."""

    if not unit_numbers:
        return {}
    events = db.scalars(
        select(UnitLifecycleEventRow).where(
            UnitLifecycleEventRow.project_id == project_id,
            UnitLifecycleEventRow.unit_number.in_(unit_numbers),
            UnitLifecycleEventRow.effective_at <= as_of,
        )
    ).all()
    by_unit: dict[str, list[UnitLifecycleEventRow]] = {}
    for event in events:
        by_unit.setdefault(event.unit_number, []).append(event)

    result: dict[str, dict] = {}
    for unit_number in unit_numbers:
        rows = by_unit.get(unit_number)
        if not rows:
            result[unit_number] = {"status": AVAILABLE, "effective_at": None, "sale": None}
            continue
        latest = max(rows, key=lambda e: (e.effective_at, e.created_at, e.id))
        sale = None
        if latest.status == "SOLD":
            sale = db.scalar(
                select(ProjectSaleRow).where(
                    ProjectSaleRow.project_id == project_id, ProjectSaleRow.unit_number == unit_number
                )
            )
        result[unit_number] = {"status": latest.status, "effective_at": latest.effective_at, "sale": sale}
    return result


def current_commercial_state(db, project_id: str, unit_numbers: list[str]) -> dict[str, dict]:
    """Live. Used only to build a new snapshot -- never for pricing or evidence."""
    return resolve_commercial_state(db, project_id, unit_numbers, as_of=datetime.now(timezone.utc))


def create_state_snapshot(db, project_id: str, inventory_version_id: str, as_of: datetime | None = None) -> ProjectStateSnapshotRow:
    as_of = as_of or datetime.now(timezone.utc)
    unit_numbers = [u.unit_number for u in load_units(db, inventory_version_id)]
    state = resolve_commercial_state(db, project_id, unit_numbers, as_of)

    snapshot = ProjectStateSnapshotRow(project_id=project_id, inventory_version_id=inventory_version_id, as_of=as_of)
    db.add(snapshot)
    db.flush()
    for unit_number in unit_numbers:
        info = state[unit_number]
        db.add(ProjectStateUnitRow(
            project_state_snapshot_id=snapshot.id,
            unit_number=unit_number,
            status=info["status"],
            effective_at=info["effective_at"],
            project_sale_id=info["sale"].id if info["sale"] is not None else None,
        ))
    db.flush()
    return snapshot


def record_sale(db, project_id: str, payload: dict) -> ProjectSaleRow:
    """The only writer of ProjectSaleRow, and the only path that may ever write a
    SOLD lifecycle event. Atomic: both rows are added in the same flush."""

    unit_number = payload["unit_number"]
    existing = db.scalar(
        select(ProjectSaleRow).where(ProjectSaleRow.project_id == project_id, ProjectSaleRow.unit_number == unit_number)
    )
    if existing is not None:
        raise DuplicateSaleError(f"unit {unit_number} already has a recorded sale")

    contract_date: date = payload["contract_date"]
    source = payload.get("source") or "marketing_input"

    sale = ProjectSaleRow(
        project_id=project_id,
        unit_number=unit_number,
        contract_date=contract_date.isoformat(),
        contract_price_ils=payload["contract_price_ils"],
        list_price_at_sale_ils=payload.get("list_price_at_sale_ils"),
        discount_ils=payload.get("discount_ils"),
        payment_terms_json=json.dumps(payload["payment_terms"], ensure_ascii=False) if payload.get("payment_terms") is not None else None,
        concessions_json=json.dumps(payload["concessions"], ensure_ascii=False) if payload.get("concessions") is not None else None,
        effective_price_ils=payload.get("effective_price_ils"),
        effective_price_basis=payload.get("effective_price_basis"),
        source=source,
        note=payload.get("note"),
    )
    db.add(sale)
    db.flush()

    db.add(UnitLifecycleEventRow(
        project_id=project_id,
        unit_number=unit_number,
        status="SOLD",
        effective_at=datetime.combine(contract_date, time.min, tzinfo=timezone.utc),
        source=source,
        reason="own_project_sale_recorded",
    ))
    db.flush()
    return sale


def record_lifecycle_event(db, project_id: str, unit_number: str, payload: dict) -> UnitLifecycleEventRow:
    """SOLD is rejected here unconditionally, and nothing may be posted at all for a
    unit that has ever been sold -- SOLD is terminal from the moment it is recorded,
    regardless of whether its contract_date has "taken effect" yet relative to now.
    Checked against ProjectSaleRow existence directly (not temporal state resolution)
    so a future-dated contract cannot leave a terminal unit briefly editable."""

    if payload["status"] == "SOLD":
        raise ValueError("status=SOLD may only be created via POST /projects/{project_id}/sales")

    existing_sale = db.scalar(
        select(ProjectSaleRow).where(ProjectSaleRow.project_id == project_id, ProjectSaleRow.unit_number == unit_number)
    )
    if existing_sale is not None:
        raise UnitAlreadySoldError(f"unit {unit_number} is already sold; lifecycle is terminal")

    effective_at = payload.get("effective_at") or datetime.now(timezone.utc)
    event = UnitLifecycleEventRow(
        project_id=project_id,
        unit_number=unit_number,
        status=payload["status"],
        effective_at=effective_at,
        source=payload.get("source") or "marketing_input",
        reason=payload.get("reason"),
    )
    db.add(event)
    db.flush()
    return event


def _load_session_commercial_state(db, session: PricingSessionRow) -> dict[str, dict]:
    """The only function pricing/evidence code may use to resolve commercial state --
    scoped to this session's frozen snapshot, never live."""

    rows = db.scalars(
        select(ProjectStateUnitRow).where(ProjectStateUnitRow.project_state_snapshot_id == session.project_state_snapshot_id)
    ).all()
    result: dict[str, dict] = {}
    for row in rows:
        sale = db.get(ProjectSaleRow, row.project_sale_id) if row.project_sale_id else None
        result[row.unit_number] = {"status": row.status, "effective_at": row.effective_at, "sale": sale}
    return result


def _load_own_project_sales_for_session(db, session: PricingSessionRow) -> list[OwnProjectSaleRecord]:
    """Built exclusively from this session's frozen snapshot -- a sale recorded after
    the snapshot was taken can never appear here, regardless of when this is called."""

    units_by_number = {u.unit_number: u for u in load_units(db, session.inventory_version_id)}
    state = _load_session_commercial_state(db, session)

    records: list[OwnProjectSaleRecord] = []
    for unit_number, info in state.items():
        if info["status"] != "SOLD" or info["sale"] is None:
            continue
        unit = units_by_number.get(unit_number)
        if unit is None:
            continue
        sale = info["sale"]
        records.append(OwnProjectSaleRecord(
            unit_number=unit_number,
            family_key=family_key(unit),
            contract_date=date.fromisoformat(sale.contract_date),
            contract_price_ils=sale.contract_price_ils,
            floor=unit.floor,
            internal_area=unit.internal_area,
            balcony_area=unit.balcony_area,
            source=sale.source,
            recorded_at=sale.created_at,
        ))
    return records


def _non_priced_units_payload(db, session: PricingSessionRow) -> list[dict]:
    units_by_number = {u.unit_number: u for u in load_units(db, session.inventory_version_id)}
    state = _load_session_commercial_state(db, session)

    out: list[dict] = []
    for unit_number, info in state.items():
        if info["status"] == AVAILABLE:
            continue
        unit = units_by_number.get(unit_number)
        sale = info["sale"]
        out.append({
            "unit_number": unit_number,
            "status": info["status"].lower(),
            "floor": unit.floor if unit else None,
            "rooms": unit.rooms if unit else None,
            "internal_area": unit.internal_area if unit else None,
            "balcony_area": unit.balcony_area if unit else None,
            "unit_type": unit.unit_type if unit else None,
            "family_key": family_key(unit) if unit else None,
            "contract_price_ils": sale.contract_price_ils if sale else None,
            "contract_date": sale.contract_date if sale else None,
            "effective_at": info["effective_at"].isoformat() if info["effective_at"] else None,
        })
    return out


# --- pricing ------------------------------------------------------------------------


def build_unit_market_results(db, session: PricingSessionRow) -> list[tuple[Unit, Any, Any]]:
    """Returns (unit, MarketRangeResult, ComparableSet) triples for units whose
    session-scoped commercial state is AVAILABLE, replaying the exact sold-source
    routing logic from scripts/run_project_dry_run.py against the session's frozen
    market snapshot. Non-available units never reach build_comparable_set at all."""

    snapshot = db.get(MarketSnapshotRow, session.market_snapshot_id)
    units = load_units(db, session.inventory_version_id)
    state = _load_session_commercial_state(db, session)
    available_units = [u for u in units if state.get(u.unit_number, {"status": AVAILABLE})["status"] == AVAILABLE]

    location = ProjectLocation(
        city=snapshot.location_city,
        neighborhood=snapshot.location_neighborhood,
        latitude=snapshot.location_latitude,
        longitude=snapshot.location_longitude,
        source=snapshot.location_source,
    )
    as_of = date.fromisoformat(snapshot.pricing_as_of)

    sold_by_source = {
        source_key: _load_sold_qa_results(db, snapshot.id, source_key)
        for source_key in SOLD_SOURCE_BY_ROOMS.values()
    }
    madlan_listings = _load_madlan_listings(db, snapshot.id)
    madlan_projects = _load_madlan_projects(db, snapshot.id)

    triples: list[tuple[Unit, Any, Any]] = []
    for unit in available_units:
        source_key = SOLD_SOURCE_BY_ROOMS.get(int(unit.rooms)) if unit.rooms is not None else None
        if unit.unit_type == "standard_apartment" and source_key is not None:
            sold_records = sold_by_source[source_key]
            source_context = {
                "sold_query_scope": {
                    "city": snapshot.location_city,
                    "neighborhoods": [snapshot.location_neighborhood] if snapshot.location_neighborhood else [],
                    "rooms": [unit.rooms],
                    "source_file": source_key,
                }
            }
        else:
            sold_records = []
            source_context = {
                "sold_query_scope": {
                    "city": snapshot.location_city,
                    "neighborhoods": [],
                    "rooms": [unit.rooms] if unit.rooms is not None else [],
                    "note": "No scoped completed-sale source is available for this room count/unit type in the demo snapshot.",
                }
            }

        comps = build_comparable_set(
            unit, location, sold_records, madlan_listings, madlan_projects,
            as_of=as_of, source_context=source_context,
        )
        market = build_market_range(comps, as_of=as_of)
        triples.append((unit, market, comps))
    return triples


def build_decision_plan(db, scenario: ScenarioRow) -> ProjectDecisionPlan:
    rows = db.scalars(select(StrategyProfileRow).where(StrategyProfileRow.scenario_id == scenario.id)).all()
    decisions = [
        FamilyStrategyDecision(
            family_key=row.family_key,
            rationale=row.rationale,
            source=row.source,
            strategy=StrategyProfile(
                name=row.name,
                basis=PricingBasis(row.basis),
                range_position_pct=row.range_position_pct,
                competitor_reference_ils=row.competitor_reference_ils,
                competitor_reference_source_id=row.competitor_reference_source_id,
                competitor_reference_name=row.competitor_reference_name,
                competitor_delta_ils=row.competitor_delta_ils,
                negotiation_buffer_ils=row.negotiation_buffer_ils,
                floor_rule=FloorRule(**json.loads(row.floor_rule_json)) if row.floor_rule_json else None,
                minimum_price_ils=row.minimum_price_ils,
                maximum_price_ils=row.maximum_price_ils,
                internal_sale_plus_amount_ils=row.internal_sale_plus_amount_ils,
                minimum_not_below_last_realized_sale=row.minimum_not_below_last_realized_sale,
                source=row.source,
                note=row.note,
            ),
        )
        for row in rows
    ]
    return ProjectDecisionPlan(name=f"scenario:{scenario.name}", family_decisions=decisions, source="marketing_input")


def reprice_scenario(db, scenario: ScenarioRow):
    """The only function in this module that writes pricing results. GET endpoints
    only ever read what this persisted."""

    session = db.get(PricingSessionRow, scenario.pricing_session_id)
    triples = build_unit_market_results(db, session)
    own_sales = _load_own_project_sales_for_session(db, session)
    plan = build_decision_plan(db, scenario)
    pairs = [(unit, market) for unit, market, _comps in triples]
    result = price_project_decision(pairs, plan, own_project_sales=own_sales)

    db.execute(delete(UnitMarketResultRow).where(UnitMarketResultRow.scenario_id == scenario.id))
    db.execute(delete(UnitPriceResultRow).where(UnitPriceResultRow.scenario_id == scenario.id))
    db.execute(delete(ScenarioPricingRunRow).where(ScenarioPricingRunRow.scenario_id == scenario.id))
    db.flush()

    comps_by_unit = {unit.unit_number: comps for unit, _market, comps in triples}
    market_by_unit = {unit.unit_number: market for unit, market, _comps in triples}

    for unit_result in result.units:
        market = market_by_unit[unit_result.unit_number]
        comps = comps_by_unit[unit_result.unit_number]
        db.add(UnitMarketResultRow(
            scenario_id=scenario.id,
            unit_number=unit_result.unit_number,
            result_json=json.dumps(market.public_dict(), ensure_ascii=False),
            selection_trace_json=json.dumps([t.public_dict() for t in comps.selection_trace], ensure_ascii=False),
        ))
        db.add(UnitPriceResultRow(
            scenario_id=scenario.id,
            unit_number=unit_result.unit_number,
            result_json=json.dumps(unit_result.public_dict(), ensure_ascii=False),
        ))

    non_priced = _non_priced_units_payload(db, session)

    payload = result.public_dict()
    db.add(ScenarioPricingRunRow(
        scenario_id=scenario.id,
        plan_json=json.dumps(payload["plan"], ensure_ascii=False),
        family_summaries_json=json.dumps(payload["family_summaries"], ensure_ascii=False),
        project_metrics_json=json.dumps(payload["project_metrics"], ensure_ascii=False),
        non_priced_units_json=json.dumps(non_priced, ensure_ascii=False),
    ))
    db.flush()
    return result


def get_price_list(db, scenario: ScenarioRow) -> dict:
    """Strictly read-only: never computes or persists. Returns {'status': 'not_priced'}
    if POST /reprice has not run yet for this scenario."""

    run = db.get(ScenarioPricingRunRow, scenario.id)
    if run is None:
        return {"status": "not_priced"}

    session = db.get(PricingSessionRow, scenario.pricing_session_id)
    units_by_number = {u.unit_number: u for u in load_units(db, session.inventory_version_id)}

    price_rows = db.scalars(select(UnitPriceResultRow).where(UnitPriceResultRow.scenario_id == scenario.id)).all()
    rows = []
    available_value = 0.0
    for pr in price_rows:
        result = json.loads(pr.result_json)
        unit = units_by_number.get(pr.unit_number)
        rows.append({
            "unit_number": pr.unit_number,
            "floor": unit.floor if unit else None,
            "rooms": unit.rooms if unit else None,
            "internal_area": unit.internal_area if unit else None,
            "balcony_area": unit.balcony_area if unit else None,
            "unit_type": unit.unit_type if unit else None,
            **result,
        })
        if result.get("proposed_list_price_ils") is not None:
            available_value += float(result["proposed_list_price_ils"])

    non_priced = json.loads(run.non_priced_units_json)
    counts = {"sold_count": 0, "reserved_count": 0, "on_hold_count": 0, "withdrawn_count": 0}
    realized_value = 0.0
    for np_unit in non_priced:
        counts[f"{np_unit['status']}_count"] = counts.get(f"{np_unit['status']}_count", 0) + 1
        if np_unit["status"] == "sold" and np_unit.get("contract_price_ils") is not None:
            realized_value += float(np_unit["contract_price_ils"])
    rows.extend(non_priced)
    rows.sort(key=lambda r: _unit_sort_key(r["unit_number"]))

    return {
        "status": "priced",
        "repriced_at": run.repriced_at.isoformat(),
        "project_metrics": json.loads(run.project_metrics_json),
        "units": rows,
        # Deliberately not "project value"/"total": reserved/on_hold/withdrawn units
        # are excluded by construction, so the counts make coverage explicit.
        "realized_contract_value_ils": round(realized_value),
        "available_proposed_list_value_ils": round(available_value),
        "realized_plus_available_proposed_value_ils": round(realized_value + available_value),
        "available_count": len(price_rows),
        **counts,
    }


def get_families(db, scenario: ScenarioRow) -> dict:
    run = db.get(ScenarioPricingRunRow, scenario.id)
    if run is None:
        return {"status": "not_priced"}
    return {
        "status": "priced",
        "repriced_at": run.repriced_at.isoformat(),
        "family_summaries": json.loads(run.family_summaries_json),
    }


def unit_evidence_payload(db, scenario: ScenarioRow, unit_number: str) -> dict:
    session = db.get(PricingSessionRow, scenario.pricing_session_id)
    units_by_number = {u.unit_number: u for u in load_units(db, session.inventory_version_id)}
    unit = units_by_number.get(unit_number)
    if unit is None:
        return {"status": "unit_not_found"}

    session_state = _load_session_commercial_state(db, session)
    lifecycle = session_state.get(unit_number, {"status": AVAILABLE, "effective_at": None, "sale": None})

    if lifecycle["status"] != AVAILABLE:
        sale = lifecycle["sale"]
        return {
            "status": "not_available_this_session",
            "unit_number": unit_number,
            "lifecycle_status": lifecycle["status"].lower(),
            "contract_price_ils": sale.contract_price_ils if sale else None,
            "contract_date": sale.contract_date if sale else None,
        }

    market_row = db.scalar(
        select(UnitMarketResultRow).where(
            UnitMarketResultRow.scenario_id == scenario.id,
            UnitMarketResultRow.unit_number == unit_number,
        )
    )
    run = db.get(ScenarioPricingRunRow, scenario.id)
    if market_row is None or run is None:
        return {"status": "not_priced"}

    snapshot_id = session.market_snapshot_id
    trace = json.loads(market_row.selection_trace_json)
    market_dict = json.loads(market_row.result_json)

    area_norm_by_source_id: dict[str, float | None] = {}
    for lane_name in ("sold", "current_asking", "new_development"):
        for contrib in market_dict.get("lanes", {}).get(lane_name, {}).get("primary_contributors", []):
            for sid in contrib.get("source_ids", []):
                area_norm_by_source_id[sid] = contrib.get("area_normalized_indication_ils")

    price_row = db.scalar(
        select(UnitPriceResultRow).where(
            UnitPriceResultRow.scenario_id == scenario.id,
            UnitPriceResultRow.unit_number == unit_number,
        )
    )
    pricing = json.loads(price_row.result_json) if price_row else None
    proposed_price = pricing.get("proposed_list_price_ils") if pricing else None

    target_attributes = ComparableAttributes(
        rooms=unit.rooms,
        internal_area=unit.internal_area,
        floor=unit.floor,
        balcony_present=None if unit.balcony_area is None else unit.balcony_area > 0,
        balcony_area_sqm=unit.balcony_area,
        parking_present=None if unit.parking is None else unit.parking > 0,
        parking_count=unit.parking,
        storage_present=unit.storage,
        storage_area_sqm=None,
        orientation=unit.orientation,
        property_type=unit.unit_type,
        garden=None,
        special_type=None if unit.unit_type == "standard_apartment" else unit.unit_type,
    )

    evidence_by_key: dict[tuple[str, str | None], EvidenceRecordRow] = {}
    for row in db.scalars(
        select(EvidenceRecordRow).where(
            EvidenceRecordRow.market_snapshot_id == snapshot_id,
            EvidenceRecordRow.lane.in_(["sold", "current_asking", "new_development"]),
        )
    ).all():
        evidence_by_key[(row.lane, row.source_record_id)] = row

    candidate_records = []
    for t in trace:
        row = evidence_by_key.get((t["lane"], t["source_id"]))
        entry: dict[str, Any] = {
            "lane": t["lane"],
            "source": t["source"],
            "source_id": t["source_id"],
            "included": t["included"],
            "reasons": t["reasons"],
            "rank": t["rank"],
            "evidence": None,
            "attribute_comparison": None,
            "price_gap": None,
        }
        if row is not None:
            entry["evidence"] = _evidence_display(row)
            comparable_attrs = (
                ComparableAttributes(**json.loads(row.comparable_attributes_json))
                if row.comparable_attributes_json
                else ComparableAttributes()
            )
            gap = build_comparable_price_gap(
                lane=t["lane"],
                source_id=t["source_id"],
                target=target_attributes,
                comparable=comparable_attrs,
                observed_price_ils=row.price,
                area_normalized_indication_ils=area_norm_by_source_id.get(t["source_id"]),
                target_proposed_price_ils=proposed_price,
            )
            entry["attribute_comparison"] = [c.public_dict() for c in gap.attribute_comparison]
            entry["price_gap"] = gap.public_dict()
        candidate_records.append(entry)

    reference_records = [
        _evidence_display(row)
        for row in db.scalars(
            select(EvidenceRecordRow).where(
                EvidenceRecordRow.market_snapshot_id == snapshot_id,
                EvidenceRecordRow.lane == "reference",
            )
        ).all()
    ]

    fam_key = family_key(unit)
    own_sales = _load_own_project_sales_for_session(db, session)
    own_sales_for_family = [s for s in own_sales if s.family_key == fam_key]
    own_summary = summarize_own_project_sales(fam_key, own_sales)
    own_comparison = compare_against_own_sales(
        proposed_price,
        market_dict.get("supported_range", {}).get("lower"),
        market_dict.get("supported_range", {}).get("upper"),
        own_summary,
    )

    plan = json.loads(run.plan_json)
    active_strategy = next((d for d in plan.get("family_decisions", []) if d["family_key"] == fam_key), None)

    return {
        "status": "priced",
        "unit_number": unit_number,
        "lifecycle_status": "available",
        "market_range": market_dict,
        "pricing": pricing,
        "active_strategy": active_strategy,
        "candidate_records": candidate_records,
        "secondary_reference_records": reference_records,
        "own_project_sales": [s.public_dict() for s in own_sales_for_family],
        "own_project_sales_summary": own_summary.public_dict(),
        "own_sales_comparison": own_comparison.public_dict(),
    }


def impact_payload(db, scenario: ScenarioRow, against: ScenarioRow) -> dict:
    scenario_result = _load_result_stub(db, scenario)
    baseline_result = _load_result_stub(db, against)
    if scenario_result is None or baseline_result is None:
        return {"status": "not_priced"}

    impact = compare_decision_scenarios(baseline_result, scenario_result)
    payload = impact.public_dict()

    by_family: dict[str, dict[str, int]] = {}
    for u in payload["unit_impacts"]:
        family = u["family_key"] or "unknown"
        bucket = by_family.setdefault(family, {"changed": 0, "unchanged": 0})
        bucket["changed" if u["before_ils"] != u["after_ils"] else "unchanged"] += 1
    payload["family_changed_breakdown"] = by_family
    payload["status"] = "priced"
    return payload


def compare_pricing_sessions(
    db,
    session_a: PricingSessionRow,
    scenario_a: ScenarioRow,
    session_b: PricingSessionRow,
    scenario_b: ScenarioRow,
) -> dict:
    """Session-to-session comparison over time. Keeps 'the market changed' and 'the
    strategy changed' visible as separate facts -- never blended into one number."""

    run_a = db.get(ScenarioPricingRunRow, scenario_a.id)
    run_b = db.get(ScenarioPricingRunRow, scenario_b.id)
    if run_a is None or run_b is None:
        return {"status": "not_priced"}

    snapshot_a = db.get(MarketSnapshotRow, session_a.market_snapshot_id)
    snapshot_b = db.get(MarketSnapshotRow, session_b.market_snapshot_id)

    state_a = {
        r.unit_number: r.status
        for r in db.scalars(
            select(ProjectStateUnitRow).where(ProjectStateUnitRow.project_state_snapshot_id == session_a.project_state_snapshot_id)
        ).all()
    }
    state_b = {
        r.unit_number: r.status
        for r in db.scalars(
            select(ProjectStateUnitRow).where(ProjectStateUnitRow.project_state_snapshot_id == session_b.project_state_snapshot_id)
        ).all()
    }

    def _counts(state: dict[str, str]) -> dict[str, int]:
        out = {"available": 0, "sold": 0, "reserved": 0, "on_hold": 0, "withdrawn": 0}
        for status in state.values():
            key = status.lower()
            out[key] = out.get(key, 0) + 1
        return out

    state_diff = {
        "before_counts": _counts(state_a),
        "after_counts": _counts(state_b),
        "newly_sold": sorted(
            [u for u, s in state_b.items() if s == "SOLD" and state_a.get(u) != "SOLD"], key=_unit_sort_key
        ),
        "newly_reserved": sorted(
            [u for u, s in state_b.items() if s == "RESERVED" and state_a.get(u) != "RESERVED"], key=_unit_sort_key
        ),
    }

    families_a = {f["family_key"]: f for f in json.loads(run_a.family_summaries_json)}
    families_b = {f["family_key"]: f for f in json.loads(run_b.family_summaries_json)}
    plan_a = {d["family_key"]: d for d in json.loads(run_a.plan_json).get("family_decisions", [])}
    plan_b = {d["family_key"]: d for d in json.loads(run_b.plan_json).get("family_decisions", [])}

    family_rows = []
    for fam in sorted(set(families_a) | set(families_b)):
        fa, fb = families_a.get(fam), families_b.get(fam)
        da, db_ = plan_a.get(fam), plan_b.get(fam)
        strategy_changed = (da is None) != (db_ is None) or (
            da is not None and db_ is not None and (da["strategy"] != db_["strategy"] or da["rationale"] != db_["rationale"])
        )
        family_rows.append({
            "family_key": fam,
            "external_range_before_ils": fa.get("supported_range_envelope_ils") if fa else None,
            "external_range_after_ils": fb.get("supported_range_envelope_ils") if fb else None,
            "average_proposed_price_before_ils": fa.get("average_proposed_price_ils") if fa else None,
            "average_proposed_price_after_ils": fb.get("average_proposed_price_ils") if fb else None,
            "strategy_changed": strategy_changed,
        })

    metrics_a = json.loads(run_a.project_metrics_json)
    metrics_b = json.loads(run_b.project_metrics_json)

    return {
        "status": "priced",
        "market_snapshot_before": {"id": snapshot_a.id, "pricing_as_of": snapshot_a.pricing_as_of},
        "market_snapshot_after": {"id": snapshot_b.id, "pricing_as_of": snapshot_b.pricing_as_of},
        "market_snapshot_changed": snapshot_a.id != snapshot_b.id,
        "state_diff": state_diff,
        "family_comparison": family_rows,
        "remaining_list_value_before_ils": metrics_a.get("total_proposed_list_value_ils"),
        "remaining_list_value_after_ils": metrics_b.get("total_proposed_list_value_ils"),
    }


# --- internal helpers -------------------------------------------------------------


@dataclass
class _UnitStub:
    unit_number: str
    family_key: str
    proposed_list_price_ils: float | None
    requires_review: bool


@dataclass
class _FamilyStub:
    family_key: str
    total_proposed_list_value_ils: float
    average_proposed_price_ils: float | None


@dataclass
class _PlanStub:
    name: str


@dataclass
class _ResultStub:
    plan: _PlanStub
    units: list[_UnitStub]
    family_summaries: list[_FamilyStub]
    project_metrics: dict


def _load_result_stub(db, scenario: ScenarioRow) -> _ResultStub | None:
    """Adapts persisted pricing JSON back into the minimal shape
    pricing_core.decision.compare_decision_scenarios reads. This is pure
    deserialization, not a reimplementation of any decision/eligibility logic --
    the actual comparison arithmetic still runs inside pricing_core."""

    run = db.get(ScenarioPricingRunRow, scenario.id)
    if run is None:
        return None

    price_rows = db.scalars(select(UnitPriceResultRow).where(UnitPriceResultRow.scenario_id == scenario.id)).all()
    units = []
    for pr in price_rows:
        d = json.loads(pr.result_json)
        units.append(_UnitStub(
            unit_number=d["unit_number"],
            family_key=d["family_key"],
            proposed_list_price_ils=d["proposed_list_price_ils"],
            requires_review=d["requires_review"],
        ))

    families = [
        _FamilyStub(
            family_key=f["family_key"],
            total_proposed_list_value_ils=f["total_proposed_list_value_ils"],
            average_proposed_price_ils=f["average_proposed_price_ils"],
        )
        for f in json.loads(run.family_summaries_json)
    ]
    plan = _PlanStub(name=json.loads(run.plan_json)["name"])
    metrics = json.loads(run.project_metrics_json)
    return _ResultStub(plan=plan, units=units, family_summaries=families, project_metrics=metrics)


def _load_sold_qa_results(db, snapshot_id: str, source_type: str) -> list:
    rows = db.scalars(
        select(EvidenceRecordRow).where(
            EvidenceRecordRow.market_snapshot_id == snapshot_id,
            EvidenceRecordRow.source_type == source_type,
        )
    ).all()
    results = []
    for r in rows:
        raw = json.loads(r.raw_payload_json)
        normalized = json.loads(r.normalized_payload_json)
        results.append(normalized_payload_to_qa_result(normalized, raw, r.quality_status, json.loads(r.quality_reasons_json)))
    return results


def _load_madlan_listings(db, snapshot_id: str) -> list[dict]:
    rows = db.scalars(
        select(EvidenceRecordRow).where(
            EvidenceRecordRow.market_snapshot_id == snapshot_id,
            EvidenceRecordRow.source_type == "madlan_listings",
        )
    ).all()
    return [json.loads(r.raw_payload_json) for r in rows]


def _load_madlan_projects(db, snapshot_id: str) -> list[dict]:
    rows = db.scalars(
        select(EvidenceRecordRow).where(
            EvidenceRecordRow.market_snapshot_id == snapshot_id,
            EvidenceRecordRow.source_type == "madlan_projects",
        )
    ).all()
    seen: dict[Any, dict] = {}
    for r in rows:
        project = json.loads(r.raw_payload_json)
        seen[project.get("id")] = project
    return list(seen.values())


def _evidence_display(row: EvidenceRecordRow) -> dict:
    return {
        "id": row.id,
        "source_type": row.source_type,
        "source_record_id": row.source_record_id,
        "quality_status": row.quality_status,
        "quality_reasons": json.loads(row.quality_reasons_json),
        "address": row.address,
        "price": row.price,
        "rooms": row.rooms,
        "area": row.area,
        "floor": row.floor,
        "event_date": row.event_date,
        "neighborhood": row.neighborhood,
        "project_name": row.project_name,
        "distance_m": row.distance_m,
        "raw": json.loads(row.raw_payload_json),
    }


def _unit_sort_key(value: str) -> tuple[int, str]:
    try:
        return (0, f"{int(float(value)):09d}")
    except (TypeError, ValueError):
        return (1, str(value))
