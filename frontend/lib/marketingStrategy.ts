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
import { CONFIDENCE_RANK, deriveComparisonSelectorOptions, productGroupKeyOf } from "./comparisonSubject";

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
  // Marketing-entered demo input (a plain percentage, not derived from
  // soldUnitNumbers) -- 0 = not supplied. Purely descriptive, compared
  // against targetSellThroughPctByPhase below to produce the read-only gap;
  // never feeds salesProgressAdjustment automatically. Stays one current/
  // global figure (never keyed per phase) -- actual sell-through is a fact
  // about today, not a per-milestone benchmark.
  actualSellThroughPct: number;
  // Marketing-entered benchmark: the CUMULATIVE sell-through target for
  // reaching a given project phase/milestone (e.g. presale 10%, launch 25%,
  // regular_sales 60%, final_inventory 90% -- illustrative only, never
  // hard-coded; every value here is whatever Marketing actually typed in).
  // Keyed per phase -- never a single shared value -- so switching
  // projectPhase never silently carries one milestone's target into
  // another: a phase with no entry yet is unset (null), never inferred from
  // another phase and never defaulted to 0%. Purely a display comparison
  // against actualSellThroughPct -- never feeds salesProgressAdjustment
  // automatically. See projectTargetSellThroughPctFor.
  targetSellThroughPctByPhase: Record<ProjectPhase, number | null>;
  // Explicit, Marketing-entered percentage tied to the CURRENTLY SELECTED
  // project phase -- keyed per phase (never a single shared value) so
  // switching projectPhase never silently carries one stage's adjustment
  // into another: a +1% entered under "presale" stays exactly there, and
  // "launch" reads its own (initially 0%/unset) entry until Marketing
  // explicitly sets one. Switching back to presale later restores whatever
  // was entered for it. The phase itself still carries no automatic
  // percentage of its own -- an unset entry is always 0%, never inferred
  // from the phase name.
  phaseAdjustments: Record<ProjectPhase, StrategyAdjustment>;
  // Explicit, project-wide, Marketing-entered percentage conceptually tied
  // to sales pace vs. target -- never auto-derived from the ahead/behind
  // comparison, which is descriptive only.
  salesProgressAdjustment: StrategyAdjustment;
  // The pre-existing project/family/unit adjustment, now the "manual"
  // component of the formula.
  projectAdjustment: StrategyAdjustment;
  familyAdjustments: Record<FamilyBucket, StrategyAdjustment>;
  unitAdjustments: Record<string, StrategyAdjustment>;
  // Company-internal sales performance by product group (טיפוס דירה) -- see
  // "Sales performance by product group" below. Keyed by the exact same
  // product-group key lib/comparisonSubject.ts's apartment-type selector
  // already uses; an EMPTY object is the correct default (no assignment
  // data supplied real sales history, so every group starts "not entered",
  // never a fabricated zero).
  productGroupSales: ProductGroupSales;
}

