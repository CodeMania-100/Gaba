// Pure derivation for "תובנות שיווקיות מול המתחרים" -- a compact strip of
// marketing-intelligence cards shown above the detailed competitor cards in
// ProductComparisonSection. This is a presentation/selection layer only:
// every fact surfaced here is already computed elsewhere in this app (the
// same fields buildProductComparisonRows already reads for the detailed
// cards, and lib/commercialTerms.ts's already-safeguarded CommercialOfferSummary)
// -- this module only picks a handful of the most notable facts, ranks them,
// and phrases one sentence each. It never computes a new price, an
// "effective price", a financing value, an NPV, or a "who wins" verdict; a
// term is only ever called "high/low" when it is a plain, directly
// measurable percentage gap against our own frozen market indication (the
// same real, non-demo computation lib/competitorIntelligence.ts's
// evaluatePriceGapAlert already uses elsewhere in this app).
//
// Safeguards inherited by construction (never re-implemented here):
//   - STARTING_PRICE vs exact unit price: competitorCurrentPrice mirrors
//     buildProductComparisonRows' own precedence (matched variant price is
//     exact; a project-level starting_price_context is always tagged as a
//     starting price) -- evaluatePriceGapAlert's own wording then states
//     "מחיר התחלתי בפרויקט" vs "מחיר מתחרה" accordingly.
//   - Mortgage linkage never implies a construction-index exemption:
//     commercialSummary.indexationLabel is only ever non-null when
//     indexation_benefit itself is VERIFIED (see lib/commercialTerms.ts).
//   - Current vs historical: CommercialOfferSummary is derived only from
//     commercial_offer (current), never commercial_offer_history.
//   - Relevance: only ever called with the SAME already-vetted comparables
//     list (pickStrongestComparables / the pinned competitor) the detailed
//     cards below render -- no separate competitor selection exists here.

import { JsonRecord } from "./api";
import { CommercialOfferSummary } from "./commercialTerms";
import { coerceNumber } from "./competitorRegister";
import { evaluatePriceGapAlert } from "./competitorIntelligence";
import { ROOM_FAMILY_LABELS } from "./family";
import { ComparableItem, deliveryLabel as enrichmentDeliveryLabel, paymentTermsLabel as enrichmentPaymentTermsLabel } from "./standardEnrichment";

export type CompetitorInsightCategory = "price_position" | "indexation" | "financing" | "payment_plan" | "delivery" | "differentiator";

export const INSIGHT_CATEGORY_BADGE_LABELS: Record<CompetitorInsightCategory, string> = {
  price_position: "מיצוב מחיר",
  indexation: "פטור הצמדה",
  financing: "מבצע מימון",
  payment_plan: "מסלול תשלום",
  delivery: "מועד מסירה",
  differentiator: "הטבה נוספת",
};

export interface CompetitorInsight {
  category: CompetitorInsightCategory;
  badgeLabel: string;
  competitorName: string;
  sentence: string;
  qualifier: string | null;
}

export interface CompetitorInsightInput {
  competitorName: string;
  item: ComparableItem;
  // Optional: absent for a current_asking comparable (an individual listed
  // apartment, not a researched project) and whenever no commercial-terms
  // enrichment record exists for this competitor at all -- both genuinely
  // mean "nothing more to surface here," never an invented gap.
  commercialSummary: CommercialOfferSummary | null;
}

interface FamilyMarketContext {
  family: "3R" | "5R";
  market: { supported_lower: number | null; supported_upper: number | null };
}

/** The one raw current price a competitor comparable actually carries, read
 * with the EXACT same precedence buildProductComparisonRows already uses for
 * its own "מחיר"/"מחיר התחלתי" rows (matched-variant price first, treated as
 * an exact unit price; otherwise the project's own starting_price_context,
 * always tagged as a starting price) -- never a new price computation, just
 * the same already-displayed figure read as a number instead of a formatted
 * string, so a % gap can be computed. current_asking listings only ever
 * carry a genuine, non-starting asking price. */
