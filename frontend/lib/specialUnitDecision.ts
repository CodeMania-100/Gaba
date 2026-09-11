// Pure, presentation-only derivations for the special-unit ("Focused Batch —
// Special Apartment Decision Drawer") redesign. Every function here reads
// straight from the same canonical objects that already drive pricing and
// the market map (SpecialUnitContext / SpecialUnitIndication -- comps_used,
// comps_context_only, excluded, sold_selected, sold_rejected; see
// lib/marketMap.ts's buildStatusIndex for the map's equivalent read of the
// same fields) -- nothing here recomputes market_indication, a tier, or an
// eligibility rule. This module only groups, labels, and counts what
// already exists, in Hebrew, for the drawer's compact decision layer.

import { SpecialUnitComparable, SpecialUnitContext, SpecialUnitIndication, SpecialUnitLaneResult } from "./api";
import { SPECIAL_UNIT_CATEGORY_LABELS } from "./marketMap";

export type SpecialLaneName = "sold" | "current_asking" | "new_development";

export const LANE_TITLES: Record<SpecialLaneName, string> = {
  sold: "עסקאות שבוצעו",
  current_asking: "הצעות קיימות",
  new_development: "פרויקטים חדשים",
};

// ---------------------------------------------------------------------------
// B. Plain-language method sentence (task item 4)
// ---------------------------------------------------------------------------

/** category-keyed exact wording the task supplies for the two categories
 * that actually appear with this evidence composition in the current
 * dataset (triplex: no direct triplex sale; duplex: some direct/broadened
 * duplex evidence found) -- garden (or any future category) falls back to a
 * sentence composed from the unit's own real voting lanes, never a fixed
 * guess. Internal names (route, numeric_status, broadened_premium_unit_review)
 * never appear here. */
export function methodSentence(context: SpecialUnitContext): string {
  if (context.category === "triplex") {
    return "האינדיקציה מבוססת על עסקאות של נכסים רב־מפלסיים גדולים, בהיעדר עסקה מאומתת של טריפלקס בגודל דומה לדירה.";
  }
  if (context.category === "duplex") {
    return "האינדיקציה מבוססת על עסקאות דופלקס / נכסים רב־מפלסיים שנמצאו מתאימים, לצד נתוני שוק עדכניים ופרויקטים חדשים.";
  }
  const categoryLabel = SPECIAL_UNIT_CATEGORY_LABELS[context.category] ?? context.category;
  const indication = context.market_indication;
  if (!indication || indication.voting_lane_names.length === 0) {
    return `לא נמצאו כרגע מספיק ראיות מאומתות כדי לבסס אינדיקציית מחיר ל${categoryLabel} זו.`;
  }
  const laneLabels = indication.voting_lane_names.map((l) => LANE_TITLES[l as SpecialLaneName] ?? l);
  return `האינדיקציה מבוססת על ${laneLabels.join(" ו")} של ${categoryLabel} דומות באזור.`;
}

// ---------------------------------------------------------------------------
// Shared: which lane actually anchors the primary chart/funnel/confidence
// read -- the voting lane with real participating comparables, preferring
// sold (actual completed transactions) when it has any.
// ---------------------------------------------------------------------------

export function primaryLaneName(indication: SpecialUnitIndication | null | undefined): SpecialLaneName | null {
  if (!indication) return null;
  if ((indication.lanes.sold?.comps_used.length ?? 0) > 0) return "sold";
  if (indication.lanes.current_asking) return "current_asking";
  if (indication.lanes.new_development) return "new_development";
  return null;
}

// ---------------------------------------------------------------------------
// Primary visualization -- comparable price-axis chart (task item 5)
// ---------------------------------------------------------------------------

export interface ChartPoint {
  label: string;
  priceIls: number;
  participating: boolean; // false = context-only (shown quieter, per item 5)
  isHighlighted: boolean;
}

/** One dot per participating/context comparable in the given lane --
 * excluded records are never included (they are not in comps_used or
 * comps_context_only at all), matching item 5/25's requirement that
 * excluded records never render as chart dots. */
export function deriveChartPoints(lane: SpecialUnitLaneResult | null | undefined, highlightedLabel?: string): ChartPoint[] {
  if (!lane) return [];
  return [
    ...lane.comps_used.map((c) => ({ label: c.label, priceIls: c.comparable_price_ils, participating: true, isHighlighted: c.label === highlightedLabel })),
    ...lane.comps_context_only.map((c) => ({ label: c.label, priceIls: c.comparable_price_ils, participating: false, isHighlighted: false })),
  ];
}

