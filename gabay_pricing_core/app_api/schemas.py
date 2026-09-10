from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    city: str = Field(min_length=1, max_length=120)
    neighborhood: str | None = None
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    location_source: str | None = None


class ProjectRead(ProjectCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime
    updated_at: datetime


class InventoryImport(BaseModel):
    source_filename: str = Field(min_length=1, max_length=255)
    matrix: list[list[Any]]


class ProjectStartRequest(BaseModel):
    """Generic (city, address) project-start request. Today only Petah Tikva
    (with no exact address -- the assignment never supplied one) resolves to
    a snapshot -- see app_api.project_launcher.

    address may legitimately be empty: the Petah Tikva demo's subject project
    has no real street address, so an empty string is the honest value, not
    a missing one -- min_length is intentionally 0 here (unlike city).

    inventory_fingerprint is the deterministic fingerprint returned by
    POST /api/v1/inventory/preview for the workbook the user just uploaded.
    It is optional (older clients simply skip the inventory-binding check)
    but when present it must match the fingerprint the matched snapshot was
    frozen from, or the request is reported unsupported rather than silently
    served against an unrelated inventory."""

    city: str = Field(min_length=1, max_length=255)
    address: str = Field(default="", max_length=255)
    inventory_fingerprint: str | None = None


class PetahTikvaScenarioRequest(BaseModel):
    """0=lower bound, 50=midpoint (the frozen baseline), 100=upper bound -- a
    position inside the already-supported market interval, not a statistical
    percentile. See pricing_core.strategy.StrategyProfile.range_position_pct."""

    range_position_pct: float = Field(ge=0, le=100)
    name: str | None = None


class UnitRead(BaseModel):
    unit_number: str
    floor: str | None
    rooms: float | None
    internal_area: float | None
    balcony_area: float | None
    orientation: str | None
    parking: int | None
    storage: bool | None
    unit_type: str | None
    notes: str | None
    source_row_numbers: list[int]
    derivation_reasons: list[str]


class InventoryVersionRead(BaseModel):
    id: str
    project_id: str
    version_number: int
    source_filename: str
    source_hash: str
    status: str
    imported_at: datetime
    reused_existing: bool = False
    units: list[UnitRead]


class PricingSessionCreate(BaseModel):
    project_id: str
    inventory_version_id: str
    market_snapshot_id: str
    # Optional: when omitted, the endpoint auto-creates a fresh state snapshot from
    # current commercial state (all AVAILABLE if no lifecycle events exist yet) and
    # persists its id -- the session is never left unpinned.
    project_state_snapshot_id: str | None = None


class PricingSessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    inventory_version_id: str
    market_snapshot_id: str
    project_state_snapshot_id: str | None
    status: str
    created_at: datetime


class ScenarioCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_scenario_id: str | None = None
    created_by: str = "current_user"


class ScenarioRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    pricing_session_id: str
    parent_scenario_id: str | None
    name: str
    created_by: str
    created_at: datetime


class FloorRuleInput(BaseModel):
    reference_floor: float
    amount_per_floor_ils: float
    source: str = "company_strategy_input"
    note: str | None = None


class FamilyDecisionUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    basis: str = "market_range_position"
    rationale: str = Field(min_length=1)
    range_position_pct: float | None = None
    competitor_reference_ils: float | None = None
    competitor_reference_source_id: str | None = None
    competitor_reference_name: str | None = None
    competitor_delta_ils: float = 0.0
    negotiation_buffer_ils: float = 0.0
    floor_rule: FloorRuleInput | None = None
    minimum_price_ils: float | None = None
    maximum_price_ils: float | None = None
    # For latest_own_project_sale_plus_amount only -- the "latest" reference itself is
    # always resolved by the engine, never typed manually.
    internal_sale_plus_amount_ils: float = 0.0
    # Optional modifier combinable with any basis.
    minimum_not_below_last_realized_sale: bool = False
    source: str = "marketing_input"
    note: str | None = None


class ProjectSaleCreate(BaseModel):
    unit_number: str = Field(min_length=1, max_length=80)
    contract_date: date
    contract_price_ils: float = Field(gt=0)
    list_price_at_sale_ils: float | None = None
    discount_ils: float | None = None
    payment_terms: dict[str, Any] | None = None
    concessions: dict[str, Any] | None = None
    # Never auto-derived from the fields above -- both or neither.
    effective_price_ils: float | None = None
    effective_price_basis: str | None = None
    source: str = Field(default="marketing_input", min_length=1)
    note: str | None = None


class ProjectSaleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    unit_number: str
    contract_date: str
    contract_price_ils: float
    list_price_at_sale_ils: float | None
    discount_ils: float | None
    effective_price_ils: float | None
    effective_price_basis: str | None
    source: str
    note: str | None
    created_at: datetime


class LifecycleEventCreate(BaseModel):
    status: str = Field(min_length=1, max_length=40)
    effective_at: datetime | None = None
    source: str = Field(default="marketing_input", min_length=1)
    reason: str | None = None


class StateSnapshotCreate(BaseModel):
    inventory_version_id: str
    as_of: datetime | None = None
