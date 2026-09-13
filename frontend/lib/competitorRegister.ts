// Presentation helpers for the competitor register/map (see
// app_api/competitor_register.py build_competitor_landscape). Pure
// derivation from fields the payload already has -- no new pricing/valuation
// math, no invented values. Every function returns null/empty when the
// underlying field is missing so the UI can skip rendering it rather than
// showing "unknown".

import { CompetitorRegisterProject, JsonRecord } from "./api";
import { ils, num } from "./format";
import { paymentTermsLabel as translatePaymentTerms } from "./standardEnrichment";

// ---------------------------------------------------------------------------
// P0 fix ("matched-variant fact consistency"): known_unit_variants is the one
// place rooms/area/price/floor for a SPECIFIC model genuinely live together
// on the same object. Two real bugs made that guarantee leak out into the
// UI before this fix:
//   1. The multi-city register's own reshape (app_api/multi_city_competitor_
//      register.py) writes area_sqm_range as [] (not null) when a project
//      has no researched project-wide range -- and `!range` treats an empty
//      array as falsy-but-present, so the old areaRangeLabel happily
//      destructured it into "undefined–undefined" and rendered "—–— מ״ר"
//      instead of recognizing "no range" and falling back to anything else.
//   2. Petah Tikva's own native seed spells a variant's area internal_area_sqm
//      differently -- area_sqm -- so any code that only ever reads
//      internal_area_sqm (as buildFactSheet's price-per-sqm calc already did)
//      silently got `undefined` for every Petah Tikva variant, even though
//      the exact same value was sitting right there under a different key.
// coerceNumber/variantAreaSqm/variantRooms below are the single tolerant
// reader for both datasets' shapes, used everywhere a variant's own rooms/
// area is read (never re-implemented per call site) so no surface can ever
// again show a price from one variant next to an area from a different one
// (or from the project-wide range) -- see pickRoomMatchedVariant and
// matchedVariantSummary.
// ---------------------------------------------------------------------------

export function coerceNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function variantsOf(project: CompetitorRegisterProject): JsonRecord[] {
  return (project.known_unit_variants as JsonRecord[] | undefined) ?? [];
}

export function variantRooms(variant: JsonRecord): number | undefined {
  return coerceNumber(variant.rooms);
}

/** Tolerant of both known field spellings this frozen data uses for a
 * variant's own internal area -- see the module-level comment above. */
export function variantAreaSqm(variant: JsonRecord): number | undefined {
  return coerceNumber(variant.internal_area_sqm) ?? coerceNumber(variant.area_sqm);
}

const FLOOR_LABELS: Record<string, string> = { ground: "קומת קרקע" };

/** A specific variant's own floor, never a project-wide range -- shown
 * exactly as this model's own record has it, or omitted ("לא פורסם" by the
 * caller) when this model's floor genuinely isn't known. Never inferred. */
export function variantFloorLabel(variant: JsonRecord): string | null {
  const raw = variant.floor;
  if (raw == null || raw === "") return null;
  const asNumber = coerceNumber(raw);
  if (asNumber != null) return `קומה ${num(asNumber)}`;
  const key = String(raw).trim().toLowerCase();
  return FLOOR_LABELS[key] ?? String(raw);
}

/** A project-level [lo, hi] range field, valid only when it actually carries
 * two real numbers -- an empty array (see bug 1 above) or a one-sided range
 * is treated exactly like "no range on file", never destructured into
 * "undefined–undefined". */
export function validRange(range: unknown): [number, number] | null {
  if (!Array.isArray(range) || range.length !== 2) return null;
  const lo = coerceNumber(range[0]);
  const hi = coerceNumber(range[1]);
  return lo != null && hi != null ? [lo, hi] : null;
}

/** [min, max] of a numeric field across every variant that actually has it --
 * never invented when no variant carries the field at all. */
function rangeFromVariants(variants: JsonRecord[], reader: (v: JsonRecord) => number | undefined): [number, number] | null {
  const values = variants.map(reader).filter((n): n is number => n != null);
  if (values.length === 0) return null;
  return [Math.min(...values), Math.max(...values)];
}

