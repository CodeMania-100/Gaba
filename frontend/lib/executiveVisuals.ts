// Pure derivation helpers for the executive-visual layer (donut, trend,
// insights, building explorer, market map, market-position chart, competitor
// matrix, pricing waterfall). No React here -- components receive an
// already-derived view model and only render it. No new pricing/evidence
// calculation is introduced anywhere in this file: every function either
// re-shapes data the backend already computed (price_list, evidence_lanes,
// evidence_provenance, competitor_landscape) or re-derives a per-level ₪
// effect from lib/marketingStrategy's existing, unmodified formula.

import { JsonRecord, PetahTikvaWorkspace, PtkPriceListRow } from "./api";
import {
  buildFactSheet,
  CompetitorFactSheet,
  computePriceComparison,
  evaluatePriceGapAlert,
} from "./competitorIntelligence";
import { ils } from "./format";
import {
  computePriceBreakdown,
  EMPTY_ADJUSTMENT,
  FAMILY_BUCKET_LABELS,
  familyBucketOf,
  MarketingStrategyState,
  PHASE_ADJUSTMENT_RECAP_LABEL,
  salesPerformanceAdjustmentLabel,
  SALES_PROGRESS_ADJUSTMENT_LABEL,
} from "./marketingStrategy";
import { productGroupLabelOf } from "./comparisonSubject";

// ---------------------------------------------------------------------------
// Apartment mix donut (task item 4)
// ---------------------------------------------------------------------------

export interface ApartmentMixSlice {
  key: string;
  label: string;
  count: number;
  pct: number;
}

const MIX_BUCKETS: { key: string; label: string; match: (row: PtkPriceListRow) => boolean }[] = [
  { key: "3R", label: "3 חדרים סטנדרטיות", match: (r) => r.family === "3R" },
  { key: "5R", label: "5 חדרים סטנדרטיות", match: (r) => r.family === "5R" },
  { key: "garden", label: "דירות גן", match: (r) => r.family === "garden_apartment" },
  { key: "duplex", label: "דופלקס", match: (r) => r.family === "duplex" },
  { key: "triplex", label: "טריפלקס", match: (r) => r.family === "triplex" },
];

/** Counts derived directly from the 39 price-list rows -- never hardcoded. */
export function deriveApartmentMix(rows: PtkPriceListRow[]): ApartmentMixSlice[] {
  const total = rows.length;
  return MIX_BUCKETS.map(({ key, label, match }) => {
    const count = rows.filter(match).length;
    return { key, label, count, pct: total > 0 ? (count / total) * 100 : 0 };
  }).filter((s) => s.count > 0);
}

// ---------------------------------------------------------------------------
// Completed-sales market snapshot (real frozen tax/sold evidence only).
//
// "insufficient_for_trend != no_data": a context can have real, valid
// completed-sale evidence that simply doesn't span enough distinct quarters
// to draw a connected multi-point trend line. That is a *presentation*
// constraint, not an evidence shortage -- the old code conflated the two by
// filtering out any quarter with fewer than 3 transactions (per family) and
// then treating an all-empty result as "no data", which incorrectly showed
// the empty-state message for e.g. Netanya/Ashkelon even though both have
// real completed-sale rows (just thin, and spread thin per family-quarter).
//
// Mode is decided from the COMBINED 3R+5R evidence pool for this context
// (never from one family alone -- a context can clear 2 distinct quarters
// combined even when neither family does individually):
//   >=2 distinct quarters (across both families) -> quarterly_trend
//   ==1 distinct quarter                          -> single_quarter
//   >=1 valid transaction but none dateable into a quarter -> scatter
//   0 valid transactions                          -> empty
//
// "Valid" / "usable" here is exactly the same evidence this card has always
// used -- workspace.evidence_provenance.sold.{3R,5R}.records with
// quality_status "usable" (the same gate the pricing engine itself uses).
// Never current asking, starting prices, historical marketing prices, or
// context-only special evidence -- this card is completed-sale evidence
// only. No pricing range is recomputed here.
// ---------------------------------------------------------------------------

export type CompletedSalesMode = "quarterly_trend" | "single_quarter" | "scatter" | "empty";

