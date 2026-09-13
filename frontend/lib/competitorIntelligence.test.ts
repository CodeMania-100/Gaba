// Regression tests for "P0 — Fix competitor/product matching globally".
// buildFactSheet used to pick the cheapest priced unit variant across EVERY
// room count regardless of which family the caller actually cared about --
// this is what let a project with (say) only a 6R-priced variant show that
// 6R price under a 3R comparison. rooms, when given, must restrict pricing
// to a variant that actually matches that room count (or a genuine
// project-level starting price), never an unrelated room count's price.

import { describe, expect, it } from "vitest";
import { PetahTikvaWorkspace } from "./api";
import { buildFactSheet } from "./competitorIntelligence";
import { ils } from "./format";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

function workspaceWithProject(project: Rec): PetahTikvaWorkspace {
  return {
    competitor_landscape: { projects: [project] },
    standard_attribute_enrichment: {
      families: {
        standard_3r: { new_development_comparables: [] },
        standard_5r: { new_development_comparables: [] },
      },
    },
    special_unit_market_context: { units: {} },
  } as unknown as PetahTikvaWorkspace;
}

describe("buildFactSheet with a rooms argument (P0 fix)", () => {
  it("acceptance test: a project with only a 6-room priced variant must not show that price under a 3-room (rooms=3) lookup", () => {
    // known_unit_variants values arrive as raw strings from the frozen
    // register, exactly like the real competitor_projects_v2.json shape.
    const project = {
      project_name: "NAVE PARK",
      display_classification: "relevant",
      relevance: ["standard_5r"],
      known_unit_variants: [{ rooms: "6", price_ils: "3850000", price_basis: null, internal_area_sqm: "180" }],
    };
    const workspace = workspaceWithProject(project);

    const fact3R = buildFactSheet(workspace, "NAVE PARK", "NAVE PARK", 3);
    expect(fact3R.currentPriceIls).toBeNull();
    expect(fact3R.priceLabel).toBeNull(); // caller renders "לא פורסם" for null, never a substituted price

    const fact6R = buildFactSheet(workspace, "NAVE PARK", "NAVE PARK", 6);
    expect(fact6R.currentPriceIls).toBe(3850000);
  });

  it("picks the room-matching variant's own price, not the cheapest variant overall, when a project has several room counts", () => {
    const project = {
      project_name: "זאב ברנדה 22",
      display_classification: "direct",
      relevance: ["standard_3r", "standard_5r"],
      known_unit_variants: [
        { rooms: "3", price_ils: "2400000", price_basis: null, internal_area_sqm: "68" },
        { rooms: "5", price_ils: "1900000", price_basis: null, internal_area_sqm: "110" }, // deliberately cheaper than the 3R one
      ],
    };
    const workspace = workspaceWithProject(project);

    // Without the fix, Math.min(...) across all variants would pick the
    // cheaper 5R price (1,900,000) even for the 3R lookup.
    const fact3R = buildFactSheet(workspace, "זאב ברנדה 22", "זאב ברנדה 22", 3);
    expect(fact3R.currentPriceIls).toBe(2400000);
    expect(fact3R.pricePerSqmIls).toBeCloseTo(2400000 / 68, 5);

    const fact5R = buildFactSheet(workspace, "זאב ברנדה 22", "זאב ברנדה 22", 5);
    expect(fact5R.currentPriceIls).toBe(1900000);
    expect(fact5R.pricePerSqmIls).toBeCloseTo(1900000 / 110, 5);
  });

  it("falls back to the genuine project-level starting price (never a different room's variant) when no variant matches", () => {
    const project = {
      project_name: "פרויקט התחלתי",
      display_classification: "relevant",
      relevance: ["standard_3r"],
      known_unit_variants: [{ rooms: "5", price_ils: "3000000", price_basis: null }],
      project_price_from_ils: 2100000,
    };
    const workspace = workspaceWithProject(project);

    const fact3R = buildFactSheet(workspace, "פרויקט התחלתי", "פרויקט התחלתי", 3);
    expect(fact3R.currentPriceIls).toBe(2100000);
    expect(fact3R.isStartingPriceOnly).toBe(true);
    expect(fact3R.priceLabel).toContain("החל מ־");
  });

  it("omitting rooms preserves the previous cross-family cheapest-variant behavior (backward compatible for callers with no family context)", () => {
    const project = {
      project_name: "X",
      display_classification: "relevant",
      relevance: ["standard_3r", "standard_5r"],
      known_unit_variants: [
        { rooms: "3", price_ils: "2400000", price_basis: null },
        { rooms: "5", price_ils: "1900000", price_basis: null },
      ],
    };
    const workspace = workspaceWithProject(project);
    const fact = buildFactSheet(workspace, "X", "X"); // no rooms argument at all
    expect(fact.currentPriceIls).toBe(1900000); // cheapest overall, unchanged legacy behavior
  });

  it("priceLabel always agrees with currentPriceIls (never a project-wide range independent of the matched variant)", () => {
    const project = {
      project_name: "Y",
      display_classification: "relevant",
      relevance: ["standard_3r"],
      known_unit_variants: [
        { rooms: "3", price_ils: "2200000", price_basis: null },
        { rooms: "5", price_ils: "4500000", price_basis: null },
      ],
    };
    const workspace = workspaceWithProject(project);
    const fact = buildFactSheet(workspace, "Y", "Y", 3);
    expect(fact.priceLabel).toBe(ils(2200000));
    expect(fact.currentPriceIls).toBe(2200000);
  });

  it("a project with no register entry at all (e.g. a special-unit-only comparator) is unaffected by the rooms argument", () => {
    const workspace = {
      competitor_landscape: { projects: [] },
      standard_attribute_enrichment: { families: { standard_3r: { new_development_comparables: [] }, standard_5r: { new_development_comparables: [] } } },
      special_unit_market_context: { units: {} },
    } as unknown as PetahTikvaWorkspace;
    const fact = buildFactSheet(workspace, "NAVE PARK", "NAVE PARK נווה פארק", 3);
    expect(fact.currentPriceIls).toBeNull();
    expect(fact.priceLabel).toBeNull();
  });
});

