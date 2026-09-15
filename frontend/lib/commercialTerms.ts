// Presentation helpers for the multi_city_commercial_terms_enrichment_v1
// display/context layer (see gabay_pricing_core/app_api/commercial_terms_
// enrichment.py and lib/api.ts's Commercial* types). This is a strictly
// additive UI-context layer answering "what is the buyer actually being
// offered beyond the headline price" -- payment structure, financing,
// construction-index exemption, promotions, included product benefits,
// delivery/status -- for the 13 curated competitors this dataset researched.
//
// HARD INVARIANTS, enforced by every function below:
//   - Never read by, or fed into, market-range/consensus/strategy/pricing
//     code. Every function here is a pure display-string derivation.
//   - Never computes an effective price, a discount-equivalent price, an
//     NPV, an index-adjusted price, or any "commercial attractiveness" score.
//   - UNKNOWN never renders as "אין" -- callers get null and omit the row,
//     or show "לא פורסם" themselves; this module never fabricates a value.
//   - HISTORICAL offers/terms never surface as if current.
//   - A term's scope gates whether it may be shown as confirmed for a given
//     subject -- see commercialTermAppliesToSubject.

import {
  CommercialConflict,
  CommercialDelivery,
  CommercialFinancingBenefit,
  CommercialIncludedBenefit,
  CommercialIndexationBenefit,
  CommercialOffer,
  CommercialPaymentStructure,
  CommercialProjectOffer,
  CommercialPromotion,
  CommercialPublishedPrice,
  CommercialSource,
  JsonRecord,
  NumericOrRangeText,
  PetahTikvaWorkspace,
} from "./api";
import { coerceNumber, normalizeProjectName } from "./competitorRegister";
import { num } from "./format";

// --- Lookup ------------------------------------------------------------

/** Resolves one existing competitor's commercial-terms record from the
 * workspace's own commercial_intelligence.projects (already scoped
 * server-side to the current market context -- see commercial_terms_
 * enrichment.py's MARKET_CONTEXT_TO_COMMERCIAL_CONTEXT). Prefers an exact
 * project_id match (present on the multi-city register's own projects);
 * falls back to normalizeProjectName's exact-match rule (the SAME dash-
 * normalization already used to reconcile register/enrichment name
 * spellings elsewhere in this app). Never fuzzy. Returns null when this
 * competitor genuinely wasn't part of the 13-project research pass -- that
 * absence must never be read as "no financing/no promotion/no terms". */
export function findCommercialProject(
  workspace: PetahTikvaWorkspace,
  projectName: string,
  projectId?: string | null
): CommercialProjectOffer | null {
  const projects = workspace.commercial_intelligence?.projects ?? [];
  if (projectId) {
    const byId = projects.find((p) => p.project_id === projectId);
    if (byId) return byId;
  }
  const target = normalizeProjectName(projectName);
  return projects.find((p) => normalizeProjectName(p.project_name) === target) ?? null;
}

// --- Type guards (section 38: no truthiness reliance on status strings) --

export function isVerifiedCommercialTerm(term: { status?: string } | null | undefined): boolean {
  return term?.status === "VERIFIED";
}

/** "Current" means not UNKNOWN and not HISTORICAL -- covers VERIFIED,
 * CURRENT, CURRENT_PAGE_NO_EXPLICIT_VALIDITY and RECENT_UNCONFIRMED alike,
 * each of which still describes today's offer (with its own display
 * qualifier -- see currentStatusQualifier), as opposed to a superseded one. */
export function isCurrentCommercialTerm(term: { status?: string } | null | undefined): boolean {
  return term != null && term.status !== "UNKNOWN" && term.status !== "HISTORICAL";
}

export function isHistoricalCommercialTerm(term: { status?: string } | null | undefined): boolean {
  return term?.status === "HISTORICAL";
}

/** Only an exact numeric scalar qualifies for mathematical use (a ₪/מ״ר
 * calculation, a room-count match, etc). A range-string like "67-77" is
 * valid DISPLAY data (see numericOrRangeLabel) but must never be Number()-
 * cast or midpoint-converted here. */
export function exactNumericArea(value: NumericOrRangeText | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** value may be an exact number, a prose range string ("67-77", "2-2.5"),
 * or null. Ranges are shown as real ranges (dash normalized to a proper en
 * dash), never coerced to a single figure. */
export function numericOrRangeLabel(value: NumericOrRangeText | undefined, unit: string): string | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? `${num(value)} ${unit}` : null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return `${trimmed.replace(/-/g, "–")} ${unit}`;
}