export interface CompletedSaleObservation {
  family: "3R" | "5R";
  address: string | null;
  date: string | null;
  quarterKey: string | null;
  quarterLabel: string | null;
  priceIls: number | null;
  areaSqm: number | null;
  pricePerSqm: number;
  // Visibility-pass additions (see MarketEvidenceRegister) -- every one a
  // straight passthrough of an already-computed backend field.
  floor: string | number | null;
  contributesToPricing: boolean;
  targetEquivalentIndicationIls: number | null;
}

export interface QuarterlyTrendPoint {
  quarterKey: string;
  quarterLabel: string;
  medianPricePerSqm: number;
  transactionCount: number;
}

export interface QuarterlyTrendSeries {
  family: "3R" | "5R";
  familyLabel: string;
  points: QuarterlyTrendPoint[];
}

export interface CompletedSalesOverview {
  mode: CompletedSalesMode;
  // All valid observations (both families, sorted by date where known) --
  // used directly by single_quarter/scatter rendering.
  observations: CompletedSaleObservation[];
  // Per-family quarterly series -- used only by quarterly_trend rendering.
  quarterlySeries: QuarterlyTrendSeries[];
  medianPricePerSqm: number | null;
  transactionCount: number;
  // Only set for single_quarter mode.
  quarterLabel: string | null;
}

