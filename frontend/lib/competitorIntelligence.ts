// Demo "מודיעין תחרותי" (competitive-intelligence) feature. Two very
// different kinds of data are combined here, and every function/component
// downstream must keep them visually distinct (see task item 10):
//
//   1. Real current facts -- read from data already collected and exposed
//      elsewhere in this app (competitor_landscape, standard_attribute_
//      enrichment, special_unit_market_context). Nothing new is collected;
//      this module only re-reads and formats fields that already exist.
//   2. DEMO_COMPETITOR_HISTORY -- an explicitly simulated, hardcoded
//      timeline for presentation purposes only. Every event/alert derived
//      from it is tagged isDemoScenario: true and must render a visible
//      "תרחיש הדגמה" badge. This data is never read by pricing_core, never
//      merged into any market-evidence lane, and lives only in this module
//      (not in any workspace payload field).
//
// Derived indicators (months_on_market, sell_through_pct, etc.) are plain
// arithmetic over the above -- no ML, no probability model, no invented
// percentages.

import {
  CompetitorRegisterProject,
  JsonRecord,
  PetahTikvaWorkspace,
  PtkPriceListRow,
} from "./api";
import {
  areaRangeLabel,
  coerceNumber,
  developerLabel,
  floorRangeLabel,
  normalizeProjectName,
  paymentTermsLabel as registerPaymentTermsLabel,
  pickRoomMatchedVariant,
  productTypesLabel,
  roomRangeLabel,
  validRange,
  variantAreaSqm,
  variantFloorLabel,
} from "./competitorRegister";
import { findCommercialProject, resolvePaymentTermsLabel } from "./commercialTerms";
import { ils, num } from "./format";
import { computePriceBreakdown, MarketingStrategyState } from "./marketingStrategy";
import { deliveryLabel, paymentTermsLabel as enrichmentPaymentTermsLabel, projectStatusLabel } from "./standardEnrichment";

// ---------------------------------------------------------------------------
// 1. Real current facts (nothing invented -- every field here is read from
//    an existing, already-collected source; absent data renders as "לא פורסם").
// ---------------------------------------------------------------------------

export interface CompetitorFactSheet {
  displayName: string;
  developer: string | null;
  priceLabel: string | null;
  isStartingPriceOnly: boolean;
  currentPriceIls: number | null;
  paymentTerms: string | null;
  delivery: string | null;
  status: string | null;
  classification: "direct" | "relevant" | "context" | null;
  productMix: string | null;
  relevanceToUs: string | null;
  areaLabel: string | null;
  floorRangeLabel: string | null;
  // Only computed when both a representative price and a representative
  // area are known -- the area is the midpoint of the register's own
  // area_sqm_range (a real reported range, not an invented exact figure),
  // so this is itself an approximation and must be labeled as such wherever
  // shown (see CompetitorComparisonMatrix).
  pricePerSqmIls: number | null;
}

function findRegisterProject(workspace: PetahTikvaWorkspace, name: string): CompetitorRegisterProject | undefined {
  return workspace.competitor_landscape.projects.find((p) => p.project_name === name);
}

/** The standard_attribute_enrichment comparable carries project_level.status/
 * delivery/payment_terms that the competitor register does not -- searched
 * across both families since a project can appear in either or both.
 * Compared via normalizeProjectName (not a raw === ) because at least one
 * real competitor's name disagrees on dash character between the two
 * datasets -- the register's own "רוטשילד 163–165" (en dash) vs this
 * dataset's "רוטשילד 163-165" (hyphen); without normalizing, this lookup
 * silently returned undefined for that project and its delivery/status
 * were shown as "לא פורסם" even though the enrichment dataset actually has
 * them. */
function findEnrichmentComparable(workspace: PetahTikvaWorkspace, name: string): JsonRecord | undefined {
  const target = normalizeProjectName(name);
  for (const famKey of ["standard_3r", "standard_5r"] as const) {
    const found = workspace.standard_attribute_enrichment.families[famKey].new_development_comparables.find(
      (c) => normalizeProjectName(c.project as string) === target
    );
    if (found) return found;
  }
  return undefined;
}

