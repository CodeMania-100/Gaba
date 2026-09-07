// Decision-support board: pure, deterministic derivation of competitor
// comparisons from data the workspace/scenario API already returns. No new
// pricing/valuation math -- only selection (sorting on existing fields),
// simple subtraction/formatting, and label rules. See CLAUDE task notes for
// "שיקולים להחלטת מחיר".

import { JsonRecord } from "./api";
import { competitorRecordRole, CompetitorRecordRole } from "./family";
import { ils, num } from "./format";

export interface SubjectFacts {
  internalArea: number | null;
  balconyArea: number | null;
  floor: string | number | null;
  orientation: string | null;
  price: number | null;
  priceLabel: string; // "בסיס" | "בתרחיש" -- for observation wording only
}

export interface CompetitorProject {
  projectName: string;
  representative: JsonRecord;
  allListings: JsonRecord[];
  role: CompetitorRecordRole;
}

function numericFloor(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function pickRepresentative(listings: JsonRecord[], targetArea: number | null): JsonRecord {
  const withArea = listings.filter((r) => r.area_sqm != null);
  if (withArea.length === 0 || targetArea == null) return listings[0];
  return withArea.reduce((best, r) => (Math.abs(r.area_sqm - targetArea) < Math.abs(best.area_sqm - targetArea) ? r : best));
}

/** True only for records that actually look like new-development/competitor
 * evidence (they carry project_id + geo_tier, fields sold/current_asking
 * records never have). Defensive guard so a caller can never accidentally
 * rank completed sales or resale asking listings as "direct competitors" --
 * those lanes answer different business questions (what buyers paid / what
 * resale alternatives exist today), not "who competes with our new units". */
export function isNewDevelopmentRecord(record: JsonRecord): boolean {
  return typeof record?.project_id === "string" && (record.geo_tier === 1 || record.geo_tier === 2);
}

/**
 * Group competitor records by project (multiple Yad2 listings for the same
 * building count as one project), then sort deterministically:
 *   1) contributed quantitatively to the market range (role === "contributed")
 *   2) exact target geography (geo_tier === 1)
 *   3) smallest absolute internal-area difference from the subject
 *   4) stable tie-break by project name
 * No weighted score -- a plain lexicographic comparator over fields the
 * payload already has. Only records that pass isNewDevelopmentRecord are
 * ever considered, regardless of what the caller passes in.
 */
export function rankCompetitorProjects(
  records: JsonRecord[],
  contributorSourceIds: Set<string>,
  targetAreaSqm: number | null
): CompetitorProject[] {
  const groups = new Map<string, JsonRecord[]>();
  for (const r of records.filter(isNewDevelopmentRecord)) {
    const key = r.project_name ?? r.project_id ?? "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const items: CompetitorProject[] = Array.from(groups.entries()).map(([projectName, allListings]) => {
    const representative = pickRepresentative(allListings, targetAreaSqm);
    return { projectName, representative, allListings, role: competitorRecordRole(representative, contributorSourceIds) };
  });

  const roleRank = (role: CompetitorRecordRole) => (role === "contributed" ? 0 : 1);
  const geoRank = (r: JsonRecord) => (r.geo_tier === 1 ? 0 : 1);
  const areaDiff = (r: JsonRecord) =>
    r.area_sqm != null && targetAreaSqm != null ? Math.abs(r.area_sqm - targetAreaSqm) : Infinity;

  items.sort((a, b) => {
    const roleCmp = roleRank(a.role) - roleRank(b.role);
    if (roleCmp !== 0) return roleCmp;
    const geoCmp = geoRank(a.representative) - geoRank(b.representative);
    if (geoCmp !== 0) return geoCmp;
    const areaCmp = areaDiff(a.representative) - areaDiff(b.representative);
    if (areaCmp !== 0) return areaCmp;
    return a.projectName.localeCompare(b.projectName, "he");
  });

  return items;
}

export interface ComparisonRow {
  label: string;
  subjectValue: string;
  competitorValue: string;
}