function quarterOf(dateStr: string): { key: string; label: string; sortKey: number } | null {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return { key: `${y}-Q${q}`, label: `Q${q} ${y}`, sortKey: y * 4 + q };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function collectCompletedSaleObservations(workspace: PetahTikvaWorkspace): CompletedSaleObservation[] {
  const families: ("3R" | "5R")[] = ["3R", "5R"];
  const observations: CompletedSaleObservation[] = [];
  for (const fam of families) {
    const records = (workspace.evidence_provenance.sold[fam]?.records as JsonRecord[] | undefined) ?? [];
    // Same contributor/QA gate the pricing engine itself uses -- never
    // current asking, starting prices, historical marketing, or context-
    // only evidence (none of which live in this sold-records array anyway).
    for (const r of records) {
      if (r.quality_status !== "usable") continue;
      const price = (r.price as number | null) ?? null;
      const area = (r.area as number | null) ?? null;
      const ppsm = (r.price_per_sqm as number | null) ?? (price != null && area ? price / area : null);
      if (ppsm == null) continue; // not a usable price/sqm observation
      const dateStr = (r.event_date as string | undefined) ?? null;
      const q = dateStr ? quarterOf(dateStr) : null;
      observations.push({
        family: fam,
        address: (r.address as string | null) ?? null,
        date: dateStr,
        quarterKey: q?.key ?? null,
        quarterLabel: q?.label ?? null,
        priceIls: price,
        areaSqm: area,
        pricePerSqm: ppsm,
        floor: (r.floor as string | number | null) ?? null,
        // Every observation here already passed the quality_status==="usable"
        // gate above; contributes_to_pricing (when the backend computed it)
        // narrows further to "became a primary contributor for this family",
        // defaulting true to match this function's pre-existing behavior for
        // datasets that don't carry the field (e.g. Petah Tikva's own).
        contributesToPricing: (r.contributes_to_pricing as boolean | undefined) ?? true,
        targetEquivalentIndicationIls: (r.target_equivalent_indication_ils as number | null) ?? null,
      });
    }
  }
  return observations.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

function buildQuarterlySeries(observations: CompletedSaleObservation[]): QuarterlyTrendSeries[] {
  const families: ("3R" | "5R")[] = ["3R", "5R"];
  return families.map((fam) => {
    const byQuarter = new Map<string, { label: string; sortKey: number; ppsms: number[] }>();
    for (const o of observations) {
      if (o.family !== fam || o.quarterKey == null) continue;
      if (!byQuarter.has(o.quarterKey)) {
        const [yStr, qStr] = o.quarterKey.split("-Q");
        byQuarter.set(o.quarterKey, { label: o.quarterLabel!, sortKey: Number(yStr) * 4 + Number(qStr), ppsms: [] });
      }
      byQuarter.get(o.quarterKey)!.ppsms.push(o.pricePerSqm);
    }
    const points: QuarterlyTrendPoint[] = [...byQuarter.entries()]
      .sort((a, b) => a[1].sortKey - b[1].sortKey)
      .map(([key, v]) => ({
        quarterKey: key,
        quarterLabel: v.label,
        medianPricePerSqm: median(v.ppsms),
        transactionCount: v.ppsms.length,
      }));
    return { family: fam, familyLabel: fam === "3R" ? "3 חדרים" : "5 חדרים", points };
  });
}

export function deriveCompletedSalesOverview(workspace: PetahTikvaWorkspace): CompletedSalesOverview {
  const observations = collectCompletedSaleObservations(workspace);
  const transactionCount = observations.length;

  if (transactionCount === 0) {
    return { mode: "empty", observations: [], quarterlySeries: [], medianPricePerSqm: null, transactionCount: 0, quarterLabel: null };
  }

  const medianPricePerSqm = median(observations.map((o) => o.pricePerSqm));
  const distinctQuarters = new Set(observations.map((o) => o.quarterKey).filter((k): k is string => k != null));

  if (distinctQuarters.size >= 2) {
    return {
      mode: "quarterly_trend",
      observations,
      quarterlySeries: buildQuarterlySeries(observations),
      medianPricePerSqm,
      transactionCount,
      quarterLabel: null,
    };
  }

  if (distinctQuarters.size === 1) {
    const [onlyQuarterKey] = distinctQuarters;
    const quarterObservations = observations.filter((o) => o.quarterKey === onlyQuarterKey);
    return {
      mode: "single_quarter",
      observations: quarterObservations,
      quarterlySeries: [],
      medianPricePerSqm: median(quarterObservations.map((o) => o.pricePerSqm)),
      transactionCount: quarterObservations.length,
      quarterLabel: quarterObservations[0]?.quarterLabel ?? null,
    };
  }

  // distinctQuarters.size === 0: real, valid transactions exist, but none of
  // them carry a dateable event_date -- quarter aggregation itself is not
  // possible, not merely thin. Never treated as "no data".
  return { mode: "scatter", observations, quarterlySeries: [], medianPricePerSqm, transactionCount, quarterLabel: null };
}

// ---------------------------------------------------------------------------
// Executive insight cards (task item 6) -- at most 3, all dynamically derived.
// ---------------------------------------------------------------------------

export interface ExecutiveInsight {
  status: "info" | "attention" | "opportunity";
  title: string;
  subject?: string;
  lines: string[];
}

export function deriveExecutiveInsights(workspace: PetahTikvaWorkspace): ExecutiveInsight[] {
  const insights: ExecutiveInsight[] = [];

  // 1. Confidence attention -- special units with low market-indication confidence.
  const specialUnits = Object.values(workspace.special_unit_market_context.units);
  const lowConfidence = specialUnits.filter((u) => u.market_indication?.confidence === "low");
  if (lowConfidence.length > 0) {
    const categoryLabel = (c: string) => (c === "garden" ? "דירות גן" : c === "duplex" ? "דופלקס" : c === "triplex" ? "טריפלקס" : c);
    const categories = [...new Set(lowConfidence.map((u) => u.category))];
    const categoryText = categories.length === 1 ? categoryLabel(categories[0]) : "יחידות מיוחדות";
    insights.push({
      status: "attention",
      title: "דורש תשומת לב",
      lines: [
        `${lowConfidence.length} ${categoryText} עם רמת ביטחון נמוכה`,
        "בשל מספר מוגבל של השוואות כמותיות ישירות.",
      ],
    });
  }

  // 2. Market positioning -- reuse the existing competitor-intelligence
  // price-gap rule as-is (frozen market indication, not proposed price).
  const theSpotFact = buildFactSheet(workspace, "THE SPOT", "THE SPOT");
  const theSpotComparison = computePriceComparison(workspace, theSpotFact, "3R", null);
  if (theSpotComparison) {
    const gap = evaluatePriceGapAlert(
      "THE SPOT",
      theSpotComparison.competitorPriceIls,
      theSpotComparison.competitorIsStartingPriceOnly,
      theSpotComparison.ourMarketIndicationIls,
      theSpotComparison.ourFamilyLabel
    );
    if (gap) {
      insights.push({ status: "opportunity", title: "פער מול מתחרה", subject: "THE SPOT", lines: gap.lines });
    }
  }

  // 3. Data quality -- transactions retained for transparency but excluded
  // from the accepted evidence set (quality_status !== "usable").
  let nonUsable = 0;
  for (const fam of ["3R", "5R"] as const) {
    const records = (workspace.evidence_provenance.sold[fam]?.records as JsonRecord[] | undefined) ?? [];
    nonUsable += records.filter((r) => r.quality_status && r.quality_status !== "usable").length;
  }
  if (nonUsable > 0) {
    insights.push({
      status: "info",
      title: "איכות נתונים",
      lines: [`${nonUsable} עסקאות מוצגות במאגר`, "אך אינן משתתפות בחישוב הטווח."],
    });
  }

  return insights.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Building / floor explorer (task item 7-9)
// ---------------------------------------------------------------------------

export interface BuildingFloorGroup {
  floorKey: string;
  floorLabel: string;
  units: PtkPriceListRow[];
}

function floorSortKey(key: string): [number, number] {
  if (key === "קרקע") return [-1, -1];
  const parts = key.split("-").map((p) => parseInt(p, 10));
  const lo = Number.isFinite(parts[0]) ? parts[0] : 0;
  const hi = parts.length > 1 && Number.isFinite(parts[1]) ? parts[1] : lo;
  return [lo, hi];
}

function floorGroupLabel(key: string): string {
  if (key === "קרקע") return "קרקע";
  if (key.includes("-")) return `קומות ${key.replace("-", "–")}`;
  return `קומה ${key}`;
}

/** Groups the actual 39 rows by their real inventory `floor` value -- never
 * an assumed/derived floor plan. Highest floor group first. */
export function deriveBuildingFloors(rows: PtkPriceListRow[]): BuildingFloorGroup[] {
  const groups = new Map<string, PtkPriceListRow[]>();
  for (const r of rows) {
    const key = String(r.floor ?? "—");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const result: BuildingFloorGroup[] = [...groups.entries()].map(([floorKey, units]) => ({
    floorKey,
    floorLabel: floorGroupLabel(floorKey),
    units: [...units].sort((a, b) => Number(a.unit_number) - Number(b.unit_number) || a.unit_number.localeCompare(b.unit_number)),
  }));
  return result.sort((a, b) => {
    const [aLo, aHi] = floorSortKey(a.floorKey);
    const [bLo, bHi] = floorSortKey(b.floorKey);
    return aLo !== bLo ? bLo - aLo : bHi - aHi;
  });
}

// ---------------------------------------------------------------------------
// Geographic map markers (task item 12-16) -- only current-asking listings
// carry real coordinates in this dataset (285 records); sold transactions and
// the competitor register do not, so no marker/heatmap is fabricated for
// them (see task item 44: never invent coordinates).
// ---------------------------------------------------------------------------

export interface AskingListingMarker {
  id: string;
  family: "3R" | "5R";
  lat: number;
  lng: number;
  address: string | null;
  rooms: number | null;
  areaSqm: number | null;
  askingPriceIls: number | null;
  askingPpsm: number | null;
  // Visibility-pass additions (see MarketEvidenceRegister) -- every one a
  // straight passthrough of an already-computed backend field.
  floor: string | number | null;
  contributesToPricing: boolean;
  targetEquivalentIndicationIls: number | null;
  nonContributionReason: string | null;
}

export function deriveAskingListingMarkers(workspace: PetahTikvaWorkspace): AskingListingMarker[] {
  const out: AskingListingMarker[] = [];
  for (const fam of ["3R", "5R"] as const) {
    const laneData = workspace.evidence_provenance.current_asking[fam];
    // Both accepted and rejected records -- rejected listings still carry
    // real coordinates and facts (they simply didn't pass QA/status), and
    // showing them lets the register honestly demonstrate what "רק ראיות
    // שנכנסו לחישוב" actually filters out, matching the map's own existing
    // included/context/excluded distinction rather than silently hiding them.
    const records = [
      ...((laneData?.accepted_records as JsonRecord[] | undefined) ?? []),
      ...((laneData?.rejected_records as JsonRecord[] | undefined) ?? []),
    ];
    for (const r of records) {
      if (r.latitude == null || r.longitude == null) continue;
      const exclusionReasons = (r.exclusion_reasons as string[] | undefined) ?? [];
      out.push({
        id: String(r.listing_id ?? `${fam}-${out.length}`),
        family: fam,
        lat: r.latitude as number,
        lng: r.longitude as number,
        address: (r.address as string | null) ?? null,
        rooms: (r.rooms as number | null) ?? null,
        areaSqm: (r.area as number | null) ?? null,
        askingPriceIls: (r.asking_price as number | null) ?? null,
        askingPpsm: (r.asking_ppsm as number | null) ?? null,
        floor: (r.floor as string | number | null) ?? null,
        contributesToPricing: (r.contributes_to_pricing as boolean | undefined) ?? exclusionReasons.length === 0,
        targetEquivalentIndicationIls: (r.target_equivalent_indication_ils as number | null) ?? null,
        nonContributionReason: (r.non_contribution_reason as string | null) ?? (exclusionReasons[0] ?? null),
      });
    }
  }
  return out;
}

/** The centroid of the real, already-collected asking-listing coordinates --
 * used only as an honest visual stand-in for "the comparison area", never
 * presented as the subject project's exact address (see task item 13/45). */
export function deriveAreaCentroid(markers: AskingListingMarker[]): { lat: number; lng: number } | null {
  if (markers.length === 0) return null;
  const lat = markers.reduce((s, m) => s + m.lat, 0) / markers.length;
  const lng = markers.reduce((s, m) => s + m.lng, 0) / markers.length;
  return { lat, lng };
}

// ---------------------------------------------------------------------------
// Market position chart (task item 19) -- reuses each family's already-
// computed evidence-lane range centers; no independent calculation.
// ---------------------------------------------------------------------------

export interface MarketPositionCategory {
  key: string;
  label: string;
  priceIls: number;
  sourceNote: string;
  sampleSize: number | null;
  isOurs: boolean;
}

const LANE_META: { key: "sold" | "current_asking" | "new_development"; label: string }[] = [
  { key: "sold", label: "עסקאות שבוצעו" },
  { key: "current_asking", label: "מחירים מבוקשים" },
  { key: "new_development", label: "פרויקטים חדשים" },
];

export function deriveMarketPosition(workspace: PetahTikvaWorkspace, family: "3R" | "5R"): MarketPositionCategory[] {
  const fam = workspace.families.find((f) => f.family === family);
  if (!fam) return [];
  const categories: MarketPositionCategory[] = [];
  for (const { key, label } of LANE_META) {
    const lane = fam.evidence_lanes[key];
    if (lane.range.center == null) continue;
    categories.push({
      key,
      label,
      priceIls: lane.range.center,
      sourceNote: `חציון ${label} שנכלל בשכבת השוק`,
      sampleSize: lane.primary_contributor_count,
      isOurs: false,
    });
  }
  if (fam.market.supported_lower != null && fam.market.supported_upper != null) {
    categories.push({
      key: "ours",
      label: "אינדיקציית השוק שלנו",
      priceIls: (fam.market.supported_lower + fam.market.supported_upper) / 2,
      sourceNote: "אמצע הטווח הנתמך שלנו (קפוא, ללא השפעת אסטרטגיה)",
      sampleSize: null,
      isOurs: true,
    });
  }
  return categories;
}

// ---------------------------------------------------------------------------
// Competitor comparison matrix (task item 17-18)
// ---------------------------------------------------------------------------

export interface CompetitorMatrixRow {
  key: string;
  label: string;
  values: string[];
}

export interface CompetitorMatrix {
  columns: string[];
  rows: CompetitorMatrixRow[];
}

// Petah Tikva's own curated 3-competitor selection -- a deliberate editorial
// choice (mixing a core_exact_target contributor with adjacent-submarket
// context), not a rule any generic ranking reproduces. Kept exactly as-is,
// used only for the Petah Tikva context, so this batch's multi-city work
// causes zero drift here.
const MATRIX_COMPETITORS = [
  { displayName: "THE SPOT", matchName: "THE SPOT" },
  { displayName: "זאב ברנדה 22", matchName: "זאב ברנדה 22" },
  { displayName: "NAVE PARK", matchName: "NAVE PARK נווה פארק" },
];

const NOT_PUBLISHED = "לא פורסם";

/** For the three multi-city contexts (which have no such curated list),
 * picks up to 3 competitor_landscape projects relevant to this family --
 * "direct" classification first, then "relevant", by name for a
 * deterministic order -- so the price-positioning matrix compares against
 * this context's own real competitors instead of Petah Tikva's names
 * (which would simply never match and show "לא פורסם" for everything). */
export function deriveDefaultMatrixCompetitors(workspace: PetahTikvaWorkspace, family: "3R" | "5R"): { displayName: string; matchName: string }[] {
  const relevanceKey = family === "3R" ? "standard_3r" : "standard_5r";
  const rank: Record<string, number> = { direct: 0, relevant: 1, context: 2 };
  const projects = workspace.competitor_landscape.projects
    .filter((p) => ((p.relevance as string[] | undefined) ?? []).includes(relevanceKey))
    .sort((a, b) => (rank[a.display_classification] ?? 3) - (rank[b.display_classification] ?? 3) || a.project_name.localeCompare(b.project_name));
  return projects.slice(0, 3).map((p) => ({ displayName: p.project_name, matchName: p.project_name }));
}

export function deriveCompetitorMatrix(
  workspace: PetahTikvaWorkspace,
  family: "3R" | "5R",
  ourPhaseLabel: string,
  competitorOverride?: { displayName: string; matchName: string }[]
): CompetitorMatrix {
  const fam = workspace.families.find((f) => f.family === family);
  const ourMarketIndicationIls =
    fam?.market.supported_lower != null && fam?.market.supported_upper != null
      ? (fam.market.supported_lower + fam.market.supported_upper) / 2
      : null;
  const ourAreaSqm = fam?.target.internal_area ?? null;
  const ourPpsm = ourMarketIndicationIls != null && ourAreaSqm ? ourMarketIndicationIls / ourAreaSqm : null;

  // Real floor span for this family, derived from the actual inventory --
  // never assumed.
  const familyFloors = workspace.price_list
    .filter((r) => r.family === family)
    .map((r) => (typeof r.floor === "number" ? r.floor : Number(r.floor)))
    .filter((f) => Number.isFinite(f));
  const ourFloorLabel =
    familyFloors.length > 0
      ? Math.min(...familyFloors) === Math.max(...familyFloors)
        ? `קומה ${Math.min(...familyFloors)}`
        : `קומות ${Math.min(...familyFloors)}–${Math.max(...familyFloors)} (בפיזור בבניין)`
      : NOT_PUBLISHED;

  const competitors = competitorOverride ?? MATRIX_COMPETITORS;
  const facts: CompetitorFactSheet[] = competitors.map((c) => buildFactSheet(workspace, c.displayName, c.matchName));

  const columns = ["הפרויקט שלנו", ...competitors.map((c) => c.displayName)];

  const priceRow: CompetitorMatrixRow = {
    key: "price",
    label: "מחיר / מחיר התחלתי",
    values: [
      ourMarketIndicationIls != null ? ils(ourMarketIndicationIls) : NOT_PUBLISHED,
      ...facts.map((f) => f.priceLabel ?? NOT_PUBLISHED),
    ],
  };
  const priceKindRow: CompetitorMatrixRow = {
    key: "price_kind",
    label: "סוג המחיר",
    values: ["אינדיקציית שוק (טווח קפוא)", ...facts.map((f) => (f.currentPriceIls == null ? NOT_PUBLISHED : f.isStartingPriceOnly ? "מחיר התחלתי בפרויקט" : "מחיר דירה")),],
  };
  const areaRow: CompetitorMatrixRow = {
    key: "area",
    label: "שטח",
    values: [ourAreaSqm != null ? `${Math.round(ourAreaSqm)} מ״ר` : NOT_PUBLISHED, ...facts.map((f) => f.areaLabel ?? NOT_PUBLISHED)],
  };
  const ppsmRow: CompetitorMatrixRow = {
    key: "ppsm",
    label: "מחיר למ״ר (משוער)",
    values: [ourPpsm != null ? `${ils(ourPpsm)} למ״ר` : NOT_PUBLISHED, ...facts.map((f) => (f.pricePerSqmIls != null ? `${ils(f.pricePerSqmIls)} למ״ר` : NOT_PUBLISHED))],
  };
  const floorRow: CompetitorMatrixRow = {
    key: "floor",
    label: "קומה / טווח קומות",
    values: [ourFloorLabel, ...facts.map((f) => f.floorRangeLabel ?? NOT_PUBLISHED)],
  };
  const deliveryRow: CompetitorMatrixRow = {
    key: "delivery",
    label: "מועד מסירה",
    values: [NOT_PUBLISHED, ...facts.map((f) => f.delivery ?? NOT_PUBLISHED)],
  };
  const paymentRow: CompetitorMatrixRow = {
    key: "payment",
    label: "תנאי תשלום",
    values: [NOT_PUBLISHED, ...facts.map((f) => f.paymentTerms ?? NOT_PUBLISHED)],
  };
  const phaseRow: CompetitorMatrixRow = {
    key: "phase",
    label: "שלב הפרויקט",
    values: [ourPhaseLabel, ...facts.map((f) => f.status ?? NOT_PUBLISHED)],
  };
  const developerRow: CompetitorMatrixRow = {
    key: "developer",
    label: "יזם",
    values: [NOT_PUBLISHED, ...facts.map((f) => f.developer ?? NOT_PUBLISHED)],
  };

  return { columns, rows: [priceRow, priceKindRow, areaRow, ppsmRow, floorRow, deliveryRow, paymentRow, phaseRow, developerRow] };
}

// ---------------------------------------------------------------------------
// Pricing waterfall (task item 21-24) -- a pure re-shaping of
// computePriceBreakdown's existing output plus the three already-existing
// project/family/unit adjustment percentages; no new formula.
// ---------------------------------------------------------------------------

export interface WaterfallStep {
  key: string;
  label: string;
  valueIls: number | null;
  kind: "base" | "adjustment" | "result";
  isZero: boolean;
}

export function deriveWaterfallSteps(state: MarketingStrategyState, row: PtkPriceListRow): WaterfallStep[] {
  const breakdown = computePriceBreakdown(state, row);
  const bucket = familyBucketOf(row);
  const familyAdjustment = state.familyAdjustments[bucket] ?? EMPTY_ADJUSTMENT;
  const unitAdjustment = state.unitAdjustments[row.unit_number] ?? EMPTY_ADJUSTMENT;
  const pctEffect = (v: number) => (breakdown.marketIndicationIls != null ? breakdown.marketIndicationIls * (v / 100) : 0);

  return [
    { key: "market", label: "אינדיקציית שוק", valueIls: breakdown.marketIndicationIls, kind: "base", isZero: false },
    { key: "phase", label: PHASE_ADJUSTMENT_RECAP_LABEL, valueIls: breakdown.phaseEffectIls, kind: "adjustment", isZero: breakdown.phasePct === 0 },
    {
      key: "sales_progress",
      label: SALES_PROGRESS_ADJUSTMENT_LABEL,
      valueIls: breakdown.salesProgressEffectIls,
      kind: "adjustment",
      isZero: breakdown.salesProgressPct === 0,
    },
    {
      key: "project",
      label: "התאמה מסחרית – כלל הפרויקט",
      valueIls: pctEffect(state.projectAdjustment.adjustment_pct),
      kind: "adjustment",
      isZero: state.projectAdjustment.adjustment_pct === 0,
    },
    {
      key: "family",
      label: `התאמה מסחרית – משפחת ${FAMILY_BUCKET_LABELS[bucket]}`,
      valueIls: pctEffect(familyAdjustment.adjustment_pct),
      kind: "adjustment",
      isZero: familyAdjustment.adjustment_pct === 0,
    },
    {
      key: "unit",
      label: `התאמה מסחרית – דירה ${row.unit_number}`,
      valueIls: pctEffect(unitAdjustment.adjustment_pct),
      kind: "adjustment",
      isZero: unitAdjustment.adjustment_pct === 0,
    },
    {
      key: "sales_performance",
      label: salesPerformanceAdjustmentLabel(productGroupLabelOf(row)),
      valueIls: breakdown.salesPerformanceEffectIls,
      kind: "adjustment",
      isZero: breakdown.salesPerformancePct === 0,
    },
    { key: "proposed", label: "מחיר שיווק מוצע", valueIls: breakdown.proposedIls, kind: "result", isZero: false },
  ];
}