function competitorCurrentPrice(item: ComparableItem): { priceIls: number; isStartingPriceOnly: boolean } | null {
  if (item.kind === "current_asking") {
    const price = coerceNumber(item.record.asking_price);
    return price != null ? { priceIls: price, isStartingPriceOnly: false } : null;
  }
  const { competitor, variant } = item;
  if (variant) {
    const price = coerceNumber(variant.price);
    if (price != null) return { priceIls: price, isStartingPriceOnly: false };
  }
  const startingCtx = (competitor.starting_price_context as { value?: number } | null | undefined) ?? null;
  const startingPrice = coerceNumber(startingCtx?.value);
  return startingPrice != null ? { priceIls: startingPrice, isStartingPriceOnly: true } : null;
}

/** new_development comparables carry their own project_level.payment_terms/
 * delivery -- the SAME fields buildProductComparisonRows already formats for
 * its "תנאי תשלום"/"מועד מסירה" rows. current_asking listings have no
 * project-level concept at all and correctly contribute nothing here. */
function legacyProjectLevel(item: ComparableItem): JsonRecord | null {
  return item.kind === "new_development" ? ((item.competitor.project_level as JsonRecord | undefined) ?? null) : null;
}

const CATEGORY_RANK: Record<CompetitorInsightCategory, number> = {
  price_position: 0,
  indexation: 1,
  financing: 2,
  payment_plan: 3,
  delivery: 4,
  differentiator: 5,
};

const MAX_INSIGHTS = 5;
const MAX_PER_COMPETITOR = 2;

interface RankedCandidate {
  insight: CompetitorInsight;
  magnitude: number; // only price_position ever sets this above 0
}

/** Selects, ranks and phrases up to MAX_INSIGHTS marketing-intelligence
 * cards. Sort order: category priority first (price position, being the one
 * directly measurable, most actionable figure, always leads when present),
 * then -- within price_position only -- larger gaps first; every other
 * category keeps the deterministic input order (the same order the detailed
 * cards below already render in). At most MAX_PER_COMPETITOR cards per
 * competitor, so the section can't be crowded out by one project's rich
 * data. Returns [] when nothing meaningful survives -- the caller hides the
 * whole section in that case, never rendering an empty/placeholder card. */
