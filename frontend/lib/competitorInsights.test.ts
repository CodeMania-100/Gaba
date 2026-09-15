// Regression tests for "תובנות שיווקיות מול המתחרים" (lib/competitorInsights.ts).
// This is a selection/ranking/phrasing layer only -- every fixture below
// mirrors real field shapes already used elsewhere in this app (see
// lib/standardEnrichment.ts's ComparableItem, lib/commercialTerms.ts's
// CommercialOfferSummary), never a new data shape.

import { describe, expect, it } from "vitest";
import { CommercialOfferSummary } from "./commercialTerms";
import { CompetitorInsightInput, deriveCompetitorInsights } from "./competitorInsights";
import { ComparableItem } from "./standardEnrichment";

const FAMILY_3R = { family: "3R" as const, market: { supported_lower: 3_000_000, supported_upper: 3_400_000 } }; // midpoint 3.2M

function ndItem(overrides: { variant?: Record<string, unknown> | null; startingPriceIls?: number; projectLevel?: Record<string, unknown> }): ComparableItem {
  return {
    kind: "new_development",
    competitor: {
      project: "מתחרה לדוגמה",
      project_level: overrides.projectLevel ?? {},
      starting_price_context: overrides.startingPriceIls != null ? { value: overrides.startingPriceIls, applies_to: "3-room marketing line" } : null,
    },
    variant: overrides.variant ?? null,
  };
}

function askingItem(askingPriceIls: number): ComparableItem {
  return { kind: "current_asking", record: { address: "כתובת לדוגמה", asking_price: askingPriceIls } };
}

function emptySummary(): CommercialOfferSummary {
  return {
    paymentLabel: null,
    financingLabels: [],
    indexationLabel: null,
    promotionLabels: [],
    includedBenefitLabels: [],
    deliveryLabel: null,
    currentOfferCount: 0,
    hasHistoricalOffers: false,
    hasConflicts: false,
    sources: [],
  };
}

function input(competitorName: string, item: ComparableItem, summary: Partial<CommercialOfferSummary> | null = null): CompetitorInsightInput {
  return { competitorName, item, commercialSummary: summary ? { ...emptySummary(), ...summary } : null };
}

describe("price-position insight", () => {
  it("surfaces a real, exact-variant price gap over ±10% against our market indication", () => {
    // 3.2M midpoint, competitor at 3.9M -> ~22% gap
    const insights = deriveCompetitorInsights(FAMILY_3R, [input("THE SPOT", ndItem({ variant: { price: 3_900_000 } }))]);
    expect(insights).toHaveLength(1);
    expect(insights[0].category).toBe("price_position");
    expect(insights[0].sentence).toContain("גבוה");
    expect(insights[0].sentence).toContain("22%");
    expect(insights[0].sentence).toContain("מחיר מתחרה"); // exact variant price, never "starting price"
  });

  it("labels a STARTING_PRICE-only figure explicitly, never as an exact unit price", () => {
    const insights = deriveCompetitorInsights(FAMILY_3R, [input("THE SPOT", ndItem({ startingPriceIls: 3_800_000 }))]);
    expect(insights).toHaveLength(1);
    expect(insights[0].sentence).toContain("מחיר התחלתי בפרויקט");
    expect(insights[0].sentence).not.toBe("מחיר מתחרה");
  });

  it("reads a current_asking listing's genuine asking price, never as a starting price", () => {
    const insights = deriveCompetitorInsights(FAMILY_3R, [input("רחוב הרצל 5", askingItem(3_900_000))]);
    expect(insights[0].sentence).toContain("מחיר מתחרה");
  });

  it("stays silent (no insight) for a gap under the ±10% threshold", () => {
    // 3.2M midpoint, competitor at 3.3M -> ~3% gap
    const insights = deriveCompetitorInsights(FAMILY_3R, [input("קרוב מדי", ndItem({ variant: { price: 3_300_000 } }))]);
    expect(insights).toHaveLength(0);
  });

  it("produces no price-position insight when our own market indication is unknown", () => {
    const unknownMarket = { family: "3R" as const, market: { supported_lower: null, supported_upper: null } };
    const insights = deriveCompetitorInsights(unknownMarket, [input("THE SPOT", ndItem({ variant: { price: 3_900_000 } }))]);
    expect(insights.filter((i) => i.category === "price_position")).toHaveLength(0);
  });
});