export function defaultMarketingStrategyState(): MarketingStrategyState {
  return {
    projectPhase: "presale",
    soldUnitNumbers: new Set(),
    internalProjectSales: [],
    actualSellThroughPct: 0,
    targetSellThroughPctByPhase: {
      presale: null,
      launch: null,
      regular_sales: null,
      final_inventory: null,
    },
    phaseAdjustments: {
      presale: { ...EMPTY_ADJUSTMENT },
      launch: { ...EMPTY_ADJUSTMENT },
      regular_sales: { ...EMPTY_ADJUSTMENT },
      final_inventory: { ...EMPTY_ADJUSTMENT },
    },
    salesProgressAdjustment: { ...EMPTY_ADJUSTMENT },
    projectAdjustment: { ...EMPTY_ADJUSTMENT },
    familyAdjustments: { "3R": { ...EMPTY_ADJUSTMENT }, "5R": { ...EMPTY_ADJUSTMENT }, special: { ...EMPTY_ADJUSTMENT } },
    unitAdjustments: {},
    productGroupSales: {},
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

// Centralized so the Strategy workspace (project-wide) and
// MarketingDecisionChain (per-unit drawer) never drift into different
// wording -- and so it reads unambiguously as an explicit, editable
// Marketing PRICING decision tied to the stage, never a measure of sales
// progress itself (that's סales performance, a completely separate
// concept -- see PHASE_ADJUSTMENT_RECAP_LABEL / SALES_PROGRESS_ADJUSTMENT_LABEL
// / salesPerformanceAdjustmentLabel, deliberately worded apart from each
// other and from this one). LABEL is used for the editable control's own
// title (an input affordance, "(%)" spelled out the same way the sales-
// target field's label does); RECAP_LABEL drops the "(%)" for contexts that
// already show the live percentage value right next to the label (the
// drawer recap row, the impact-summary decision list, the pricing
// waterfall) where repeating "(%)" would just be noise.
export const PHASE_ADJUSTMENT_LABEL = "התאמת מחיר בשל שלב הפרויקט (%)";
export const PHASE_ADJUSTMENT_RECAP_LABEL = "התאמת מחיר בשל שלב הפרויקט";

/** The adjustment entered for one specific phase (defaults to the
 * currently-selected state.projectPhase) -- never a cross-phase fallback.
 * A phase with no entry yet reads as EMPTY_ADJUSTMENT (0%/unset), never the
 * previously-selected phase's value. */
export function phaseAdjustmentFor(state: MarketingStrategyState, phase: ProjectPhase = state.projectPhase): StrategyAdjustment {
  return state.phaseAdjustments[phase] ?? EMPTY_ADJUSTMENT;
}

/** The project-wide cumulative sell-through TARGET entered for one specific
 * phase (defaults to the currently-selected state.projectPhase) -- never a
 * cross-phase fallback. A phase with no entry yet is null (unset), never
 * inherited from another phase and never coerced to 0%. Mirrors
 * phaseAdjustmentFor's own contract exactly, for the same reason: switching
 * projectPhase must only ever change WHICH phase's own value is read, never
 * invent or carry one. */
export function projectTargetSellThroughPctFor(state: MarketingStrategyState, phase: ProjectPhase = state.projectPhase): number | null {
  return state.targetSellThroughPctByPhase[phase] ?? null;
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

// ---------------------------------------------------------------------------
// Sales performance by product group (טיפוס דירה) -- a company-internal
// input layer, strictly separate from market indication. Nothing here ever
// reads or writes row.market_range, row.proposed_list_price_ils (the market
// indication itself), confidence, or any evidence-lane field: it only adds
// ONE new, purely Marketing-entered percentage into the same additive
// formula computePriceBreakdown already composes (phase + salesProgress +
// manual + this). No automatic price premium is ever derived from sell-
// through -- Marketing always types the group adjustment in explicitly; the
// sell-through/status fields below are informational only.
//
// Product groups are the exact same segments
// lib/comparisonSubject.ts's apartment-type selector already established
// (deriveComparisonSelectorOptions / productGroupKeyOf) -- never a second,
// parallel classification, and never hardcoded to 3R/5R only: a project
// with different special-unit room counts would automatically get
// different groups here too.
// ---------------------------------------------------------------------------

export interface ProductGroupSalesInput {
  // null = "not entered" (unknown) -- never coerced to 0. An integer,
  // 0 <= soldUnits <= that group's real inventory count (see
  // clampSoldUnits). One current/global cumulative actual value -- never
  // keyed per phase (unlike the target below): "how many are sold" is a
  // fact about today, regardless of which project phase is selected.
  soldUnits: number | null;
  // 0-100, optional company input: the CUMULATIVE sell-through target for
  // reaching a given project phase/milestone (e.g. presale 10%, launch 25%,
  // regular_sales 60%, final_inventory 90% -- illustrative only, never
  // hard-coded). Keyed per phase so switching state.projectPhase never
  // silently carries one milestone's target into another -- a phase with no
  // entry yet is unset (null), never inferred from another phase and never
  // coerced to 0%. See productGroupTargetSellThroughPctFor.
  targetSellThroughPctByPhase: Partial<Record<ProjectPhase, number | null>>;
  // The one explicit, Marketing-entered price lever this section
  // contributes -- reuses the exact same {adjustment_pct, rationale} shape
  // and control already used by every other strategy-adjustment level.
  adjustment: StrategyAdjustment;
}

export type ProductGroupSales = Record<string, ProductGroupSalesInput>;

export function emptyProductGroupSalesInput(): ProductGroupSalesInput {
  return { soldUnits: null, targetSellThroughPctByPhase: {}, adjustment: { ...EMPTY_ADJUSTMENT } };
}

function getGroupSalesInput(state: MarketingStrategyState, key: string): ProductGroupSalesInput {
  return state.productGroupSales[key] ?? emptyProductGroupSalesInput();
}

/** The product group's own cumulative sell-through TARGET entered for one
 * specific phase (defaults to the currently-selected state.projectPhase) --
 * never a cross-phase fallback, exactly like projectTargetSellThroughPctFor
 * above. A phase with no entry yet is null, never inherited/coerced. */
export function productGroupTargetSellThroughPctFor(
  input: ProductGroupSalesInput,
  phase: ProjectPhase
): number | null {
  return input.targetSellThroughPctByPhase[phase] ?? null;
}

/** The one term this feature adds to computePriceBreakdown's total: a plain
 * lookup of Marketing's own explicit per-group percentage for this row's
 * product group. 0 when that group has no adjustment (or no entry at all)
 * -- the same "no invented nonzero default" rule every other adjustment
 * level already follows. Never derived from sellThrough/status. */
export function salesPerformancePct(state: MarketingStrategyState, row: PtkPriceListRow): number {
  return getGroupSalesInput(state, productGroupKeyOf(row)).adjustment.adjustment_pct || 0;
}

export function clampSoldUnits(value: number, inventoryCount: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(inventoryCount, Math.round(value)));
}

export function clampTargetSellThroughPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

// Simple, deterministic, documented display tolerance -- not a business-
// approved threshold (none was supplied for this task): within +-2
// percentage points of the group's own target reads as "on pace". Display
// only; never feeds a price adjustment automatically. Deliberately its own
// constant/function rather than reusing sellThroughStatus's 0.5-point
// tolerance above, which was calibrated for the separate, already-shipped
// project-wide sales-pace badge and is left untouched by this feature.
export const PRODUCT_GROUP_STATUS_TOLERANCE_POINTS = 2;

export type ProductGroupSellThroughStatus = "unknown" | "no_target" | "above_target" | "on_target" | "below_target";

export const PRODUCT_GROUP_STATUS_LABELS: Record<ProductGroupSellThroughStatus, string> = {
  unknown: "לא הוזן",
  no_target: "לא הוגדר יעד",
  above_target: "מעל היעד",
  on_target: "בקצב היעד",
  below_target: "מתחת ליעד",
};

export interface ProductGroupSalesRow {
  key: string;
  label: string;
  inventoryCount: number;
  soldUnits: number | null;
  sellThroughPct: number | null;
  targetSellThroughPct: number | null;
  deltaPct: number | null;
  status: ProductGroupSellThroughStatus;
  adjustment: StrategyAdjustment;
  // Combined ₪ effect of this group's own adjustment across every row that
  // belongs to it (computed the same way computePriceBreakdown computes it
  // per-row -- never a separate calculation), so the UI can show "how much
  // this group's decision is worth" without re-deriving it itself. 0 when
  // the group has no adjustment.
  effectIls: number;
}

/** One row per real product-group segment currently in the inventory (the
 * exact same segments the Tab 2 apartment-type selector uses). Sell-through
 * is only ever computed once soldUnits has actually been entered for that
 * group -- a group with no entry stays "unknown" end to end, never a fake
 * 0%. Multi-level special units (e.g. a triplex spanning two floor rows in
 * the raw XLSX) are already collapsed to one apartment row upstream in the
 * normalized price list, so inventoryCount here is never inflated. */
export function deriveProductGroupSales(rows: PtkPriceListRow[], state: MarketingStrategyState): ProductGroupSalesRow[] {
  const segments = deriveComparisonSelectorOptions(rows);
  return segments.map((seg) => {
    const groupRows = rows.filter((r) => productGroupKeyOf(r) === seg.key);
    const inventoryCount = groupRows.length;
    const input = getGroupSalesInput(state, seg.key);
    // Resolved for the CURRENT project phase only -- see
    // productGroupTargetSellThroughPctFor's own contract. soldUnits stays
    // one current/global actual value regardless of phase.
    const targetSellThroughPct = productGroupTargetSellThroughPctFor(input, state.projectPhase);
    const sellThroughPct = input.soldUnits != null && inventoryCount > 0 ? (input.soldUnits / inventoryCount) * 100 : null;
    const deltaPct = sellThroughPct != null && targetSellThroughPct != null ? sellThroughPct - targetSellThroughPct : null;

    let status: ProductGroupSellThroughStatus;
    if (sellThroughPct == null) status = "unknown";
    else if (targetSellThroughPct == null) status = "no_target";
    else if (Math.abs(deltaPct!) <= PRODUCT_GROUP_STATUS_TOLERANCE_POINTS) status = "on_target";
    else status = deltaPct! > 0 ? "above_target" : "below_target";

    const effectIls = groupRows.reduce((sum, r) => sum + (computePriceBreakdown(state, r).salesPerformanceEffectIls ?? 0), 0);

    return {
      key: seg.key,
      label: seg.label,
      inventoryCount,
      soldUnits: input.soldUnits,
      sellThroughPct,
      targetSellThroughPct,
      deltaPct,
      status,
      adjustment: input.adjustment,
      effectIls,
    };
  });
}

export interface PriceBreakdown {
  marketIndicationIls: number | null;
  phasePct: number;
  salesProgressPct: number;
  manualPct: number;
  // Marketing's explicit per-product-group sales-performance adjustment
  // (see "Sales performance by product group" above) -- a fourth, separate
  // additive term, never folded into manualPct so the UI can always label
  // it distinctly (task item 8's "שלב הפרויקט / התאמת קבוצה / התאמת דירה /
  // השפעה משולבת" breakdown) and never derived automatically from sell-
  // through: it is exactly whatever percentage Marketing typed into this
  // row's product group in Tab 3, 0 when none was entered.
  salesPerformancePct: number;
  totalPct: number;
  proposedIls: number | null;
  // Individual ₪ effect of each named component. Since the formula sums
  // percentages before applying them to market_indication once, these four
  // effects add up exactly to (proposedIls - marketIndicationIls) -- no
  // compounding, no cross terms.
  phaseEffectIls: number | null;
  salesProgressEffectIls: number | null;
  manualEffectIls: number | null;
  salesPerformanceEffectIls: number | null;
}

/** proposed_price = market_indication * (1 + (phase_pct + sales_progress_pct
 * + manual_pct + sales_performance_pct) / 100). market_indication is
 * whatever price the (unchanged) pricing engine already produced for this
 * row -- row.proposed_list_price_ils, already reflecting the active
 * standard-family scenario or the special-unit market indication. No other
 * calculation happens here -- this remains the one canonical path from
 * market indication to proposed marketing price; sales-performance is one
 * more additive term in it, never a second, parallel price calculation. */
export function computePriceBreakdown(state: MarketingStrategyState, row: PtkPriceListRow): PriceBreakdown {
  const marketIndicationIls = row.proposed_list_price_ils;
  const phasePct = phaseAdjustmentFor(state).adjustment_pct || 0;
  const salesProgressPct = state.salesProgressAdjustment.adjustment_pct || 0;
  const manualPct = manualAdjustmentPct(state, row);
  const salesPerfPct = salesPerformancePct(state, row);
  const totalPct = phasePct + salesProgressPct + manualPct + salesPerfPct;

  if (marketIndicationIls == null) {
    return {
      marketIndicationIls: null,
      phasePct,
      salesProgressPct,
      manualPct,
      salesPerformancePct: salesPerfPct,
      totalPct,
      proposedIls: null,
      phaseEffectIls: null,
      salesProgressEffectIls: null,
      manualEffectIls: null,
      salesPerformanceEffectIls: null,
    };
  }

  return {
    marketIndicationIls,
    phasePct,
    salesProgressPct,
    manualPct,
    salesPerformancePct: salesPerfPct,
    totalPct,
    proposedIls: marketIndicationIls * (1 + totalPct / 100),
    phaseEffectIls: marketIndicationIls * (phasePct / 100),
    salesProgressEffectIls: marketIndicationIls * (salesProgressPct / 100),
    manualEffectIls: marketIndicationIls * (manualPct / 100),
    salesPerformanceEffectIls: marketIndicationIls * (salesPerfPct / 100),
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
 * manually. targetPct === null means no benchmark was supplied for the
 * phase being displayed -- a genuine, Marketing-entered 0% target (unusual
 * but valid) is NOT the same as "unset" and must not be treated as one. */
export type SellThroughStatus = "no_target" | "ahead" | "on_target" | "behind";

export function sellThroughStatus(actualPct: number, targetPct: number | null): SellThroughStatus {
  if (targetPct == null) return "no_target";
  const diff = actualPct - targetPct;
  if (Math.abs(diff) < 0.5) return "on_target";
  return diff > 0 ? "ahead" : "behind";
}

export const SELL_THROUGH_STATUS_LABELS: Record<SellThroughStatus, string> = {
  no_target: "לא הוגדר יעד",
  ahead: "מעל היעד",
  on_target: "בהתאם ליעד",
  behind: "מתחת ליעד",
};

/** Plain factual difference (actual - target), in percentage points --
 * never a price adjustment. Marketing still has to type
 * salesProgressAdjustment.adjustment_pct in manually; this only answers
 * "how far are we from the target," it never feeds the formula (see task
 * item 2). null when no target was supplied for the phase being displayed
 * (targetPct === null) -- never confused with a genuine 0% target. */
export function sellThroughGapPoints(actualPct: number, targetPct: number | null): number | null {
  if (targetPct == null) return null;
  return actualPct - targetPct;
}

// Exact Hebrew labels for the three commercial-adjustment levels (task item
// 3) -- centralized so the Strategy workspace (project-wide) and
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

// Two more, deliberately worded apart from each other and from the three
// above -- salesProgressAdjustment (project-wide, tied to overall sell-
// through pace) and the per-product-group salesPerformance adjustment (see
// "Sales performance by product group" above) are two SEPARATE, independent
// Marketing decisions that compose additively; neither is derived from the
// other or from any entered sell-through figure. When both show up in the
// same flat breakdown (the drawer's decision chain, the pricing waterfall),
// similar-sounding labels ("sales pace" vs "sales performance") could read
// as one redundant control instead of two distinct ones -- so the project-
// wide label spells out "כללית ... בפרויקט" (general, project-wide) and the
// group label always names its own group inline, never relying on
// surrounding layout alone to disambiguate.
export const SALES_PROGRESS_ADJUSTMENT_LABEL = "התאמה כללית לקצב המכירות בפרויקט";
export function salesPerformanceAdjustmentLabel(groupLabel: string): string {
  return `התאמת מחיר לקבוצת ${groupLabel}`;
}

export interface RevenueSummary {
  marketIndicationRevenueIls: number;
  proposedRevenueIls: number;
  differenceIls: number;
  phaseEffectRevenueIls: number;
  salesProgressEffectRevenueIls: number;
  manualEffectRevenueIls: number;
  salesPerformanceEffectRevenueIls: number;
}

// ---------------------------------------------------------------------------
// Strategy impact summary (Tab 3) -- "affected units" and "outside the
// supported market range" as two small, precisely-scoped comparative facts.
// Both read row.market_range, which has the identical {lower, upper,
// confidence} shape for standard AND special units alike (a special unit's
// range is its own indicative range, from a different methodology, but
// structurally the same field computePriceBreakdown already consumes
// generically for any row) -- so this runs over all 39 rows with a usable
// range rather than standard-only, and reports the two groups separately so
// a reader never has to guess which inventory slice a count describes.
// ---------------------------------------------------------------------------

export type RangePosition = "above_range" | "within_range" | "below_range";

export interface StrategyImpactUnit {
  unitNumber: string;
  bucket: FamilyBucket;
  proposedIls: number;
  lowerIls: number | null;
  upperIls: number | null;
  position: RangePosition;
}

export interface StrategyImpactGroup {
  totalWithRange: number;
  affectedCount: number;
  outsideRange: StrategyImpactUnit[];
}

export interface StrategyImpactSummary {
  standard: StrategyImpactGroup;
  special: StrategyImpactGroup;
}

function emptyImpactGroup(): StrategyImpactGroup {
  return { totalWithRange: 0, affectedCount: 0, outsideRange: [] };
}

/** For every row with a usable market_range, compares the current
 * proposed price (computePriceBreakdown, unchanged formula) against that
 * range -- purely comparative display logic, no new pricing input. A row
 * counts as "affected" only when totalPct !== 0 for that specific unit
 * (the same definition the drawer/consistency review already use), never a
 * blanket "every unit" count. Rows without a usable range (lower and upper
 * both null, or no market_range at all) are excluded rather than coerced
 * into a false in-range/out-of-range verdict. */
export function deriveStrategyImpactSummary(rows: PtkPriceListRow[], state: MarketingStrategyState): StrategyImpactSummary {
  const standard = emptyImpactGroup();
  const special = emptyImpactGroup();

  for (const row of rows) {
    const range = row.market_range;
    if (!range || (range.lower == null && range.upper == null)) continue;
    const breakdown = computePriceBreakdown(state, row);
    if (breakdown.proposedIls == null) continue;

    const group = row.family_key != null ? standard : special;
    group.totalWithRange += 1;
    if (breakdown.totalPct !== 0) group.affectedCount += 1;

    const proposed = breakdown.proposedIls;
    let position: RangePosition = "within_range";
    if (range.upper != null && proposed > range.upper) position = "above_range";
    else if (range.lower != null && proposed < range.lower) position = "below_range";

    if (position !== "within_range") {
      group.outsideRange.push({
        unitNumber: row.unit_number,
        bucket: familyBucketOf(row),
        proposedIls: proposed,
        lowerIls: range.lower,
        upperIls: range.upper,
        position,
      });
    }
  }

  return { standard, special };
}

export const RANGE_POSITION_LABELS: Record<RangePosition, string> = {
  above_range: "מעל טווח השוק",
  within_range: "בתוך טווח השוק",
  below_range: "מתחת לטווח השוק",
};

export function computeRevenueSummary(rows: PtkPriceListRow[], state: MarketingStrategyState): RevenueSummary {
  let marketIndicationRevenueIls = 0;
  let proposedRevenueIls = 0;
  let phaseEffectRevenueIls = 0;
  let salesProgressEffectRevenueIls = 0;
  let manualEffectRevenueIls = 0;
  let salesPerformanceEffectRevenueIls = 0;
  for (const row of rows) {
    const breakdown = computePriceBreakdown(state, row);
    if (breakdown.marketIndicationIls == null) continue;
    marketIndicationRevenueIls += breakdown.marketIndicationIls;
    proposedRevenueIls += breakdown.proposedIls ?? breakdown.marketIndicationIls;
    phaseEffectRevenueIls += breakdown.phaseEffectIls ?? 0;
    salesProgressEffectRevenueIls += breakdown.salesProgressEffectIls ?? 0;
    manualEffectRevenueIls += breakdown.manualEffectIls ?? 0;
    salesPerformanceEffectRevenueIls += breakdown.salesPerformanceEffectIls ?? 0;
  }
  return {
    marketIndicationRevenueIls,
    proposedRevenueIls,
    differenceIls: proposedRevenueIls - marketIndicationRevenueIls,
    phaseEffectRevenueIls,
    salesProgressEffectRevenueIls,
    manualEffectRevenueIls,
    salesPerformanceEffectRevenueIls,
  };
}

// ---------------------------------------------------------------------------
// Marketing decision-support layer (Tab 3 redesign) -- turns the strategy
// screen from "type a percentage" into "where does Marketing need to look,
// why, and what would changing it do." Every function below is a pure,
// read-only DERIVATION over existing state/rows: none of it writes state,
// none of it produces a recommended percentage, and none of it creates a
// second price calculation -- everything here still funnels through
// computePriceBreakdown. A "signal" (MarketingDecisionSignal) is display
// guidance only; it is never written into productGroupSales or any other
// state field, so it can never be mistaken for -- or accidentally persisted
// as -- an actual pricing decision (see StrategyAdjustment).
// ---------------------------------------------------------------------------

// Exact wording from the task (distinct from the older RangePosition/
// RANGE_POSITION_LABELS pair above, which power the separately-shipped
// "מה השוק תומך" section and are left untouched): this one adds an explicit
// "no range" state so a missing supported range is never silently coerced
// into "within range."
export type PricePositionKind = "below_range" | "within_range" | "above_range" | "no_range";

export const PRICE_POSITION_LABELS: Record<PricePositionKind, string> = {
  below_range: "מתחת לטווח",
  within_range: "בתוך הטווח",
  above_range: "מעל הטווח",
  no_range: "אין טווח נתמך",
};

/** One apartment's proposed price vs. its own supported market range --
 * never an aggregated/synthetic range. "no_range" when the range is missing
 * entirely (never treated as in-range by default). */
export function derivePriceRangePosition(
  proposedIls: number | null,
  range: { lower: number | null; upper: number | null } | null | undefined
): PricePositionKind {
  if (proposedIls == null || !range || (range.lower == null && range.upper == null)) return "no_range";
  if (range.upper != null && proposedIls > range.upper) return "above_range";
  if (range.lower != null && proposedIls < range.lower) return "below_range";
  return "within_range";
}

/** Collapses a group's per-unit position counts into one representative
 * position for signal purposes, in a fixed, documented priority: any unit
 * priced above its own range is the strongest pricing-conflict fact and
 * wins first (even one such unit in an otherwise-fine group deserves a
 * look); then any below-range unit; then within-range; "no_range" only when
 * literally none of the group's units have a usable range at all. This is
 * a display/signal convenience only -- it never stands in for the real
 * per-unit ranges, which deriveProductGroupSalesSummary/
 * deriveProductGroupStrategyImpact both expose alongside it via
 * positionCounts. */
export function aggregatePricePosition(counts: Record<PricePositionKind, number>): PricePositionKind {
  if (counts.above_range > 0) return "above_range";
  if (counts.below_range > 0) return "below_range";
  if (counts.within_range > 0) return "within_range";
  return "no_range";
}

function worstConfidence(confidences: (string | null | undefined)[]): string | null {
  let worst: string | null = null;
  let worstRank = -1;
  for (const c of confidences) {
    if (c == null) continue;
    const rank = CONFIDENCE_RANK[c] ?? 0;
    if (rank > worstRank) {
      worstRank = rank;
      worst = c;
    }
  }
  return worst;
}

export interface ProductGroupMarketPosition {
  positionCounts: Record<PricePositionKind, number>;
  totalRows: number;
  aggregatePosition: PricePositionKind;
  // true only when every row in the group shares the identical market
  // indication + range + confidence -- true for the demo's two standard
  // families by construction (one shared family-level price), false
  // whenever a group's units genuinely differ (special groups with more
  // than one unit). Never forced true to make the UI simpler.
  isUniform: boolean;
  // Only populated when isUniform -- a single "מה השוק אומר" figure is
  // only ever shown when it truly represents every unit in the group.
  representativeIls: number | null;
  representativeRange: { lower: number | null; upper: number | null } | null;
  representativeConfidence: string | null;
  // Present regardless of uniformity -- the lowest-confidence unit's
  // confidence in the group, used only for the signal's caution caveat
  // (task item 10-F), never for a claimed single market figure.
  worstConfidence: string | null;
}

function deriveGroupMarketPosition(groupRows: PtkPriceListRow[], state: MarketingStrategyState): ProductGroupMarketPosition {
  const positionCounts: Record<PricePositionKind, number> = { below_range: 0, within_range: 0, above_range: 0, no_range: 0 };
  for (const row of groupRows) {
    const proposedIls = computePriceBreakdown(state, row).proposedIls;
    positionCounts[derivePriceRangePosition(proposedIls, row.market_range)] += 1;
  }

  const first = groupRows[0];
  const isUniform =
    groupRows.length > 0 &&
    groupRows.every(
      (r) =>
        r.proposed_list_price_ils === first.proposed_list_price_ils &&
        (r.market_range?.lower ?? null) === (first.market_range?.lower ?? null) &&
        (r.market_range?.upper ?? null) === (first.market_range?.upper ?? null) &&
        (r.market_range?.confidence ?? null) === (first.market_range?.confidence ?? null)
    );

  return {
    positionCounts,
    totalRows: groupRows.length,
    aggregatePosition: aggregatePricePosition(positionCounts),
    isUniform,
    representativeIls: isUniform ? first.proposed_list_price_ils : null,
    representativeRange: isUniform ? { lower: first.market_range?.lower ?? null, upper: first.market_range?.upper ?? null } : null,
    representativeConfidence: isUniform ? first.market_range?.confidence ?? null : null,
    worstConfidence: worstConfidence(groupRows.map((r) => r.market_range?.confidence ?? null)),
  };
}

// ---------------------------------------------------------------------------
// Decision signals -- structured, deterministic guidance derived from
// (a) the group's own sell-through-vs-target status (reusing
// deriveProductGroupSales's ProductGroupSellThroughStatus and its existing
// +-2pp tolerance, never a second threshold model) and (b) the group's
// aggregate price position. A signal is guidance for Marketing to look at,
// never a recommended percentage and never auto-applied to
// productGroupSales.adjustment -- that stays a separate, explicitly
// Marketing-entered value that always defaults to 0%.
// ---------------------------------------------------------------------------

export type MarketingSignalKind = "insufficient_data" | "review_price" | "review" | "opportunity" | "strong_sales" | "no_exception";

export const MARKETING_SIGNAL_LABELS: Record<MarketingSignalKind, string> = {
  insufficient_data: "אין מספיק נתוני מכירות",
  review_price: "דורש בדיקת מחיר",
  review: "דורש בחינה",
  opportunity: "אפשר לבחון העלאת מחיר",
  strong_sales: "מכירות חזקות",
  no_exception: "ללא חריגה",
};

export interface MarketingDecisionSignal {
  kind: MarketingSignalKind;
  label: string;
  reasons: string[];
}

/** Priority order (task item 11), deterministic, no invented thresholds
 * beyond the existing +-2pp sell-through tolerance:
 *   1. insufficient sales-comparison data (no sold count or no target)
 *   2. below target AND price above its supported range -> review_price
 *   3. below target (any other price position) -> review
 *   4. above target AND price above its supported range -> strong_sales
 *   5. above target (any other price position) -> opportunity
 *   6. otherwise (on target) -> no_exception
 * A missing supported range never claims high/low by itself (task item
 * 10-G) -- it only appends a caveat alongside whatever the sales
 * comparison already established. Confidence is always a secondary,
 * appended caveat (task item 10-F), never the primary signal. */
export function deriveMarketingDecisionSignal(params: {
  salesStatus: ProductGroupSellThroughStatus;
  pricePosition: PricePositionKind;
  confidence: string | null;
}): MarketingDecisionSignal {
  const { salesStatus, pricePosition, confidence } = params;
  const reasons: string[] = [];
  let kind: MarketingSignalKind;

  if (salesStatus === "unknown" || salesStatus === "no_target") {
    kind = "insufficient_data";
  } else if (salesStatus === "below_target") {
    if (pricePosition === "above_range") {
      kind = "review_price";
      reasons.push("שיעור המכירה נמוך מהיעד ומחיר השיווק נמצא מעל טווח השוק.");
    } else {
      kind = "review";
      reasons.push("שיעור המכירה נמוך מהיעד, אך המחיר עדיין בתוך טווח השוק.");
      reasons.push("יש לבדוק אם הפער קשור למחיר או למאפייני המוצר.");
    }
  } else if (salesStatus === "above_target") {
    if (pricePosition === "above_range") {
      kind = "strong_sales";
      reasons.push("שיעור המכירה גבוה מהיעד למרות מחיר מעל טווח השוק.");
    } else {
      kind = "opportunity";
      reasons.push("שיעור המכירה גבוה מהיעד והמחיר עדיין בתוך טווח השוק.");
    }
  } else {
    kind = "no_exception";
  }

  if (pricePosition === "no_range" && kind !== "insufficient_data") {
    reasons.push("אין טווח שוק נתמך להשוואה.");
  }
  if (confidence === "low" || confidence === "insufficient") {
    reasons.push("ראיות השוק מוגבלות.");
  }

  return { kind, label: MARKETING_SIGNAL_LABELS[kind], reasons };
}

// One row per product group, ready for Section B's decision table and
// Section C's selected-group panel -- ProductGroupSalesRow (sales/target/
// adjustment, already shipped and tested) enriched with the market
// position and the derived signal, without changing or duplicating either.
export interface ProductGroupDecisionRow extends ProductGroupSalesRow {
  market: ProductGroupMarketPosition;
  signal: MarketingDecisionSignal;
}

export function deriveProductGroupSalesSummary(rows: PtkPriceListRow[], state: MarketingStrategyState): ProductGroupDecisionRow[] {
  const salesRows = deriveProductGroupSales(rows, state);
  return salesRows.map((salesRow) => {
    const groupRows = rows.filter((r) => productGroupKeyOf(r) === salesRow.key);
    const market = deriveGroupMarketPosition(groupRows, state);
    const signal = deriveMarketingDecisionSignal({
      salesStatus: salesRow.status,
      pricePosition: market.aggregatePosition,
      confidence: market.worstConfidence,
    });
    return { ...salesRow, market, signal };
  });
}

// ---------------------------------------------------------------------------
// Before/after preview for Section C -- "what would applying/changing this
// group's decision do." "Before" is computed by re-running
// computePriceBreakdown with ONLY this group's own adjustment forced to 0%
// (every other active adjustment -- phase, sales-progress, project,
// family/unit, every OTHER group -- stays exactly as currently set), so the
// comparison always answers "what does this group's own decision change,"
// not "what did I last save," and needs no separate draft/snapshot state.
// For a non-uniform (typically special) group, a single ₪ figure would
// misrepresent it, so both before/after are exposed as a min-max range
// (min === max when the group is uniform) alongside full position counts.
// ---------------------------------------------------------------------------

export interface ProductGroupStrategyImpact {
  groupKey: string;
  // > 0 (= the group's inventory count) only while this group's own
  // adjustment is currently non-zero; 0 when there is no active decision
  // for this group to have affected anything.
  affectedUnitsCount: number;
  beforeIlsRange: { min: number; max: number } | null;
  afterIlsRange: { min: number; max: number } | null;
  isUniform: boolean;
  beforePositionCounts: Record<PricePositionKind, number>;
  afterPositionCounts: Record<PricePositionKind, number>;
}

export function deriveProductGroupStrategyImpact(
  rows: PtkPriceListRow[],
  state: MarketingStrategyState,
  groupKey: string
): ProductGroupStrategyImpact {
  const groupRows = rows.filter((r) => productGroupKeyOf(r) === groupKey);
  const ownInput = getGroupSalesInput(state, groupKey);
  const withoutOwnAdjustment: MarketingStrategyState = {
    ...state,
    productGroupSales: { ...state.productGroupSales, [groupKey]: { ...ownInput, adjustment: { ...EMPTY_ADJUSTMENT } } },
  };

  const beforePositionCounts: Record<PricePositionKind, number> = { below_range: 0, within_range: 0, above_range: 0, no_range: 0 };
  const afterPositionCounts: Record<PricePositionKind, number> = { below_range: 0, within_range: 0, above_range: 0, no_range: 0 };
  let beforeMin = Infinity;
  let beforeMax = -Infinity;
  let afterMin = Infinity;
  let afterMax = -Infinity;
  let anyPriced = false;

  for (const row of groupRows) {
    const before = computePriceBreakdown(withoutOwnAdjustment, row);
    const after = computePriceBreakdown(state, row);
    beforePositionCounts[derivePriceRangePosition(before.proposedIls, row.market_range)] += 1;
    afterPositionCounts[derivePriceRangePosition(after.proposedIls, row.market_range)] += 1;
    if (before.proposedIls != null && after.proposedIls != null) {
      anyPriced = true;
      beforeMin = Math.min(beforeMin, before.proposedIls);
      beforeMax = Math.max(beforeMax, before.proposedIls);
      afterMin = Math.min(afterMin, after.proposedIls);
      afterMax = Math.max(afterMax, after.proposedIls);
    }
  }

  return {
    groupKey,
    affectedUnitsCount: (ownInput.adjustment.adjustment_pct || 0) !== 0 ? groupRows.length : 0,
    beforeIlsRange: anyPriced ? { min: beforeMin, max: beforeMax } : null,
    afterIlsRange: anyPriced ? { min: afterMin, max: afterMax } : null,
    isUniform: anyPriced && beforeMin === beforeMax && afterMin === afterMax,
    beforePositionCounts,
    afterPositionCounts,
  };
}
