const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface Project {
  id: string;
  name: string;
  city: string;
  neighborhood: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  location_source: string | null;
  created_at: string;
  updated_at: string;
}

export interface Unit {
  unit_number: string;
  floor: string | null;
  rooms: number | null;
  internal_area: number | null;
  balcony_area: number | null;
  orientation: string | null;
  parking: number | null;
  storage: boolean | null;
  unit_type: string | null;
  notes: string | null;
  source_row_numbers: number[];
  derivation_reasons: string[];
}

export interface InventoryVersion {
  id: string;
  project_id: string;
  version_number: number;
  source_filename: string;
  source_hash: string;
  status: string;
  imported_at: string;
  reused_existing: boolean;
  units: Unit[];
}

export interface SourceRun {
  source_key: string;
  lane: string;
  status: "success" | "failed" | "unavailable";
  raw_count: number;
  usable_count: number;
  rejected_count: number;
  source_filename: string | null;
  relative_source_path: string | null;
  sha256: string | null;
  collected_at: string | null;
  collected_at_basis: string | null;
  error_code: string | null;
  safe_error_message: string | null;
}

export interface MarketSnapshot {
  id: string;
  project_id: string;
  status: string;
  location: {
    city: string;
    neighborhood: string | null;
    latitude: number | null;
    longitude: number | null;
    source: string | null;
  };
  snapshot_created_at: string;
  pricing_as_of: string;
  pricing_as_of_basis: string;
  pricing_as_of_excluded_sources: { source_key: string; reason: string }[];
  demo_disclaimer: string;
  source_runs: SourceRun[];
}

export interface PricingSession {
  id: string;
  project_id: string;
  inventory_version_id: string;
  market_snapshot_id: string;
  status: string;
  created_at: string;
}

export interface Scenario {
  id: string;
  pricing_session_id: string;
  parent_scenario_id: string | null;
  name: string;
  created_by: string;
  created_at: string;
}

export interface FamilyDecisionInput {
  name: string;
  basis: "market_range_position" | "competitor_reference";
  rationale: string;
  range_position_pct?: number | null;
  competitor_reference_ils?: number | null;
  competitor_reference_source_id?: string | null;
  competitor_reference_name?: string | null;
  competitor_delta_ils?: number;
  negotiation_buffer_ils?: number;
  minimum_price_ils?: number | null;
  maximum_price_ils?: number | null;
  source?: string;
  note?: string | null;
}

// The heavier nested payloads mirror pricing_core's own public_dict() output
// directly (see gabay_pricing_core/pricing_core) rather than being re-typed here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonRecord = Record<string, any>;

// --- Petah Tikva demo workspace (frozen-artifact payload, GET-only) -----------
// Mirrors app_api/petah_tikva_workspace.py's build_petah_tikva_workspace_payload()
// output directly. The frontend never recomputes anything in here.

export interface PtkLaneRange {
  lane: string;
  confidence: "high" | "medium" | "low" | "insufficient";
  range: { lower: number | null; center: number | null; upper: number | null };
  primary_contributor_count: number;
  primary_contributors: JsonRecord[];
  reference_records: JsonRecord[];
  warnings: string[];
  methodology_notes: string[];
  can_enter_consensus: boolean;
}

export interface PtkFamily {
  family: "3R" | "5R";
  family_key: string;
  target: { family: string; rooms: number; internal_area: number; balcony_area: number };
  market: {
    status: string;
    confidence: "high" | "medium" | "low" | "insufficient";
    supported_lower: number | null;
    supported_upper: number | null;
    support_lanes: string[];
  };
  evidence_lanes: {
    sold: PtkLaneRange;
    current_asking: PtkLaneRange;
    new_development: PtkLaneRange;
  };
  strategy: {
    basis: string;
    name: string;
    range_position_pct: number | null;
    rationale: string;
    is_engineering_demo_baseline: boolean;
    is_gabay_commercial_strategy: boolean;
  };
  proposed_family_price_ils: number | null;
  total_family_list_value_ils: number;
  unit_count: number;
  priced_unit_count: number;
  review_unit_count: number;
  warnings: string[];
}

