// Regression tests for "Resolve the FAMILY GROOVE / JADE variant conflict":
// two real competitors (Tel Aviv "FAMILY GROOVE TLV — נגבה 21-27" and
// Ashkelon "JADE אשקלון") each have more than one current, eligible variant
// at the same room count -- and this app's map/register/matrix picker
// (lib/competitorRegister.ts's pickRoomMatchedVariant, "cheapest among
// ties") and its product-comparison picker (lib/standardEnrichment.ts's
// pickVariant, "closest area to subject") were two independently
// implemented rules that could disagree about which physical unit is "the"
// match for a given family. Both now funnel through the one shared
// pickCanonicalVariant rule (see competitorRegister.ts), so for the same
// project + room count + subject area they must always agree. These tests
// prove that agreement holds across every subject-aware surface's own
// entry point -- not just that the two low-level pickers happen to agree.

import { describe, expect, it } from "vitest";
import { PetahTikvaWorkspace } from "./api";
import { buildFactSheet } from "./competitorIntelligence";
import { matchedVariantSummary, pickRoomMatchedVariant } from "./competitorRegister";
import { pickVariant } from "./standardEnrichment";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

function workspaceWith(project: Rec, ndComparable: Rec | null, familyTarget: { family: "3R" | "5R"; internal_area: number }): PetahTikvaWorkspace {
  const familyKey = familyTarget.family === "3R" ? "standard_3r" : "standard_5r";
  return {
    competitor_landscape: { projects: [project] },
    standard_attribute_enrichment: {
      families: {
        standard_3r: { new_development_comparables: familyKey === "standard_3r" && ndComparable ? [ndComparable] : [] },
        standard_5r: { new_development_comparables: familyKey === "standard_5r" && ndComparable ? [ndComparable] : [] },
      },
    },
    special_unit_market_context: { units: {} },
    families: [{ family: familyTarget.family, target: { internal_area: familyTarget.internal_area } }],
  } as unknown as PetahTikvaWorkspace;
}

describe("FAMILY GROOVE TLV — נגבה 21-27 (real data, 3R, subject area 69 מ״ר)", () => {
  // Real known_unit_variants: a 76 מ״ר "starting price" model and a 107 מ״ר
  // CURRENT_ASKING model, both eligible, both 3-room.
  const project = {
    project_name: "FAMILY GROOVE TLV — נגבה 21-27",
    display_classification: "relevant",
    relevance: ["standard_3r"],
    known_unit_variants: [
      { rooms: "3", internal_area_sqm: "107", price_ils: "3116610", price_basis: "CURRENT_ASKING" },
      { rooms: "3", internal_area_sqm: "76", price_ils: "3116000", price_basis: "starting price" },
    ],
  };
  // The real standard_attribute_enrichment unit_variants shape for the same project.
  const ndComparable = {
    project: "FAMILY GROOVE TLV — נגבה 21-27",
    project_level: {},
    starting_price_context: null,
    unit_variants: [
      { rooms: 3, internal_area: 107, price: 3116610, price_basis: "CURRENT_ASKING" },
      { rooms: 3, internal_area: 76, price: 3116000, price_basis: "starting price" },
    ],
  };
  const workspace = workspaceWith(project, ndComparable, { family: "3R", internal_area: 69 });

  it("every subject-aware surface picks the SAME variant (76 מ״ר, not 107)", () => {
    const registerMatched = pickRoomMatchedVariant(project as never, 3, 69);
    const summary = matchedVariantSummary(project as never, 3, 69);
    const fact = buildFactSheet(workspace, project.project_name, project.project_name, 3, 69);
    const productComparisonVariant = pickVariant(ndComparable as never, 3, 69);

    // register/map popup/aggregate member
    expect(registerMatched?.internal_area_sqm).toBe("76");
    expect(registerMatched?.price_ils).toBe("3116000");
    // register card summary bundle
    expect(summary?.areaSqm).toBe(76);
    expect(summary?.priceIls).toBe(3116000);
    // buildFactSheet -- map popup / price-positioning matrix
    expect(fact.areaLabel).toBe("76 מ״ר");
    expect(fact.currentPriceIls).toBe(3116000);
    expect(fact.pricePerSqmIls).toBeCloseTo(3116000 / 76, 5);
    // product comparison / map -> full comparison
    expect(productComparisonVariant?.internal_area).toBe(76);
    expect(productComparisonVariant?.price).toBe(3116000);
  });
});