/** NAVE PARK (and any other special-unit-only comparator) never made it into
 * the standard competitor register -- the only place it's exposed today is
 * as an excluded/context record inside special_unit_market_context. Only the
 * fields actually present there are used; everything else stays "לא פורסם"
 * rather than being invented. */
function findSpecialContextRecord(workspace: PetahTikvaWorkspace, matchName: string): JsonRecord | undefined {
  for (const unit of Object.values(workspace.special_unit_market_context.units)) {
    const excluded = unit.market_indication?.excluded ?? [];
    const rec = excluded.find((e) => e.label.includes(matchName) || (e.raw?.competitor as string | undefined) === matchName);
    if (rec) return rec.raw;
  }
  return undefined;
}

/** "6R from ₪3.85M" -> { label: "6 חדרים – החל מ-₪3.85M", priceIls: 3850000 }.
 * A narrow, honest parser for the one price-segment shape this frozen data
 * actually uses -- never a general-purpose price parser, and returns nulls
 * rather than guessing when the shape doesn't match. */
function parsePriceSegment(segment: string | null | undefined): { label: string | null; priceIls: number | null } {
  if (!segment) return { label: null, priceIls: null };
  const m = segment.match(/^(\d+)R\s+from\s+₪([\d.]+)M/i);
  if (!m) return { label: segment, priceIls: null };
  const rooms = m[1];
  const priceIls = parseFloat(m[2]) * 1_000_000;
  return { label: `${rooms} חדרים – החל מ-₪${m[2]}M`, priceIls };
}

function formatPriceLabel(priceIls: number | null, isStartingPriceOnly: boolean): string | null {
  if (priceIls == null) return null;
  return isStartingPriceOnly ? `החל מ־${ils(priceIls)}` : ils(priceIls);
}

/** `rooms`, when given, is the ONLY standard-family room count this fact
 * sheet may price against -- a project with several unit variants across
 * different room counts (or, formerly, Petah Tikva's hardcoded 3-competitor
 * matrix list showing a special-unit-only project regardless of family) must
 * never have an unrelated room count's price presented as though it were
 * this family's own (P0: "3 חדרים — סטנדרט must not show a NAVE PARK 6R
 * price"). When a project has no variant matching `rooms` at all, only its
 * genuine project-level facts remain (developer/status/delivery/payment/
 * area range/floor range/a whole-project starting price) -- unit-specific
 * price/area-per-sqm stay null ("לא פורסם" wherever rendered), never
 * silently substituted from a different room count. Omitting `rooms`
 * entirely (a caller with no family context, e.g. a special-unit lookup)
 * preserves the previous "cheapest priced variant, any room count"
 * behavior -- unchanged for those callers.
 *
 * subjectAreaSqm (task: "Resolve the FAMILY GROOVE / JADE variant
 * conflict"): the currently selected comparison subject's own internal
 * area (the family's target.internal_area, or a specific special unit's own
 * area) -- passed straight through to pickRoomMatchedVariant so that when a
 * project has several current, eligible same-room variants, the one closest
 * in area to what the user is actually comparing against is picked, not
 * simply the cheapest. Omitting it falls back to the deterministic
 * cheapest-among-eligible rule, unchanged from before subject-aware
 * matching existed. */