/** Only ever returns a row when both sides are known, or one side carries a
 * verified, meaningful value worth showing (e.g. an area range). Never emits
 * an "unknown vs unknown" row. */
export function buildComparisonRows(subject: SubjectFacts, competitor: JsonRecord): ComparisonRow[] {
  const rows: ComparisonRow[] = [];

  if (subject.internalArea != null && competitor.area_sqm != null) {
    rows.push({ label: "שטח פנימי", subjectValue: `${num(subject.internalArea)} מ״ר`, competitorValue: `${num(competitor.area_sqm)} מ״ר` });
  } else if (competitor.area_min_sqm != null && competitor.area_max_sqm != null) {
    rows.push({
      label: "שטח פנימי",
      subjectValue: subject.internalArea != null ? `${num(subject.internalArea)} מ״ר` : "—",
      competitorValue: `${num(competitor.area_min_sqm)}–${num(competitor.area_max_sqm)} מ״ר (טווח)`,
    });
  }

  if (subject.price != null && competitor.price_ils != null) {
    rows.push({ label: "מחיר מוצע", subjectValue: ils(subject.price), competitorValue: ils(competitor.price_ils) });
  }

  if (subject.floor != null && competitor.floor != null) {
    rows.push({ label: "קומה", subjectValue: String(subject.floor), competitorValue: String(competitor.floor) });
  }

  if (subject.balconyArea != null && competitor.balcony_sqm != null) {
    rows.push({ label: "מרפסת", subjectValue: `${num(subject.balconyArea)} מ״ר`, competitorValue: `${num(competitor.balcony_sqm)} מ״ר` });
  }

  return rows;
}

export interface Observation {
  text: string;
  kind: "fact" | "consideration";
}

/** Deterministic bullets from known fields only. Market facts are plain
 * subtraction/comparison of already-known numbers; commercial considerations
 * surface a verified feature without converting it into a price adjustment. */
export function buildObservations(subject: SubjectFacts, competitor: JsonRecord): Observation[] {
  const obs: Observation[] = [];

  const compPrice: number | null = competitor.price_ils ?? null;
  const compArea: number | null = competitor.area_sqm ?? null;
  const areaKnownBoth = subject.internalArea != null && compArea != null;
  const areaDiff = areaKnownBoth ? Math.abs(subject.internalArea! - compArea!) : null;
  const areaClose = areaDiff != null && areaDiff <= 2;

  if (subject.price != null && compPrice != null) {
    const delta = subject.price - compPrice;
    const closePrice = Math.abs(delta) / subject.price < 0.02;
    if (areaClose && closePrice) {
      const sameArea = areaDiff! < 0.5;
      obs.push({
        kind: "fact",
        text: `המחיר ה${subject.priceLabel === "בתרחיש" ? "בתרחיש" : "מוצע"} שלנו כמעט זהה למתחרה בעל שטח פנימי ${sameArea ? "זהה" : "דומה"}.`,
      });
    } else {
      const dir = delta > 0 ? "נמוך" : "גבוה";
      obs.push({ text: `מחיר המתחרה ${dir} ב-${ils(Math.abs(delta))} ממחיר ה${subject.priceLabel} שלנו.`, kind: "fact" });
    }
  }

  const sf = numericFloor(subject.floor);
  const cf = numericFloor(competitor.floor);
  if (sf != null && cf != null && sf !== cf) {
    obs.push({ kind: "fact", text: sf > cf ? "הדירה שלנו בקומה גבוהה יותר." : "הדירה שלנו בקומה נמוכה יותר." });
  }

  if (competitor.payment_terms) {
    obs.push({ kind: "consideration", text: `המתחרה מפרסם תנאי תשלום ${competitor.payment_terms}.` });
  }

  const perks: string[] = [];
  if (competitor.parking) perks.push("חניה");
  if (competitor.storage) perks.push("מחסן");
  if (perks.length > 0) {
    obs.push({ kind: "consideration", text: `המתחרה כולל ${perks.join(" ו")}, שיכולים להשפיע על השוואת המחיר מנקודת מבט הקונה.` });
  }

  if (competitor.geo_tier === 2 && competitor.commercial_area) {
    obs.push({ kind: "consideration", text: `הפרויקט נמצא באזור סמוך (${competitor.commercial_area}) ולא באזור היעד המדויק.` });
  }

  if (compArea == null && competitor.area_min_sqm != null && competitor.area_max_sqm != null) {
    obs.push({ kind: "consideration", text: "למתחרה טווח שטח מפורסם בלבד, ללא שיוך ודאי ליחידה ספציפית." });
  }

  return obs;
}

