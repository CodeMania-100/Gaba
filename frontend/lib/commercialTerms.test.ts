// Regression tests for the commercial-terms enrichment display/context layer
// (lib/commercialTerms.ts, see its own module docstring). Fixture data below
// is copied verbatim from the real frozen dataset (gabay_pricing_core/data/
// frozen/multi_city_commercial_terms_enrichment_v1/multi_city_commercial_
// terms_enrichment_v1.json) -- the same real projects the backend's own
// tests/test_commercial_terms_enrichment.py exercises -- so a regression
// here reflects an actual real-data case, not an invented one.

import { describe, expect, it } from "vitest";
import { CommercialProjectOffer, PetahTikvaWorkspace } from "./api";
import {
  commercialSourceLine,
  commercialTermAppliesToSubject,
  compactCommercialOfferLine,
  currentOfferNeverIncludesHistory,
  deriveCommercialOfferSummary,
  exactNumericArea,
  findCommercialProject,
  formatDeliveryLabel,
  formatFinancingBenefitLines,
  formatIndexationBenefit,
  formatPaymentStructure,
  formatPromotionLabel,
  isCurrentCommercialTerm,
  isHistoricalCommercialTerm,
  isVerifiedCommercialTerm,
  numericOrRangeLabel,
  pickBestCommercialPriceCandidate,
  resolvePaymentTermsLabel,
  STARTING_PRICE_BADGE_LABEL,
} from "./commercialTerms";

function workspaceWith(projects: CommercialProjectOffer[]): PetahTikvaWorkspace {
  return {
    commercial_intelligence: { version: "v1", generated_at: "2026-09-14", projects },
  } as unknown as PetahTikvaWorkspace;
}

const TIDHAR: CommercialProjectOffer = {
  market_context: "tel_aviv_yad_eliyahu",
  project_id: "ta-tidhar-between",
  project_name: "TIDHAR בין השדרות",
  developer: "תדהר",
  project_status: "under_construction_and_marketing",
  construction_status: null,
  permit_status: null,
  commercial_offer: {
    published_prices: [
      { rooms: 3, internal_area_sqm: 71, price_ils: 3700000, price_type: "VERIFIED_UNIT_PRICE", scope: "UNIT_VARIANT", current_status: "CURRENT_PAGE_NO_EXPLICIT_VALIDITY", quantitative_unit_price_area: true },
    ],
    payment_structure: {
      status: "VERIFIED",
      type: "20_80",
      installments: [
        { percent: 20, timing: "initial/contract" },
        { percent: 80, timing: "near_occupancy" },
      ],
      scope: "PROJECT_WIDE",
    },
    deferred_payment: { status: "VERIFIED" },
    financing_benefit: { status: "VERIFIED", type: "contractor_loan", amount_ils: null, interest_terms: "not stated", scope: "PROJECT_WIDE" },
    indexation_benefit: { status: "UNKNOWN" },
    discount: { status: "UNKNOWN" },
    included_benefits: [
      { type: "private_storage", scope: "PROJECT_WIDE", status: "VERIFIED" },
      { type: "underground_parking", scope: "PROJECT_WIDE", status: "VERIFIED" },
      { type: "mamad", scope: "PROJECT_WIDE", status: "VERIFIED" },
    ],
    promotions: [{ promotion_type: "warranty_campaign", promotion_text: "10 שנות אחריות תדהר", scope: "PROJECT_WIDE" }],
    delivery: { status: "UNKNOWN" },
  },
  commercial_offer_history: [],
  conflicts: [],
  unresolved_fields: [],
  sources: [{ source_url: "https://www.tidhar-benhasderot.co.il/lp/", source_title: "TIDHAR בין השדרות — official campaign", source_type: "project_official", retrieved_at: "2026-09-14", observed_date: null, verification_status: "PRIMARY_SOURCE" }],
  notes: [],
};