export function buildFactSheet(
  workspace: PetahTikvaWorkspace,
  displayName: string,
  matchName: string,
  rooms?: number,
  subjectAreaSqm?: number | null
): CompetitorFactSheet {
  const reg = findRegisterProject(workspace, matchName);
  const enrich = findEnrichmentComparable(workspace, matchName);
  const projectLevel = (enrich?.project_level as JsonRecord | undefined) ?? {};

  // Whether the enrichment dataset separately documents this same figure as
  // a project/marketing-line "starting price" (see e.g. THE SPOT's
  // starting_price_context: {value: 2250000, applies_to: "3-room marketing
  // line"}) -- the register's own known_unit_variants don't always carry a
  // price_basis tag, so this cross-reference catches cases the register
  // alone would silently mislabel as an exact unit price.
  const startingCtx = (enrich?.starting_price_context as { value?: number } | null | undefined) ?? null;

  if (reg) {
    const variants = (reg.known_unit_variants as JsonRecord[] | undefined) ?? [];
    let currentPriceIls: number | null = null;
    let isStartingPriceOnly = false;
    // Set only when a SINGLE matched variant is actually driving the price
    // above -- once true, area/floor/₪-per-מ״ר below may ONLY be read from
    // that same variant object, never from the project-wide range (task P0:
    // "use that same canonical variant object for rooms/area/price/...";
    // "never use the 3R price with 5R area or vice versa"). A project-level
    // "starting from" price (the `else if` branches below) is a genuine
    // whole-project fact, not tied to any one model, so it keeps using the
    // project-wide range instead -- that's not a mismatch, it's the correct
    // source for a figure that was never model-specific to begin with.
    let matchedVariantAreaSqm: number | null = null;
    let matchedVariantFloorLabel: string | null = null;
    let usedMatchedVariant = false;

    if (rooms != null) {
      const matched = pickRoomMatchedVariant(reg, rooms, subjectAreaSqm);
      if (matched) {
        currentPriceIls = coerceNumber(matched.price_ils) ?? null;
        isStartingPriceOnly =
          matched.price_basis === "starting price" || (startingCtx?.value != null && currentPriceIls === startingCtx.value);
        matchedVariantAreaSqm = variantAreaSqm(matched) ?? null;
        matchedVariantFloorLabel = variantFloorLabel(matched);
        usedMatchedVariant = true;
      } else if (reg.project_price_from_ils != null) {
        // A genuine project-level fact (the project's own "starting from"
        // marketing price, not tied to any one room count) -- safe to show
        // regardless of which family is selected, unlike a specific other
        // room's variant.
        currentPriceIls = reg.project_price_from_ils as number;
        isStartingPriceOnly = true;
      }
    } else {
      const priced = variants.filter((v) => coerceNumber(v.price_ils) != null);
      if (priced.length > 0) {
        const cheapest = priced.reduce((best, v) => (coerceNumber(v.price_ils)! < coerceNumber(best.price_ils)! ? v : best));
        currentPriceIls = coerceNumber(cheapest.price_ils) ?? null;
        isStartingPriceOnly =
          priced.some((v) => v.price_basis === "starting price") ||
          (startingCtx?.value != null && priced.some((v) => coerceNumber(v.price_ils) === startingCtx.value));
      } else if (reg.project_price_from_ils != null) {
        currentPriceIls = reg.project_price_from_ils as number;
        isStartingPriceOnly = true;
      }
    }

    const areaRange = validRange(reg.area_sqm_range);
    const areaMidSqm = areaRange ? (areaRange[0] + areaRange[1]) / 2 : null;
    // The matched variant's own exact area is strictly more precise than the
    // project-wide range for a ₪/מ״ר figure -- and once we matched one, it is
    // the ONLY allowed source (never silently fall back to the project range
    // just because the matched variant itself lacks an area -- that would
    // show a ₪/מ״ר figure computed from a different area than the one
    // displayed as "area" for this same model, exactly the inconsistency
    // this fix exists to prevent). The range-midpoint fallback (already
    // labeled "משוער" everywhere it's shown) is used only when no specific
    // variant matched at all.
    const pricePerSqmArea = usedMatchedVariant ? matchedVariantAreaSqm : areaMidSqm;
    const pricePerSqmIls = currentPriceIls != null && pricePerSqmArea ? currentPriceIls / pricePerSqmArea : null;

    // Priority (sections 25/42 of the commercial-terms enrichment task): a
    // VERIFIED commercial-enrichment payment_structure wins over the older
    // generic payment_terms field, which stays only as the fallback for
    // projects the enrichment didn't research -- never both at once (that
    // would render a duplicate/conflicting "20/80" line from two sources).
    const legacyPaymentTerms = registerPaymentTermsLabel(reg) ?? enrichmentPaymentTermsLabel(projectLevel.payment_terms as string | null);
    const commercialProject = findCommercialProject(workspace, matchName, (reg.project_id as string | undefined) ?? null);

    return {
      displayName,
      developer: developerLabel(reg),
      priceLabel: formatPriceLabel(currentPriceIls, isStartingPriceOnly),
      isStartingPriceOnly,
      currentPriceIls,
      paymentTerms: resolvePaymentTermsLabel(legacyPaymentTerms, commercialProject),
      delivery: deliveryLabel(projectLevel.delivery as string | null),
      status: projectStatusLabel(projectLevel.status as string | null),
      classification: reg.display_classification,
      productMix: [productTypesLabel(reg), roomRangeLabel(reg)].filter(Boolean).join(" · ") || null,
      relevanceToUs: (reg.relevance as string[] | undefined)?.join(", ") ?? null,
      areaLabel: usedMatchedVariant ? (matchedVariantAreaSqm != null ? `${num(matchedVariantAreaSqm)} מ״ר` : null) : areaRangeLabel(reg),
      floorRangeLabel: usedMatchedVariant ? matchedVariantFloorLabel : floorRangeLabel(reg),
      pricePerSqmIls,
    };
  }

  // No register entry (e.g. NAVE PARK) -- fall back to whatever the
  // special-unit context exposes, which today is only a name + price segment.
  const specialRaw = findSpecialContextRecord(workspace, matchName);
  const parsed = parsePriceSegment(specialRaw?.price_segment as string | undefined);
  return {
    displayName,
    developer: null,
    priceLabel: parsed.label,
    isStartingPriceOnly: true,
    currentPriceIls: parsed.priceIls,
    paymentTerms: null,
    delivery: null,
    status: null,
    classification: null,
    productMix: null,
    relevanceToUs: specialRaw ? "הקשר ליחידות מיוחדות פרימיום (APT36–39)" : null,
    areaLabel: null,
    floorRangeLabel: null,
    pricePerSqmIls: null,
  };
}

