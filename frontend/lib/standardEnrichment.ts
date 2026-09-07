// Pure helpers for the standard 3R/5R decision-support enrichment (see
// app_api/standard_attribute_enrichment.py). No pricing math -- only
// selection (sorting/filtering on fields the payload already has) and
// formatting. Every "no automatic rule" message here mirrors the source
// file's own methodology_guards; nothing here invents a coefficient.

import { JsonRecord, StandardAttributeEnrichmentFamily } from "./api";
import { ils, num } from "./format";

export const FACT_SCOPE_LABELS: Record<string, string> = {
  unit_specific_fact: "נתון לדירה המסוימת",
  unit_variant_marketing_fact: "נתון לדגם",
  project_product_fact: "נתון ברמת הפרויקט",
  project_level_fact: "נתון ברמת הפרויקט",
  starting_price_context: "מחיר התחלתי לפרויקט/טיפוס",
};

export function factScopeLabel(scope: string | null | undefined): string | null {
  if (!scope) return null;
  return FACT_SCOPE_LABELS[scope] ?? scope;
}

export const NO_FLOOR_RULE_MESSAGE = "השפעת קומה: לא הוגדר כלל כספי מאומת.";
export const INSUFFICIENT_FLOOR_DATA_MESSAGE = "אין מספיק נתונים כדי לכמת השפעת קומה באופן אמין.";

export type ObservationalPairQuality = "STRONGEST_OBSERVATIONAL_PAIR" | "STRONG_OBSERVATIONAL_PAIR" | "MEDIUM_OBSERVATIONAL_PAIR";

const PAIR_QUALITY_LABELS: Record<ObservationalPairQuality, string> = {
  STRONGEST_OBSERVATIONAL_PAIR: "התצפית החזקה ביותר",
  STRONG_OBSERVATIONAL_PAIR: "תצפית חזקה",
  MEDIUM_OBSERVATIONAL_PAIR: "תצפית בינונית",
};

export function pairQualityLabel(q: ObservationalPairQuality): string {
  return PAIR_QUALITY_LABELS[q];
}

/** Deterministic quality tier for a registered-sale floor-observation pair,
 * from real fields already on the record -- never an invented score.
 * Same-day observations (0 days apart) are the tightest possible control
 * and rank STRONGEST; a "lower-confidence" caveat (the source's own words,
 * e.g. a nearby mirror/duplicate-record concern) always forces MEDIUM
 * regardless of how close the dates are. */
export function classifyFloorPairQuality(pair: JsonRecord): ObservationalPairQuality {
  const caveat = String(pair.caveat ?? "");
  if (caveat.toLowerCase().includes("lower-confidence")) return "MEDIUM_OBSERVATIONAL_PAIR";

  const dates = ((pair.observations as JsonRecord[] | undefined) ?? []).map((o) => new Date(String(o.date)).getTime());
  if (dates.length === 2 && dates.every((d) => Number.isFinite(d))) {
    const daysApart = Math.abs(dates[1] - dates[0]) / 86_400_000;
    if (daysApart === 0) return "STRONGEST_OBSERVATIONAL_PAIR";
    if (daysApart <= 14) return "STRONG_OBSERVATIONAL_PAIR";
  }
  return "MEDIUM_OBSERVATIONAL_PAIR";
}

const QUALITY_SORT_ORDER: Record<ObservationalPairQuality, number> = {
  STRONGEST_OBSERVATIONAL_PAIR: 0,
  STRONG_OBSERVATIONAL_PAIR: 1,
  MEDIUM_OBSERVATIONAL_PAIR: 2,
};

/** Sorts floor-observation pairs strongest-first, purely for display order
 * -- does not filter or drop any pair. */
export function sortFloorPairsByQuality(pairs: JsonRecord[]): { pair: JsonRecord; quality: ObservationalPairQuality }[] {
  return pairs
    .map((pair) => ({ pair, quality: classifyFloorPairQuality(pair) }))
    .sort((a, b) => QUALITY_SORT_ORDER[a.quality] - QUALITY_SORT_ORDER[b.quality]);
}

export function noVerifiedRuleMessage(featureLabel: string): string {
  return `${featureLabel}: מאפיין מוצר ידוע, אך אין מחיר נפרד המאפשר לבודד את השפעתו — לא הוגדר כלל כספי מאומת.`;
}

const PROJECT_STATUS_LABELS: Record<string, string> = {
  active_marketing: "שיווק פעיל",
  construction_started: "בבנייה",
  presale: "מכירה מוקדמת (PRESALE)",
};

