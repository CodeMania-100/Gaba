// Minimal marketing-strategy layer: project sales phase, sales progress
// (with an explicit sell-through target Marketing can set), internal project
// sales as a separate evidence type, and three explicit, Marketing-entered
// percentage adjustments (phase, sales-progress, manual) that combine
// additively into the proposed price. Deliberately small -- see task: "Do
// not build a large strategy engine" / "Do not add any more strategy
// dimensions." Pure client-side state (React useState in the page), never
// persisted server-side and never recomputed by pricing_core: the only
// arithmetic here is
//   proposed = market_indication * (1 + (phase_pct + sales_progress_pct + manual_pct) / 100)
// exactly the formula the task specifies. No automatic scarcity/forecast
// logic, no per-attribute coefficients, and the ahead/behind-target
// comparison is purely descriptive -- it never derives sales_progress_pct
// for Marketing. This only reads the price the engine already produced
// (row.proposed_list_price_ils) and applies explicit, human-entered
// percentages on top of it.

import { PtkPriceListRow } from "./api";

export type ProjectPhase = "presale" | "launch" | "regular_sales" | "final_inventory";

export const PROJECT_PHASE_LABELS: Record<ProjectPhase, string> = {
  presale: "פריסייל",
  launch: "השקה",
  regular_sales: "מכירה שוטפת",
  final_inventory: "מלאי סופי",
};

export const PROJECT_PHASES: ProjectPhase[] = ["presale", "launch", "regular_sales", "final_inventory"];

// The three buckets sales-progress and family-level adjustments are tracked
// at -- matches item 2's "3R sold/remaining, 5R sold/remaining, special
// sold/remaining" breakdown exactly.
export type FamilyBucket = "3R" | "5R" | "special";
export const FAMILY_BUCKET_LABELS: Record<FamilyBucket, string> = { "3R": "3 חדרים", "5R": "5 חדרים", special: "יחידות מיוחדות" };

export function familyBucketFromString(family: string): FamilyBucket {
  return family === "3R" || family === "5R" ? family : "special";
}

export function familyBucketOf(row: PtkPriceListRow): FamilyBucket {
  return familyBucketFromString(row.family);
}

export interface StrategyAdjustment {
  adjustment_pct: number;
  rationale: string;
}

export const EMPTY_ADJUSTMENT: StrategyAdjustment = { adjustment_pct: 0, rationale: "" };

export interface InternalProjectSaleRecord {
  unit: string;
  family: string;
  sale_price_ils: number;
  sale_date: string;
  notes?: string;
}

export interface MarketingStrategyState {
  projectPhase: ProjectPhase;
  // Demo default: no real Gabay sales-stage data was supplied, so no unit is
  // marked sold. Kept as an explicit set (not a count) so a specific unit
  // could be marked sold later without inventing a number now.
  soldUnitNumbers: Set<string>;
  // Demo default: no internal-project-sales records were supplied. Real
  // records could be added here later without changing the shape.
  internalProjectSales: InternalProjectSaleRecord[];
  // Marketing-entered benchmark, not computed. 0 = not supplied. Purely a
  // display comparison against the computed sell-through -- never feeds
  // salesProgressAdjustment automatically.
  targetSellThroughPct: number;
  // Explicit, project-wide, Marketing-entered percentage conceptually tied
  // to the project phase above -- but the phase itself carries no automatic
  // percentage; these two are independent inputs.
  phaseAdjustment: StrategyAdjustment;
  // Explicit, project-wide, Marketing-entered percentage conceptually tied
  // to sales pace vs. target -- never auto-derived from the ahead/behind
  // comparison, which is descriptive only.
  salesProgressAdjustment: StrategyAdjustment;
  // The pre-existing project/family/unit adjustment, now the "manual"
  // component of the formula.
  projectAdjustment: StrategyAdjustment;
  familyAdjustments: Record<FamilyBucket, StrategyAdjustment>;
  unitAdjustments: Record<string, StrategyAdjustment>;
}

export function defaultMarketingStrategyState(): MarketingStrategyState {
  return {
    projectPhase: "presale",
    soldUnitNumbers: new Set(),
    internalProjectSales: [],
    targetSellThroughPct: 0,
    phaseAdjustment: { ...EMPTY_ADJUSTMENT },
    salesProgressAdjustment: { ...EMPTY_ADJUSTMENT },
    projectAdjustment: { ...EMPTY_ADJUSTMENT },
    familyAdjustments: { "3R": { ...EMPTY_ADJUSTMENT }, "5R": { ...EMPTY_ADJUSTMENT }, special: { ...EMPTY_ADJUSTMENT } },
    unitAdjustments: {},
  };
}