// ---------------------------------------------------------------------------
// 2. Demo history -- explicitly simulated, never real evidence.
// ---------------------------------------------------------------------------

export interface DemoHistoryEvent {
  monthNumber: number;
  description: string;
  // Present only on the event(s) that report a reading -- e.g. a sell-through
  // check, a price change, or a promotion/payment-terms switch. A plain
  // description-only event (e.g. "התחלת שיווק") carries none of these.
  sellThroughPct?: number;
  priceChangePct?: number;
  promoLabel?: string;
  isDemoScenario: true;
}

export const DEMO_COMPETITOR_HISTORY: Record<string, DemoHistoryEvent[]> = {
  "זאב ברנדה 22": [
    { monthNumber: 1, description: "התחלת שיווק", isDemoScenario: true },
    { monthNumber: 3, description: "מחיר עודכן", priceChangePct: 2, isDemoScenario: true },
    { monthNumber: 5, description: "שיעור מכירה 20%", sellThroughPct: 20, isDemoScenario: true },
    { monthNumber: 6, description: "מעבר למסלול תשלום 20/80", promoLabel: "מסלול תשלום 20/80", isDemoScenario: true },
  ],
  "THE SPOT": [
    { monthNumber: 1, description: "התחלת שיווק", isDemoScenario: true },
    { monthNumber: 4, description: "שיעור מכירה 35%", sellThroughPct: 35, isDemoScenario: true },
  ],
  "NAVE PARK": [
    { monthNumber: 1, description: "התחלת שיווק ביחידות הפרימיום", isDemoScenario: true },
    { monthNumber: 3, description: "שיעור מכירה 15% ביחידות העליונות", sellThroughPct: 15, isDemoScenario: true },
  ],
};

