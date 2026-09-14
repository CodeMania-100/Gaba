// Regression tests for "P0 -- Fix matched-variant fact consistency globally":
// areaRangeLabel/roomRangeLabel/floorRangeLabel must (a) treat an empty
// project-level range exactly like a missing one (the multi-city register's
// own reshape writes area_sqm_range as [] rather than null when a project
// has no researched project-wide range), and (b) fall back to deriving a
// range from known_unit_variants when the project-level field genuinely has
// nothing. pickRoomMatchedVariant/matchedVariantSummary/multiModelSummaryLabel
// are the canonical per-model bundle every consuming surface must share.

import { describe, expect, it } from "vitest";
import { CompetitorRegisterProject } from "./api";
import {
  areaRangeLabel,
  floorRangeLabel,
  matchedVariantSummary,
  multiModelSummaryLabel,
  pickRoomMatchedVariant,
  registerPromotionLabels,
  registerSpecificationLabels,
  roomRangeLabel,
} from "./competitorRegister";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function project(overrides: Record<string, any>): CompetitorRegisterProject {
  return {
    project_name: "פרויקט",
    display_classification: "relevant",
    relevance: [],
    quantitative_eligibility: {},
    geography_role: "adjacent_submarket",
    ...overrides,
  } as unknown as CompetitorRegisterProject;
}

describe("areaRangeLabel (P0 fix)", () => {
  it("treats an empty area_sqm_range array exactly like a missing one, never '—–— מ״ר'", () => {
    const p = project({ area_sqm_range: [], known_unit_variants: [] });
    expect(areaRangeLabel(p)).toBeNull();
  });

  it("falls back to deriving a range from known_unit_variants when the project-level range is empty", () => {
    const p = project({
      area_sqm_range: [],
      known_unit_variants: [
        { rooms: "3", price_ils: "3700000", internal_area_sqm: "71" },
        { rooms: "5", price_ils: "4758000", internal_area_sqm: "105" },
      ],
    });
    expect(areaRangeLabel(p)).toBe("71–105 מ״ר");
  });

  it("still prefers a real project-level range when one is on file", () => {
    const p = project({
      area_sqm_range: [67, 192],
      known_unit_variants: [{ rooms: "3", price_ils: "1000000", internal_area_sqm: "999" }],
    });
    expect(areaRangeLabel(p)).toBe("67–192 מ״ר");
  });

  it("tolerates Petah Tikva's own native variant field spelling (area_sqm)", () => {
    const p = project({ known_unit_variants: [{ rooms: 3, price_ils: 2150000, area_sqm: 77 }] });
    expect(areaRangeLabel(p)).toBe("77 מ״ר");
  });

  it("parses a THIRD real shape this field arrives in -- a single 'lo–hi' string, not an array (K — עיר היין אשקלון's real data)", () => {
    const p = project({ area_sqm_range: "77.42–156.6", known_unit_variants: [] });
    expect(areaRangeLabel(p)).toBe("77.4–156.6 מ״ר"); // num() rounds to 1 decimal digit, same as every other area label
  });

  it("returns null (never a guess) when neither a project-level range nor any variant area exists", () => {
    const p = project({ known_unit_variants: [{ rooms: "3", price_ils: "1000000" }] });
    expect(areaRangeLabel(p)).toBeNull();
  });
});

describe("roomRangeLabel and floorRangeLabel variant fallback (P0 fix)", () => {
  it("roomRangeLabel derives from variants when room_range is absent", () => {
    const p = project({
      known_unit_variants: [
        { rooms: "3", price_ils: "1", internal_area_sqm: "1" },
        { rooms: "5", price_ils: "1", internal_area_sqm: "1" },
      ],
    });
    expect(roomRangeLabel(p)).toBe("3–5 חדרים");
  });

  it("roomRangeLabel parses the real single 'lo–hi' string shape, never silently narrowing to a variant-derived range instead", () => {
    const p = project({
      room_range: "3–6",
      known_unit_variants: [
        { rooms: "3", price_ils: "1", internal_area_sqm: "1" },
        { rooms: "5", price_ils: "1", internal_area_sqm: "1" },
      ],
    });
    expect(roomRangeLabel(p)).toBe("3–6 חדרים");
  });

  it("floorRangeLabel derives from variants when floors_range is absent (the multi-city dataset never has floors_range at all)", () => {
    const p = project({
      known_unit_variants: [
        { rooms: "3", price_ils: "1", floor: "2" },
        { rooms: "5", price_ils: "1", floor: "8" },
      ],
    });
    expect(floorRangeLabel(p)).toBe("קומות 2–8");
  });

  it("floorRangeLabel returns null (never invented) when no variant has a floor either", () => {
    const p = project({ known_unit_variants: [{ rooms: "3", price_ils: "1", floor: null }] });
    expect(floorRangeLabel(p)).toBeNull();
  });
});