export interface PtkPriceListRow {
  unit_number: string;
  family: string; // "3R" | "5R" | special unit_type (garden_apartment/duplex/triplex)
  family_key: string | null; // null marks a special (non-standard-family) unit
  floor: string | number | null;
  // Present on special-unit rows (parsed straight from inventory); absent on
  // baseline standard rows (frozen doc predates this field) -- derive rooms
  // for those from the family ("3R"/"5R") instead of leaving it blank.
  rooms?: number | null;
  internal_area_sqm: number | null;
  balcony_area_sqm: number | null;
  orientation: string | null;
  parking?: number | null;
  storage?: boolean | null;
  market_range: { lower: number | null; upper: number | null; confidence: string } | null;
  strategy_basis: string | null;
  commercial_base_price_ils: number | null;
  adjustments: { kind: string; amount_ils: number; source: string; explanation: string }[];
  proposed_list_price_ils: number | null;
  // Present on scenario price-list rows only: the frozen 50% baseline price for
  // the same unit, so a scenario can be shown alongside it without recomputing.
  baseline_price_ils?: number | null;
  status: string; // "priced" | "manual_special_pricing_pending" | ...
  requires_review: boolean;
  warnings: string[];
  explanation: string[];
  override: JsonRecord | null;
  locked: boolean;
}

export interface PtkScenarioFamily {
  family: "3R" | "5R";
  family_key: string;
  proposed_family_price_ils: number | null;
  baseline_proposed_family_price_ils: number | null;
  total_family_list_value_ils: number;
  baseline_total_family_list_value_ils: number;
  unit_count: number;
}

export interface PetahTikvaScenario {
  version: string;
  scenario_name: string;
  range_position_pct: number;
  is_baseline_position: boolean;
  strategy_disclaimer: string;
  families: PtkScenarioFamily[];
  price_list: PtkPriceListRow[];
  total_standard_unit_revenue_ils: number;
  comparison: {
    baseline_total_standard_unit_revenue_ils: number;
    scenario_total_standard_unit_revenue_ils: number;
    delta_ils: number;
    delta_pct: number | null;
    units_changed_count: number;
  };
  impact: JsonRecord;
}

// One project from the competitor register (see app_api/competitor_register.py
// build_competitor_landscape) -- a full passthrough of the frozen seed's
// per-project record plus a computed display_classification, so field
// presence/absence here always mirrors the seed file exactly. Loosely typed
// (JsonRecord) rather than exhaustively re-typed: fields legitimately vary
// per project (null vs an object with status/value, optional keys like
// elevator/view/project_price_from_ils), and the UI must already handle
// "field absent or null" for every one of them.
export type CompetitorRegisterProject = JsonRecord & {
  project_name: string;
  geography_role: "core_exact_target" | "adjacent_submarket" | "broader_petah_tikva";
  display_classification: "direct" | "relevant" | "context";
  relevance: string[];
  quantitative_eligibility: Record<string, { eligible: boolean; reason: string }>;
};

export interface CompetitorLandscape {
  version: string;
  market: { city: string; target_submarket: string; subject_address: string | null; subject_location_note: string };
  usage_rules: JsonRecord;
  project_count: number;
  classification_counts: { direct: number; relevant: number; context: number };
  geography_counts: Record<string, number>;
  relevance_counts: { standard_3r: number; standard_5r: number; garden: number; duplex_or_premium: number };
  quantitative_headline: Record<"3R" | "5R", { researched_project_count: number; strict_contributor_count: number }>;
  projects: CompetitorRegisterProject[];
}

