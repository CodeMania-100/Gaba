// Pure derivation for "במה המוצר שלנו שונה מהמתחרים?" (Tab ג of השוק
// והמתחרים) -- classifies each already-built ProductComparisonRow (see
// lib/standardEnrichment.ts's buildProductComparisonRows, unchanged) into
// MATCH / DIFFERENT / UNKNOWN. No new comparison data, no invented
// competitor attribute -- purely a state derived from values that already
// exist (or don't) on the two sides of a row already being rendered today.

import { ProductComparisonRow } from "./standardEnrichment";

export type AttributeMatchState = "match" | "different" | "unknown";

// Only genuine product-attribute rows get a MATCH/DIFFERENT/UNKNOWN badge --
// price/status/payment-basis rows (מחיר, מחיר התחלתי, סטטוס הפרויקט) are
// never "matched" or "different" in this sense, so they keep rendering as
// plain value pairs, unbadged, exactly as before.
const ATTRIBUTE_ROW_LABELS = new Set([
  "חדרים",
  "שטח פנימי",
  "שטח מפורסם",
  "מרפסת",
  "חצר",
  "קומה",
  "כיוון",
  "חניה",
  "מחסן",
  "מעלית",
  "ממ״ד",
  "מצב",
  "מועד מסירה",
  "תנאי תשלום",
]);

export interface MatchStateRow extends ProductComparisonRow {
  matchState: AttributeMatchState | null; // null = not an attribute row, no badge
}

const UNKNOWN_VALUE = "—";

function normalize(v: string): string {
  return v.trim().toLowerCase();
}

export function deriveMatchState(row: ProductComparisonRow): AttributeMatchState | null {
  if (!ATTRIBUTE_ROW_LABELS.has(row.label)) return null;
  if (row.subjectValue === UNKNOWN_VALUE || row.competitorValue === UNKNOWN_VALUE) return "unknown";
  return normalize(row.subjectValue) === normalize(row.competitorValue) ? "match" : "different";
}

export function deriveMatchStateRows(rows: ProductComparisonRow[]): MatchStateRow[] {
  return rows.map((r) => ({ ...r, matchState: deriveMatchState(r) }));
}

export const MATCH_STATE_LABELS: Record<AttributeMatchState, string> = {
  match: "MATCH",
  different: "DIFFERENT",
  unknown: "UNKNOWN",
};

export const MATCH_STATE_COLORS: Record<AttributeMatchState, string> = {
  match: "bg-emerald-100 text-emerald-800",
  different: "bg-amber-100 text-amber-900",
  unknown: "bg-slate-100 text-slate-500",
};