describe("JADE אשקלון (real data, 5R, subject area 111.1 מ״ר)", () => {
  // Real known_unit_variants: two 5-room "starting price" models, 152 מ״ר
  // and 126 מ״ר, plus unrelated room-count noise (3/4/6) that must never be
  // picked for a 5R lookup.
  const project = {
    project_name: "JADE אשקלון",
    display_classification: "relevant",
    relevance: ["standard_5r"],
    known_unit_variants: [
      { rooms: "3", internal_area_sqm: "77.5", price_ils: "1790000", price_basis: "starting price" },
      { rooms: "5", internal_area_sqm: "152", price_ils: "4450000", price_basis: "starting price" },
      { rooms: "6", internal_area_sqm: "173", price_ils: "5250000", price_basis: "starting price" },
      { rooms: "4", internal_area_sqm: "106", price_ils: "2110000", price_basis: "starting price" },
      { rooms: "5", internal_area_sqm: "126", price_ils: "2290000", price_basis: "starting price" },
      { rooms: "6", internal_area_sqm: "146", price_ils: "2680000", price_basis: "starting price" },
    ],
  };
  const ndComparable = {
    project: "JADE אשקלון",
    project_level: {},
    starting_price_context: null,
    unit_variants: [
      { rooms: 3, internal_area: 77.5, price: 1790000, price_basis: "starting price" },
      { rooms: 5, internal_area: 152, price: 4450000, price_basis: "starting price" },
      { rooms: 6, internal_area: 173, price: 5250000, price_basis: "starting price" },
      { rooms: 4, internal_area: 106, price: 2110000, price_basis: "starting price" },
      { rooms: 5, internal_area: 126, price: 2290000, price_basis: "starting price" },
      { rooms: 6, internal_area: 146, price: 2680000, price_basis: "starting price" },
    ],
  };
  const workspace = workspaceWith(project, ndComparable, { family: "5R", internal_area: 111.1 });

  it("every subject-aware surface picks the SAME variant (126 מ״ר, closest to 111.1, not the cheaper-overall-but-farther 152)", () => {
    const registerMatched = pickRoomMatchedVariant(project as never, 5, 111.1);
    const summary = matchedVariantSummary(project as never, 5, 111.1);
    const fact = buildFactSheet(workspace, project.project_name, project.project_name, 5, 111.1);
    const productComparisonVariant = pickVariant(ndComparable as never, 5, 111.1);

    expect(registerMatched?.internal_area_sqm).toBe("126");
    expect(registerMatched?.price_ils).toBe("2290000");
    expect(summary?.areaSqm).toBe(126);
    expect(summary?.priceIls).toBe(2290000);
    expect(fact.areaLabel).toBe("126 מ״ר");
    expect(fact.currentPriceIls).toBe(2290000);
    expect(productComparisonVariant?.internal_area).toBe(126);
    expect(productComparisonVariant?.price).toBe(2290000);
  });
});

// A synthetic case constructed so "cheapest" and "closest-to-subject-area"
// genuinely disagree (unlike the two real cases above, where the two rules
// happen to also agree once given the real subject area) -- proving the
// unified rule actually prefers area-closeness over price when both are
// eligible, not merely coinciding with the old cheapest-only behavior.
describe("pickRoomMatchedVariant vs pickVariant: genuine cheapest-vs-closest conflict (synthetic)", () => {
  const project = {
    project_name: "פרויקט בדיקה",
    display_classification: "relevant",
    relevance: ["standard_3r"],
    known_unit_variants: [
      { rooms: "3", internal_area_sqm: "40", price_ils: "1000000", price_basis: "starting price" }, // cheap, far from subject
      { rooms: "3", internal_area_sqm: "100", price_ils: "5000000", price_basis: "starting price" }, // expensive, close to subject
    ],
  };
  const ndComparable = {
    project: "פרויקט בדיקה",
    project_level: {},
    starting_price_context: null,
    unit_variants: [
      { rooms: 3, internal_area: 40, price: 1000000, price_basis: "starting price" },
      { rooms: 3, internal_area: 100, price: 5000000, price_basis: "starting price" },
    ],
  };

  it("both pickers choose the pricier-but-closer-in-area variant when a subject area is given", () => {
    const registerMatched = pickRoomMatchedVariant(project as never, 3, 95);
    const productComparisonVariant = pickVariant(ndComparable as never, 3, 95);
    expect(registerMatched?.internal_area_sqm).toBe("100");
    expect(productComparisonVariant?.internal_area).toBe(100);
  });

  it("both pickers deterministically fall back to the cheaper variant when no subject area is known", () => {
    const registerMatched = pickRoomMatchedVariant(project as never, 3, null);
    const productComparisonVariant = pickVariant(ndComparable as never, 3, null);
    expect(registerMatched?.internal_area_sqm).toBe("40");
    expect(productComparisonVariant?.internal_area).toBe(40);
  });

  it("excludes an ineligible (historical/context-only) variant even when it would otherwise be the closest by area", () => {
    const projectWithHistorical = {
      ...project,
      known_unit_variants: [
        { rooms: "3", internal_area_sqm: "100", price_ils: "5000000", price_basis: "HISTORICAL_MARKETING_PRICE" }, // closest by area, but ineligible
        { rooms: "3", internal_area_sqm: "40", price_ils: "1000000", price_basis: "starting price" },
      ],
    };
    expect(pickRoomMatchedVariant(projectWithHistorical as never, 3, 95)?.internal_area_sqm).toBe("40");
  });
});