describe("pickRoomMatchedVariant (P0 fix, canonical)", () => {
  it("matches exact rooms only, cheapest among ties", () => {
    const p = project({
      known_unit_variants: [
        { rooms: "3", price_ils: "2400000" },
        { rooms: "3", price_ils: "2100000" },
        { rooms: "5", price_ils: "1000" },
      ],
    });
    const matched = pickRoomMatchedVariant(p, 3);
    expect(matched?.price_ils).toBe("2100000");
  });

  it("returns null when no variant has this room count priced", () => {
    const p = project({ known_unit_variants: [{ rooms: "5", price_ils: "1000" }] });
    expect(pickRoomMatchedVariant(p, 3)).toBeNull();
  });
});

describe("matchedVariantSummary (P0 fix)", () => {
  it("TIDHAR acceptance case: rooms + area + price + ₪/מ״ר + floor all from the one matched variant", () => {
    const p = project({
      area_sqm_range: [],
      known_unit_variants: [
        { rooms: "3", price_ils: "3700000", price_basis: null, internal_area_sqm: "71", floor: null },
        { rooms: "5", price_ils: "4758000", price_basis: null, internal_area_sqm: "105", floor: null },
      ],
    });
    const summary = matchedVariantSummary(p, 3);
    expect(summary).not.toBeNull();
    expect(summary!.areaSqm).toBe(71);
    expect(summary!.areaLabel).toBe("71 מ״ר");
    expect(summary!.priceIls).toBe(3700000);
    expect(summary!.pricePerSqmIls).toBeCloseTo(3700000 / 71, 5);
    // displayed price/m² must equal displayed price / displayed area exactly
    expect(summary!.pricePerSqmIls).toBeCloseTo(summary!.priceIls! / summary!.areaSqm!, 9);
  });

  it("pricePerSqmIls stays null when the matched variant has a price but no area, even if the project has an unrelated area range", () => {
    const p = project({
      area_sqm_range: [60, 140],
      known_unit_variants: [{ rooms: "3", price_ils: "2000000", internal_area_sqm: null }],
    });
    const summary = matchedVariantSummary(p, 3);
    expect(summary!.priceIls).toBe(2000000);
    expect(summary!.areaLabel).toBeNull();
    expect(summary!.pricePerSqmIls).toBeNull();
  });

  it("returns null when this project has no priced model for the requested room count", () => {
    const p = project({ known_unit_variants: [{ rooms: "5", price_ils: "1000000", internal_area_sqm: "100" }] });
    expect(matchedVariantSummary(p, 3)).toBeNull();
  });

  it("translates a ground-floor variant, never inferring an unpublished floor", () => {
    const p = project({ known_unit_variants: [{ rooms: "3", price_ils: "2000000", internal_area_sqm: "70", floor: "ground" }] });
    expect(matchedVariantSummary(p, 3)!.floorLabel).toBe("קומת קרקע");
  });
});

describe("multiModelSummaryLabel (P0 fix)", () => {
  it("TIDHAR acceptance case: '3 חד׳ 71 מ״ר · 5 חד׳ 105 מ״ר' for a small number of known models", () => {
    const p = project({
      known_unit_variants: [
        { rooms: "3", price_ils: "3700000", internal_area_sqm: "71" },
        { rooms: "5", price_ils: "4758000", internal_area_sqm: "105" },
      ],
    });
    expect(multiModelSummaryLabel(p)).toBe("3 חד׳ 71 מ״ר · 5 חד׳ 105 מ״ר");
  });

  it("returns null when there are more distinct models than maxModels (a plain range reads better than a long list)", () => {
    const p = project({
      known_unit_variants: [2, 3, 4, 5, 6].map((rooms) => ({ rooms: String(rooms), price_ils: "1000000", internal_area_sqm: "50" })),
    });
    expect(multiModelSummaryLabel(p, 4)).toBeNull();
  });

  it("returns null when no variant is priced at all", () => {
    const p = project({ known_unit_variants: [{ rooms: "3", internal_area_sqm: "70" }] });
    expect(multiModelSummaryLabel(p)).toBeNull();
  });
});