/** Whether the lane's own reference value is a raw price median (no area
 * normalization) or an area-normalized median -- read straight off
 * calculation_method, never inferred (task item 5: "If it is a raw median,
 * label it as such"). */
export function chartMethodLabel(lane: SpecialUnitLaneResult | null | undefined): string | null {
  if (!lane) return null;
  return lane.calculation_method === "raw_price_median" ? "חציון מחירים גולמיים (ללא נירמול שטח)" : "חציון ערכים מנורמלים לשטח";
}

// ---------------------------------------------------------------------------
// Highlighted / "central" comparable (task items 6, 23)
// ---------------------------------------------------------------------------

export interface HighlightedComparable {
  comparable: SpecialUnitComparable;
  areaDeltaSqm: number;
  areaDeltaPct: number;
  sameRoomOnly: boolean;
  // Always this wording -- there is no pre-existing deterministic "best
  // comparable" ranking in pricing_core.special_market_indication, so this
  // is never called "ההשוואה הקרובה ביותר" (task item 6/23).
  ruleLabel: string;
}

/** Simple, transparent, documented rule (task item 23): among this lane's
 * *participating* comparables (comps_used only -- never context-only or
 * excluded), pick the smallest absolute internal-area difference from the
 * subject, preferring same-room comparables when the subject's room count
 * and the comparable's raw.rooms are both known. This is a new, minimal
 * display rule -- it does not feed market_indication or any pricing output. */
export function deriveHighlightedComparable(lane: SpecialUnitLaneResult | null | undefined, subjectRooms: number | null): HighlightedComparable | null {
  if (!lane || lane.comps_used.length === 0) return null;
  const sameRoom = subjectRooms != null ? lane.comps_used.filter((c) => (c.raw?.rooms as number | undefined) === subjectRooms) : [];
  const pool = sameRoom.length > 0 ? sameRoom : lane.comps_used;
  const best = pool.reduce((a, b) => (Math.abs(a.comparable_area_sqm - a.subject_area_sqm) <= Math.abs(b.comparable_area_sqm - b.subject_area_sqm) ? a : b));
  const areaDeltaSqm = best.comparable_area_sqm - best.subject_area_sqm;
  return {
    comparable: best,
    areaDeltaSqm,
    areaDeltaPct: (areaDeltaSqm / best.subject_area_sqm) * 100,
    sameRoomOnly: sameRoom.length > 0,
    ruleLabel: "עסקה מרכזית מתוך סל ההשוואה",
  };
}

// ---------------------------------------------------------------------------
// Confidence explanation -- at most 3 dimensions, words only (task item 7)
// ---------------------------------------------------------------------------

export interface ConfidenceDimension {
  label: string;
  value: string;
}

/** Three factual dimensions derived from real, already-computed indication
 * fields -- never a numeric score. Thresholds are a display-only judgment
 * call (documented here), not a pricing rule: they decide only which of a
 * few fixed Hebrew words to show, never a number, and never feed back into
 * confidence/market_indication themselves (those remain pricing_core's own
 * output, read as-is). */
/** `broadDirectTypeContextCount` (task item 8): the number of real,
 * verified-address, non-voting direct-type context records found for this
 * category (e.g. the Apt36/37 triplex_context cards) -- when there are
 * enough of them, "התאמת סוג הנכס" reflects that direct triplex PRODUCT
 * evidence is now good, even though none of those records vote in the
 * priced comps (which stay all tier_b_size_relaxed, since no near-size sale
 * was found). This only changes explanatory wording; it never touches
 * confidence/market_indication themselves. */