// Standard 3R/5R decision-support enrichment (see app_api/standard_attribute_
// enrichment.py). Research/attribute data only -- never a pricing authority.
// Loosely typed: every field may legitimately be null/absent, and the UI
// must already handle that for each one individually.
export interface StandardAttributeEnrichmentFamily {
  subject_reference: JsonRecord;
  current_asking_comparables: JsonRecord[];
  new_development_comparables: JsonRecord[];
  matched_observations: Record<string, JsonRecord[]>;
  floor_observations: JsonRecord[];
  research_gaps: string[];
}

export interface StandardAttributeEnrichment {
  version: string;
  retrieved_at: string;
  scope: string;
  methodology_guards: string[];
  existing_standard_universe_context: JsonRecord;
  new_development_floor_pair_search: JsonRecord;
  families: { standard_3r: StandardAttributeEnrichmentFamily; standard_5r: StandardAttributeEnrichmentFamily };
}

// Special-unit (garden/duplex/triplex) research context, sourced from
// data/frozen/special_unit_master_data_v1.json (curated_special_review +
// expanded_market_evidence) -- see app_api/special_unit_context.py.
// Presentation only -- no price/range is computed from it. Kept as a fully
// separate payload branch from StandardAttributeEnrichment: nothing here is
// ever read by, or merged into, the standard 3R/5R pipeline.
export interface SpecialUnitFamilyAnchorContext {
  label: string; // always "עוגן שוק למשפחה — להקשר בלבד"
  family: "3R" | "5R";
  supported_lower: number | null;
  supported_upper: number | null;
  confidence: string;
}

// One already-tiered, already-priced comparable feeding (or shown as
// context for) a special-unit market-indication lane -- see pricing_core/
// special_market_indication.py. area_diff_pct is not sent by the backend
// (it is a Python @property, not a dataclass field); compute it on the
// frontend as (comparable_area_sqm - subject_area_sqm) / subject_area_sqm.
export interface SpecialUnitComparable {
  lane: "sold" | "current_asking" | "new_development";
  tier: "tier_a_direct" | "tier_b_size_relaxed" | "tier_c_broadened";
  label: string;
  comparable_price_ils: number;
  comparable_area_sqm: number;
  subject_area_sqm: number;
  normalized_value_ils: number;
  note: string;
  raw: JsonRecord;
}

export interface SpecialUnitExcludedRecord {
  lane: "sold" | "current_asking" | "new_development";
  label: string;
  reason: string;
  raw: JsonRecord;
}

export interface SpecialUnitLaneResult {
  lane: "sold" | "current_asking" | "new_development";
  calculation_method: "area_normalized_median" | "raw_price_median";
  comps_used: SpecialUnitComparable[];
  comps_context_only: SpecialUnitComparable[];
  reference_ils: number;
  is_provisional: boolean;
  is_direct_quality: boolean;
  label: string;
}

// Deterministic special-unit suggested price/range/confidence (see
// pricing_core/special_market_indication.py). Fully separate from the
// standard 3R/5R market range -- never compare or merge the two.
export interface SpecialUnitIndication {
  unit_number: string;
  category: "garden" | "duplex" | "triplex";
  subject_internal_area_sqm: number;
  lanes: Partial<Record<"sold" | "current_asking" | "new_development", SpecialUnitLaneResult>>;
  voting_lane_names: string[];
  excluded: SpecialUnitExcludedRecord[];
  suggested_price_ils: number | null;
  indicative_lower_ils: number | null;
  indicative_upper_ils: number | null;
  confidence: "high" | "medium" | "low";
  confidence_reason: string;
}

export interface SpecialUnitContext {
  category: "garden" | "duplex" | "triplex";
  route: string;
  direct_comparables: JsonRecord[];
  broadened_comparables: JsonRecord[];
  sold_selected: JsonRecord[];
  sold_rejected: JsonRecord[];
  sold_evidence_gap: string | null;
  direct_sold_triplex_count: number | null;
  sold_context_additions: JsonRecord[];
  qa_flags: JsonRecord[];
  // Read-only, contextual only -- must never be treated as a special-unit
  // comparable or used to derive a premium (see task's separation rule).
  family_anchor_context: SpecialUnitFamilyAnchorContext | null;
  market_indication: SpecialUnitIndication | null;
  // Supplemental first-researcher context/provenance records relevant to
  // this unit (see app_api/first_researcher_context.py). Always
  // numeric_eligibility: false -- display only, never a pricing input, and
  // never read by pricing_core.special_market_indication.
  first_researcher_context: JsonRecord[];
}