/** Project status strings in the source data are free text (research notes,
 * not a closed enum) -- map known ones to a clean Hebrew label and fall back
 * to showing the original text rather than hiding it. */
export function projectStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return PROJECT_STATUS_LABELS[status] ?? status;
}

/** One new-development comparable's variant closest in rooms/area to the
 * subject -- deterministic (rooms exact match required, then smallest area
 * difference), never a weighted score. Returns null if the project has no
 * variant for this family's room count. */
export function pickVariant(competitor: JsonRecord, rooms: number, targetArea: number | null): JsonRecord | null {
  const variants = (competitor.unit_variants as JsonRecord[] | undefined) ?? [];
  const matching = variants.filter((v) => v.rooms === rooms);
  if (matching.length === 0) return null;
  if (targetArea == null) return matching[0];
  const withArea = matching.filter((v) => v.internal_area != null || v.advertised_area != null);
  if (withArea.length === 0) return matching[0];
  const areaOf = (v: JsonRecord) => (v.internal_area ?? v.advertised_area) as number;
  return withArea.reduce((best, v) => (Math.abs(areaOf(v) - targetArea) < Math.abs(areaOf(best) - targetArea) ? v : best));
}

const CLASSIFICATION_RANK: Record<string, number> = { direct: 0, relevant: 1, context: 2 };

export type ComparableItem =
  | { kind: "new_development"; competitor: JsonRecord; variant: JsonRecord | null }
  | { kind: "current_asking"; record: JsonRecord };

/** Up to `maxCount` strongest comparables: new-development projects ranked by
 * the already-validated register classification (direct before relevant
 * before context before unclassified), then the closest current-asking
 * listings by area. No opaque score -- a plain, documented sort. */
export function pickStrongestComparables(
  family: StandardAttributeEnrichmentFamily,
  rooms: number,
  targetArea: number | null,
  maxCount = 3
): ComparableItem[] {
  const nd = [...family.new_development_comparables].sort((a, b) => {
    const ra = CLASSIFICATION_RANK[a.register_classification as string] ?? 3;
    const rb = CLASSIFICATION_RANK[b.register_classification as string] ?? 3;
    return ra - rb;
  });
  const ndItems: ComparableItem[] = nd.slice(0, maxCount).map((competitor) => ({
    kind: "new_development",
    competitor,
    variant: pickVariant(competitor, rooms, targetArea),
  }));
  if (ndItems.length >= maxCount) return ndItems;

  const asking = [...family.current_asking_comparables].filter((r) => r.advertised_area != null || r.built_area != null);
  asking.sort((a, b) => {
    if (targetArea == null) return 0;
    const areaA = (a.built_area ?? a.advertised_area) as number;
    const areaB = (b.built_area ?? b.advertised_area) as number;
    return Math.abs(areaA - targetArea) - Math.abs(areaB - targetArea);
  });
  const remaining = maxCount - ndItems.length;
  const askingItems: ComparableItem[] = asking.slice(0, remaining).map((record) => ({ kind: "current_asking", record }));
  return [...ndItems, ...askingItems];
}

export interface ProductComparisonRow {
  label: string;
  subjectValue: string;
  competitorValue: string;
  scope: string | null;
}

interface SubjectSpec {
  price: number | null;
  rooms: number | null;
  internalArea: number | null;
  balconyArea: number | null;
  floor: string | number | null;
  orientation: string | null;
}

/** Renders a row only when the competitor side actually carries a value --
 * "unknown vs unknown" rows are never emitted. */