const ZEEV_BRANDA: CommercialProjectOffer = {
  market_context: "petah_tikva",
  project_id: "pt-zeev-branda-22",
  project_name: "זאב ברנדה 22",
  developer: "רכסים",
  project_status: "active_construction_and_marketing",
  construction_status: null,
  permit_status: null,
  commercial_offer: {
    published_prices: [
      { rooms: "2-2.5", internal_area_sqm: "60", price_ils: 1917000, price_type: "STARTING_PRICE", scope: "ROOM_FAMILY", quantitative_unit_price_area: false },
      { rooms: 5, internal_area_sqm: 122, price_ils: 3180000, price_type: "STARTING_PRICE", scope: "ROOM_FAMILY", quantitative_unit_price_area: false },
    ],
    payment_structure: {
      status: "VERIFIED",
      type: "80_20_OPTION",
      installments_semantics: "80/20 option advertised; exact milestone wording not recovered",
      scope: "CAMPAIGN_GENERAL",
    },
    deferred_payment: { status: "VERIFIED" },
    financing_benefit: {
      status: "VERIFIED",
      type: "mortgage_and_bridge_campaign",
      mortgage_rate_pct: 2.99,
      mortgage_rate_type: "fixed",
      mortgage_index_linkage: "unlinked",
      term_years: 20,
      bridge_financing_until: "key_delivery",
      scope: "CAMPAIGN_GENERAL",
      conditions: "subject to lender/developer campaign terms; exact loan amount not published in retained evidence",
    },
    indexation_benefit: { status: "UNKNOWN", note: "Mortgage campaign is unlinked; no verified construction-input-index exemption was found." },
    discount: { status: "UNKNOWN" },
    included_benefits: [
      { type: "underground_parking", scope: "PROJECT_WIDE", status: "VERIFIED" },
      { type: "mamad", scope: "PROJECT_WIDE", status: "VERIFIED" },
      { type: "sun_balcony", scope: "PROJECT_WIDE", status: "VERIFIED" },
    ],
    promotions: [],
    delivery: { status: "RECENT_UNCONFIRMED", value: "2026-11" },
  },
  commercial_offer_history: [],
  conflicts: [],
  unresolved_fields: [],
  sources: [{ source_url: "https://www.rehasimbuild.co.il/project/", source_title: "זאב ברנדה 22 — official developer project page", source_type: "developer_official", retrieved_at: "2026-09-14", observed_date: null, verification_status: "PRIMARY_SOURCE" }],
  notes: [],
};

const RAYK: CommercialProjectOffer = {
  market_context: "tel_aviv_yad_eliyahu",
  project_id: "ta-rayk-east",
  project_name: "RAYK EAST SIDE",
  developer: "RAYK",
  project_status: "construction_started",
  construction_status: null,
  permit_status: null,
  commercial_offer: {
    published_prices: [{ rooms: "3-6", internal_area_sqm: null, price_ils: 2900000, price_type: "STARTING_PRICE", scope: "PROJECT_WIDE", quantitative_unit_price_area: false }],
    payment_structure: { status: "UNKNOWN" },
    deferred_payment: { status: "UNKNOWN" },
    financing_benefit: {
      status: "VERIFIED",
      type: "mortgage_campaign",
      interest_rate_pct: 1.99,
      interest_rate_type: "fixed",
      index_linkage: "unlinked",
      amount_ils: null,
      term_months: null,
      scope: "CAMPAIGN_GENERAL",
      conditions: "Exact loan amount/term and bank approval conditions not retained.",
    },
    indexation_benefit: { status: "UNKNOWN", note: "The 1.99% mortgage is described as unlinked; no verified construction-index exemption was found." },
    discount: { status: "UNKNOWN" },
    included_benefits: [],
    promotions: [],
    delivery: { status: "VERIFIED", value: "2029", scope: "PROJECT_WIDE" },
  },
  commercial_offer_history: [],
  conflicts: [],
  unresolved_fields: [],
  sources: [],
  notes: [],
};