// Regression tests for "P0 -- Fix matched-variant fact consistency globally"
// (TIDHAR בין השדרות: 3R = 71 מ״ר / ₪3.7M / ₪52,113 למ״ר -- the UI correctly
// showed the price and ₪/מ״ר but rendered area as "—" because areaLabel was
// derived from the project-wide area_sqm_range instead of the SAME matched
// variant already driving the price. Two real root causes: an empty (not
// null) area_sqm_range from the multi-city reshape, and buildFactSheet never
// reading the matched variant's own area into areaLabel at all).
describe("buildFactSheet matched-variant fact consistency (P0 fix)", () => {
  it("TIDHAR acceptance case: area/floor/₪-per-מ״ר all come from the SAME matched variant as the price, even though the project-level area range is empty (not null)", () => {
    const project = {
      project_name: "TIDHAR בין השדרות",
      display_classification: "relevant",
      relevance: ["standard_3r", "standard_5r"],
      area_sqm_range: [], // the exact multi-city reshape shape that used to render "—–— מ״ר"
      known_unit_variants: [
        { rooms: "3", price_ils: "3700000", price_basis: null, internal_area_sqm: "71", floor: null },
        { rooms: "5", price_ils: "4758000", price_basis: null, internal_area_sqm: "105", floor: null },
      ],
    };
    const workspace = workspaceWithProject(project);

    const fact3R = buildFactSheet(workspace, "TIDHAR בין השדרות", "TIDHAR בין השדרות", 3);
    expect(fact3R.currentPriceIls).toBe(3700000);
    expect(fact3R.areaLabel).toBe("71 מ״ר"); // never "—–— מ״ר", never null
    expect(fact3R.pricePerSqmIls).toBeCloseTo(3700000 / 71, 5);

    const fact5R = buildFactSheet(workspace, "TIDHAR בין השדרות", "TIDHAR בין השדרות", 5);
    expect(fact5R.currentPriceIls).toBe(4758000);
    expect(fact5R.areaLabel).toBe("105 מ״ר");
    expect(fact5R.pricePerSqmIls).toBeCloseTo(4758000 / 105, 5);
  });

  it("invariant: when the matched variant has a price but genuinely no area, areaLabel and pricePerSqmIls both stay null -- never borrowed from an unrelated project-wide range", () => {
    const project = {
      project_name: "חסר שטח לדגם",
      display_classification: "relevant",
      relevance: ["standard_3r"],
      // A real, populated project-wide range exists -- but it must NEVER be
      // used to fill in this SPECIFIC model's area once a model was matched.
      area_sqm_range: [60, 140],
      known_unit_variants: [{ rooms: "3", price_ils: "2000000", price_basis: null, internal_area_sqm: null }],
    };
    const workspace = workspaceWithProject(project);
    const fact = buildFactSheet(workspace, "חסר שטח לדגם", "חסר שטח לדגם", 3);
    expect(fact.currentPriceIls).toBe(2000000);
    expect(fact.areaLabel).toBeNull();
    expect(fact.pricePerSqmIls).toBeNull();
  });

  it("a matched variant's own floor is shown, never the project-wide floor range", () => {
    const project = {
      project_name: "פרויקט עם קומה",
      display_classification: "relevant",
      relevance: ["standard_3r"],
      floors_range: [1, 20],
      known_unit_variants: [{ rooms: "3", price_ils: "2000000", price_basis: null, internal_area_sqm: "70", floor: "5" }],
    };
    const workspace = workspaceWithProject(project);
    const fact = buildFactSheet(workspace, "פרויקט עם קומה", "פרויקט עם קומה", 3);
    expect(fact.floorRangeLabel).toBe("קומה 5"); // this model's own floor, not "קומות 1–20"
  });

  it("tolerates Petah Tikva's own native variant field spelling (area_sqm instead of internal_area_sqm)", () => {
    const project = {
      project_name: "הרב ניימן 8",
      display_classification: "relevant",
      relevance: ["standard_3r"],
      known_unit_variants: [{ rooms: 3, price_ils: 2150000, floor: 5, area_sqm: 77 }],
    };
    const workspace = workspaceWithProject(project);
    const fact = buildFactSheet(workspace, "הרב ניימן 8", "הרב ניימן 8", 3);
    expect(fact.currentPriceIls).toBe(2150000);
    expect(fact.areaLabel).toBe("77 מ״ר");
    expect(fact.pricePerSqmIls).toBeCloseTo(2150000 / 77, 5);
    expect(fact.floorRangeLabel).toBe("קומה 5");
  });
});