/** Internal-project-sales records for one family bucket -- a separate
 * evidence type from external Tax/Madlan transactions (see task item 3/6),
 * shown next to the marketing decision but never merged into the market
 * indication. */
export function internalSalesForBucket(state: MarketingStrategyState, bucket: FamilyBucket): InternalProjectSaleRecord[] {
  return state.internalProjectSales.filter((s) => familyBucketFromString(s.family) === bucket);
}

/** The internal-project-sale record for one specific unit, if any was
 * supplied -- undefined (never invented) when this unit hasn't sold or no
 * internal sale price was recorded for it. */
export function internalSaleForUnit(state: MarketingStrategyState, unitNumber: string): InternalProjectSaleRecord | undefined {
  return state.internalProjectSales.find((s) => s.unit === unitNumber);
}

/** Sum of whichever explicit manual adjustments apply to this unit (project
 * + its family bucket + the unit itself). Each level defaults to 0% when
 * unset -- never an invented nonzero default. This is the "manual_adjustment_pct"
 * term of the final formula. */
export function manualAdjustmentPct(state: MarketingStrategyState, row: PtkPriceListRow): number {
  const bucket = familyBucketOf(row);
  return (
    (state.projectAdjustment.adjustment_pct || 0) +
    (state.familyAdjustments[bucket]?.adjustment_pct || 0) +
    (state.unitAdjustments[row.unit_number]?.adjustment_pct || 0)
  );
}

export interface PriceBreakdown {
  marketIndicationIls: number | null;
  phasePct: number;
  salesProgressPct: number;
  manualPct: number;
  totalPct: number;
  proposedIls: number | null;
  // Individual ₪ effect of each named component. Since the formula sums
  // percentages before applying them to market_indication once, these three
  // effects add up exactly to (proposedIls - marketIndicationIls) -- no
  // compounding, no cross terms.
  phaseEffectIls: number | null;
  salesProgressEffectIls: number | null;
  manualEffectIls: number | null;
}

/** proposed_price = market_indication * (1 + (phase_pct + sales_progress_pct
 * + manual_pct) / 100). market_indication is whatever price the (unchanged)
 * pricing engine already produced for this row -- row.proposed_list_price_ils,
 * already reflecting the active standard-family scenario or the special-unit
 * market indication. No other calculation happens here. */
export function computePriceBreakdown(state: MarketingStrategyState, row: PtkPriceListRow): PriceBreakdown {
  const marketIndicationIls = row.proposed_list_price_ils;
  const phasePct = state.phaseAdjustment.adjustment_pct || 0;
  const salesProgressPct = state.salesProgressAdjustment.adjustment_pct || 0;
  const manualPct = manualAdjustmentPct(state, row);
  const totalPct = phasePct + salesProgressPct + manualPct;

  if (marketIndicationIls == null) {
    return {
      marketIndicationIls: null,
      phasePct,
      salesProgressPct,
      manualPct,
      totalPct,
      proposedIls: null,
      phaseEffectIls: null,
      salesProgressEffectIls: null,
      manualEffectIls: null,
    };
  }

  return {
    marketIndicationIls,
    phasePct,
    salesProgressPct,
    manualPct,
    totalPct,
    proposedIls: marketIndicationIls * (1 + totalPct / 100),
    phaseEffectIls: marketIndicationIls * (phasePct / 100),
    salesProgressEffectIls: marketIndicationIls * (salesProgressPct / 100),
    manualEffectIls: marketIndicationIls * (manualPct / 100),
  };
}

export interface SalesProgress {
  unitsTotal: number;
  unitsSold: number;
  unitsRemaining: number;
  sellThroughPct: number;
  byFamily: Record<FamilyBucket, { total: number; sold: number; remaining: number; sellThroughPct: number }>;
}

export function computeSalesProgress(rows: PtkPriceListRow[], soldUnitNumbers: Set<string>): SalesProgress {
  const byFamily: Record<FamilyBucket, { total: number; sold: number; remaining: number; sellThroughPct: number }> = {
    "3R": { total: 0, sold: 0, remaining: 0, sellThroughPct: 0 },
    "5R": { total: 0, sold: 0, remaining: 0, sellThroughPct: 0 },
    special: { total: 0, sold: 0, remaining: 0, sellThroughPct: 0 },
  };
  let sold = 0;
  for (const row of rows) {
    const bucket = familyBucketOf(row);
    byFamily[bucket].total += 1;
    if (soldUnitNumbers.has(row.unit_number)) {
      byFamily[bucket].sold += 1;
      sold += 1;
    }
  }
  for (const bucket of Object.keys(byFamily) as FamilyBucket[]) {
    byFamily[bucket].remaining = byFamily[bucket].total - byFamily[bucket].sold;
    byFamily[bucket].sellThroughPct = byFamily[bucket].total > 0 ? (byFamily[bucket].sold / byFamily[bucket].total) * 100 : 0;
  }
  const unitsTotal = rows.length;
  return {
    unitsTotal,
    unitsSold: sold,
    unitsRemaining: unitsTotal - sold,
    sellThroughPct: unitsTotal > 0 ? (sold / unitsTotal) * 100 : 0,
    byFamily,
  };
}

