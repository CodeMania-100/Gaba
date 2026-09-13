import { describe, expect, it } from "vitest";
import { deriveCompetitorMatrix, deriveCompletedSalesOverview, deriveDefaultMatrixCompetitors } from "./executiveVisuals";
import { PetahTikvaWorkspace } from "./api";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

/** Minimal workspace stand-in -- deriveCompletedSalesOverview only ever
 * reads workspace.evidence_provenance.sold.{3R,5R}.records, so nothing else
 * needs to be populated. Cast rather than fully typed, matching how
 * JsonRecord-shaped evidence is already consumed throughout this module. */
function workspaceWithSold(records3R: Rec[], records5R: Rec[]): PetahTikvaWorkspace {
  return {
    evidence_provenance: {
      sold: {
        "3R": { family: "3R", records: records3R },
        "5R": { family: "5R", records: records5R },
      },
      current_asking: { "3R": { records: [] }, "5R": { records: [] } },
      new_development: { "3R": { records: [] }, "5R": { records: [] } },
      funnel_stages: [],
      source_registry: {},
    },
  } as unknown as PetahTikvaWorkspace;
}

function usableSale(overrides: Rec): Rec {
  return {
    quality_status: "usable",
    address: "כתובת לדוגמה",
    price: 2000000,
    area: 60,
    price_per_sqm: null,
    event_date: "2026-01-15",
    ...overrides,
  };
}

