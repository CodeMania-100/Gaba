// Pure, presentation-only price-list consistency review (task "Focused
// Batch — Price List Consistency Review"). Reads only proposed_price and
// its already-existing, already-deterministic inputs (market indication,
// project/group/unit strategy adjustments) via lib/marketingStrategy.ts's
// computePriceBreakdown -- no new pricing rule, no new valuation model, no
// feature-price coefficient is ever invented here. This module only
// explains WHY two proposed prices differ (or flags that it can't), using
// facts that already exist on the row/state; it never judges a price
// "right" or "wrong".

import { PtkPriceListRow } from "./api";
import { outdoorLabel, roomsOf, unitTypeLabel } from "./family";
import { ils, num } from "./format";
import {
  computePriceBreakdown,
  EMPTY_ADJUSTMENT,
  familyBucketOf,
  FAMILY_BUCKET_LABELS,
  FamilyBucket,
  MarketingStrategyState,
  PriceBreakdown,
  StrategyAdjustment,
} from "./marketingStrategy";

// A UI review threshold only -- decides when a price difference is worth
// showing at all (so ₪1 of floating-point noise never becomes a "finding").
// This is NOT a valuation rule and never appears as if it were one (task
// item 6): it is never compared against a percentage, never described as
// an "acceptable" gap, and never used to decide explained vs. needs-review
// -- only whether a difference is big enough to mention in the first place.
export const REVIEW_NOISE_FLOOR_ILS = 500;

export type ConsistencyStatus = "consistent" | "explained" | "needs_review";

export interface UnitSnapshot {
  row: PtkPriceListRow;
  breakdown: PriceBreakdown;
  unitAdjustment: StrategyAdjustment;
  groupAdjustment: StrategyAdjustment;
}

function buildSnapshot(row: PtkPriceListRow, state: MarketingStrategyState): UnitSnapshot {
  const bucket = familyBucketOf(row);
  return {
    row,
    breakdown: computePriceBreakdown(state, row),
    unitAdjustment: state.unitAdjustments[row.unit_number] ?? EMPTY_ADJUSTMENT,
    groupAdjustment: state.familyAdjustments[bucket] ?? EMPTY_ADJUSTMENT,
  };
}

export interface PhysicalDiffRow {
  label: string;
  a: string;
  b: string;
  same: boolean;
}

/** Only the fields this task explicitly allows (task item 2) -- never
 * parking/storage unless both sides actually have a known value, and never
 * a field that doesn't exist on the row. */
function physicalDiffs(a: PtkPriceListRow, b: PtkPriceListRow): PhysicalDiffRow[] {
  const rows: PhysicalDiffRow[] = [];
  const push = (label: string, av: string | number | boolean | null | undefined, bv: string | number | boolean | null | undefined, format?: (v: string | number | boolean) => string) => {
    if (av == null || bv == null) return;
    const at = format ? format(av) : String(av);
    const bt = format ? format(bv) : String(bv);
    rows.push({ label, a: at, b: bt, same: at === bt });
  };
  push("שטח פנימי", a.internal_area_sqm, b.internal_area_sqm, (v) => `${num(v as number)} מ״ר`);
  push(outdoorLabel(a.family), a.balcony_area_sqm, b.balcony_area_sqm, (v) => `${num(v as number)} מ״ר`);
  push("כיוון", a.orientation, b.orientation);
  push("קומה", a.floor, b.floor);
  push("חניה", a.parking, b.parking, (v) => num(v as number));
  push("מחסן", a.storage, b.storage, (v) => (v ? "יש" : "אין"));
  return rows;
}

export interface ConsistencyFinding {
  id: string;
  groupLabel: string;
  unitA: UnitSnapshot;
  unitB: UnitSnapshot;
  diffIls: number;
  diffPct: number;
  status: ConsistencyStatus;
  physicalDiffs: PhysicalDiffRow[];
  // The three factual lines task item 10 always wants: market indication,
  // group adjustment, unit adjustment -- each either "identical" or its own
  // differing values, never a computed cause/effect claim.
  marketIndicationLine: string;
  groupAdjustmentLine: string;
  unitAdjustmentLine: string;
  // Which unit (if either) carries the differing, non-empty rationale text
  // that explains the unit-adjustment line -- null when no adjustment
  // differs, or when it does but no rationale was typed (task item 18: show
  // "לא הוזן נימוק להתאמה" rather than pretending the reason is known).
  rationale: { unitNumber: string; text: string } | null;
  rationaleMissing: boolean;
}

