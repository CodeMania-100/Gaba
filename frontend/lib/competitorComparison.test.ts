// Regression tests for "restore full competitor intelligence and fix פתח
// השוואה מלאה" -- the fixed row-visibility semantics in
// buildProductComparisonRows (a missing competitor value must still render
// as an explicit "לא פורסם"/unknown row, never silently disappear and never
// read as a confirmed absence), the broadened unknown-value recognition in
// competitorMatchStates (so "לא פורסם"/"לא הוזן" never get scored
// "different"), and the new findComparableForCompetitorName lookup that
// lets a specific map-selected competitor be pinned into the comparison
// view.

import { describe, expect, it } from "vitest";
import { JsonRecord, StandardAttributeEnrichmentFamily } from "./api";
import { deriveMatchStateRows } from "./competitorMatchStates";
import { buildProductComparisonRows, ComparableItem, findComparableForCompetitorName } from "./standardEnrichment";

const subject = {
  price: 1_850_000,
  rooms: 3,
  internalArea: 69,
  balconyArea: 12,
  floor: null,
  orientation: null,
};

function newDevelopmentItem(competitor: JsonRecord, variant: JsonRecord | null = null): ComparableItem {
  return { kind: "new_development", competitor, variant };
}

describe("buildProductComparisonRows -- row visibility when competitor data is missing", () => {
  it("still renders the row (never silently drops it) when our side has a value but the competitor's is unpublished", () => {
    // Real scenario from the task: our apartment has a 12 sqm balcony: the
    // competitor's variant simply has no balcony_area field at all.
    const item = newDevelopmentItem({ project: "מגדלי הזית", project_level: {} }, { rooms: 3 });
    const rows = buildProductComparisonRows(subject, item);
    const balconyRow = rows.find((r) => r.label === "מרפסת");
    expect(balconyRow).toBeDefined();
    expect(balconyRow!.subjectValue).toBe("12 מ״ר");
    expect(balconyRow!.competitorValue).toBe("לא פורסם"); // never "אין" -- unpublished, not confirmed absent

    const matched = deriveMatchStateRows(rows).find((r) => r.label === "מרפסת")!;
    expect(matched.matchState).toBe("unknown"); // never "different" merely because the competitor is silent
  });

  it("omits a row only when BOTH sides are genuinely unknown", () => {
    const item = newDevelopmentItem({ project: "מגדלי הזית", project_level: {} }, { rooms: 3 });
    // subject.orientation is null and this variant has no orientation either.
    const rows = buildProductComparisonRows(subject, item);
    expect(rows.find((r) => r.label === "כיוון")).toBeUndefined();
  });

  it("renders a confirmed different value as שונה, never as unknown", () => {
    const item = newDevelopmentItem({ project: "מגדלי הזית", project_level: {} }, { rooms: 4 });
    const rows = buildProductComparisonRows(subject, item); // subject.rooms = 3
    const matched = deriveMatchStateRows(rows).find((r) => r.label === "חדרים")!;
    expect(matched.subjectValue).toBe("3");
    expect(matched.competitorValue).toBe("4");
    expect(matched.matchState).toBe("different");
  });

  it("renders a confirmed matching value as תואם", () => {
    const item = newDevelopmentItem({ project: "מגדלי הזית", project_level: {} }, { rooms: 3 });
    const rows = buildProductComparisonRows(subject, item);
    const matched = deriveMatchStateRows(rows).find((r) => r.label === "חדרים")!;
    expect(matched.matchState).toBe("match");
  });

  it("renders a known 20/80 payment term from the competitor side, with our own side explicitly לא הוזן (never a fabricated Gabay term)", () => {
    const item = newDevelopmentItem({ project: "רוטשילד 163-165", project_level: { payment_terms: "20/80" } });
    const rows = buildProductComparisonRows(subject, item);
    const paymentRow = rows.find((r) => r.label === "תנאי תשלום")!;
    expect(paymentRow).toBeDefined();
    expect(paymentRow.subjectValue).toBe("לא הוזן");
    expect(paymentRow.competitorValue).toBe("מסלול תשלום 20/80");

    // Our side being explicitly "not entered" must never be scored
    // "different" against the competitor's real term.
    const matched = deriveMatchStateRows(rows).find((r) => r.label === "תנאי תשלום")!;
    expect(matched.matchState).toBe("unknown");
  });

  it("never claims a monetary field is different merely from placeholder text (price/status stay unbadged)", () => {
    const item = newDevelopmentItem({ project: "מגדלי הזית", project_level: { status: "presale" } });
    const rows = buildProductComparisonRows(subject, item);
    const statusRow = rows.find((r) => r.label === "סטטוס הפרויקט")!;
    const matched = deriveMatchStateRows([statusRow])[0];
    expect(matched.matchState).toBeNull(); // status is not an attribute-match row at all
  });
});