export interface SpecialUnitMarketContext {
  available: boolean;
  version?: string;
  source?: string;
  implementation_invariants?: string[];
  direct_triplex_status?: JsonRecord;
  units: Record<string, SpecialUnitContext>;
}

export interface PetahTikvaWorkspace {
  version: string;
  project: {
    name: string;
    // null when only a neighborhood-level demo location is used (no exact
    // subject address was supplied) -- see project.location_note and
    // commercial_area/official_neighborhood for the neighborhood-level context.
    address: string | null;
    city: string;
    commercial_area: string;
    official_neighborhood: string;
    location_note?: string;
    demo_location_assumption: boolean;
    total_units: number;
    standard_units_priced: number;
    special_units_pending: number;
    total_standard_unit_revenue_ils: number;
    disclaimer: string;
  };
  families: PtkFamily[];
  competitor_landscape: CompetitorLandscape;
  standard_attribute_enrichment: StandardAttributeEnrichment;
  special_unit_market_context: SpecialUnitMarketContext;
  evidence_provenance: {
    sold: Record<"3R" | "5R", JsonRecord>;
    current_asking: Record<"3R" | "5R", JsonRecord>;
    new_development: Record<"3R" | "5R", JsonRecord>;
    funnel_stages: string[];
    source_registry: Record<string, string>;
  };
  // Loosely typed (JsonRecord): mirrors app_api/petah_tikva_workspace.py's
  // _build_data_quality_section() output directly rather than being re-typed here.
  data_quality: {
    source_catalog: { name: string; lane: string }[];
    pipeline_stages: string[];
    funnel: {
      sold: Record<"3R" | "5R", JsonRecord>;
      current_asking: Record<"3R" | "5R", JsonRecord>;
      new_development: Record<"3R" | "5R", JsonRecord>;
    };
    nearby_deals_enrichment: JsonRecord;
    case_study_3r_new_development: JsonRecord;
  };
  price_list: PtkPriceListRow[];
  strategy: {
    note: string;
    disclaimer: string;
    is_engineering_demo_baseline: boolean;
    is_gabay_commercial_strategy: boolean;
    override_lock_support: string;
  };
  metadata: JsonRecord;
}

// A unit's pricing route. Standard 3R/5R units go through the existing
// evidence -> strategy -> price flow; special (garden/duplex/triplex) units are
// explicitly routed to a separate, not-yet-built review flow instead of being
// forced through the standard engine. See SpecialUnitReviewService (planned).
export type PricingRoute = "standard_family" | "special_review";

export function pricingRouteOf(row: PtkPriceListRow): PricingRoute {
  return row.family_key ? "standard_family" : "special_review";
}

