import { describe, expect, it } from "vitest";
import { deriveCompletedSalesOverview } from "./executiveVisuals";
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