export function buildProductComparisonRows(subject: SubjectSpec, item: ComparableItem): ProductComparisonRow[] {
  const rows: ProductComparisonRow[] = [];
  const push = (label: string, subjectValue: string | null, competitorValue: unknown, scope: string | null) => {
    if (competitorValue == null || competitorValue === "") return;
    rows.push({ label, subjectValue: subjectValue ?? "—", competitorValue: String(competitorValue), scope });
  };

  if (item.kind === "current_asking") {
    const r = item.record;
    const fieldScope = "unit_specific_fact";
    push("מחיר", subject.price != null ? ils(subject.price) : null, r.asking_price != null ? ils(r.asking_price as number) : null, fieldScope);
    push("חדרים", subject.rooms != null ? num(subject.rooms) : null, r.rooms != null ? num(r.rooms as number) : null, fieldScope);
    push("שטח פנימי", subject.internalArea != null ? `${num(subject.internalArea)} מ״ר` : null, r.built_area != null ? `${num(r.built_area as number)} מ״ר` : null, fieldScope);
    push("שטח מפורסם", null, r.advertised_area != null ? `${num(r.advertised_area as number)} מ״ר` : null, fieldScope);
    push("מרפסת", subject.balconyArea != null ? `${num(subject.balconyArea)} מ״ר` : null, r.balcony_area != null ? `${num(r.balcony_area as number)} מ״ר` : null, fieldScope);
    push("חצר", null, r.garden_area != null ? `${num(r.garden_area as number)} מ״ר` : null, fieldScope);
    push("קומה", subject.floor != null ? String(subject.floor) : null, r.floor != null ? String(r.floor) : null, fieldScope);
    push("כיוון", subject.orientation ?? null, r.orientation != null ? String(r.orientation) : null, fieldScope);
    push("חניה", null, r.parking_count != null ? num(r.parking_count as number) : null, fieldScope);
    push("מחסן", null, r.storage === true ? "יש" : r.storage === false ? "אין" : null, fieldScope);
    push("מעלית", null, r.elevator === true ? "יש" : r.elevator === false ? "אין" : null, fieldScope);
    push("ממ״ד", null, r.mamad === true ? "יש" : r.mamad === false ? "אין" : null, fieldScope);
    push("מצב", null, r.condition != null ? String(r.condition) : null, fieldScope);
    return rows;
  }

  const { competitor, variant } = item;
  const projectLevel = (competitor.project_level as JsonRecord) ?? {};
  const startingPrice = (competitor.starting_price_context as JsonRecord | null) ?? null;
  const variantScope = "unit_variant_marketing_fact";

  if (variant) {
    push("מחיר", subject.price != null ? ils(subject.price) : null, variant.price != null ? ils(variant.price as number) : null, variantScope);
    push("חדרים", subject.rooms != null ? num(subject.rooms) : null, variant.rooms != null ? num(variant.rooms as number) : null, variantScope);
    push(
      "שטח פנימי",
      subject.internalArea != null ? `${num(subject.internalArea)} מ״ר` : null,
      variant.internal_area != null ? `${num(variant.internal_area as number)} מ״ר` : null,
      variantScope
    );
    push("שטח מפורסם", null, variant.advertised_area != null ? `${num(variant.advertised_area as number)} מ״ר` : null, variantScope);
    push(
      "מרפסת",
      subject.balconyArea != null ? `${num(subject.balconyArea)} מ״ר` : null,
      variant.balcony_area != null ? `${num(variant.balcony_area as number)} מ״ר` : null,
      variantScope
    );
    push("קומה", subject.floor != null ? String(subject.floor) : null, variant.floor != null ? String(variant.floor) : null, variantScope);
    push(
      "כיוון",
      subject.orientation ?? null,
      variant.orientation != null ? (Array.isArray(variant.orientation) ? (variant.orientation as string[]).join(" / ") : String(variant.orientation)) : null,
      variantScope
    );
    push("חניה", null, variant.parking != null ? num(variant.parking as number) : null, variantScope);
    push("מחסן", null, variant.storage === true ? "יש" : variant.storage === false ? "אין" : null, variantScope);
  }

  // The project's general starting price is always shown as its own,
  // separately-labeled row -- never merged into the exact-model price row
  // above, so a project-level "from" price is never implied to be the price
  // of the specific matched model (see task: Rothschild 163-165 example).
  if (startingPrice?.value != null) {
    push(
      variant ? "מחיר התחלתי (לא משויך לדגם זה)" : "מחיר התחלתי",
      subject.price != null ? ils(subject.price) : null,
      `${ils(startingPrice.value as number)} (${startingPrice.applies_to ?? "כלל הפרויקט"})`,
      "starting_price_context"
    );
  }

  push("סטטוס הפרויקט", null, projectStatusLabel(projectLevel.status as string | null), "project_level_fact");
  push("מועד מסירה", null, projectLevel.delivery != null ? String(projectLevel.delivery) : null, "project_level_fact");
  push("תנאי תשלום", null, projectLevel.payment_terms != null ? String(projectLevel.payment_terms) : null, "project_level_fact");

  return rows;
}

export function comparableName(item: ComparableItem): string {
  return item.kind === "new_development" ? (item.competitor.project as string) : ((item.record.address as string) ?? "הצעה קיימת");
}