export const api = {
  getOrCreateDemoProject: () => request<Project>("/api/v1/demo-project", { method: "POST" }),

  importInventoryFile: (projectId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<InventoryVersion>(`/api/v1/projects/${projectId}/inventory/import-file`, {
      method: "POST",
      body: form,
    });
  },

  createDemoMarketSnapshot: (projectId: string) =>
    request<MarketSnapshot>(`/api/v1/projects/${projectId}/demo-market-snapshot`, { method: "POST" }),

  getInventory: (inventoryVersionId: string) => request<InventoryVersion>(`/api/v1/inventory/${inventoryVersionId}`),

  getMarketSnapshot: (snapshotId: string) => request<MarketSnapshot>(`/api/v1/market-snapshots/${snapshotId}`),

  createPricingSession: (body: { project_id: string; inventory_version_id: string; market_snapshot_id: string }) =>
    request<PricingSession>("/api/v1/pricing-sessions", { method: "POST", body: JSON.stringify(body) }),

  getPricingSession: (sessionId: string) => request<PricingSession>(`/api/v1/pricing-sessions/${sessionId}`),

  listScenarios: (sessionId: string) => request<Scenario[]>(`/api/v1/pricing-sessions/${sessionId}/scenarios`),

  createScenario: (sessionId: string, body: { name: string; parent_scenario_id?: string | null }) =>
    request<Scenario>(`/api/v1/pricing-sessions/${sessionId}/scenarios`, { method: "POST", body: JSON.stringify(body) }),

  putFamilyDecision: (scenarioId: string, familyId: string, body: FamilyDecisionInput) =>
    request<JsonRecord>(`/api/v1/scenarios/${scenarioId}/family-decisions/${encodeURIComponent(familyId)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  reprice: (scenarioId: string) => request<JsonRecord>(`/api/v1/scenarios/${scenarioId}/reprice`, { method: "POST" }),

  getPriceList: (scenarioId: string) => request<JsonRecord>(`/api/v1/scenarios/${scenarioId}/price-list`),

  getFamilies: (scenarioId: string) => request<JsonRecord>(`/api/v1/scenarios/${scenarioId}/families`),

  getUnitEvidence: (scenarioId: string, unitNumber: string) =>
    request<JsonRecord>(`/api/v1/scenarios/${scenarioId}/units/${encodeURIComponent(unitNumber)}/evidence`),

  getImpact: (scenarioId: string, against: string) =>
    request<JsonRecord>(`/api/v1/scenarios/${scenarioId}/impact?against=${encodeURIComponent(against)}`),

  getPetahTikvaWorkspace: () => request<PetahTikvaWorkspace>("/api/v1/demo/petah-tikva/workspace"),

  getPetahTikvaScenario: (rangePositionPct: number, name?: string) =>
    request<PetahTikvaScenario>("/api/v1/demo/petah-tikva/scenario", {
      method: "POST",
      body: JSON.stringify({ range_position_pct: rangePositionPct, name: name ?? null }),
    }),

  startProject: (city: string, address: string, inventoryFingerprint?: string | null) =>
    request<ProjectStartResponse>("/api/v1/demo/project-start", {
      method: "POST",
      body: JSON.stringify({ city, address, inventory_fingerprint: inventoryFingerprint ?? null }),
    }),

  previewInventory: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<InventoryPreview>("/api/v1/inventory/preview", { method: "POST", body: form });
  },
};

// Stateless read of an uploaded workbook (see app_api/inventory_preview.py) --
// never persists a project/inventory version. Used only to show real unit
// counts before the user picks a project context.
export interface InventoryPreviewUnit {
  unit_number: string;
  unit_type: string | null;
  rooms: number | null;
  internal_area: number | null;
  balcony_area: number | null;
  floor: string | number | null;
  orientation: string | null;
  pricing_route: "standard_family" | "special_review";
}

export interface InventoryPreview {
  total_units: number;
  standard_unit_count: number;
  special_unit_count: number;
  family_counts: Record<string, number>;
  units: InventoryPreviewUnit[];
  // Deterministic fingerprint over stable pricing-relevant fields only (see
  // app_api/inventory_preview.py compute_inventory_fingerprint) -- passed
  // back on project-start so the resolver can refuse to attach a frozen
  // snapshot built for a different inventory.
  fingerprint: string;
}

// Generic (city, address) project-start contract. Today only Petah Tikva /
// חפץ חיים 25 resolves to "snapshot"; "live" is reserved for a future
// production collector flow that is not implemented yet. "unsupported" means
// no live collection was attempted -- the request is simply not prepared as a
// demo snapshot yet.
export type ProjectStartDataMode = "snapshot" | "live" | "unsupported";

export interface ProjectStartResponse {
  data_mode: ProjectStartDataMode;
  stages: string[];
  workspace?: PetahTikvaWorkspace;
  message?: string;
}