const THE_STRIP: CommercialProjectOffer = {
  market_context: "netanya_kiryat_hasharon",
  project_id: "net-the-strip",
  project_name: "THE STRIP נתניה",
  developer: "אאורה ישראל",
  project_status: "active_marketing",
  construction_status: null,
  permit_status: null,
  commercial_offer: {
    published_prices: [{ rooms: "3-5", internal_area_sqm: null, price_ils: 2500000, price_type: "STARTING_PRICE", scope: "PROJECT_WIDE", quantitative_unit_price_area: false }],
    payment_structure: {
      status: "VERIFIED",
      type: "20_80",
      installments: [
        { percent: 20, timing: "contract/initial" },
        { percent: 80, timing: "later per campaign" },
      ],
      scope: "PROJECT_WIDE",
    },
    deferred_payment: { status: "VERIFIED" },
    financing_benefit: { status: "UNKNOWN" },
    indexation_benefit: { status: "VERIFIED", type: "full_exemption", scope: "PROJECT_WIDE", source_text: "פטור מדד" },
    discount: { status: "UNKNOWN" },
    included_benefits: [],
    promotions: [
      { promotion_type: "price_protection_cancellation_option", promotion_text: "Campaign allows cancellation before contractual delivery if the apartment price declines, subject to campaign terms.", scope: "PROJECT_WIDE" },
      { promotion_type: "year_end_pricing", promotion_text: "מחירי סוף השנה", scope: "PROJECT_WIDE" },
    ],
    delivery: { status: "UNKNOWN" },
  },
  commercial_offer_history: [],
  conflicts: [],
  unresolved_fields: [],
  sources: [{ source_url: "https://aura-project.co.il/aurasafety/the-strip-netanya/", source_title: "Aura דירה בבטחון — THE STRIP", source_type: "developer_official", retrieved_at: "2026-09-14", observed_date: null, verification_status: "PRIMARY_SOURCE" }],
  notes: [],
};

const BERESHIT_FAMILY: CommercialProjectOffer = {
  market_context: "netanya_kiryat_hasharon",
  project_id: "net-bereshit-family",
  project_name: "בראשית פמלי — קריית השרון",
  developer: "דוד אזולאי",
  project_status: "active_near_occupancy",
  construction_status: null,
  permit_status: null,
  commercial_offer: {
    published_prices: [
      { rooms: 3, internal_area_sqm: null, price_ils: 2470000, price_type: "STARTING_PRICE", scope: "ROOM_FAMILY", quantitative_unit_price_area: false },
    ],
    payment_structure: { status: "UNKNOWN" },
    deferred_payment: { status: "UNKNOWN" },
    financing_benefit: { status: "UNKNOWN" },
    indexation_benefit: { status: "UNKNOWN" },
    discount: { status: "UNKNOWN" },
    included_benefits: [],
    promotions: [
      { promotion_type: "trade_in", promotion_text: "Trade-in program for selected participating apartments", scope: "SELECTED_UNITS", conditions: "Participation/eligibility subject to company terms; not guaranteed for every unit." },
    ],
    delivery: { status: "UNKNOWN" },
  },
  commercial_offer_history: [],
  conflicts: [
    {
      status: "PRICE_SNAPSHOT_DIFFERENCE",
      field: "3R garden starting price",
      frozen_snapshot_value_ils: 2490000,
      current_portal_value_ils: 2550000,
      resolution_note: "Preserved as separate observations; not interpreted as a discount or same-unit price change.",
    },
  ],
  unresolved_fields: [],
  sources: [],
  notes: [],
};

const GABAY_PARK: CommercialProjectOffer = {
  market_context: "netanya_kiryat_hasharon",
  project_id: "net-gabay-park",
  project_name: "גבאי על הפארק",
  developer: "קבוצת גבאי",
  project_status: "active_marketing",
  construction_status: null,
  permit_status: null,
  commercial_offer: {
    published_prices: [{ rooms: 5, internal_area_sqm: 141.2, price_ils: 3490000, price_type: "STARTING_PRICE", scope: "ROOM_FAMILY", quantitative_unit_price_area: false }],
    payment_structure: {
      status: "VERIFIED",
      type: "20_80",
      installments: [
        { percent: 20, timing: "initial/contract" },
        { percent: 80, timing: "later/delivery_not_explicit_in_retained_card" },
      ],
      scope: "ROOM_FAMILY",
      rooms: 5,
    },
    deferred_payment: { status: "VERIFIED" },
    financing_benefit: { status: "UNKNOWN" },
    indexation_benefit: { status: "UNKNOWN" },
    discount: { status: "UNKNOWN" },
    included_benefits: [],
    promotions: [],
    delivery: { status: "UNKNOWN" },
  },
  commercial_offer_history: [],
  conflicts: [],
  unresolved_fields: [],
  sources: [],
  notes: [],
};

