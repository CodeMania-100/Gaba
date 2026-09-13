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
