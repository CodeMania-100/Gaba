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

// Every literal placeholder buildProductComparisonRows can put on either
// side of a row when a value is genuinely not known/supplied -- "—" (no
// concept applies), "לא פורסם" (competitor side: not published), "לא הוזן"
// (our side: no company value entered). A row must never be classified
// "different" merely because one side uses one of these placeholders
// instead of a real value (see task: "do not infer שונה merely because
// competitor information is absent").
const UNKNOWN_VALUES = new Set(["—", "לא פורסם", "לא הוזן", "לא ידוע"]);

function normalize(v: string): string {
  return v.trim().toLowerCase();
}

function isUnknownValue(v: string): boolean {
  return UNKNOWN_VALUES.has(v.trim());
}

export function deriveMatchState(row: ProductComparisonRow): AttributeMatchState | null {
  if (!ATTRIBUTE_ROW_LABELS.has(row.label)) return null;
  if (isUnknownValue(row.subjectValue) || isUnknownValue(row.competitorValue)) return "unknown";
  return normalize(row.subjectValue) === normalize(row.competitorValue) ? "match" : "different";
}

export function deriveMatchStateRows(rows: ProductComparisonRow[]): MatchStateRow[] {
  return rows.map((r) => ({ ...r, matchState: deriveMatchState(r) }));
}

// Hebrew UI labels -- the surrounding interface is entirely Hebrew, so
// these badges never show the internal state names in English.
export const MATCH_STATE_LABELS: Record<AttributeMatchState, string> = {
  match: "תואם",
  different: "שונה",
  unknown: "לא ידוע",
};

export const MATCH_STATE_COLORS: Record<AttributeMatchState, string> = {
  match: "bg-supported/15 text-supported",
  different: "bg-warning/15 text-warning",
  unknown: "bg-hairline/50 text-ink-muted",
};