const GALIPOLIS: CommercialProjectOffer = {
  market_context: "tel_aviv_yad_eliyahu",
  project_id: "ta-galipolis",
  project_name: "GALIPOLIS",
  developer: "קבוצת אלמוג",
  project_status: "presale",
  construction_status: null,
  permit_status: null,
  commercial_offer: {
    published_prices: [
      { rooms: 2, internal_area_sqm: null, price_ils: 2920000, price_type: "STARTING_PRICE", scope: "ROOM_FAMILY", quantitative_unit_price_area: false },
      {
        rooms: 3,
        internal_area_sqm: 73,
        price_ils: 3215000,
        price_type: "STARTING_PRICE",
        scope: "ROOM_FAMILY",
        quantitative_unit_price_area: false,
        semantic_note: "Frozen integration correction preserved: no durable retained evidence ties ₪3.215M to the exact 73 m² model.",
      },
    ],
    payment_structure: { status: "UNKNOWN" },
    deferred_payment: { status: "UNKNOWN" },
    financing_benefit: { status: "UNKNOWN" },
    indexation_benefit: { status: "UNKNOWN" },
    discount: { status: "UNKNOWN" },
    included_benefits: [],
    promotions: [],
    delivery: { status: "UNKNOWN" },
  },
  commercial_offer_history: [],
  conflicts: [],
  unresolved_fields: [],
  sources: [],
  notes: [],
};

const HALOMOT_BARNEA: CommercialProjectOffer = {
  market_context: "ashkelon_barnea",
  project_id: "ash-halomot-barnea",
  project_name: "חלומות ברנע הירוקה",
  developer: "שיכון ובינוי נדל״ן / מכלוף בכור",
  project_status: "occupied",
  construction_status: null,
  permit_status: null,
  commercial_offer: {
    published_prices: [],
    payment_structure: { status: "UNKNOWN" },
    deferred_payment: { status: "UNKNOWN" },
    financing_benefit: { status: "UNKNOWN" },
    indexation_benefit: { status: "UNKNOWN" },
    discount: { status: "UNKNOWN" },
    included_benefits: [],
    promotions: [],
    delivery: { status: "VERIFIED", value: "occupied", scope: "PROJECT_WIDE" },
  },
  commercial_offer_history: [
    { offer_type: "starting_price_context", price_ils: 1619000, price_type: "HISTORICAL_MARKETING_PRICE", status: "HISTORICAL" },
  ],
  conflicts: [
    { status: "RESOLVED_BY_PRIMARY_SOURCE", field: "project_status", primary_current: "occupied", secondary_stale: "marketing/construction language remains on portals", resolution_note: "Official developer status controls current-state display; legacy prices remain historical." },
  ],
  unresolved_fields: [],
  sources: [],
  notes: [],
};

const ALL_PROJECTS = [TIDHAR, ZEEV_BRANDA, RAYK, THE_STRIP, BERESHIT_FAMILY, GABAY_PARK, GALIPOLIS, HALOMOT_BARNEA];

// --- findCommercialProject ---------------------------------------------

describe("findCommercialProject", () => {
  const ws = workspaceWith(ALL_PROJECTS);

  it("resolves by exact project_id", () => {
    expect(findCommercialProject(ws, "irrelevant name", "ta-tidhar-between")?.project_id).toBe("ta-tidhar-between");
  });

  it("resolves by normalized name when no id given, tolerating dash-character differences", () => {
    expect(findCommercialProject(ws, "גבאי על הפארק")?.project_id).toBe("net-gabay-park");
  });

  it("returns null for a project genuinely not in the 13-project research pass", () => {
    expect(findCommercialProject(ws, "פרויקט שלא נחקר")).toBeNull();
  });

  it("returns null (never crashes) when commercial_intelligence is entirely absent from the workspace", () => {
    const bareWorkspace = {} as PetahTikvaWorkspace;
    expect(findCommercialProject(bareWorkspace, "TIDHAR בין השדרות")).toBeNull();
  });
});

// --- CRITICAL semantic safeguard (section 13) ---------------------------

describe("mortgage linkage vs construction-index exemption (CRITICAL safeguard)", () => {
  it("Zeev Branda: unlinked, VERIFIED mortgage must not imply a verified indexation exemption", () => {
    const financingLines = formatFinancingBenefitLines(ZEEV_BRANDA.commercial_offer.financing_benefit);
    expect(financingLines.join(" | ")).toContain("לא צמודה");
    expect(financingLines.join(" | ")).not.toContain("מדד");

    expect(formatIndexationBenefit(ZEEV_BRANDA.commercial_offer.indexation_benefit)).toBeNull();
  });

  it("RAYK EAST SIDE: same safeguard holds under the mortgage_campaign field-name shape (interest_rate_pct/index_linkage)", () => {
    const financingLines = formatFinancingBenefitLines(RAYK.commercial_offer.financing_benefit);
    expect(financingLines.join(" | ")).toContain("1.99%");
    expect(financingLines.join(" | ")).toContain("לא צמודה");
    expect(formatIndexationBenefit(RAYK.commercial_offer.indexation_benefit)).toBeNull();
  });

  it("THE STRIP: the one positive case -- VERIFIED full_exemption renders 'פטור מהצמדה למדד'", () => {
    expect(formatIndexationBenefit(THE_STRIP.commercial_offer.indexation_benefit)).toBe("פטור מהצמדה למדד");
  });
});