/** The single priced unit variant that actually matches a target room count
 * -- exact match only (never the closest/nearest room count), cheapest
 * among ties. THE canonical "which model matches this family" pick, reused
 * by every surface that needs one (map popup / aggregate cards / comparison
 * matrix via lib/competitorIntelligence.ts's buildFactSheet, and this
 * module's own matchedVariantSummary for the register card) -- never
 * reimplemented per call site, so two surfaces can never disagree on which
 * model is "the" 3R (or 5R) model for a given project. */
export function pickRoomMatchedVariant(project: CompetitorRegisterProject, rooms: number): JsonRecord | null {
  const variants = variantsOf(project);
  const matching = variants.filter((v) => variantRooms(v) === rooms && coerceNumber(v.price_ils) != null);
  if (matching.length === 0) return null;
  return matching.reduce((best, v) => (coerceNumber(v.price_ils)! < coerceNumber(best.price_ils)! ? v : best));
}

export interface MatchedVariantSummary {
  rooms: number;
  areaSqm: number | null;
  areaLabel: string | null;
  floorLabel: string | null;
  priceIls: number | null;
  priceLabel: string | null;
  isStartingPriceOnly: boolean;
  // Only present when this SAME matched variant carries both a price and an
  // area -- never computed against a project-wide range or a different
  // variant's area (task invariant: "if price/m² is displayed from a
  // variant, its source area must also be displayed").
  pricePerSqmIls: number | null;
}

/** rooms + area + price + ₪/מ״ר + floor, all read from the ONE matched
 * variant object -- the single canonical bundle for "this project's NR
 * model," reused by the register card (task item 2) and by buildFactSheet
 * (task item 1) so neither can independently derive one of these fields
 * from a different path than the others. Returns null when this project has
 * no priced variant for this room count at all (never a partial/guessed
 * bundle). */
export function matchedVariantSummary(project: CompetitorRegisterProject, rooms: number): MatchedVariantSummary | null {
  const matched = pickRoomMatchedVariant(project, rooms);
  if (!matched) return null;
  const areaSqm = variantAreaSqm(matched) ?? null;
  const priceIls = coerceNumber(matched.price_ils) ?? null;
  const isStartingPriceOnly = matched.price_basis === "starting price";
  return {
    rooms,
    areaSqm,
    areaLabel: areaSqm != null ? `${num(areaSqm)} מ״ר` : null,
    floorLabel: variantFloorLabel(matched),
    priceIls,
    priceLabel: priceIls != null ? (isStartingPriceOnly ? `החל מ־${ils(priceIls)}` : ils(priceIls)) : null,
    isStartingPriceOnly,
    pricePerSqmIls: priceIls != null && areaSqm != null && areaSqm > 0 ? priceIls / areaSqm : null,
  };
}

/** Compact multi-model line for a project with several distinct room-count
 * models and no single family scoping this surface's own selected family
 * (task: "3 חד׳ 71 מ״ר · 5 חד׳ 105 מ״ר" for the register's explicit הכל
 * filter) -- one entry per distinct room count that has a priced variant,
 * ascending by room count. Capped at maxModels (task: "when the number of
 * known models is small") -- beyond that a plain range reads better than a
 * long list, so the caller should fall back to roomRangeLabel/areaRangeLabel
 * instead; this function returns null rather than truncating silently. */
export function multiModelSummaryLabel(project: CompetitorRegisterProject, maxModels = 4): string | null {
  const variants = variantsOf(project);
  const byRooms = new Map<number, JsonRecord>();
  for (const v of variants) {
    const rooms = variantRooms(v);
    if (rooms == null || coerceNumber(v.price_ils) == null) continue;
    if (!byRooms.has(rooms)) byRooms.set(rooms, v);
  }
  if (byRooms.size === 0 || byRooms.size > maxModels) return null;
  const entries = [...byRooms.entries()].sort(([a], [b]) => a - b);
  return entries
    .map(([rooms, v]) => {
      const area = variantAreaSqm(v);
      return area != null ? `${num(rooms)} חד׳ ${num(area)} מ״ר` : `${num(rooms)} חד׳`;
    })
    .join(" · ");
}