// --- Status display qualifiers (section 9) ------------------------------

/** A short, non-alarming qualifier for statuses that need one -- appended
 * by callers next to the underlying fact, never replacing it.
 * CURRENT_PAGE_NO_EXPLICIT_VALIDITY: the source page is live today but
 * states no explicit validity date -- a subtle note, not a warning.
 * RECENT_UNCONFIRMED: recent information not verified as a binding date.
 * Every other status (VERIFIED/CURRENT/UNKNOWN/HISTORICAL) needs none. */
export function currentStatusQualifier(currentStatus: string | null | undefined): string | null {
  if (currentStatus === "CURRENT_PAGE_NO_EXPLICIT_VALIDITY") return "דף פעיל · ללא תאריך תוקף מפורש";
  if (currentStatus === "RECENT_UNCONFIRMED") return "מידע עדכני שלא אומת כמועד מחייב";
  return null;
}

// --- Central Hebrew label maps (section 37) -----------------------------

export const COMMERCIAL_SCOPE_LABELS: Record<string, string> = {
  PROJECT_WIDE: "כלל הפרויקט",
  ROOM_FAMILY: "משפחת חדרים זו",
  CAMPAIGN_GENERAL: "קמפיין בפרויקט",
  SELECTED_UNITS: "יחידות משתתפות",
  UNIT_VARIANT: "דגם ספציפי",
};

export function commercialScopeLabel(scope: string | null | undefined): string | null {
  if (!scope) return null;
  return COMMERCIAL_SCOPE_LABELS[scope] ?? scope;
}

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  "20_80": "מסלול 20/80",
  "80_20_OPTION": "מסלול 80/20",
};

const INSTALLMENT_TIMING_LABELS: Record<string, string> = {
  contract: "בחתימה",
  "initial/contract": "בתחילת העסקה",
  "contract/initial": "בתחילת העסקה",
  occupancy: "באכלוס",
  near_occupancy: "בסמוך לאכלוס",
  key_delivery: "במסירת מפתח",
};

const VAGUE_TIMING_SUFFIX = "בתשלום מאוחר · מועד מדויק לא פורסם";

const DELIVERY_MILESTONE_LABELS: Record<string, string> = {
  key_delivery: "מסירת המפתח",
  near_occupancy: "סמוך לאכלוס",
  occupancy: "האכלוס",
};

export const DELIVERY_VALUE_LABELS: Record<string, string> = {
  occupied: "מאוכלס",
};

const RATE_TYPE_LABELS: Record<string, string> = {
  fixed: "קבועה",
  variable: "משתנה",
};

const LINKAGE_LABELS: Record<string, string> = {
  unlinked: "לא צמודה",
  linked: "צמודה",
};

export const INCLUDED_BENEFIT_LABELS: Record<string, string> = {
  underground_parking: "חניה תת־קרקעית",
  mamad: 'ממ"ד',
  sun_balcony: "מרפסת שמש",
  private_storage: "מחסן פרטי",
};

const PROMOTION_TYPE_LABELS: Record<string, string> = {
  price_protection_cancellation_option: "אפשרות ביטול בתנאים מסוימים במקרה של ירידת מחיר",
  year_end_pricing: "מחירי סוף השנה",
  trade_in: "תוכנית טרייד־אין",
  warranty_campaign: "מבצע אחריות",
};

// --- Field formatters (sections 10-17) ----------------------------------

/** Concrete installments[] (each {percent, timing}) render as one line per
 * installment, using the exact Hebrew milestone the timing token maps to;
 * an unrecognized/vague timing token (e.g. "later per campaign",
 * "later/delivery_not_explicit_in_retained_card") is NEVER translated into
 * a concrete milestone -- it renders as "X% בתשלום מאוחר · מועד מדויק לא
 * פורסם" instead (section 10). When only installments_semantics (prose, no
 * recovered exact chronology -- e.g. Zeev Branda's advertised 80/20 option)
 * is present, shows the plain type label (e.g. "מסלול 80/20") and never
 * invents a chronology (section 11). */