// ---------------------------------------------------------------------------
// 3. Derived indicators -- plain arithmetic only, no model.
// ---------------------------------------------------------------------------

export interface CompetitorIndicators {
  monthsOnMarket: number;
  sellThroughPct: number | null;
  remainingInventoryPct: number | null;
  priceChangePct: number;
}

export function computeIndicators(history: DemoHistoryEvent[]): CompetitorIndicators {
  const monthsOnMarket = history.length ? Math.max(...history.map((e) => e.monthNumber)) : 0;
  const sellThroughEvents = history.filter((e) => e.sellThroughPct != null);
  const sellThroughPct = sellThroughEvents.length ? sellThroughEvents[sellThroughEvents.length - 1].sellThroughPct! : null;
  const remainingInventoryPct = sellThroughPct != null ? 100 - sellThroughPct : null;
  const priceChangePct = history.reduce((sum, e) => sum + (e.priceChangePct ?? 0), 0);
  return { monthsOnMarket, sellThroughPct, remainingInventoryPct, priceChangePct };
}

// ---------------------------------------------------------------------------
// 4. Alerts -- simple explicit demo rules, never a statistical claim.
// ---------------------------------------------------------------------------

export interface CompetitorAlert {
  competitorDisplayName: string;
  title: string;
  isDemoScenario: boolean;
  lines: string[];
}

/** IF months_on_market >= 6 AND sell_through_pct <= 20 THEN flag slow sales
 * -- an explicit threshold rule, not a prediction. If the demo history also
 * contains a promotion/payment-terms switch anywhere in the timeline, add a
 * second, clearly-labeled "this happened before in the demo scenario" line
 * -- never a probability ("73% chance..."). */
export function evaluateSlowSalesAlert(displayName: string, indicators: CompetitorIndicators, history: DemoHistoryEvent[]): CompetitorAlert | null {
  if (indicators.monthsOnMarket < 6 || indicators.sellThroughPct == null || indicators.sellThroughPct > 20) return null;
  const lines = ["קצב המכירות של המתחרה נמוך. כדאי לעקוב אחר שינוי במחיר או בתנאי התשלום."];
  const promo = history.find((e) => e.promoLabel);
  if (promo) {
    lines.push(`בתרחיש ההדגמה, המתחרה עבר בעבר ל${promo.promoLabel} לאחר תקופה של קצב מכירות נמוך.`);
  }
  return { competitorDisplayName: displayName, title: "קצב מכירות נמוך", isDemoScenario: true, lines };
}

/** A real, computed price-gap flag (not simulated) -- fires only past a
 * plain ±10% threshold, and always states the gap as a plain percentage,
 * never a probability or forecast. Compares against our *frozen* market
 * indication (the evidence range, unaffected by any strategy/range-position
 * choice) -- never the strategy-adjusted proposed price, so toggling our own
 * presale/family adjustment can never by itself flip this alert on or off
 * (see computePriceComparison's ourMarketIndicationIls). When the
 * competitor's figure is only a project/marketing-line starting price, the
 * wording says so explicitly rather than implying an exact comparable unit
 * price. */
export function evaluatePriceGapAlert(
  displayName: string,
  competitorPriceIls: number | null,
  competitorIsStartingPriceOnly: boolean,
  ourMarketIndicationIls: number | null,
  ourFamilyLabel: string
): CompetitorAlert | null {
  if (competitorPriceIls == null || ourMarketIndicationIls == null || ourMarketIndicationIls === 0) return null;
  const gapPct = ((competitorPriceIls - ourMarketIndicationIls) / ourMarketIndicationIls) * 100;
  if (Math.abs(gapPct) < 10) return null;
  const direction = gapPct > 0 ? "גבוה" : "נמוך";
  const priceKind = competitorIsStartingPriceOnly ? "מחיר התחלתי בפרויקט" : "מחיר מתחרה";
  return {
    competitorDisplayName: displayName,
    title: "פער מחיר משמעותי",
    isDemoScenario: false,
    lines: [`${priceKind} ${direction} בכ-${Math.abs(gapPct).toFixed(0)}% מאינדיקציית השוק שלנו ל${ourFamilyLabel}.`],
  };
}