/** Verified product/commercial facts about a matched competitor-register
 * project (see lib/competitorRegister.ts matchRegisterProject), rendered as
 * plain considerations -- never as a price adjustment (see the register's
 * own usage_rules.feature_pricing). Respects each field's provenance status:
 * "verified_project_level" is labeled as a project-wide offering, not proven
 * for the exact unit being compared; "variant_level" is labeled as specific
 * to the known unit variant it was recorded against. A field with no status
 * wrapper (e.g. a bare boolean/string) is treated as project-level. */
export function buildRegisterConsiderations(
  registerProject: JsonRecord | undefined,
  evidenceRecord: JsonRecord
): Observation[] {
  if (!registerProject) return [];
  const obs: Observation[] = [];

  const fieldNote = (field: JsonRecord | boolean | string | null | undefined): string =>
    field && typeof field === "object" && field.status === "variant_level" ? " (ליחידה הידועה בלבד)" : " (ברמת הפרויקט)";

  const balcony = registerProject.balcony as JsonRecord | boolean | null;
  if (balcony) obs.push({ kind: "consideration", text: `לפרויקט מרפסת מאומתת${fieldNote(balcony)}.` });

  const garden = registerProject.garden as JsonRecord | boolean | null;
  if (garden) obs.push({ kind: "consideration", text: `לפרויקט יחידות גן${fieldNote(garden)}.` });

  // parking/storage/payment_terms: buildObservations() above already surfaces
  // these when the strict evidence record itself carries them (a different,
  // narrower field shape) -- only add the register's version when the
  // evidence record doesn't already say it, to avoid a duplicate-looking pair
  // of bullets for the same fact.
  const parking = registerProject.parking as JsonRecord | boolean | null;
  if (parking && !evidenceRecord.parking) obs.push({ kind: "consideration", text: `למתחרה חניה מאומתת${fieldNote(parking)}.` });

  const storage = registerProject.storage as JsonRecord | boolean | null;
  if (storage && !evidenceRecord.storage) obs.push({ kind: "consideration", text: `למתחרה מחסן מאומת${fieldNote(storage)}.` });

  const mamad = registerProject.mamad as JsonRecord | boolean | null;
  if (mamad) obs.push({ kind: "consideration", text: `לפרויקט ממ״ד מאומת${fieldNote(mamad)}.` });

  const paymentTerms = registerProject.payment_terms as JsonRecord | null;
  if (paymentTerms?.value && !evidenceRecord.payment_terms) {
    obs.push({ kind: "consideration", text: `המתחרה מציע תנאי תשלום: ${paymentTerms.value}.` });
  }

  const occupancy = registerProject.occupancy as JsonRecord | null;
  if (occupancy?.value) obs.push({ kind: "consideration", text: `מועד אכלוס מפורסם: ${occupancy.value}.` });

  const orientation = registerProject.orientation as JsonRecord | null;
  if (orientation?.value) obs.push({ kind: "consideration", text: `כיוון${fieldNote(orientation)}: ${orientation.value}.` });

  return obs;
}

/** True only when the payload actually carries a documented cross-source
 * disagreement -- never inferred. */
export function competitorProvenanceWarning(record: JsonRecord): string | null {
  const notes = record.field_provenance?.disagreement_notes as string[] | undefined;
  if (notes && notes.length > 0) {
    return "המחיר והשטח מגיעים ממקורות שונים ולא אומת בוודאות שהם מתייחסים לאותה גרסת דירה.";
  }
  return null;
}