describe("deriveCompletedSalesOverview", () => {
  it("Netanya-shaped evidence (real quarter distribution) must not render the no-data/empty state", () => {
    // Mirrors the actual frozen netanya completed_sales_3r/5r.csv accepted
    // rows: 3R across {2025-Q2 x2, 2026-Q1 x1, 2026-Q2 x1}, 5R across
    // {2025-Q1 x2, 2025-Q2 x1, 2025-Q3 x1, 2026-Q1 x1, 2026-Q2 x2}. Under
    // the old per-family/per-quarter >=3 filter every one of these quarters
    // was dropped (max count per family-quarter is 2), so the whole card
    // went blank even though 11 real completed sales exist.
    const records3R = [
      usableSale({ event_date: "2025-04-10" }),
      usableSale({ event_date: "2025-05-02" }),
      usableSale({ event_date: "2026-01-20" }),
      usableSale({ event_date: "2026-05-11" }),
    ];
    const records5R = [
      usableSale({ event_date: "2025-01-05" }),
      usableSale({ event_date: "2025-02-14" }),
      usableSale({ event_date: "2025-05-20" }),
      usableSale({ event_date: "2025-08-01" }),
      usableSale({ event_date: "2026-02-02" }),
      usableSale({ event_date: "2026-05-05" }),
      usableSale({ event_date: "2026-06-01" }),
    ];
    const overview = deriveCompletedSalesOverview(workspaceWithSold(records3R, records5R));

    expect(overview.mode).not.toBe("empty");
    expect(overview.transactionCount).toBe(11);
    expect(overview.mode).toBe("quarterly_trend");
    // The combined distinct-quarter count is what matters -- never per-family alone.
    const allQuarters = new Set(overview.observations.map((o) => o.quarterKey));
    expect(allQuarters.size).toBeGreaterThanOrEqual(2);
  });

  it("Ashkelon-shaped evidence (real quarter distribution) must not render the no-data/empty state", () => {
    // Mirrors the actual frozen ashkelon completed_sales_3r/5r.csv accepted
    // rows: 3R across {2025-Q4 x2, 2026-Q2 x2, 2026-Q3 x1}, 5R across
    // {2026-Q1 x2, 2026-Q2 x3, 2026-Q3 x2}.
    const records3R = [
      usableSale({ event_date: "2025-10-10" }),
      usableSale({ event_date: "2025-11-05" }),
      usableSale({ event_date: "2026-05-01" }),
      usableSale({ event_date: "2026-05-20" }),
      usableSale({ event_date: "2026-08-01" }),
    ];
    const records5R = [
      usableSale({ event_date: "2026-01-10" }),
      usableSale({ event_date: "2026-02-15" }),
      usableSale({ event_date: "2026-04-01" }),
      usableSale({ event_date: "2026-05-15" }),
      usableSale({ event_date: "2026-06-01" }),
      usableSale({ event_date: "2026-07-10" }),
      usableSale({ event_date: "2026-08-20" }),
    ];
    const overview = deriveCompletedSalesOverview(workspaceWithSold(records3R, records5R));

    expect(overview.mode).not.toBe("empty");
    expect(overview.transactionCount).toBe(12);
    expect(overview.mode).toBe("quarterly_trend");
  });

  it("exactly one distinct quarter renders observations + median, never a fake trend", () => {
    const records3R = [
      usableSale({ event_date: "2026-02-01", price: 1900000, area: 60 }),
      usableSale({ event_date: "2026-02-15", price: 2100000, area: 60 }),
    ];
    const records5R = [usableSale({ event_date: "2026-03-10", price: 3200000, area: 100 })];
    const overview = deriveCompletedSalesOverview(workspaceWithSold(records3R, records5R));

    expect(overview.mode).toBe("single_quarter");
    expect(overview.quarterlySeries).toEqual([]);
    expect(overview.transactionCount).toBe(3);
    expect(overview.quarterLabel).toBe("Q1 2026");
    expect(overview.observations).toHaveLength(3);
    // median of [1900000/60, 2100000/60, 3200000/100] = [31666.67, 35000, 32000] -> sorted: 31666.67, 32000, 35000 -> median 32000
    expect(overview.medianPricePerSqm).toBeCloseTo(32000, 0);
  });

  it("zero valid sold records is the only condition that renders the true empty state", () => {
    const empty = deriveCompletedSalesOverview(workspaceWithSold([], []));
    expect(empty.mode).toBe("empty");
    expect(empty.transactionCount).toBe(0);
    expect(empty.observations).toEqual([]);
  });

  it("non-usable quality_status records are excluded and can also produce the empty state", () => {
    const records3R = [
      usableSale({ quality_status: "rejected", event_date: "2026-01-01" }),
      usableSale({ quality_status: "ambiguous", event_date: "2026-02-01" }),
      usableSale({ quality_status: "low_confidence", event_date: "2026-03-01" }),
    ];
    const overview = deriveCompletedSalesOverview(workspaceWithSold(records3R, []));
    expect(overview.mode).toBe("empty");
    expect(overview.transactionCount).toBe(0);
  });

  it("sparse evidence (undateable records) renders a scatter and never fabricates a quarter", () => {
    const records3R = [
      usableSale({ event_date: undefined, price: 2000000, area: 65 }),
      usableSale({ event_date: null, price: 2100000, area: 65 }),
    ];
    const overview = deriveCompletedSalesOverview(workspaceWithSold(records3R, []));

    expect(overview.mode).toBe("scatter");
    expect(overview.transactionCount).toBe(2);
    // No observation may be assigned a quarter that wasn't derivable from a real date.
    expect(overview.observations.every((o) => o.quarterKey === null)).toBe(true);
    expect(overview.quarterlySeries).toEqual([]);
  });

  it("never fabricates an additional quarter beyond what the raw dates actually support", () => {
    // Two transactions, same real quarter, one with a slightly different day --
    // must still collapse to exactly one quarterKey, never split or invented.
    const records3R = [usableSale({ event_date: "2026-04-01" }), usableSale({ event_date: "2026-06-20" })];
    const overview = deriveCompletedSalesOverview(workspaceWithSold(records3R, []));
    const quarterKeys = new Set(overview.observations.map((o) => o.quarterKey));
    expect(quarterKeys.size).toBe(1);
    expect(overview.mode).toBe("single_quarter");
  });

  it("ignores unrelated evidence types (current_asking) even if present on the workspace", () => {
    const workspace = workspaceWithSold(
      [usableSale({ event_date: "2026-01-10" }), usableSale({ event_date: "2026-04-10" })],
      []
    );
    // Pollute current_asking with data that must never be counted here.
    (workspace as unknown as { evidence_provenance: { current_asking: Rec } }).evidence_provenance.current_asking = {
      "3R": { records: [{ asking_price: 9999999, listing_id: "should-never-be-read" }] },
      "5R": { records: [] },
    };
    const overview = deriveCompletedSalesOverview(workspace);
    expect(overview.transactionCount).toBe(2); // only the two sold records, never the asking record
  });
});

// ---------------------------------------------------------------------------
// P0 — "Fix competitor/product matching globally". Petah Tikva used to fall
// back to a hardcoded 3-name list (MATRIX_COMPETITORS, now removed) for the
// price-positioning/product-attribute matrix regardless of which family
// (3R/5R) was selected, while the three multi-city contexts already
// filtered by real family relevance. That inconsistency is exactly what let
// a special-unit-only project with no standard-family register entry at all
// (the task's own example, "NAVE PARK") occupy a 3R/5R matrix column. Every
// market context must now go through the identical selection+matching rule.
// ---------------------------------------------------------------------------

