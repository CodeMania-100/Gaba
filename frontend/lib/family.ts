// Mirrors pricing_core.decision.family_key() exactly so family ids computed in the
// browser (before any pricing has run) match what the backend expects on
// PUT /scenarios/{id}/family-decisions/{family_id}.

export function formatG(n: number): string {
  if (Number.isInteger(n)) return String(n);
  let s = n.toPrecision(6);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

export function computeFamilyKey(unitType: string | null, rooms: number | null, area: number | null): string {
  const roomsStr = rooms == null ? "unknown" : `${formatG(rooms)}r`;
  const areaStr = area == null ? "unknown" : `${formatG(area)}sqm`;
  return `${unitType || "unknown"}|${roomsStr}|${areaStr}`;
}

const UNIT_TYPE_LABELS: Record<string, string> = {
  standard_apartment: "דירה סטנדרטית",
  garden_apartment: "דירת גן",
  duplex: "דופלקס",
  triplex: "טריפלקס",
  unknown: "סוג לא ידוע",
};

export function familyLabel(unitType: string | null, rooms: number | null, area: number | null): string {
  const typeLabel = UNIT_TYPE_LABELS[unitType ?? "unknown"] ?? unitType ?? "סוג לא ידוע";
  const roomsLabel = rooms == null ? "" : `${formatG(rooms)} חדרים`;
  const areaLabel = area == null ? "" : `${formatG(area)} מ״ר`;
  return [typeLabel, roomsLabel, areaLabel].filter(Boolean).join(" · ");
}

export function isStandardFamily(unitType: string | null): boolean {
  return unitType === "standard_apartment";
}

export const STATUS_LABELS: Record<string, string> = {
  priced: "מתומחר",
  manual_review: "בדיקה פרטנית",
  strategy_required: "נדרשת אסטרטגיה",
  insufficient_evidence: "ראיות לא מספיקות",
  manual_special_pricing_pending: "תמחור פרטני בתהליך",
  special_indication_available: "ניתוח פרטני הושלם",
};

export const STATUS_COLORS: Record<string, string> = {
  priced: "bg-emerald-100 text-emerald-800",
  manual_review: "bg-violet-100 text-violet-800",
  strategy_required: "bg-amber-100 text-amber-900",
  insufficient_evidence: "bg-slate-200 text-slate-700",
  manual_special_pricing_pending: "bg-violet-100 text-violet-800",
  special_indication_available: "bg-violet-100 text-violet-800",
};

// Petah Tikva room-family display labels (business-facing). Internal family
// keys ("3R"/"5R") and backend enum values are never changed -- these map
// values to Hebrew for display only.
export const ROOM_FAMILY_LABELS: Record<string, string> = {
  "3R": "3 חדרים",
  "5R": "5 חדרים",
};

// Non-standard unit_type -> Hebrew, for the price-list "type" column and
// drawer. standard_apartment intentionally excluded: standard rows show the
// room-family label (ROOM_FAMILY_LABELS) instead.
export const SPECIAL_UNIT_TYPE_LABELS: Record<string, string> = {
  garden_apartment: "דירת גן",
  duplex: "דופלקס",
  triplex: "טריפלקס",
};

export function displayFamilyLabel(family: string): string {
  return ROOM_FAMILY_LABELS[family] ?? SPECIAL_UNIT_TYPE_LABELS[family] ?? family;
}

// "Type" alone (no room count) -- standard rows show a generic type label,
// special rows show their real product type. Kept distinct from
// displayFamilyLabel so a table can show "סוג" and "חדרים" as separate
// columns without collapsing the two concepts together.
export function unitTypeLabel(family: string): string {
  if (family === "3R" || family === "5R") return "דירה סטנדרטית";
  return SPECIAL_UNIT_TYPE_LABELS[family] ?? family;
}

// Room count for a price-list row: standard rows don't carry their own
// `rooms` field (the frozen baseline doc predates it -- family already
// implies room count), special rows do (parsed from inventory). Never
// invents a number: standard family "3R"/"5R" is the only fallback, anything
// else with no `rooms` field renders as unknown to the caller.
export function roomsOf(row: { family: string; rooms?: number | null }): number | null {
  if (row.rooms != null) return row.rooms;
  if (row.family === "3R") return 3;
  if (row.family === "5R") return 5;
  return null;
}

// Garden apartments' outdoor field is business-facing שטח חצר, not מרפסת --
// they can independently also have a balcony (the data model keeps
// balcony_area/garden_area separate; the assignment inventory only carries
// one combined outdoor field per unit today, so this is a label decision,
// not a data merge). All other unit types keep מרפסת. outdoorLabel is the
// full field label (used e.g. in a facts grid); outdoorKind is the short
// tag (used inline in compact table cells) -- callers must never collapse
// the two semantics into one generic "outdoor area" word.
export function outdoorLabel(family: string): string {
  return family === "garden_apartment" ? "שטח חצר" : "מרפסת";
}

export function outdoorKind(family: string): "חצר" | "מרפסת" {
  return family === "garden_apartment" ? "חצר" : "מרפסת";
}

// Business-facing translations for backend warning codes. Raw codes must never
// appear in primary cards/tables -- only inside a "פרטים טכניים" (technical
// details) toggle. Falls back to a generic Hebrew line (never the raw code)
// for any warning not explicitly mapped.
export const WARNING_LABELS: Record<string, string> = {
  target_balcony_present_without_verified_monetary_adjustment: "לא בוצעה התאמה כספית למרפסת ללא כלל מאומת",
  new_development_offer_area_missing_reference_only:
    "חלק מהצעות המתחרים משמשות כהשוואה בלבד משום שלא פורסם שטח מדויק",
  other_neighborhood_new_development_kept_as_reference: "חלק מהפרויקטים המתחרים נמצאים באזור סמוך ומוצגים להשוואה בלבד",
  target_area_outside_observed_area_envelope: "שטח היחידה המבוקשת מעט מחוץ לטווח השטחים שנצפו בראיות",
  target_is_smaller_or_larger_than_observed_primary_comparable_areas:
    "שטח היחידה המבוקשת שונה מעט משטח ההשוואות העיקריות",
  proposed_list_price_outside_supported_market_range: "המחיר המוצע חורג מהטווח הנתמך על ידי נתוני השוק",
  sold_recency_window_expanded: "נעשה שימוש בעסקאות ותיקות יותר בשל מיעוט עסקאות עדכניות",
  special_unit_requires_individual_pricing_review: "יחידה זו נבדקת בנפרד ואינה מתומחרת אוטומטית",
};

export function translateWarning(code: string): string {
  return WARNING_LABELS[code] ?? "הערה טכנית נוספת (ראו פרטים טכניים)";
}

// Business-facing translations for the backend's data-quality pipeline-stage
// labels (see app_api/petah_tikva_workspace.py PIPELINE_STAGES and each lane's
// "stages" list in _build_data_quality_section). Keyed by the exact English
// string the backend sends today; numbers themselves always come from the
// payload untouched. Falls back to the original string for anything unmapped.
export const STAGE_LABELS: Record<string, string> = {
  "raw/source records": "איסוף נתונים",
  "raw listings": "איסוף נתונים",
  "discovered records": "איסוף נתונים",
  "scoped by city/neighborhood": "סינון גיאוגרפי",
  "target submarket": "סינון גיאוגרפי",
  "exact target geography": "סינון גיאוגרפי",
  "Geography / size filtering": "סינון גיאוגרפי",
  "room/area/recency filters": "התאמת חדרים ושטח",
  "target size": "התאמת חדרים ושטח",
  "exact price + area": "התאמת חדרים ושטח",
  QA: "בדיקות איכות",
  "duplicate/source-pair handling": "קיבוץ מקורות תלויים",
  "deduped listings/locations": "טיפול בכפילויות",
  "deduped by project": "טיפול בכפילויות",
  Dedupe: "טיפול בכפילויות",
  "independent locations/buildings": "קבוצות השוואה עצמאיות",
  "independent projects": "קבוצות השוואה עצמאיות",
  "Independent grouping": "קבוצות השוואה עצמאיות",
  "quantitative contributors": "תורמים כמותיים",
  Normalize: "נרמול נתונים",
  "Three market lanes": "שלושה ערוצי ראיות",
  Consensus: "טווח מוסכם",
  "Company strategy": "אסטרטגיית תמחור",
  "Unit price list": "מחירון יחידות",
};

export function translateStage(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

// Business-facing categorization for one new-development competitor record,
// derived on the frontend from fields the backend already provides (geo_tier,
// area_sqm, and whether this record's identifier appears in the lane's own
// primary_contributors[].source_ids) -- no pricing/consensus logic here, only
// display categorization of already-computed backend results.
export type CompetitorRecordRole = "contributed" | "context" | "nearby" | "missing_area";

export const COMPETITOR_ROLE_LABELS: Record<CompetitorRecordRole, string> = {
  contributed: "תרם לטווח",
  context: "מידע משלים",
  nearby: "אזור סמוך",
  missing_area: "חסר שטח מדויק",
};

export function competitorRecordRole(
  record: { project_id?: string; geo_tier?: number; area_sqm?: number | null },
  contributorSourceIds: Set<string>
): CompetitorRecordRole {
  if (record.project_id && contributorSourceIds.has(record.project_id)) return "contributed";
  if (record.geo_tier === 2) return "nearby";
  if (record.area_sqm == null) return "missing_area";
  return "context";
}

export const CONFIDENCE_LABELS: Record<string, string> = {
  high: "גבוהה",
  medium: "בינונית",
  low: "נמוכה",
  insufficient: "לא מספיקה",
};

export const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-900",
  low: "bg-orange-100 text-orange-900",
  insufficient: "bg-slate-200 text-slate-600",
};

// Explains WHY a confidence level is what it is, derived from the real
// support_lanes count already in the payload -- never a manual override. A
// future city with genuinely fewer supporting lanes gets its own honest
// explanation from the same rule, not a hardcoded "High" claim.
const CONFIDENCE_LABELS_MASCULINE: Record<string, string> = {
  high: "גבוה",
  medium: "בינוני",
  low: "נמוך",
  insufficient: "לא מספיק",
};

export function confidenceExplanation(confidence: string, supportLaneCount: number): string {
  const label = CONFIDENCE_LABELS_MASCULINE[confidence] ?? CONFIDENCE_LABELS[confidence] ?? confidence;
  if (supportLaneCount >= 3) return `ביטחון ${label} — שלושת מקורות השוק תומכים בטווח.`;
  if (supportLaneCount === 2) return `ביטחון ${label} — שני מקורות שוק תומכים בטווח.`;
  if (supportLaneCount === 1) return `ביטחון ${label} — מקור שוק אחד בלבד תומך בטווח.`;
  return `ביטחון ${label} — אין כרגע מספיק מקורות עצמאיים שתומכים בטווח אחד.`;
}

// Business meaning of each evidence lane -- deliberately distinct so a resale
// listing is never implied to be equivalent to a brand-new developer unit:
// sold = what buyers actually paid, current_asking = resale alternatives
// available today, new_development = the direct competition for our new units.
export const LANE_LABELS: Record<string, { title: string; subtitle: string; helper: string }> = {
  sold: {
    title: "עסקאות שבוצעו",
    subtitle: "מה קונים שילמו בפועל בשוק המקומי",
    helper: "עוגן לעסקאות שהושלמו בפועל",
  },
  current_asking: {
    title: "דירות קיימות שמוצעות למכירה",
    subtitle: "חלופות יד שנייה שקונה יכול לבחור כיום",
    helper: "מחירי בקשה — לא מחירי עסקה",
  },
  new_development: {
    title: "פרויקטים חדשים מתחרים",
    subtitle: "התחרות הישירה ביותר לדירה חדשה בפרויקט",
    helper: "פרויקטים חדשים בעלי מוצר דומה באזור",
  },
};