export function confidenceDimensions(indication: SpecialUnitIndication, broadDirectTypeContextCount = 0): ConfidenceDimension[] {
  const totalUsed = (["sold", "current_asking", "new_development"] as const).reduce(
    (s, l) => s + (indication.lanes[l]?.comps_used.length ?? 0),
    0
  );
  const votingLanes = indication.voting_lane_names.length;

  const evidenceQty = votingLanes >= 2 && totalUsed >= 6 ? "מספקת" : totalUsed >= 3 ? "סבירה" : "מוגבלת";

  const primary = primaryLaneName(indication);
  const primaryComps = primary ? (indication.lanes[primary]?.comps_used ?? []) : [];
  const directCount = primaryComps.filter((c) => c.tier === "tier_a_direct").length;
  let typeMatch = primaryComps.length === 0 ? "לא ידועה" : directCount === primaryComps.length ? "מלאה" : "חלקית";
  if (broadDirectTypeContextCount >= 3 && typeMatch === "חלקית") typeMatch = "טובה";

  const maxAreaDiffPct =
    primaryComps.length === 0
      ? null
      : Math.max(...primaryComps.map((c) => Math.abs(c.comparable_area_sqm - c.subject_area_sqm) / c.subject_area_sqm)) * 100;
  const scaleMatch = maxAreaDiffPct == null ? "לא ידועה" : maxAreaDiffPct <= 5 ? "טובה" : maxAreaDiffPct <= 10 ? "סבירה" : "מוגבלת";

  return [
    { label: "כמות הראיות", value: evidenceQty },
    { label: "התאמת סוג הנכס", value: typeMatch },
    { label: "התאמת קנה המידה", value: scaleMatch },
  ];
}

/** Explanatory-only override of the closing confidence sentence (task item
 * 8) -- shown instead of indication.confidence_reason only when there is
 * now real breadth of direct-type context evidence to explain (currently
 * just the Apt36/37 triplex case). Never changes indication.confidence
 * itself. */
export function confidenceReasonOverride(broadDirectTypeContextCount: number): string | null {
  if (broadDirectTypeContextCount < 3) return null;
  return "נמצאו מספר טריפלקסים בני 6 חדרים, אך הם קטנים משמעותית מהדירות בפרויקט.";
}

// ---------------------------------------------------------------------------
// Evidence funnel (task items 8, 26) -- built per lane so counts always
// reconcile exactly with the underlying records (never a single fabricated
// cross-lane total, since sold/current_asking/new_development have
// genuinely different candidate-pool shapes in the payload).
// ---------------------------------------------------------------------------

export interface FunnelStage {
  label: string;
  count: number;
}

export interface ExcludedEntry {
  label: string;
  groupedReason: string;
  rawReason: string;
}

export interface LaneFunnel {
  laneName: SpecialLaneName;
  laneLabel: string;
  stages: FunnelStage[];
  excludedRecords: ExcludedEntry[];
}

/** Groups a real backend exclusion reason string into one of a handful of
 * clean Hebrew labels (task items 8/9/25). Order matters: a reason can
 * mention more than one keyword (e.g. a property-form conflict whose text
 * also happens to say "cottage") -- the explicit technical flag is checked
 * first so it is never mis-grouped as the softer cottage/single-family
 * category. Falls back to a generic technical-reason label (never raw
 * English) when nothing matches; the raw reason is preserved on
 * ExcludedEntry.rawReason for "פירוט מלא של הראיות והמקורות". */
export function groupExclusionReason(rawReason: string, category: string, categoryLabel: string): string {
  const r = rawReason.toLowerCase();
  if (r.includes("property_form_conflict")) return `סוג הנכס אינו מתאים ל${categoryLabel}`;
  if (r.includes("cottage") || r.includes("single-family") || r.includes("single_family")) return "נכס פרטי / קוטג׳";
  if (r.includes("triplex") && category === "duplex") return "טריפלקס במקום דופלקס";
  if (r.includes("price_conflict") || r.includes("price conflict")) return "סתירת מחיר בין מקורות";
  if (r.includes("no verified") || r.includes("no_verified")) return "אין עדות ישירה מספקת";
  return "סיבה טכנית אחרת (ראו פירוט מלא)";
}