export function deriveCompetitorInsights(family: FamilyMarketContext, inputs: CompetitorInsightInput[]): CompetitorInsight[] {
  const ourMarketIndicationIls =
    family.market.supported_lower != null && family.market.supported_upper != null
      ? (family.market.supported_lower + family.market.supported_upper) / 2
      : null;
  const ourFamilyLabel = ROOM_FAMILY_LABELS[family.family] ?? family.family;

  const candidates: RankedCandidate[] = [];

  for (const { competitorName, item, commercialSummary } of inputs) {
    // 1. Price position -- reuses the exact real (non-demo), already-tested
    // ±10% threshold and STARTING_PRICE-aware wording this app already uses
    // elsewhere for the identical comparison (see evaluatePriceGapAlert).
    const price = competitorCurrentPrice(item);
    if (price) {
      const alert = evaluatePriceGapAlert(competitorName, price.priceIls, price.isStartingPriceOnly, ourMarketIndicationIls, ourFamilyLabel);
      if (alert) {
        candidates.push({
          insight: {
            category: "price_position",
            badgeLabel: INSIGHT_CATEGORY_BADGE_LABELS.price_position,
            competitorName,
            sentence: alert.lines[0],
            qualifier: null,
          },
          magnitude: ourMarketIndicationIls ? Math.abs(price.priceIls - ourMarketIndicationIls) / ourMarketIndicationIls : 0,
        });
      }
    }

    if (commercialSummary) {
      // 2. Construction-index exemption -- only ever populated when
      // indexation_benefit itself is explicitly VERIFIED.
      if (commercialSummary.indexationLabel) {
        candidates.push({
          insight: {
            category: "indexation",
            badgeLabel: INSIGHT_CATEGORY_BADGE_LABELS.indexation,
            competitorName,
            sentence: `מעניק ${commercialSummary.indexationLabel} (מדד תשומות הבנייה).`,
            qualifier: null,
          },
          magnitude: 0,
        });
      }

      // 3. Financing/bridge-financing campaign -- exact rate/term/caveats
      // exactly as sourced (see lib/commercialTerms.ts's
      // formatFinancingBenefitLines); the main line becomes the sentence,
      // any remaining lines (bridge financing, "subject to campaign terms")
      // become the qualifier rather than being dropped.
      if (commercialSummary.financingLabels.length > 0) {
        const [first, ...rest] = commercialSummary.financingLabels;
        candidates.push({
          insight: {
            category: "financing",
            badgeLabel: INSIGHT_CATEGORY_BADGE_LABELS.financing,
            competitorName,
            sentence: first,
            qualifier: rest.length > 0 ? rest.join(" · ") : null,
          },
          magnitude: 0,
        });
      }
    }

    // 4. Payment plan -- prefers the commercial-terms enrichment's own
    // VERIFIED, current payment_structure; falls back to the older
    // project_level.payment_terms field only when the enrichment has no
    // record at all for this competitor (never both at once -- the same
    // source-priority rule already applied to the detailed cards below via
    // resolvePaymentTermsLabel).
    const paymentLabel = commercialSummary?.paymentLabel ?? enrichmentPaymentTermsLabel((legacyProjectLevel(item)?.payment_terms as string | null) ?? null);
    if (paymentLabel) {
      candidates.push({
        insight: {
          category: "payment_plan",
          badgeLabel: INSIGHT_CATEGORY_BADGE_LABELS.payment_plan,
          competitorName,
          sentence: `מציע ${paymentLabel} — עשוי להשפיע על החלטת הקונה גם אם מחיר הכותרת דומה.`,
          qualifier: null,
        },
        magnitude: 0,
      });
    }

    // 5. Delivery timing -- this app never computes a delivery date for our
    // own project (see CompetitorComparisonMatrix's own "מועד מסירה" row,
    // always "לא פורסם" on our side), so this is always one-sided by
    // construction; the qualifier states that plainly rather than the
    // sentence implying either side is "ahead."
    const legacyDelivery = enrichmentDeliveryLabel((legacyProjectLevel(item)?.delivery as string | null) ?? null);
    const deliveryLabel = commercialSummary?.deliveryLabel ?? (legacyDelivery ? `מסירה: ${legacyDelivery}` : null);
    if (deliveryLabel) {
      candidates.push({
        insight: {
          category: "delivery",
          badgeLabel: INSIGHT_CATEGORY_BADGE_LABELS.delivery,
          competitorName,
          sentence: deliveryLabel,
          qualifier: "אצלנו: מועד מסירה לא פורסם",
        },
        magnitude: 0,
      });
    }

    // 6. Warranty / trade-in / other explicit differentiators -- promotions
    // and included product benefits, only ever from VERIFIED/current
    // records (see lib/commercialTerms.ts's formatPromotionLabel /
    // includedBenefitLabels), a SELECTED_UNITS-scoped promotion already
    // says so in its own label (never implied to cover every unit).
    if (commercialSummary) {
      const differentiators = [...commercialSummary.promotionLabels, ...commercialSummary.includedBenefitLabels];
      if (differentiators.length > 0) {
        const [first, ...rest] = differentiators;
        candidates.push({
          insight: {
            category: "differentiator",
            badgeLabel: INSIGHT_CATEGORY_BADGE_LABELS.differentiator,
            competitorName,
            sentence: first,
            qualifier: rest.length > 0 ? rest.join(" · ") : null,
          },
          magnitude: 0,
        });
      }
    }
  }

  candidates.sort((a, b) => {
    const rankDiff = CATEGORY_RANK[a.insight.category] - CATEGORY_RANK[b.insight.category];
    return rankDiff !== 0 ? rankDiff : b.magnitude - a.magnitude;
  });

  const perCompetitorCount = new Map<string, number>();
  const selected: CompetitorInsight[] = [];
  for (const candidate of candidates) {
    const count = perCompetitorCount.get(candidate.insight.competitorName) ?? 0;
    if (count >= MAX_PER_COMPETITOR) continue;
    selected.push(candidate.insight);
    perCompetitorCount.set(candidate.insight.competitorName, count + 1);
    if (selected.length >= MAX_INSIGHTS) break;
  }
  return selected;
}