/** Purely descriptive ahead/behind-target comparison. Never feeds back into
 * salesProgressAdjustment -- Marketing always types that percentage in
 * manually. targetPct === 0 means no benchmark was supplied. */
export type SellThroughStatus = "no_target" | "ahead" | "on_target" | "behind";

export function sellThroughStatus(actualPct: number, targetPct: number): SellThroughStatus {
  if (!targetPct) return "no_target";
  const diff = actualPct - targetPct;
  if (Math.abs(diff) < 0.5) return "on_target";
  return diff > 0 ? "ahead" : "behind";
}

export const SELL_THROUGH_STATUS_LABELS: Record<SellThroughStatus, string> = {
  no_target: "לא הוגדר יעד",
  ahead: "מקדימה את היעד",
  on_target: "בהתאם ליעד",
  behind: "מפגרת אחרי היעד",
};

/** Plain factual difference (actual - target), in percentage points --
 * never a price adjustment. Marketing still has to type
 * salesProgressAdjustment.adjustment_pct in manually; this only answers
 * "how far are we from the target," it never feeds the formula (see task
 * item 2). null when no target was supplied (0 = "not set", not a real
 * target of 0%). */
export function sellThroughGapPoints(actualPct: number, targetPct: number): number | null {
  if (!targetPct) return null;
  return actualPct - targetPct;
}

// Exact Hebrew labels for the three commercial-adjustment levels (task item
// 3) -- centralized so MarketingStrategyPanel (project-wide) and
// MarketingDecisionChain (per-unit drawer) never drift into different
// wording for the same underlying state field.
export const PROJECT_ADJUSTMENT_LABEL = "התאמה כללית לפרויקט";
export const UNIT_ADJUSTMENT_LABEL = "התאמה לדירה זו";
// The group itself (task item 3: "For a 3R apartment: התאמה לקבוצת הדירות /
// 3 חדרים") is shown as a second line via FAMILY_BUCKET_LABELS[bucket] at
// each call site -- this label is deliberately the same regardless of
// bucket, so nothing here invents a per-type (e.g. "triplex family") rule.
export const GROUP_ADJUSTMENT_LABEL = "התאמה לקבוצת הדירות";

// Per-level helper text (task item 4) -- explains scope in plain language
// instead of expecting the reader to infer "project/group/unit" from the
// label alone.
export const PROJECT_ADJUSTMENT_HELPER = "חלה על כל הדירות בפרויקט";
export const GROUP_ADJUSTMENT_HELPER = "חלה על כל הדירות בקבוצה הנבחרת";
export const UNIT_ADJUSTMENT_HELPER = "חלה רק על הדירה הנוכחית";

export interface RevenueSummary {
  marketIndicationRevenueIls: number;
  proposedRevenueIls: number;
  differenceIls: number;
  phaseEffectRevenueIls: number;
  salesProgressEffectRevenueIls: number;
  manualEffectRevenueIls: number;
}

export function computeRevenueSummary(rows: PtkPriceListRow[], state: MarketingStrategyState): RevenueSummary {
  let marketIndicationRevenueIls = 0;
  let proposedRevenueIls = 0;
  let phaseEffectRevenueIls = 0;
  let salesProgressEffectRevenueIls = 0;
  let manualEffectRevenueIls = 0;
  for (const row of rows) {
    const breakdown = computePriceBreakdown(state, row);
    if (breakdown.marketIndicationIls == null) continue;
    marketIndicationRevenueIls += breakdown.marketIndicationIls;
    proposedRevenueIls += breakdown.proposedIls ?? breakdown.marketIndicationIls;
    phaseEffectRevenueIls += breakdown.phaseEffectIls ?? 0;
    salesProgressEffectRevenueIls += breakdown.salesProgressEffectIls ?? 0;
    manualEffectRevenueIls += breakdown.manualEffectIls ?? 0;
  }
  return {
    marketIndicationRevenueIls,
    proposedRevenueIls,
    differenceIls: proposedRevenueIls - marketIndicationRevenueIls,
    phaseEffectRevenueIls,
    salesProgressEffectRevenueIls,
    manualEffectRevenueIls,
  };
}