export function formatPaymentStructure(payment: CommercialPaymentStructure | null | undefined): string | null {
  if (!payment || payment.status === "UNKNOWN" || payment.status === "HISTORICAL") return null;
  const installments = payment.installments as { percent: number; timing: string }[] | undefined;
  if (installments && installments.length > 0) {
    return installments
      .map((i) => `${num(i.percent)}% ${INSTALLMENT_TIMING_LABELS[i.timing] ?? VAGUE_TIMING_SUFFIX}`)
      .join(" · ");
  }
  const type = payment.type as string | undefined;
  if (type) return PAYMENT_TYPE_LABELS[type] ?? type;
  return null;
}

/** financing_benefit's own field names differ entirely by `type`
 * (contractor_loan carries no rate fields at all; mortgage_and_bridge_
 * campaign uses mortgage_rate_pct/mortgage_rate_type/mortgage_index_linkage;
 * mortgage_campaign uses interest_rate_pct/interest_rate_type/index_linkage)
 * -- reads whichever fields are actually present rather than assuming one
 * shape. Returns 0-3 separate lines (rate/type/linkage+term, bridge
 * financing, and a "subject to campaign terms" caveat only when the source
 * itself records conditions) -- never a single overclaiming sentence, never
 * "guaranteed mortgage" or a computed buyer saving (section 12). */
export function formatFinancingBenefitLines(financing: CommercialFinancingBenefit | null | undefined): string[] {
  if (!financing || financing.status === "UNKNOWN" || financing.status === "HISTORICAL") return [];
  const lines: string[] = [];

  const ratePct = coerceNumber(financing.mortgage_rate_pct) ?? coerceNumber(financing.interest_rate_pct);
  const rateType = (financing.mortgage_rate_type ?? financing.interest_rate_type) as string | undefined;
  const linkage = (financing.mortgage_index_linkage ?? financing.index_linkage) as string | undefined;
  const termYears = coerceNumber(financing.term_years);
  const termMonths = coerceNumber(financing.term_months);

  if (ratePct != null) {
    const parts = [
      `${num(ratePct, 2)}%`,
      rateType ? (RATE_TYPE_LABELS[rateType] ?? rateType) : null,
      linkage ? (LINKAGE_LABELS[linkage] ?? linkage) : null,
      termYears != null ? `ל־${num(termYears)} שנה` : termMonths != null ? `ל־${num(termMonths)} חודשים` : null,
    ].filter((p): p is string => p != null);
    lines.push(`משכנתה בקמפיין: ${parts.join(", ")}`);
  } else if (financing.type === "contractor_loan") {
    lines.push("מימון: הלוואת קבלן במסגרת הפרויקט");
  }

  const bridgeUntil = financing.bridge_financing_until as string | undefined;
  if (bridgeUntil) {
    lines.push(`מימון גישור עד ${DELIVERY_MILESTONE_LABELS[bridgeUntil] ?? bridgeUntil}`);
  }

  if (financing.conditions) {
    lines.push("כפוף לתנאי הקמפיין/המלווה");
  }

  return lines;
}

/** CRITICAL semantic safeguard: reads ONLY indexation_benefit, never
 * financing_benefit's own mortgage/loan linkage field. A financing campaign
 * being "unlinked" (mortgage_index_linkage/index_linkage = "unlinked") is a
 * fact about that loan product, not about a construction-input-index
 * exemption on the apartment price -- e.g. Zeev Branda and RAYK EAST SIDE
 * both have an explicitly unlinked mortgage campaign AND an explicitly
 * UNKNOWN indexation_benefit; this function returns null for both, so a
 * caller can never accidentally show "פטור ממדד תשומות הבנייה" off the
 * financing fact alone (section 13). Only a VERIFIED indexation_benefit
 * (e.g. THE STRIP's full_exemption / "פטור מדד") renders a label, and never
 * with an invented percentage (section 14). */
export function formatIndexationBenefit(indexation: CommercialIndexationBenefit | null | undefined): string | null {
  if (!indexation || indexation.status !== "VERIFIED") return null;
  if (indexation.type === "full_exemption") return "פטור מהצמדה למדד";
  return (indexation.source_text as string | undefined) ?? "הטבת הצמדה מאומתת";
}