describe("findComparableForCompetitorName -- pinning a specific map-selected competitor", () => {
  function family(comparables: JsonRecord[]): StandardAttributeEnrichmentFamily {
    return {
      subject_reference: {},
      current_asking_comparables: [],
      new_development_comparables: comparables,
      matched_observations: {},
      floor_observations: [],
      research_gaps: [],
    };
  }

  it("finds the exact competitor by project name and builds its closest variant", () => {
    const fam = family([
      { project: "THE SPOT", unit_variants: [{ rooms: 3, internal_area: 68, price: 1_900_000 }] },
      { project: "רוטשילד 163-165", unit_variants: [{ rooms: 3, internal_area: 70, price: 2_000_000 }] },
    ]);
    const found = findComparableForCompetitorName(fam, 3, 69, "THE SPOT");
    expect(found).not.toBeNull();
    expect(found!.kind).toBe("new_development");
    if (found!.kind === "new_development") {
      expect(found!.competitor.project).toBe("THE SPOT");
      expect(found!.variant?.internal_area).toBe(68);
    }
  });

  it("returns null (never a fabricated match) when this family has no comparable entry for that competitor name", () => {
    const fam = family([{ project: "THE SPOT", unit_variants: [] }]);
    expect(findComparableForCompetitorName(fam, 3, 69, "פרויקט שלא קיים")).toBeNull();
  });

  it("matches a competitor even when the register and enrichment datasets disagree on dash character (real data quirk: en dash vs hyphen)", () => {
    // Real, observed case: the register's own project_name is "רוטשילד
    // 163–165" (en dash, U+2013); this exact same competitor's entry in
    // standard_attribute_enrichment's new_development_comparables is
    // "רוטשילד 163-165" (plain hyphen, U+2D). The map's "פתח השוואה מלאה"
    // is always clicked with the REGISTER's own name -- this must still
    // find the enrichment entry, not silently return null.
    const fam = family([{ project: "רוטשילד 163-165", unit_variants: [{ rooms: 5, internal_area: 112, balcony_area: 12 }] }]);
    const found = findComparableForCompetitorName(fam, 5, 110, "רוטשילד 163–165");
    expect(found).not.toBeNull();
    expect(found!.kind === "new_development" && found!.competitor.project).toBe("רוטשילד 163-165");
  });

  it("keeps two different competitor names fully independent -- no stale identity bleed", () => {
    const fam = family([
      { project: "THE SPOT", unit_variants: [{ rooms: 3, internal_area: 68 }] },
      { project: "זאב ברנדה 22", unit_variants: [{ rooms: 3, internal_area: 75 }] },
    ]);
    const spot = findComparableForCompetitorName(fam, 3, 69, "THE SPOT");
    const zeev = findComparableForCompetitorName(fam, 3, 69, "זאב ברנדה 22");
    expect(spot!.kind === "new_development" && spot!.competitor.project).toBe("THE SPOT");
    expect(zeev!.kind === "new_development" && zeev!.competitor.project).toBe("זאב ברנדה 22");
    expect(spot).not.toBe(zeev);
  });
});