describe("indexation insight -- CRITICAL safeguard", () => {
  it("surfaces only when commercialSummary.indexationLabel is explicitly set (VERIFIED upstream)", () => {
    const insights = deriveCompetitorInsights(FAMILY_3R, [input("THE STRIP", ndItem({}), { indexationLabel: "פטור מהצמדה למדד" })]);
    expect(insights.some((i) => i.category === "indexation" && i.sentence.includes("פטור מהצמדה למדד"))).toBe(true);
  });

  it("never fabricates an indexation insight from financing lines alone (unlinked/fixed mortgage wording)", () => {
    // A financing campaign that mentions "לא צמודה" must NOT, by itself,
    // produce an indexation insight -- indexationLabel stays null exactly
    // like the real Zeev Branda / RAYK EAST SIDE cases upstream.
    const insights = deriveCompetitorInsights(FAMILY_3R, [
      input("זאב ברנדה 22", ndItem({}), { indexationLabel: null, financingLabels: ["משכנתה בקמפיין: 2.99%, קבועה, לא צמודה, ל־20 שנה"] }),
    ]);
    expect(insights.some((i) => i.category === "indexation")).toBe(false);
  });
});

describe("financing-campaign insight", () => {
  it("keeps the exact rate/term as the sentence and puts caveats in the qualifier, never dropped", () => {
    const insights = deriveCompetitorInsights(FAMILY_3R, [
      input("זאב ברנדה 22", ndItem({}), {
        financingLabels: ["משכנתה בקמפיין: 2.99%, קבועה, לא צמודה, ל־20 שנה", "מימון גישור עד מסירת המפתח", "כפוף לתנאי הקמפיין/המלווה"],
      }),
    ]);
    const financing = insights.find((i) => i.category === "financing")!;
    expect(financing.sentence).toBe("משכנתה בקמפיין: 2.99%, קבועה, לא צמודה, ל־20 שנה");
    expect(financing.qualifier).toBe("מימון גישור עד מסירת המפתח · כפוף לתנאי הקמפיין/המלווה");
  });
});

describe("payment-plan insight", () => {
  it("surfaces the commercial-enrichment VERIFIED payment structure when present", () => {
    const insights = deriveCompetitorInsights(FAMILY_3R, [input("THE STRIP", ndItem({}), { paymentLabel: "20% בתחילת העסקה · 80% בסמוך לאכלוס" })]);
    const plan = insights.find((i) => i.category === "payment_plan")!;
    expect(plan.sentence).toContain("20% בתחילת העסקה · 80% בסמוך לאכלוס");
    expect(plan.sentence).toContain("עשוי להשפיע על החלטת הקונה");
  });

  it("falls back to the legacy project_level.payment_terms field only when no commercial-enrichment record exists", () => {
    const item = ndItem({ projectLevel: { payment_terms: "80% at signing, 20% at occupancy" } });
    const insights = deriveCompetitorInsights(FAMILY_3R, [input("פרויקט ישן", item, null)]);
    const plan = insights.find((i) => i.category === "payment_plan")!;
    expect(plan).toBeTruthy();
    expect(plan.sentence).toContain("80%");
  });

  it("never renders both the enrichment label and the legacy label at once (source-collision guard)", () => {
    const item = ndItem({ projectLevel: { payment_terms: "80% at signing, 20% at occupancy" } });
    const insights = deriveCompetitorInsights(FAMILY_3R, [input("פרויקט", item, { paymentLabel: "20% בתחילת העסקה · 80% בסמוך לאכלוס" })]);
    const paymentInsights = insights.filter((i) => i.category === "payment_plan");
    expect(paymentInsights).toHaveLength(1);
    expect(paymentInsights[0].sentence).toContain("20% בתחילת העסקה");
  });
});