// --- Payment structure formatting (sections 10-11) -----------------------

describe("formatPaymentStructure", () => {
  it("TIDHAR: concrete installments render with known Hebrew milestone labels", () => {
    expect(formatPaymentStructure(TIDHAR.commercial_offer.payment_structure)).toBe("20% בתחילת העסקה · 80% בסמוך לאכלוס");
  });

  it("THE STRIP: a vague installment timing ('later per campaign') is never translated into a concrete milestone", () => {
    const label = formatPaymentStructure(THE_STRIP.commercial_offer.payment_structure)!;
    expect(label).toContain("20% בתחילת העסקה");
    expect(label).toContain("80% בתשלום מאוחר · מועד מדויק לא פורסם");
    expect(label).not.toMatch(/קמפיין/); // never fabricates the vague English text as a Hebrew milestone
  });

  it("Zeev Branda: an advertised 80/20 OPTION with no recovered chronology shows the plain type label, never a fabricated installments split", () => {
    expect(formatPaymentStructure(ZEEV_BRANDA.commercial_offer.payment_structure)).toBe("מסלול 80/20");
  });

  it("גבאי על הפארק: the vague 80% timing token is preserved as vague, not silently normalized", () => {
    const label = formatPaymentStructure(GABAY_PARK.commercial_offer.payment_structure)!;
    expect(label).toContain("20% בתחילת העסקה");
    expect(label).toContain("80% בתשלום מאוחר · מועד מדויק לא פורסם");
  });

  it("UNKNOWN payment_structure renders null, never a fabricated label", () => {
    expect(formatPaymentStructure(RAYK.commercial_offer.payment_structure)).toBeNull();
  });
});

// --- Scope applicability (section 22) ------------------------------------

describe("commercialTermAppliesToSubject", () => {
  it("PROJECT_WIDE always applies regardless of subject room count", () => {
    expect(commercialTermAppliesToSubject({ scope: "PROJECT_WIDE" }, 3)).toBe("CONFIRMED_FOR_SUBJECT");
    expect(commercialTermAppliesToSubject({ scope: "PROJECT_WIDE" }, null)).toBe("CONFIRMED_FOR_SUBJECT");
  });

  it("גבאי על הפארק's ROOM_FAMILY 20/80 (rooms=5) confirms for a 5R subject but NOT for a 3R subject", () => {
    const term = GABAY_PARK.commercial_offer.payment_structure;
    expect(commercialTermAppliesToSubject(term, 5)).toBe("CONFIRMED_FOR_SUBJECT");
    expect(commercialTermAppliesToSubject(term, 3)).toBe("NOT_APPLICABLE");
  });

  it("SELECTED_UNITS never resolves to confirmed, regardless of subject match", () => {
    const term = BERESHIT_FAMILY.commercial_offer.promotions[0];
    expect(commercialTermAppliesToSubject(term, 3)).toBe("SELECTED_UNITS_ONLY");
  });

  it("CAMPAIGN_GENERAL is shown as a project campaign, not a subject-confirmed term", () => {
    expect(commercialTermAppliesToSubject(ZEEV_BRANDA.commercial_offer.payment_structure, 3)).toBe("CAMPAIGN_GENERAL");
  });
});

// --- Promotions / included benefits (sections 15, 16, 22) -----------------

describe("formatPromotionLabel", () => {
  it("THE STRIP: both promotions render concise Hebrew, not the raw English source text", () => {
    const labels = THE_STRIP.commercial_offer.promotions.map(formatPromotionLabel);
    expect(labels).toContain("מחירי סוף השנה");
    expect(labels).toContain("אפשרות ביטול בתנאים מסוימים במקרה של ירידת מחיר");
    expect(labels.join(" ")).not.toContain("cancellation"); // never the raw English dump
  });

  it("בראשית פמלי: SELECTED_UNITS trade-in is marked 'ליחידות משתתפות', never presented as included for every unit", () => {
    const label = formatPromotionLabel(BERESHIT_FAMILY.commercial_offer.promotions[0]);
    expect(label).toBe("תוכנית טרייד־אין ליחידות משתתפות");
    expect(label).not.toBe("טרייד־אין כלול");
  });
});