export function deriveLaneFunnel(context: SpecialUnitContext, laneName: SpecialLaneName): LaneFunnel | null {
  const indication = context.market_indication;
  if (!indication) return null;
  const lane = indication.lanes[laneName];
  const categoryLabel = SPECIAL_UNIT_CATEGORY_LABELS[context.category] ?? context.category;
  const excludedForLane = indication.excluded.filter((e) => e.lane === laneName);

  const stages: FunnelStage[] = [];
  let relevantCount: number;

  if (laneName === "sold") {
    const collected = context.sold_selected.length + context.sold_rejected.length;
    relevantCount = context.sold_selected.length;
    stages.push({ label: "נאספו", count: collected });
    // Only a real, distinct pre-filter drop-off deserves its own stage
    // (task item 8: "do not force every apartment into identical counts").
    if (context.sold_rejected.length > 0) {
      stages.push({ label: "נמצאו רלוונטיות", count: relevantCount });
    }
  } else if (laneName === "current_asking") {
    relevantCount = context.direct_comparables.length + context.broadened_comparables.length;
    stages.push({ label: "נאספו", count: relevantCount });
  } else {
    relevantCount = (lane?.comps_used.length ?? 0) + (lane?.comps_context_only.length ?? 0) + excludedForLane.length;
    stages.push({ label: "נבדקו כרלוונטיים", count: relevantCount });
  }

  stages.push({ label: "השתתפו בחישוב", count: lane?.comps_used.length ?? 0 });
  if ((lane?.comps_context_only.length ?? 0) > 0) {
    stages.push({ label: "נשמרו כהקשר בלבד", count: lane!.comps_context_only.length });
  }

  // Exclusions already accounted for by the "נאספו -> נמצאו רלוונטיות" drop
  // (sold_rejected, a basket-level pre-filter) are not double-counted here --
  // only exclusions that happened *within* the relevant/candidate pool are a
  // new stage, so every stage's count reconciles exactly with its neighbors.
  const rejectedAddresses = new Set(context.sold_rejected.map((r) => r.address as string | undefined).filter(Boolean));
  const excludedWithinPool = laneName === "sold" ? excludedForLane.filter((e) => !rejectedAddresses.has(e.label)) : excludedForLane;
  if (excludedWithinPool.length > 0) {
    stages.push({ label: "הוצאו מהחישוב", count: excludedWithinPool.length });
  }

  return {
    laneName,
    laneLabel: LANE_TITLES[laneName],
    stages,
    excludedRecords: excludedForLane.map((e) => ({
      label: e.label,
      rawReason: e.reason,
      groupedReason: groupExclusionReason(e.reason, context.category, categoryLabel),
    })),
  };
}

// ---------------------------------------------------------------------------
// "What is missing?" (task item 18)
// ---------------------------------------------------------------------------

/** Only renders when the backend already flagged a real gap
 * (sold_evidence_gap) and confidence is not already high -- the size band
 * is derived from the unit's own real subject_internal_area_sqm (already
 * shown elsewhere in the drawer), never an invented requirement. Returns
 * null whenever there is nothing real to report. */
export function evidenceGapText(context: SpecialUnitContext): string | null {
  const indication = context.market_indication;
  if (!indication || indication.confidence === "high") return null;
  if (!context.sold_evidence_gap) return null;
  const categoryLabel = SPECIAL_UNIT_CATEGORY_LABELS[context.category] ?? context.category;
  const area = indication.subject_internal_area_sqm;
  if (area == null) return null;
  const lower = Math.round(area);
  const upper = lower + 5;
  return `עסקה מאומתת של ${categoryLabel} בגודל הקרוב ל־${lower}–${upper} מ״ר.`;
}

/** Corrected triplex evidence story (task item 6) -- replaces the old,
 * easy-to-misread single-line gap text with the fuller, accurate narrative
 * once real breadth of direct-type context exists: triplex evidence is not
 * scarce in general, the specific remaining gap is near-size + sold-unit
 * linkage. Returns null (falls back to the plain evidenceGapText above)
 * when there isn't enough triplex context to justify the fuller story. */
export function triplexEvidenceStory(context: SpecialUnitContext, triplexContextCount: number): string[] | null {
  if (context.category !== "triplex" || triplexContextCount < 2) return null;
  const indication = context.market_indication;
  const area = indication?.subject_internal_area_sqm;
  const lower = area != null ? Math.round(area) : 255;
  const upper = area != null ? lower + 5 : 260;
  return [
    "נמצאו מספר נכסי טריפלקס בני 6 חדרים להשוואה.",
    `המגבלה העיקרית: לא נמצאה עסקה מאומתת של טריפלקס בשטח פנימי הקרוב ל־${lower}–${upper} מ״ר.`,
    "לא הוכח קישור ודאי בין מודעת טריפלקס היסטורית לעסקת מכר ספציפית ברשות המסים.",
  ];
}
