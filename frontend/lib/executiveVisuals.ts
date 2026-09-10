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
} from "./marketingStrategy";

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
// Quarterly sold price/sqm trend (task item 5) -- real frozen tax evidence
// only, median per quarter, sparse quarters omitted (never interpolated).
// ---------------------------------------------------------------------------

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

// Below this many usable transactions in a quarter, the point is omitted
// rather than shown as a shaky median (see task: "do not create fake trend
// continuity").
const MIN_TRANSACTIONS_PER_QUARTER = 3;

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

export function deriveQuarterlySoldTrend(workspace: PetahTikvaWorkspace): QuarterlyTrendSeries[] {
  const families: ("3R" | "5R")[] = ["3R", "5R"];
  return families.map((fam) => {
    const records = (workspace.evidence_provenance.sold[fam]?.records as JsonRecord[] | undefined) ?? [];
    // "Transactions already accepted into our standard sold evidence" --
    // quality_status "usable" is the same gate the pricing engine itself
    // uses; low_confidence/ambiguous records are shown elsewhere (data
    // quality) but never plotted here as if they were accepted evidence.
    const usable = records.filter((r) => r.quality_status === "usable");
    const byQuarter = new Map<string, { label: string; sortKey: number; ppsms: number[] }>();
    for (const r of usable) {
      const dateStr = r.event_date as string | undefined;
      if (!dateStr) continue;
      const q = quarterOf(dateStr);
      if (!q) continue;
      const price = r.price as number | null;
      const area = r.area as number | null;
      const ppsm = (r.price_per_sqm as number | null) ?? (price != null && area ? price / area : null);
      if (ppsm == null) continue;
      if (!byQuarter.has(q.key)) byQuarter.set(q.key, { label: q.label, sortKey: q.sortKey, ppsms: [] });
      byQuarter.get(q.key)!.ppsms.push(ppsm);
    }
    const points: QuarterlyTrendPoint[] = [...byQuarter.entries()]
      .filter(([, v]) => v.ppsms.length >= MIN_TRANSACTIONS_PER_QUARTER)
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
}

export function deriveAskingListingMarkers(workspace: PetahTikvaWorkspace): AskingListingMarker[] {
  const out: AskingListingMarker[] = [];
  for (const fam of ["3R", "5R"] as const) {
    const records = (workspace.evidence_provenance.current_asking[fam]?.accepted_records as JsonRecord[] | undefined) ?? [];
    for (const r of records) {
      if (r.latitude == null || r.longitude == null) continue;
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

const MATRIX_COMPETITORS = [
  { displayName: "THE SPOT", matchName: "THE SPOT" },
  { displayName: "זאב ברנדה 22", matchName: "זאב ברנדה 22" },
  { displayName: "NAVE PARK", matchName: "NAVE PARK נווה פארק" },
];

const NOT_PUBLISHED = "לא פורסם";

export function deriveCompetitorMatrix(workspace: PetahTikvaWorkspace, family: "3R" | "5R", ourPhaseLabel: string): CompetitorMatrix {
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

  const facts: CompetitorFactSheet[] = MATRIX_COMPETITORS.map((c) => buildFactSheet(workspace, c.displayName, c.matchName));

  const columns = ["הפרויקט שלנו", ...MATRIX_COMPETITORS.map((c) => c.displayName)];

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
    { key: "phase", label: "השפעת שלב הפרויקט", valueIls: breakdown.phaseEffectIls, kind: "adjustment", isZero: breakdown.phasePct === 0 },
    {
      key: "sales_progress",
      label: "השפעת קצב המכירות",
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
    { key: "proposed", label: "מחיר שיווק מוצע", valueIls: breakdown.proposedIls, kind: "result", isZero: false },
  ];
}
