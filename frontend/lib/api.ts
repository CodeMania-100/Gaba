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
};