export type CompetitorFilterGroup = "all" | "direct" | "relevant" | "context";
export type CompetitorFamilyFilter = "all" | "standard_3r" | "standard_5r" | "garden" | "duplex_penthouse" | "large_premium";

export const CLASSIFICATION_LABELS: Record<"direct" | "relevant" | "context", string> = {
  direct: "תחרות ישירה",
  relevant: "תחרות רלוונטית",
  context: "הקשר שוק / מוצרי פרימיום",
};

export const CLASSIFICATION_COLORS: Record<"direct" | "relevant" | "context", string> = {
  direct: "bg-emerald-100 text-emerald-800",
  relevant: "bg-amber-100 text-amber-900",
  context: "bg-slate-200 text-slate-700",
};

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  standard_apartment: "דירות רגילות",
  garden_apartment: "דירות גן",
  duplex: "דופלקס",
  triplex: "טריפלקס",
  penthouse: "פנטהאוז",
  penthouse_roof: "פנטהאוז גג",
  roof_duplex: "דופלקס גג",
  // The multi-city register's own product_types vocabulary (see
  // special_full_v2/competitor_projects_v2.json) -- additive only.
  standard_apartments: "דירות רגילות",
  garden: "דירות גן",
  garden_duplex: "דופלקס גן",
  large_apartment: "יחידות גדולות",
};

export function productTypesLabel(project: CompetitorRegisterProject): string | null {
  const types = (project.product_types as string[] | undefined) ?? [];
  if (types.length === 0) return null;
  return types.map((t) => PRODUCT_TYPE_LABELS[t] ?? t).join(" · ");
}

/** Project-level room_range when it's a real [lo, hi] on file; otherwise
 * derived from known_unit_variants' own room counts (task: "room range:
 * project-level range → otherwise derive from known variants") -- never
 * invented when neither source has anything. */
export function roomRangeLabel(project: CompetitorRegisterProject): string | null {
  const range = validRange(project.room_range) ?? rangeFromVariants(variantsOf(project), variantRooms);
  if (!range) return null;
  const [lo, hi] = range;
  return lo === hi ? `${num(lo)} חדרים` : `${num(lo)}–${num(hi)} חדרים`;
}

/** Project-level area_sqm_range when it's a real [lo, hi] on file (an empty
 * array -- see the multi-city reshape bug documented above -- is treated
 * exactly like "absent", never destructured into "—–— מ״ר"); otherwise
 * derived from known_unit_variants' own areas (task: "area range:
 * project-level range → otherwise derive from known variants"). */
export function areaRangeLabel(project: CompetitorRegisterProject): string | null {
  const range = validRange(project.area_sqm_range) ?? rangeFromVariants(variantsOf(project), variantAreaSqm);
  if (!range) return null;
  const [lo, hi] = range;
  return lo === hi ? `${num(lo)} מ״ר` : `${num(lo)}–${num(hi)} מ״ר`;
}

/** Project-level floors_range when present; otherwise derived from whichever
 * known_unit_variants actually carry their own floor (task: "floor range:
 * project-level range → otherwise derive from known variants where
 * present") -- multi-city projects always have floors_range == null (this
 * dataset only ever carries a single number_of_floors, not a range) so this
 * fallback is the only source of a floor figure for them at all. */
export function floorRangeLabel(project: CompetitorRegisterProject): string | null {
  const range = validRange(project.floors_range) ?? rangeFromVariants(variantsOf(project), (v) => coerceNumber(v.floor));
  if (!range) return null;
  const [lo, hi] = range;
  return lo === hi ? `קומה ${num(lo)}` : `קומות ${num(lo)}–${num(hi)}`;
}

/** Price display only from fields that already exist: exact known-unit-variant
 * prices (as a range if they differ), or a project-level starting price.
 * Never averages/estimates -- if nothing priced is known, returns null and
 * the row is hidden. */
export function priceDisplayLabel(project: CompetitorRegisterProject): string | null {
  const variants = (project.known_unit_variants as { price_ils?: number | null; price_basis?: string }[] | undefined) ?? [];
  const priced = variants.filter((v) => v.price_ils != null);
  const anyStarting = priced.some((v) => v.price_basis === "starting price");
  if (priced.length > 0) {
    const prices = priced.map((v) => v.price_ils as number);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const prefix = anyStarting ? "החל מ־" : "";
    return min === max ? `${prefix}${ils(min)}` : `${prefix}${ils(min)}–${ils(max)}`;
  }
  const projectFrom = project.project_price_from_ils as number | null | undefined;
  if (projectFrom != null) return `החל מ־${ils(projectFrom)}`;
  return null;
}