// Final P0 data-visibility audit: a variant explicitly flagged by the
// research itself as not a current representative price (price_basis
// "HISTORICAL_MARKETING_PRICE"/"CONTEXT_ONLY", after the multi-city
// reshape) must never be picked as "the" matched model for a room count --
// real case: Ashkelon's "פרץ בוני הנגב בעיר היין" had only one 5R-priced
// variant, a ₪1,441,898 historical government-program price explicitly
// noted "preserved for context only, not current market quantitative
// evidence" -- and pickRoomMatchedVariant picked it anyway, showing a stale
// historical figure as though it were this project's current 5R price.
describe("pickRoomMatchedVariant excludes non-current price_basis values (P0 fix)", () => {
  it("never picks a variant explicitly marked HISTORICAL_MARKETING_PRICE, even when it is the only priced variant for that room count", () => {
    const p = project({
      known_unit_variants: [{ rooms: "5", price_ils: "1441898", price_basis: "HISTORICAL_MARKETING_PRICE", internal_area_sqm: "126" }],
    });
    expect(pickRoomMatchedVariant(p, 5)).toBeNull();
  });

  it("never picks a variant explicitly marked CONTEXT_ONLY", () => {
    const p = project({
      known_unit_variants: [{ rooms: "3", price_ils: "2100000", price_basis: "CONTEXT_ONLY", internal_area_sqm: "155" }],
    });
    expect(pickRoomMatchedVariant(p, 3)).toBeNull();
  });

  it("still picks a normal current-priced variant when one exists alongside an ineligible one", () => {
    const p = project({
      known_unit_variants: [
        { rooms: "5", price_ils: "1441898", price_basis: "HISTORICAL_MARKETING_PRICE", internal_area_sqm: "126" },
        { rooms: "5", price_ils: "4200000", price_basis: "VERIFIED_UNIT_PRICE", internal_area_sqm: "130" },
      ],
    });
    expect(pickRoomMatchedVariant(p, 5)?.price_ils).toBe("4200000");
  });

  it("still picks Petah Tikva's own untagged (price_basis undefined) variants exactly as before", () => {
    const p = project({ known_unit_variants: [{ rooms: 3, price_ils: 2150000, area_sqm: 77 }] });
    expect(pickRoomMatchedVariant(p, 3)?.price_ils).toBe(2150000);
  });
});

describe("registerPromotionLabels / registerSpecificationLabels (P0 fix: surface existing promotions/specification_features)", () => {
  it("reads the multi-city register's array-of-objects promotions shape (TIDHAR's real data)", () => {
    const p = project({
      promotions: [{ promotion_text: "10 שנות אחריות תדהר", promotion_type: "warranty_campaign", validity: null, source_url: "https://example.com" }],
    });
    expect(registerPromotionLabels(p)).toEqual(["10 שנות אחריות תדהר"]);
  });

  it("reads Petah Tikva's own array-of-plain-strings promotions shape", () => {
    const p = project({ promotions: ["bridge financing terms", "last apartments / immediate occupancy campaign"] });
    expect(registerPromotionLabels(p)).toEqual(["bridge financing terms", "last apartments / immediate occupancy campaign"]);
  });

  it("returns an empty array (never a placeholder) when there are genuinely no promotions", () => {
    expect(registerPromotionLabels(project({ promotions: [] }))).toEqual([]);
    expect(registerPromotionLabels(project({}))).toEqual([]);
  });

  it("reads the multi-city register's premium_specification field", () => {
    const p = project({ premium_specification: "New-development specification; exact feature set varies by model." });
    expect(registerSpecificationLabels(p)).toEqual(["New-development specification; exact feature set varies by model."]);
  });

  it("falls back to Petah Tikva's own special_product_notes field", () => {
    const p = project({ special_product_notes: "5–6 room roof duplexes on floors 9–10, 148–192 sqm built." });
    expect(registerSpecificationLabels(p)).toEqual(["5–6 room roof duplexes on floors 9–10, 148–192 sqm built."]);
  });

  it("returns an empty array when neither field is present", () => {
    expect(registerSpecificationLabels(project({}))).toEqual([]);
  });
});