describe("delivery insight", () => {
  it("states the competitor's own delivery figure with an explicit 'ours is unpublished' qualifier, never implying who is ahead", () => {
    const insights = deriveCompetitorInsights(FAMILY_3R, [input("RAYK EAST SIDE", ndItem({}), { deliveryLabel: "מסירה: 2029" })]);
    const delivery = insights.find((i) => i.category === "delivery")!;
    expect(delivery.sentence).toBe("מסירה: 2029");
    expect(delivery.qualifier).toBe("אצלנו: מועד מסירה לא פורסם");
  });

  it("falls back to the legacy project_level.delivery field when no enrichment record exists", () => {
    const item = ndItem({ projectLevel: { delivery: "2026-05" } });
    const insights = deriveCompetitorInsights(FAMILY_3R, [input("פרויקט ישן", item, null)]);
    const delivery = insights.find((i) => i.category === "delivery")!;
    expect(delivery.sentence).toContain("2026-05");
  });

  it("never fires when neither side has a published delivery figure", () => {
    const insights = deriveCompetitorInsights(FAMILY_3R, [input("לא ידוע", ndItem({}), null)]);
    expect(insights.some((i) => i.category === "delivery")).toBe(false);
  });
});

describe("differentiator insight (warranty / trade-in / included benefits)", () => {
  it("surfaces a promotion label as the sentence, additional ones as the qualifier", () => {
    const insights = deriveCompetitorInsights(FAMILY_3R, [
      input("THE STRIP", ndItem({}), { promotionLabels: ["מחירי סוף השנה", "אפשרות ביטול בתנאים מסוימים במקרה של ירידת מחיר"] }),
    ]);
    const diff = insights.find((i) => i.category === "differentiator")!;
    expect(diff.sentence).toBe("מחירי סוף השנה");
    expect(diff.qualifier).toBe("אפשרות ביטול בתנאים מסוימים במקרה של ירידת מחיר");
  });

  it("a SELECTED_UNITS-scoped promotion already states its own scope in the label, never implied project-wide", () => {
    const insights = deriveCompetitorInsights(FAMILY_3R, [input("בראשית פמלי", ndItem({}), { promotionLabels: ["תוכנית טרייד־אין ליחידות משתתפות"] })]);
    const diff = insights.find((i) => i.category === "differentiator")!;
    expect(diff.sentence).toBe("תוכנית טרייד־אין ליחידות משתתפות");
  });
});

describe("hide when nothing meaningful", () => {
  it("returns [] when every category has nothing supported (all UNKNOWN/absent)", () => {
    const insights = deriveCompetitorInsights(FAMILY_3R, [input("שקט מוחלט", ndItem({}), null)]);
    expect(insights).toEqual([]);
  });
});

describe("ranking and caps", () => {
  it("ranks price_position before every other category regardless of insertion order", () => {
    const insights = deriveCompetitorInsights(FAMILY_3R, [
      input("A - הטבה בלבד", ndItem({}), { promotionLabels: ["מבצע כלשהו"] }),
      input("B - מחיר חריג", ndItem({ variant: { price: 4_000_000 } })),
    ]);
    expect(insights[0].category).toBe("price_position");
    expect(insights[0].competitorName).toBe("B - מחיר חריג");
  });

  it("caps total insights at 5 even with many eligible candidates across competitors", () => {
    const inputs: CompetitorInsightInput[] = [];
    for (let i = 0; i < 8; i++) {
      inputs.push(input(`מתחרה ${i}`, ndItem({ variant: { price: 4_000_000 + i * 10_000 } }), { indexationLabel: "פטור מהצמדה למדד" }));
    }
    const insights = deriveCompetitorInsights(FAMILY_3R, inputs);
    expect(insights.length).toBeLessThanOrEqual(5);
  });

  it("caps insights at 2 per competitor even when one competitor has many eligible categories", () => {
    const rich = input("עשיר בנתונים", ndItem({ variant: { price: 4_000_000 } }), {
      indexationLabel: "פטור מהצמדה למדד",
      financingLabels: ["משכנתה בקמפיין: 2.99%"],
      paymentLabel: "20/80",
      deliveryLabel: "מסירה: 2029",
      promotionLabels: ["מבצע"],
    });
    const insights = deriveCompetitorInsights(FAMILY_3R, [rich]);
    expect(insights.filter((i) => i.competitorName === "עשיר בנתונים")).toHaveLength(2);
    // and price_position (the highest-priority category) must be one of the two kept
    expect(insights.some((i) => i.category === "price_position")).toBe(true);
  });
});
