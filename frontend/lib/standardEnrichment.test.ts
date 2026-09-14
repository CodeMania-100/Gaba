// Regression test for "Final P0 data-visibility audit": buildProductComparisonRows'
// storage row previously read only a plain boolean (=== true/=== false),
// which correctly distinguished "known false" from "unknown" -- but silently
// dropped the row entirely when storage arrived as the richer
// {present, area} object shape several real Petah Tikva 5R comparables use
// (e.g. "השופט ברנדייס 47": {present: true, area: 5.5}), reading as though
// storage had never been researched at all.

import { describe, expect, it } from "vitest";
import { buildProductComparisonRows, ComparableItem } from "./standardEnrichment";

const SUBJECT = { price: null, rooms: 3, internalArea: null, balconyArea: null, floor: null, orientation: null };

function ndItem(variant: Record<string, unknown> | null): ComparableItem {
  return {
    kind: "new_development",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    competitor: { project: "פרויקט", project_level: {}, starting_price_context: null } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variant: variant as any,
  };
}

describe("buildProductComparisonRows storage field (P0 fix)", () => {
  it("shows a storage row (with its own area) for the {present, area} object shape", () => {
    const rows = buildProductComparisonRows(SUBJECT, ndItem({ storage: { present: true, area: 5.5 } }));
    const row = rows.find((r) => r.label === "מחסן");
    expect(row).toBeDefined();
    expect(row!.competitorValue).toBe("יש (5.5 מ״ר)");
  });

  it("shows a plain 'יש' when the object shape has no area figure", () => {
    const rows = buildProductComparisonRows(SUBJECT, ndItem({ storage: { present: true, area: null } }));
    expect(rows.find((r) => r.label === "מחסן")!.competitorValue).toBe("יש");
  });

  it("shows 'אין' for an explicit {present: false}, never confusing it with unknown", () => {
    const rows = buildProductComparisonRows(SUBJECT, ndItem({ storage: { present: false } }));
    expect(rows.find((r) => r.label === "מחסן")!.competitorValue).toBe("אין");
  });

  it("still handles the plain-boolean shape exactly as before", () => {
    const rowsTrue = buildProductComparisonRows(SUBJECT, ndItem({ storage: true }));
    expect(rowsTrue.find((r) => r.label === "מחסן")!.competitorValue).toBe("יש");
    const rowsFalse = buildProductComparisonRows(SUBJECT, ndItem({ storage: false }));
    expect(rowsFalse.find((r) => r.label === "מחסן")!.competitorValue).toBe("אין");
  });

  it("omits the row entirely when storage is genuinely unresearched (null/undefined), never showing 'אין'", () => {
    const rows = buildProductComparisonRows(SUBJECT, ndItem({ storage: null }));
    expect(rows.find((r) => r.label === "מחסן")).toBeUndefined();
  });
});