function fmtPct(pct: number): string {
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/** Compares two units already established to belong to the same review
 * group (task item 3: same standard family, or the one 36/37 pair) --
 * returns null only when either unit has no proposed price yet. When the
 * difference doesn't clear the noise floor, status is "consistent" rather
 * than dropping the comparison entirely -- callers that only want a
 * "findings list" (worth flagging) should skip consistent results
 * themselves; callers that always want to show a fixed pair (task item 7's
 * Unit 36/37 card) can render the "consistent" state directly. Classification
 * is fully deterministic: because phase/sales-progress/project adjustments
 * are always shared within one group, the only fields that can legitimately
 * differ are market_indication and the unit-level adjustment -- so
 * "needs_review" only fires in the (here, essentially unreachable but still
 * correctly handled) case where neither differs yet the prices do. */
export function compareUnits(a: UnitSnapshot, b: UnitSnapshot, groupLabel: string): ConsistencyFinding | null {
  const proposedA = a.breakdown.proposedIls;
  const proposedB = b.breakdown.proposedIls;
  if (proposedA == null || proposedB == null) return null;

  const diffIls = proposedB - proposedA;
  const diffPct = proposedA !== 0 ? (diffIls / proposedA) * 100 : 0;
  const meaningfulDiff = Math.abs(diffIls) >= REVIEW_NOISE_FLOOR_ILS;

  const marketA = a.breakdown.marketIndicationIls;
  const marketB = b.breakdown.marketIndicationIls;
  const marketDiffers = marketA != null && marketB != null && Math.abs(marketA - marketB) >= REVIEW_NOISE_FLOOR_ILS;
  const marketIndicationLine = marketDiffers ? `אינדיקציית שוק שונה: ${ils(marketA)} מול ${ils(marketB)}` : "אינדיקציית השוק זהה";

  const groupDiffers = a.groupAdjustment.adjustment_pct !== b.groupAdjustment.adjustment_pct;
  const groupAdjustmentLine = groupDiffers
    ? `התאמה לקבוצת הדירות שונה: ${fmtPct(a.groupAdjustment.adjustment_pct)} מול ${fmtPct(b.groupAdjustment.adjustment_pct)}`
    : "התאמה לקבוצת הדירות זהה";

  const unitDiffers = a.unitAdjustment.adjustment_pct !== b.unitAdjustment.adjustment_pct;
  let unitAdjustmentLine: string;
  let rationale: { unitNumber: string; text: string } | null = null;
  let rationaleMissing = false;
  if (unitDiffers) {
    const higher = a.unitAdjustment.adjustment_pct >= b.unitAdjustment.adjustment_pct ? a : b;
    unitAdjustmentLine = `התאמה לדירה ${higher.row.unit_number}: ${fmtPct(higher.unitAdjustment.adjustment_pct)}`;
    if (higher.unitAdjustment.rationale.trim()) {
      rationale = { unitNumber: higher.row.unit_number, text: higher.unitAdjustment.rationale.trim() };
    } else {
      rationaleMissing = true;
    }
  } else {
    unitAdjustmentLine = "התאמה לדירה זו זהה בשתי הדירות";
  }

  const explained = marketDiffers || groupDiffers || unitDiffers;
  const status: ConsistencyStatus = !meaningfulDiff ? "consistent" : explained ? "explained" : "needs_review";

  return {
    id: `${a.row.unit_number}-${b.row.unit_number}`,
    groupLabel,
    unitA: a,
    unitB: b,
    diffIls,
    diffPct,
    status,
    physicalDiffs: physicalDiffs(a.row, b.row),
    marketIndicationLine,
    groupAdjustmentLine,
    unitAdjustmentLine,
    rationale,
    rationaleMissing,
  };
}

// ---------------------------------------------------------------------------
// Standard-family floor ladder (task items 4, 16)
// ---------------------------------------------------------------------------

export interface FamilyLadderRow {
  unitNumber: string;
  floor: string | number | null;
  marketIndicationIls: number | null;
  totalPct: number;
  proposedIls: number | null;
  deltaVsPreviousIls: number | null;
}

function floorSortKey(floor: string | number | null | undefined): number {
  if (floor == null) return Number.POSITIVE_INFINITY;
  const n = Number(floor);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

export function buildFamilyLadder(rows: PtkPriceListRow[], state: MarketingStrategyState, family: "3R" | "5R"): FamilyLadderRow[] {
  const familyRows = rows.filter((r) => r.family === family).sort((a, b) => floorSortKey(a.floor) - floorSortKey(b.floor));
  const ladder: FamilyLadderRow[] = [];
  let previousProposed: number | null = null;
  for (const row of familyRows) {
    const breakdown = computePriceBreakdown(state, row);
    ladder.push({
      unitNumber: row.unit_number,
      floor: row.floor,
      marketIndicationIls: breakdown.marketIndicationIls,
      totalPct: breakdown.totalPct,
      proposedIls: breakdown.proposedIls,
      deltaVsPreviousIls: previousProposed != null && breakdown.proposedIls != null ? breakdown.proposedIls - previousProposed : null,
    });
    if (breakdown.proposedIls != null) previousProposed = breakdown.proposedIls;
  }
  return ladder;
}

/** Consecutive pairs in the floor-sorted ladder only -- bounded to N-1
 * comparisons per family (never an all-pairs O(n²) sweep), and it's exactly
 * what the ladder visualization already shows side by side (task item 4's
 * "שינוי מול היחידה הקודמת" column is the same adjacent-pair relationship
 * this reuses for the findings list). */
export function standardFamilyFindings(rows: PtkPriceListRow[], state: MarketingStrategyState, family: "3R" | "5R"): ConsistencyFinding[] {
  const familyRows = rows.filter((r) => r.family === family).sort((a, b) => floorSortKey(a.floor) - floorSortKey(b.floor));
  const groupLabel = FAMILY_BUCKET_LABELS[family as FamilyBucket];
  const findings: ConsistencyFinding[] = [];
  for (let i = 1; i < familyRows.length; i++) {
    const a = buildSnapshot(familyRows[i - 1], state);
    const b = buildSnapshot(familyRows[i], state);
    const finding = compareUnits(a, b, groupLabel);
    // "consistent" pairs aren't worth a card in the findings list (task item
    // 16: compact by default) -- they're still visible in the full ladder.
    if (finding && finding.status !== "consistent") findings.push(finding);
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Unit 36 / 37 (task item 7) -- the one defensible special-unit comparison
// pair in this inventory; never generalized to any other special-unit pair.
// ---------------------------------------------------------------------------

export function unit3637Finding(rows: PtkPriceListRow[], state: MarketingStrategyState): ConsistencyFinding | null {
  const row36 = rows.find((r) => r.unit_number === "36");
  const row37 = rows.find((r) => r.unit_number === "37");
  if (!row36 || !row37) return null;
  const a = buildSnapshot(row36, state);
  const b = buildSnapshot(row37, state);
  return compareUnits(a, b, "טריפלקס 6 חדרים");
}

// ---------------------------------------------------------------------------
// Whole-board summary (task item 9)
// ---------------------------------------------------------------------------

export interface ConsistencySummary {
  unitsReviewed: number;
  explainedCount: number;
  needsReviewCount: number;
  findings: ConsistencyFinding[];
}

export function buildConsistencySummary(rows: PtkPriceListRow[], state: MarketingStrategyState): ConsistencySummary {
  const findings: ConsistencyFinding[] = [
    ...standardFamilyFindings(rows, state, "3R"),
    ...standardFamilyFindings(rows, state, "5R"),
    ...(unit3637Finding(rows, state) ? [unit3637Finding(rows, state)!] : []),
  ];
  return {
    unitsReviewed: rows.length,
    explainedCount: findings.filter((f) => f.status === "explained").length,
    needsReviewCount: findings.filter((f) => f.status === "needs_review").length,
    findings,
  };
}

// Re-exported for display convenience (unit type / rooms labels the review
// UI needs alongside the physical-diff rows above).
export { outdoorLabel, roomsOf, unitTypeLabel };