/** One standout, already-verified product feature, in a fixed priority order
 * -- never a scored/weighted pick. Returns null when nothing verified is
 * present so the card can omit the row entirely rather than show a guess. */
export function standoutFeatureLabel(project: CompetitorRegisterProject): string | null {
  const relevance = (project.relevance as string[] | undefined) ?? [];
  if (relevance.includes("garden") && project.garden) return "כולל דירות גן";
  if ((relevance.includes("duplex") || relevance.includes("penthouse")) && project.product_types) {
    if ((project.product_types as string[]).some((t) => t.includes("duplex") || t.includes("penthouse"))) {
      return "כולל דופלקס/פנטהאוז";
    }
  }
  if (project.parking) return "חניה מאומתת";
  if (project.storage) return "מחסן מאומת";
  if (project.balcony) return "מרפסת מאומתת";
  if (project.mamad) return "ממ״ד מאומת";
  if (project.payment_terms) return "תנאי תשלום מיוחדים";
  return null;
}

export function paymentTermsLabel(project: CompetitorRegisterProject): string | null {
  const pt = project.payment_terms as { value?: string } | null | undefined;
  return translatePaymentTerms(pt?.value ?? null);
}

/** Verified developer/company name for this competing project, or null when
 * the register genuinely has none -- the card must show "לא פורסם" rather
 * than omit the row silently or invent a name (see task item 11). */
export function developerLabel(project: CompetitorRegisterProject): string | null {
  return (project.developer as string | null | undefined) ?? null;
}

export function matchesFamilyFilter(project: CompetitorRegisterProject, filter: CompetitorFamilyFilter): boolean {
  if (filter === "all") return true;
  const relevance = (project.relevance as string[] | undefined) ?? [];
  if (filter === "duplex_penthouse") return relevance.includes("duplex") || relevance.includes("penthouse");
  return relevance.includes(filter);
}

/** The register (competitor_landscape) and the various evidence/enrichment
 * datasets were compiled separately and don't always agree on which dash
 * character sits inside a numeric address range -- e.g. the register's own
 * "רוטשילד 163–165" (en dash, U+2013) is "רוטשילד 163-165" (plain hyphen)
 * in standard_attribute_enrichment's new_development_comparables. Collapses
 * every dash-like character (hyphen, non-breaking hyphen, figure/en/em
 * dash, horizontal bar) to a plain "-" so the two spellings compare equal
 * -- never a fuzzy/approximate match, just character-normalization of what
 * is genuinely the same name. */
export function normalizeProjectName(name: string): string {
  return name.replace(/[‐-―]/g, "-").trim();
}

/** Fuzzy-matches a decision-board competitor project name (from the strict
 * new_development evidence records, e.g. "זאב ברנדה" or "רוטשילד 163-165")
 * to its richer register entry (e.g. "זאב ברנדה 22" / "רוטשילד 163–165").
 * Both sides are stripped of a trailing "<number(-number)>" address/unit
 * suffix and compared; falls back to exact/substring match. Returns
 * undefined rather than guessing when nothing lines up. */
export function matchRegisterProject(
  evidenceProjectName: string,
  registerProjects: CompetitorRegisterProject[]
): CompetitorRegisterProject | undefined {
  const strip = (s: string) => s.replace(/[\s–—-]+\d+(?:[–—-]\d+)?\s*$/u, "").trim();
  const target = strip(evidenceProjectName);

  const exact = registerProjects.find((p) => p.project_name === evidenceProjectName);
  if (exact) return exact;

  const byStrippedName = registerProjects.find((p) => strip(p.project_name) === target);
  if (byStrippedName) return byStrippedName;

  return registerProjects.find(
    (p) => p.project_name.includes(evidenceProjectName) || evidenceProjectName.includes(strip(p.project_name))
  );
}
