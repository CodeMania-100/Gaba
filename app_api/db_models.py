from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

# App-level source-run status strings (distinct from pricing_core.models.SourceRunStatus,
# which only covers the core's own smaller SoldTransaction ingestion model):
#   success     -- source parsed and ingested normally.
#   failed      -- a required or optional source file existed but errored while parsing.
#   unavailable -- an optional/secondary source file simply isn't present in this
#                  environment. Distinct from "failed" so the UI never confuses a
#                  missing supporting file with an actual processing error.


def _id() -> str:
    return str(uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ProjectRow(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    demo_key: Mapped[str | None] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    city: Mapped[str] = mapped_column(String(120), nullable=False)
    neighborhood: Mapped[str | None] = mapped_column(String(160))
    address: Mapped[str | None] = mapped_column(String(255))
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    location_source: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now, nullable=False)

    inventory_versions: Mapped[list["InventoryVersionRow"]] = relationship(back_populates="project")


class InventoryVersionRow(Base):
    __tablename__ = "inventory_versions"
    __table_args__ = (
        UniqueConstraint("project_id", "version_number", name="uq_inventory_project_version"),
        UniqueConstraint("project_id", "source_hash", name="uq_inventory_project_source_hash"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    source_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="complete", nullable=False)
    imported_at: Mapped[datetime] = mapped_column(default=_now, nullable=False)

    project: Mapped[ProjectRow] = relationship(back_populates="inventory_versions")
    units: Mapped[list["UnitRow"]] = relationship(back_populates="inventory_version", cascade="all, delete-orphan")


class UnitRow(Base):
    __tablename__ = "units"
    __table_args__ = (
        UniqueConstraint("inventory_version_id", "unit_number", name="uq_unit_inventory_number"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    inventory_version_id: Mapped[str] = mapped_column(ForeignKey("inventory_versions.id"), nullable=False, index=True)
    unit_number: Mapped[str] = mapped_column(String(80), nullable=False)
    floor: Mapped[str | None] = mapped_column(String(80))
    rooms: Mapped[float | None] = mapped_column(Float)
    internal_area: Mapped[float | None] = mapped_column(Float)
    balcony_area: Mapped[float | None] = mapped_column(Float)
    orientation: Mapped[str | None] = mapped_column(String(160))
    parking: Mapped[int | None] = mapped_column(Integer)
    storage: Mapped[int | None] = mapped_column(Integer)
    unit_type: Mapped[str | None] = mapped_column(String(80))
    notes: Mapped[str | None] = mapped_column(Text)
    source_row_numbers_json: Mapped[str] = mapped_column(Text, nullable=False)
    derivation_reasons_json: Mapped[str] = mapped_column(Text, nullable=False)
    raw_rows_json: Mapped[str] = mapped_column(Text, nullable=False)

    inventory_version: Mapped[InventoryVersionRow] = relationship(back_populates="units")


class MarketSnapshotRow(Base):
    """Immutable once created. See APPLICATION_CONTRACT.md."""

    __tablename__ = "market_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), default="complete", nullable=False)

    location_city: Mapped[str] = mapped_column(String(120), nullable=False)
    location_neighborhood: Mapped[str | None] = mapped_column(String(160))
    location_latitude: Mapped[float | None] = mapped_column(Float)
    location_longitude: Mapped[float | None] = mapped_column(Float)
    location_source: Mapped[str | None] = mapped_column(String(255))

    # Administrative: when this snapshot row was built. Never used for pricing math.
    snapshot_created_at: Mapped[datetime] = mapped_column(default=_now, nullable=False)

    # The date passed into build_market_range/build_comparable_set. Derived only from
    # real embedded collection timestamps of the primary sources actually used by the
    # pricing calculation -- see app_api/demo_snapshot.py.
    pricing_as_of: Mapped[str] = mapped_column(String(10), nullable=False)
    pricing_as_of_basis: Mapped[str] = mapped_column(Text, nullable=False)
    pricing_as_of_excluded_sources_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)

    demo_disclaimer: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=_now, nullable=False)

    project: Mapped[ProjectRow] = relationship()
    source_runs: Mapped[list["SourceRunRow"]] = relationship(
        back_populates="market_snapshot", cascade="all, delete-orphan"
    )
    evidence_records: Mapped[list["EvidenceRecordRow"]] = relationship(
        back_populates="market_snapshot", cascade="all, delete-orphan"
    )


class SourceRunRow(Base):
    __tablename__ = "source_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    market_snapshot_id: Mapped[str] = mapped_column(ForeignKey("market_snapshots.id"), nullable=False, index=True)
    source_key: Mapped[str] = mapped_column(String(80), nullable=False)
    lane: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False)  # success / failed / unavailable
    raw_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    usable_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rejected_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Portable provenance only -- never an absolute local filesystem path.
    source_filename: Mapped[str | None] = mapped_column(String(255))
    relative_source_path: Mapped[str | None] = mapped_column(String(255))
    sha256: Mapped[str | None] = mapped_column(String(64))

    collected_at: Mapped[datetime | None] = mapped_column()
    collected_at_basis: Mapped[str | None] = mapped_column(String(120))

    error_code: Mapped[str | None] = mapped_column(String(120))
    safe_error_message: Mapped[str | None] = mapped_column(Text)

    started_at: Mapped[datetime] = mapped_column(default=_now, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column()

    market_snapshot: Mapped[MarketSnapshotRow] = relationship(back_populates="source_runs")


class EvidenceRecordRow(Base):
    __tablename__ = "evidence_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    market_snapshot_id: Mapped[str] = mapped_column(ForeignKey("market_snapshots.id"), nullable=False, index=True)
    source_run_id: Mapped[str] = mapped_column(ForeignKey("source_runs.id"), nullable=False, index=True)
    lane: Mapped[str] = mapped_column(String(40), nullable=False, index=True)  # sold / current_asking / new_development / reference
    source_type: Mapped[str] = mapped_column(String(80), nullable=False)
    source_record_id: Mapped[str | None] = mapped_column(String(160), index=True)

    quality_status: Mapped[str] = mapped_column(String(40), default="usable", nullable=False)
    quality_reasons_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)

    # Canonical display fields, precomputed once (distance_m is fixed because the
    # project location is fixed per project).
    address: Mapped[str | None] = mapped_column(String(255))
    price: Mapped[float | None] = mapped_column(Float)
    rooms: Mapped[float | None] = mapped_column(Float)
    area: Mapped[float | None] = mapped_column(Float)
    floor: Mapped[str | None] = mapped_column(String(80))
    event_date: Mapped[str | None] = mapped_column(String(10))
    neighborhood: Mapped[str | None] = mapped_column(String(160))
    project_name: Mapped[str | None] = mapped_column(String(255))
    distance_m: Mapped[float | None] = mapped_column(Float)

    # Provenance vs. what the core actually consumed -- kept separate on purpose.
    raw_payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_payload_json: Mapped[str | None] = mapped_column(Text)

    # A pricing_core.comparison.ComparableAttributes-shaped dict, computed ONCE at
    # snapshot-ingestion time (see app_api/demo_snapshot.py). Evidence explanations
    # read this frozen value -- never re-derived from raw_payload_json with whatever
    # parsing logic happens to exist when the API is later called, so a future parser
    # change can never silently rewrite a historical evidence explanation.
    comparable_attributes_json: Mapped[str | None] = mapped_column(Text)

    market_snapshot: Mapped[MarketSnapshotRow] = relationship(back_populates="evidence_records")


class StrategyProfileRow(Base):
    __tablename__ = "strategy_profiles"
    __table_args__ = (
        UniqueConstraint("scenario_id", "family_key", name="uq_strategy_scenario_family"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id"), nullable=False, index=True)
    family_key: Mapped[str] = mapped_column(String(160), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    basis: Mapped[str] = mapped_column(String(40), nullable=False)
    range_position_pct: Mapped[float | None] = mapped_column(Float)
    competitor_reference_ils: Mapped[float | None] = mapped_column(Float)
    competitor_reference_source_id: Mapped[str | None] = mapped_column(String(160))
    competitor_reference_name: Mapped[str | None] = mapped_column(String(255))
    competitor_delta_ils: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    negotiation_buffer_ils: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    floor_rule_json: Mapped[str | None] = mapped_column(Text)
    minimum_price_ils: Mapped[float | None] = mapped_column(Float)
    maximum_price_ils: Mapped[float | None] = mapped_column(Float)
    internal_sale_plus_amount_ils: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    minimum_not_below_last_realized_sale: Mapped[bool] = mapped_column(default=False, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(80), default="marketing_input", nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now, nullable=False)

    scenario: Mapped["ScenarioRow"] = relationship(back_populates="family_decisions")


class PricingSessionRow(Base):
    __tablename__ = "pricing_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    inventory_version_id: Mapped[str] = mapped_column(ForeignKey("inventory_versions.id"), nullable=False)
    market_snapshot_id: Mapped[str] = mapped_column(ForeignKey("market_snapshots.id"), nullable=False)
    # Nullable only so an omitted value can be filled in by an auto-created snapshot
    # at creation time (see app_api.main.create_pricing_session) -- once set, this
    # session's pricing/evidence never resolve commercial state any other way.
    project_state_snapshot_id: Mapped[str | None] = mapped_column(ForeignKey("project_state_snapshots.id"))
    status: Mapped[str] = mapped_column(String(40), default="draft", nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=_now, nullable=False)

    scenarios: Mapped[list["ScenarioRow"]] = relationship(
        back_populates="pricing_session", cascade="all, delete-orphan"
    )


class ScenarioRow(Base):
    __tablename__ = "scenarios"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    pricing_session_id: Mapped[str] = mapped_column(ForeignKey("pricing_sessions.id"), nullable=False, index=True)
    parent_scenario_id: Mapped[str | None] = mapped_column(ForeignKey("scenarios.id"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by: Mapped[str] = mapped_column(String(120), default="current_user", nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=_now, nullable=False)

    pricing_session: Mapped[PricingSessionRow] = relationship(back_populates="scenarios")
    family_decisions: Mapped[list[StrategyProfileRow]] = relationship(
        back_populates="scenario", cascade="all, delete-orphan"
    )


class UnitMarketResultRow(Base):
    """Written only by POST /reprice. GET endpoints only ever read these."""

    __tablename__ = "unit_market_results"
    __table_args__ = (
        UniqueConstraint("scenario_id", "unit_number", name="uq_market_result_scenario_unit"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id"), nullable=False, index=True)
    unit_number: Mapped[str] = mapped_column(String(80), nullable=False)
    result_json: Mapped[str] = mapped_column(Text, nullable=False)
    selection_trace_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=_now, nullable=False)


class UnitPriceResultRow(Base):
    """Written only by POST /reprice. GET endpoints only ever read these."""

    __tablename__ = "unit_price_results"
    __table_args__ = (
        UniqueConstraint("scenario_id", "unit_number", name="uq_price_result_scenario_unit"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id"), nullable=False, index=True)
    unit_number: Mapped[str] = mapped_column(String(80), nullable=False)
    result_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=_now, nullable=False)


class ScenarioPricingRunRow(Base):
    """One row per scenario: the aggregate ProjectDecisionResult overview.

    Written only by POST /reprice, alongside the per-unit rows above. Its presence
    is exactly what makes GET /price-list, /families and /impact read-only.
    """

    __tablename__ = "scenario_pricing_runs"

    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id"), primary_key=True)
    plan_json: Mapped[str] = mapped_column(Text, nullable=False)
    family_summaries_json: Mapped[str] = mapped_column(Text, nullable=False)
    project_metrics_json: Mapped[str] = mapped_column(Text, nullable=False)
    # Units excluded from pricing this run because their session-scoped commercial
    # state was not AVAILABLE (sold/reserved/on_hold/withdrawn), with their status and
    # (for sold) contract facts -- so GET /price-list can merge them in without ever
    # computing or querying anything live.
    non_priced_units_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    repriced_at: Mapped[datetime] = mapped_column(default=_now, nullable=False)


class UnitLifecycleEventRow(Base):
    """Append-only. ``status`` may legitimately be SOLD here (written only by
    record_sale), but the generic lifecycle-events endpoint refuses to write SOLD
    itself and refuses to write anything at all once a unit has resolved to SOLD."""

    __tablename__ = "unit_lifecycle_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    unit_number: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    # The commercial/contractual date this event took effect -- kept distinct from
    # created_at (when the row was inserted) so state can be resolved as of any
    # historical point in time, not just "whatever is most recent right now".
    effective_at: Mapped[datetime] = mapped_column(nullable=False)
    source: Mapped[str] = mapped_column(String(80), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=_now, nullable=False)


class ProjectSaleRow(Base):
    """Written only by pricing_service.record_sale, atomically with a SOLD
    UnitLifecycleEventRow. SOLD is terminal for this milestone: at most one row may
    ever exist per (project_id, unit_number)."""

    __tablename__ = "project_sales"
    __table_args__ = (
        UniqueConstraint("project_id", "unit_number", name="uq_project_sale_unit"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    unit_number: Mapped[str] = mapped_column(String(80), nullable=False)

    contract_date: Mapped[str] = mapped_column(String(10), nullable=False)
    contract_price_ils: Mapped[float] = mapped_column(Float, nullable=False)

    list_price_at_sale_ils: Mapped[float | None] = mapped_column(Float)
    discount_ils: Mapped[float | None] = mapped_column(Float)

    payment_terms_json: Mapped[str | None] = mapped_column(Text)
    concessions_json: Mapped[str | None] = mapped_column(Text)

    # Never auto-derived from list_price_at_sale_ils/discount_ils/payment_terms_json.
    # Stays null unless a caller explicitly supplies both a value and its basis.
    effective_price_ils: Mapped[float | None] = mapped_column(Float)
    effective_price_basis: Mapped[str | None] = mapped_column(String(160))

    source: Mapped[str] = mapped_column(String(80), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=_now, nullable=False)


class ProjectStateSnapshotRow(Base):
    """Immutable once created -- the frozen commercial-state counterpart to
    MarketSnapshotRow. Every pricing session pins one of these; nothing pricing- or
    evidence-related for an existing session may resolve state any other way."""

    __tablename__ = "project_state_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    inventory_version_id: Mapped[str] = mapped_column(ForeignKey("inventory_versions.id"), nullable=False)
    as_of: Mapped[datetime] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=_now, nullable=False)

    units: Mapped[list["ProjectStateUnitRow"]] = relationship(
        back_populates="snapshot", cascade="all, delete-orphan"
    )


class ProjectStateUnitRow(Base):
    __tablename__ = "project_state_units"
    __table_args__ = (
        UniqueConstraint("project_state_snapshot_id", "unit_number", name="uq_state_unit_snapshot_number"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_id)
    project_state_snapshot_id: Mapped[str] = mapped_column(
        ForeignKey("project_state_snapshots.id"), nullable=False, index=True
    )
    unit_number: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    effective_at: Mapped[datetime | None] = mapped_column()
    project_sale_id: Mapped[str | None] = mapped_column(ForeignKey("project_sales.id"))

    snapshot: Mapped[ProjectStateSnapshotRow] = relationship(back_populates="units")