/** Concise Hebrew per known promotion_type (section 15/16) -- the
 * researcher's own free-text promotion_text is kept available for an
 * optional source expansion by the caller (project.sources /
 * promotion.promotion_text), never dumped into primary UI verbatim.
 * SELECTED_UNITS-scoped promotions always say so explicitly (e.g. "תוכנית
 * טרייד־אין ליחידות משתתפות"), never implying every unit qualifies
 * (section 22). Falls back to the source's own promotion_text only for an
 * unrecognized promotion_type, never silently dropped. */
export function formatPromotionLabel(promotion: CommercialPromotion): string {
  const base = PROMOTION_TYPE_LABELS[promotion.promotion_type] ?? promotion.promotion_text;
  return promotion.scope === "SELECTED_UNITS" ? `${base} ליחידות משתתפות` : base;
}

/** Only VERIFIED included benefits render -- these are product facts
 * ("כלול / מאפייני הצעה"), not financial incentives, and must never be
 * grouped under a "הנחות" heading by the caller (section 16). */
export function includedBenefitLabels(benefits: CommercialIncludedBenefit[] | null | undefined): string[] {
  return (benefits ?? []).filter((b) => b.status === "VERIFIED").map((b) => INCLUDED_BENEFIT_LABELS[b.type] ?? b.type);
}

/** Exact semantic precision, never a derived/calculated date the researcher
 * avoided (section 17): "occupied" -> "סטטוס: מאוכלס"; a plain value (e.g.
 * "2029") -> "מסירה: 2029"; UNKNOWN/HISTORICAL -> null (never "אין"). */
export function formatDeliveryLabel(delivery: CommercialDelivery | null | undefined): string | null {
  if (!delivery || delivery.status === "UNKNOWN" || delivery.status === "HISTORICAL") return null;
  const value = delivery.value as string | undefined;
  if (value == null) return null;
  if (DELIVERY_VALUE_LABELS[value]) return `סטטוס: ${DELIVERY_VALUE_LABELS[value]}`;
  return `מסירה: ${value}`;
}

// --- Offer summary (section 8) ------------------------------------------

export interface CommercialOfferSummary {
  paymentLabel: string | null;
  financingLabels: string[];
  indexationLabel: string | null;
  promotionLabels: string[];
  includedBenefitLabels: string[];
  deliveryLabel: string | null;
  currentOfferCount: number;
  hasHistoricalOffers: boolean;
  hasConflicts: boolean;
  sources: CommercialSource[];
}

export function deriveCommercialOfferSummary(project: CommercialProjectOffer | null | undefined): CommercialOfferSummary | null {
  if (!project) return null;
  const offer = project.commercial_offer;
  return {
    paymentLabel: formatPaymentStructure(offer.payment_structure),
    financingLabels: formatFinancingBenefitLines(offer.financing_benefit),
    indexationLabel: formatIndexationBenefit(offer.indexation_benefit),
    promotionLabels: (offer.promotions ?? []).map(formatPromotionLabel),
    includedBenefitLabels: includedBenefitLabels(offer.included_benefits),
    deliveryLabel: formatDeliveryLabel(offer.delivery),
    currentOfferCount: (offer.published_prices ?? []).length,
    hasHistoricalOffers: (project.commercial_offer_history ?? []).length > 0,
    hasConflicts: (project.conflicts ?? []).length > 0,
    sources: project.sources ?? [],
  };
}

/** One compact "תנאי עסקה" line for a tight surface (register compact row,
 * map popup) -- at most the payment structure plus indexation, never a full
 * dump. Returns null when nothing verified/current is known, so the caller
 * can omit the row entirely rather than render an empty line (section 7:
 * "never silently fill un-researched projects"). */