// --- GALIPOLIS / THE SPOT starting-price safeguards (sections 20, 21) -----

describe("GALIPOLIS starting-price safeguard", () => {
  it("the 3R ₪3.215M figure stays STARTING_PRICE, never a verified exact unit price", () => {
    const threeRoom = GALIPOLIS.commercial_offer.published_prices.find((p) => p.rooms === 3)!;
    expect(threeRoom.price_type).toBe("STARTING_PRICE");
    expect(threeRoom.quantitative_unit_price_area).toBe(false);
    expect(threeRoom.semantic_note).toBeTruthy();
  });

  it("exactNumericArea never treats a STARTING_PRICE row's null area as 0 or invented", () => {
    expect(exactNumericArea(GALIPOLIS.commercial_offer.published_prices[0].internal_area_sqm)).toBeNull();
  });
});

// --- exactNumericArea / numericOrRangeLabel (section 19, 38) --------------

describe("exactNumericArea and numericOrRangeLabel", () => {
  it("treats a range-string as valid display data but NOT a valid numeric scalar", () => {
    expect(exactNumericArea("67-77")).toBeNull();
    expect(numericOrRangeLabel("67-77", 'מ"ר')).toBe('67–77 מ"ר');
  });

  it("treats an exact numeric scalar as a valid numeric scalar", () => {
    expect(exactNumericArea(71)).toBe(71);
  });

  it("never crashes or invents a value for null", () => {
    expect(exactNumericArea(null)).toBeNull();
    expect(numericOrRangeLabel(null, 'מ"ר')).toBeNull();
  });
});

// --- Historical protection (sections 30, 32) ------------------------------

describe("חלומות ברנע historical protection", () => {
  it("the historical ₪1.619M figure never appears in current published_prices", () => {
    expect(HALOMOT_BARNEA.commercial_offer.published_prices).toEqual([]);
    expect(HALOMOT_BARNEA.commercial_offer_history[0].price_ils).toBe(1619000);
    expect(currentOfferNeverIncludesHistory(HALOMOT_BARNEA)).toBe(true);
  });

  it("current delivery status (RESOLVED_BY_PRIMARY_SOURCE) drives display over stale marketing language", () => {
    expect(formatDeliveryLabel(HALOMOT_BARNEA.commercial_offer.delivery)).toBe("סטטוס: מאוכלס");
    expect(isHistoricalCommercialTerm(HALOMOT_BARNEA.commercial_offer.delivery)).toBe(false);
  });

  it("a HISTORICAL-status entry is correctly identified by the type guard", () => {
    expect(isHistoricalCommercialTerm(HALOMOT_BARNEA.commercial_offer_history[0])).toBe(true);
  });
});

// --- Conflicts preserved, never a discount (section 31) -------------------

describe("בראשית פמלי conflict handling", () => {
  it("the two price observations are preserved as a conflict, never collapsed into a discount claim", () => {
    expect(BERESHIT_FAMILY.conflicts).toHaveLength(1);
    const summary = deriveCommercialOfferSummary(BERESHIT_FAMILY)!;
    expect(summary.hasConflicts).toBe(true);
    // No function in this module ever computes a delta between the two
    // conflict values -- the summary only ever reports that a conflict
    // exists, never a "הנחה ₪X" figure.
  });
});

// --- UNKNOWN never renders as "אין" (section 34) ---------------------------

describe("UNKNOWN status handling", () => {
  it("never returns the literal string 'אין' for any UNKNOWN field", () => {
    expect(formatPaymentStructure(RAYK.commercial_offer.payment_structure)).not.toBe("אין");
    expect(formatIndexationBenefit(RAYK.commercial_offer.indexation_benefit)).not.toBe("אין");
    expect(formatDeliveryLabel(TIDHAR.commercial_offer.delivery)).not.toBe("אין");
    expect(formatDeliveryLabel(TIDHAR.commercial_offer.delivery)).toBeNull();
  });
});

// --- Type guards (section 38) ----------------------------------------------