// ---------------------------------------------------------------------------
// 5. One comparison to our project (item 7) -- plain subtraction against our
//    *frozen* market indication, deliberately not the strategy-adjusted
//    proposed price: family.proposed_family_price_ils already reflects
//    whatever range-position/family-adjustment choice Marketing made (even
//    the "engineering demo baseline" is a 50%-of-range strategy choice, not
//    raw evidence), so comparing a competitor against it would make a
//    "market gap" alert move every time our own strategy changes even though
//    neither market moved. family.market.supported_lower/upper is the raw
//    evidence range and never changes with any strategy/scenario choice --
//    its midpoint is used as the single comparable figure. The strategy-
//    adjusted proposed price is still surfaced separately, explicitly
//    labeled as our proposed marketing price rather than as market
//    indication (never re-derived, never a new calculation).
// ---------------------------------------------------------------------------

export interface PriceComparison {
  ourFamily: "3R" | "5R";
  ourFamilyLabel: string;
  ourMarketIndicationIls: number;
  ourMarketRangeLowerIls: number;
  ourMarketRangeUpperIls: number;
  ourProposedMarketingPriceIls: number | null;
  competitorPriceIls: number;
  competitorIsStartingPriceOnly: boolean;
  gapIls: number;
  gapPct: number;
}

export function computePriceComparison(
  workspace: PetahTikvaWorkspace,
  fact: CompetitorFactSheet,
  preferredFamily: "3R" | "5R",
  ourProposedMarketingPriceIls: number | null
): PriceComparison | null {
  if (fact.currentPriceIls == null) return null;
  const family = workspace.families.find((f) => f.family === preferredFamily);
  if (!family || family.market.supported_lower == null || family.market.supported_upper == null) return null;
  const ourMarketRangeLowerIls = family.market.supported_lower;
  const ourMarketRangeUpperIls = family.market.supported_upper;
  const ourMarketIndicationIls = (ourMarketRangeLowerIls + ourMarketRangeUpperIls) / 2;
  const gapIls = fact.currentPriceIls - ourMarketIndicationIls;
  return {
    ourFamily: preferredFamily,
    ourFamilyLabel: preferredFamily === "3R" ? "3 חדרים" : "5 חדרים",
    ourMarketIndicationIls,
    ourMarketRangeLowerIls,
    ourMarketRangeUpperIls,
    ourProposedMarketingPriceIls,
    competitorPriceIls: fact.currentPriceIls,
    competitorIsStartingPriceOnly: fact.isStartingPriceOnly,
    gapIls,
    gapPct: (gapIls / ourMarketIndicationIls) * 100,
  };
}

/** The family's current proposed marketing price *including* every active
 * marketing-strategy layer (phase/sales-progress/manual adjustments -- see
 * lib/marketingStrategy.ts), averaged across that family's units. Deliberately
 * separate from computePriceComparison's frozen ourMarketIndicationIls: this
 * value legitimately moves when Marketing changes strategy, which is exactly
 * why it must never be the figure a "market gap" alert compares against, but
 * it is still useful to show alongside it as a plain commercial reference
 * (see task: "you may additionally show מחיר השיווק המוצע שלנו ... but don't
 * call it market indication"). Reuses computePriceBreakdown exactly as-is --
 * no new formula. */
export function averageProposedMarketingPriceForFamily(
  rows: PtkPriceListRow[],
  state: MarketingStrategyState,
  family: "3R" | "5R"
): number | null {
  const proposed = rows
    .filter((r) => r.family === family)
    .map((r) => computePriceBreakdown(state, r).proposedIls)
    .filter((v): v is number => v != null);
  if (proposed.length === 0) return null;
  return proposed.reduce((a, b) => a + b, 0) / proposed.length;
}