export function compactCommercialOfferLine(summary: CommercialOfferSummary | null): string | null {
  if (!summary) return null;
  const parts = [summary.paymentLabel, summary.indexationLabel].filter((p): p is string => p != null);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

/** A map-popup-scale line (section 24): at most one, preferring payment
 * terms, then a short benefits digest, then indexation alone -- never more
 * than one line, and the map stays a map (a richer view lives behind
 * "פתח השוואה מלאה"). */
export function mapPopupCommercialLine(summary: CommercialOfferSummary | null): string | null {
  if (!summary) return null;
  if (summary.paymentLabel) return `תנאי עסקה: ${summary.paymentLabel}`;
  const benefits = [summary.indexationLabel, ...summary.promotionLabels].filter((p): p is string => p != null);
  if (benefits.length > 0) return `הטבות: ${benefits.slice(0, 2).join(" · ")}`;
  return null;
}

/** No scary numeric "commercial score" (section 33) -- just whether some
 * fields on this project's offer are genuinely UNKNOWN, so the caller can
 * show a small "מידע מסחרי חלקי" note when relevant. */
export function hasPartialCommercialCoverage(project: CommercialProjectOffer): boolean {
  const offer = project.commercial_offer;
  return [offer.payment_structure?.status, offer.financing_benefit?.status, offer.indexation_benefit?.status, offer.delivery?.status].some(
    (s) => s === "UNKNOWN"
  );
}

// --- Source display (section 35) ----------------------------------------

function formatRetrievedAtDDMMYYYY(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

export function commercialSourceLine(source: CommercialSource): string {
  return `${source.source_title} · נבדק: ${formatRetrievedAtDDMMYYYY(source.retrieved_at)}`;
}

/** Preserved as separate observations, never a discount (section 31/49) --
 * the caller renders resolution_note as provenance detail, not a computed
 * "הנחה ₪X" claim. */
export function conflictNote(conflict: CommercialConflict): string {
  return conflict.resolution_note;
}

// --- Scope applicability (section 22) -----------------------------------

export type CommercialTermApplicability =
  | "CONFIRMED_FOR_SUBJECT" // PROJECT_WIDE / UNIT_VARIANT, or a ROOM_FAMILY term matching the subject's own room count
  | "CAMPAIGN_GENERAL" // shown as "קמפיין בפרויקט" -- exact unit applicability not known
  | "SELECTED_UNITS_ONLY" // must display "ליחידות משתתפות" -- never assume the candidate qualifies
  | "NOT_APPLICABLE"; // a ROOM_FAMILY term for a different room count than the subject

/** THE central applicability rule: a term is only shown as "confirmed" for
 * a subject when its own scope genuinely covers that subject (section 22).
 * subjectRoomCount is the subject/candidate's own room count (e.g. from a
 * PtkPriceListRow's family, or a matched competitor variant's rooms) --
 * pass null when unknown, which fails ROOM_FAMILY terms closed (never
 * assumed to match). Example this guards against: גבאי על הפארק's 20/80
 * payment_structure has scope=ROOM_FAMILY, rooms=5 -- must not render as
 * confirmed against a 3R alternative at the same project. */
export function commercialTermAppliesToSubject(
  term: { scope?: string; rooms?: NumericOrRangeText } | null | undefined,
  subjectRoomCount: number | null | undefined
): CommercialTermApplicability {
  const scope = term?.scope;
  if (!scope || scope === "PROJECT_WIDE" || scope === "UNIT_VARIANT") return "CONFIRMED_FOR_SUBJECT";
  if (scope === "ROOM_FAMILY") {
    const termRooms = exactNumericArea(term?.rooms ?? null);
    if (termRooms != null && subjectRoomCount != null && termRooms === subjectRoomCount) return "CONFIRMED_FOR_SUBJECT";
    return "NOT_APPLICABLE";
  }
  if (scope === "SELECTED_UNITS") return "SELECTED_UNITS_ONLY";
  if (scope === "CAMPAIGN_GENERAL") return "CAMPAIGN_GENERAL";
  return "NOT_APPLICABLE";
}

// --- Payment-terms source priority (sections 25, 42) ---------------------

/** THE priority rule for the one "payment terms" row every existing surface
 * (competitor comparison matrix, map popup, competitive-intelligence panel)
 * already renders via lib/competitorIntelligence.ts's buildFactSheet: a
 * VERIFIED commercial-enrichment payment_structure wins over the older
 * generic payment_terms field; the older field is the fallback only when
 * enrichment has no current record for this project at all. Returns at
 * most one label -- never both, so no surface can ever render a duplicate/
 * conflicting "20/80" line from the two sources at once (section 42). */
export function resolvePaymentTermsLabel(legacyLabel: string | null, commercialProject: CommercialProjectOffer | null): string | null {
  if (commercialProject) {
    const verified = formatPaymentStructure(commercialProject.commercial_offer.payment_structure);
    if (verified) return verified;
  }
  return legacyLabel;
}

// --- Same-budget alternatives data layer (sections 27-29) -----------------
// The "מה הקונה יכול לקנות באותו תקציב?" feature does not exist in this app
// yet (confirmed: no sameBudget/אותו תקציב UI anywhere) -- building that
// whole feature is out of scope for integrating commercial-terms enrichment.
// This function only prepares the underlying, already-correctly-prioritized
// price-candidate data so that future feature can consume it without
// re-deriving the merge/priority rule itself.

export type CommercialPriceCandidateSource =
  | "canonical_variant" // existing known_unit_variants pick -- always wins when present
  | "commercial_enrichment_exact" // enrichment's own VERIFIED_UNIT_PRICE, tied to one exact unit+area
  | "commercial_enrichment_starting_price"; // enrichment's own STARTING_PRICE for the room family -- never a verified unit price

export interface CommercialPriceCandidate {
  source: CommercialPriceCandidateSource;
  projectId: string;
  projectName: string;
  rooms: NumericOrRangeText;
  areaSqm: NumericOrRangeText;
  priceIls: number;
  isStartingPrice: boolean;
}

export const STARTING_PRICE_BADGE_LABEL = "מחיר התחלתי";

/** Controlled merge across known_unit_variants (via existingCanonicalVariant
 * -- pass the result of lib/competitorRegister.ts's pickRoomMatchedVariant/
 * matchedVariantSummary for this project+room count) and this enrichment's
 * own published_prices, in the required 3-tier priority order. Returns AT
 * MOST ONE candidate per (project, roomCount) call -- never a duplicate
 * candidate list a future ranking UI would have to de-duplicate itself.
 * A STARTING_PRICE candidate is tagged isStartingPrice so a future ranking
 * UI can badge it "מחיר התחלתי" (never "מחיר דירה") and must never rank it
 * as though it were an exact unit price (sections 20/21/29). */
export function pickBestCommercialPriceCandidate(
  project: CommercialProjectOffer,
  roomCount: number,
  existingCanonicalVariant?: { areaSqm?: number | null; priceIls: number } | null
): CommercialPriceCandidate | null {
  if (existingCanonicalVariant) {
    return {
      source: "canonical_variant",
      projectId: project.project_id,
      projectName: project.project_name,
      rooms: roomCount,
      areaSqm: existingCanonicalVariant.areaSqm ?? null,
      priceIls: existingCanonicalVariant.priceIls,
      isStartingPrice: false,
    };
  }

  const prices: CommercialPublishedPrice[] = project.commercial_offer.published_prices ?? [];
  const sameRoom = prices.filter((p) => exactNumericArea(p.rooms) === roomCount);

  const verifiedExact = sameRoom.find((p) => p.price_type === "VERIFIED_UNIT_PRICE" && p.quantitative_unit_price_area);
  if (verifiedExact) {
    return {
      source: "commercial_enrichment_exact",
      projectId: project.project_id,
      projectName: project.project_name,
      rooms: verifiedExact.rooms,
      areaSqm: verifiedExact.internal_area_sqm ?? null,
      priceIls: verifiedExact.price_ils,
      isStartingPrice: false,
    };
  }

  const starting = sameRoom.find((p) => p.price_type === "STARTING_PRICE");
  if (starting) {
    return {
      source: "commercial_enrichment_starting_price",
      projectId: project.project_id,
      projectName: project.project_name,
      rooms: starting.rooms,
      areaSqm: starting.internal_area_sqm ?? null,
      priceIls: starting.price_ils,
      isStartingPrice: true,
    };
  }

  return null;
}

/** Historical protection for a future same-budget ranking (section 30): a
 * project's commercial_offer_history entries must never be treated as
 * current alternatives -- this function only ever reads commercial_offer
 * (current), never commercial_offer_history, so it structurally cannot
 * surface a historical price as though it were live. Exported mainly so a
 * regression test can assert this in one place rather than re-deriving it
 * per call site. */
export function currentOfferNeverIncludesHistory(project: CommercialProjectOffer): boolean {
  const currentPriceValues = new Set((project.commercial_offer.published_prices ?? []).map((p) => p.price_ils));
  const historicalPriceValues = (project.commercial_offer_history ?? []).map((h) => h.price_ils).filter((v): v is number => v != null);
  return historicalPriceValues.every((v) => !currentPriceValues.has(v));
}

// Re-exported for convenience so components that already import from this
// module don't also need a separate import of the raw JsonRecord type.
export type { CommercialOffer, JsonRecord };