describe("type guards", () => {
  it("isVerifiedCommercialTerm / isCurrentCommercialTerm never rely on truthiness alone", () => {
    expect(isVerifiedCommercialTerm(THE_STRIP.commercial_offer.indexation_benefit)).toBe(true);
    expect(isVerifiedCommercialTerm(RAYK.commercial_offer.indexation_benefit)).toBe(false);
    expect(isCurrentCommercialTerm(ZEEV_BRANDA.commercial_offer.delivery)).toBe(true); // RECENT_UNCONFIRMED is still current
    expect(isCurrentCommercialTerm(RAYK.commercial_offer.payment_structure)).toBe(false); // UNKNOWN is not current
  });
});

// --- Source-collision / priority merge (sections 25, 42) -------------------

describe("resolvePaymentTermsLabel (source-collision guard)", () => {
  it("prefers the VERIFIED commercial-enrichment payment structure over the legacy field, never rendering both", () => {
    const result = resolvePaymentTermsLabel("מסלול תשלום 20/80 (legacy)", TIDHAR);
    expect(result).toBe("20% בתחילת העסקה · 80% בסמוך לאכלוס");
    expect(result).not.toContain("legacy");
  });

  it("falls back to the legacy label when enrichment has no record for this project at all", () => {
    expect(resolvePaymentTermsLabel("מסלול תשלום 20/80 (legacy)", null)).toBe("מסלול תשלום 20/80 (legacy)");
  });

  it("falls back to the legacy label when enrichment has a record but no VERIFIED payment_structure", () => {
    expect(resolvePaymentTermsLabel("legacy label", RAYK)).toBe("legacy label");
  });
});

// --- Same-budget data layer (sections 27-29, 43) ---------------------------

describe("pickBestCommercialPriceCandidate (data layer for the not-yet-built same-budget feature)", () => {
  it("prefers an existing canonical known_unit_variants match over enrichment data", () => {
    const candidate = pickBestCommercialPriceCandidate(TIDHAR, 3, { areaSqm: 71, priceIls: 3_650_000 });
    expect(candidate?.source).toBe("canonical_variant");
    expect(candidate?.priceIls).toBe(3_650_000);
    expect(candidate?.isStartingPrice).toBe(false);
  });

  it("falls back to a VERIFIED_UNIT_PRICE exact enrichment variant when no canonical variant is given", () => {
    const candidate = pickBestCommercialPriceCandidate(TIDHAR, 3, null);
    expect(candidate?.source).toBe("commercial_enrichment_exact");
    expect(candidate?.priceIls).toBe(3_700_000);
    expect(candidate?.isStartingPrice).toBe(false);
  });

  it("THE SPOT-style project: falls back to a STARTING_PRICE candidate tagged isStartingPrice, never treated as an exact unit price", () => {
    const candidate = pickBestCommercialPriceCandidate(GALIPOLIS, 3, null);
    expect(candidate?.source).toBe("commercial_enrichment_starting_price");
    expect(candidate?.isStartingPrice).toBe(true);
    expect(candidate?.priceIls).toBe(3_215_000);
  });

  it("returns null (never a guessed candidate) when no room-matching data exists at all", () => {
    expect(pickBestCommercialPriceCandidate(HALOMOT_BARNEA, 3, null)).toBeNull();
  });

  it("STARTING_PRICE_BADGE_LABEL is the fixed, non-substitutable badge text", () => {
    expect(STARTING_PRICE_BADGE_LABEL).toBe("מחיר התחלתי");
    expect(STARTING_PRICE_BADGE_LABEL).not.toBe("מחיר דירה");
  });
});

// --- Compact summary line never fabricates content (section 7) ------------

describe("compactCommercialOfferLine", () => {
  it("returns null when the project has no record at all (never a placeholder line)", () => {
    expect(compactCommercialOfferLine(deriveCommercialOfferSummary(null))).toBeNull();
  });

  it("renders payment + indexation for a fully-researched project", () => {
    const line = compactCommercialOfferLine(deriveCommercialOfferSummary(THE_STRIP));
    expect(line).toContain("20%");
    expect(line).toContain("פטור מהצמדה למדד");
  });
});

// --- Source line formatting (section 35) -----------------------------------

describe("commercialSourceLine", () => {
  it("formats retrieved_at as DD.MM.YYYY alongside the source title", () => {
    expect(commercialSourceLine(TIDHAR.sources[0])).toBe("TIDHAR בין השדרות — official campaign · נבדק: 14.09.2026");
  });
});