function petahTikvaShapedWorkspace(projects: Rec[]): PetahTikvaWorkspace {
  return {
    competitor_landscape: { projects },
    families: [
      { family: "3R", target: { internal_area: 69 }, market: { supported_lower: 1_800_000, supported_upper: 2_000_000 } },
      { family: "5R", target: { internal_area: 110 }, market: { supported_lower: 3_000_000, supported_upper: 3_400_000 } },
    ],
    price_list: [],
    standard_attribute_enrichment: {
      families: { standard_3r: { new_development_comparables: [] }, standard_5r: { new_development_comparables: [] } },
    },
    special_unit_market_context: { units: {} },
    // No market_context key at all -- exactly how the real Petah Tikva
    // payload arrives (see market_context_workspace.build_market_context_
    // workspace_payload's is_petah_tikva branch) -- the fix must not special-
    // case on this field's absence/presence anymore.
  } as unknown as PetahTikvaWorkspace;
}

describe("deriveDefaultMatrixCompetitors / deriveCompetitorMatrix (P0 fix)", () => {
  it("acceptance test: 3 חדרים — סטנדרט must not show a NAVE-PARK-style 6R-only project's price", () => {
    const workspace = petahTikvaShapedWorkspace([
      {
        project_name: "NAVE PARK",
        display_classification: "relevant",
        relevance: ["standard_5r"], // not standard_3r at all -- never selected for a 3R matrix
        known_unit_variants: [{ rooms: "6", price_ils: "3850000", price_basis: null }],
      },
      {
        project_name: "THE SPOT",
        display_classification: "direct",
        relevance: ["standard_3r"],
        known_unit_variants: [{ rooms: "3", price_ils: "2050000", price_basis: null, internal_area_sqm: "70" }],
      },
    ]);

    const matrix3R = deriveCompetitorMatrix(workspace, "3R", "שיווק פעיל");
    expect(matrix3R.columns).not.toContain("NAVE PARK"); // never selected -- not standard_3r-relevant
    expect(matrix3R.columns).toContain("THE SPOT");
    const priceRow = matrix3R.rows.find((r) => r.key === "price")!;
    expect(priceRow.values.join(" ")).not.toContain("3,850,000"); // the 6R price never leaks in anywhere
    expect(priceRow.values.join(" ")).toContain("2,050,000"); // THE SPOT's real 3R variant price is shown
  });

  it("Petah Tikva is no longer special-cased: a project relevant to standard_3r is selected for the 3R matrix exactly like a multi-city project would be", () => {
    const workspace = petahTikvaShapedWorkspace([
      { project_name: "פרויקט א", display_classification: "direct", relevance: ["standard_3r"], known_unit_variants: [{ rooms: "3", price_ils: "1900000", price_basis: null }] },
      { project_name: "פרויקט ב", display_classification: "relevant", relevance: ["standard_5r"], known_unit_variants: [{ rooms: "5", price_ils: "3200000", price_basis: null }] },
    ]);
    const selected = deriveDefaultMatrixCompetitors(workspace, "3R");
    expect(selected.map((c) => c.displayName)).toEqual(["פרויקט א"]);
  });

  it("when two relevant projects share the same classification, the one with a real room-matching priced variant is preferred over one without", () => {
    const workspace = petahTikvaShapedWorkspace([
      {
        project_name: "בלי דגם תואם",
        display_classification: "relevant",
        relevance: ["standard_3r"],
        known_unit_variants: [{ rooms: "5", price_ils: "3000000", price_basis: null }], // relevant, but no 3R variant
      },
      {
        project_name: "עם דגם תואם",
        display_classification: "relevant",
        relevance: ["standard_3r"],
        known_unit_variants: [{ rooms: "3", price_ils: "2000000", price_basis: null }],
      },
    ]);
    const selected = deriveDefaultMatrixCompetitors(workspace, "3R");
    expect(selected[0].displayName).toBe("עם דגם תואם");
  });

  it("a selected project with no matching variant shows לא פורסם for price, never a different room count's price", () => {
    const workspace = petahTikvaShapedWorkspace([
      {
        project_name: "רק חמישה חדרים",
        display_classification: "direct",
        relevance: ["standard_3r"], // relevant per geography/classification, but its only priced data is 5R
        known_unit_variants: [{ rooms: "5", price_ils: "3300000", price_basis: null }],
      },
    ]);
    const matrix = deriveCompetitorMatrix(workspace, "3R", "שיווק פעיל");
    const priceRow = matrix.rows.find((r) => r.key === "price")!;
    expect(priceRow.values).toContain("לא פורסם");
    expect(priceRow.values.join(" ")).not.toContain("3,300,000");
  });
});
