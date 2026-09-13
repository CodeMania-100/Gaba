// Regression tests for "sales performance by apartment type" (Tab 3,
// company-internal input layer). Covers the six required cases: no data
// stays unknown (never a fake 0%), differing statuses derive correctly with
// no automatic price adjustment, an explicit group adjustment affects only
// its own group while market indication/range/confidence stay bit-for-bit
// unchanged, special groups stay distinct with no multi-floor inventory
// inflation, clearing a group returns it to unknown, and company sales data
// survives a market-context switch (a different row set with the same
// product-group structure).

import { describe, expect, it } from "vitest";
import { PtkPriceListRow } from "./api";
import { productGroupKeyOf, deriveComparisonSelectorOptions } from "./comparisonSubject";
import {
  computePriceBreakdown,
  defaultMarketingStrategyState,
  deriveMarketingDecisionSignal,
  deriveProductGroupSales,
  deriveProductGroupSalesSummary,
  deriveProductGroupStrategyImpact,
  EMPTY_ADJUSTMENT,
  MarketingStrategyState,
  salesPerformancePct,
} from "./marketingStrategy";

// A real-shaped 39-unit inventory matching the product groups named in the
// task spec: 24 standard 3R, 8 standard 5R, 2 garden-3R, 1 garden-2R,
// 2 triplex-6R (units 36/37 -- one row each, never split across floors),
// 1 duplex-7R, 1 duplex-5R (unit 38/39) = 39 rows total.
function baseRow(overrides: Partial<PtkPriceListRow>): PtkPriceListRow {
  return {
    unit_number: "1",
    family: "3R",
    family_key: "3R",
    floor: 3,
    internal_area_sqm: 69,
    balcony_area_sqm: 12,
    orientation: "מזרח",
    market_range: { lower: 1_800_000, upper: 1_900_000, confidence: "high" },
    strategy_basis: null,
    commercial_base_price_ils: null,
    adjustments: [],
    proposed_list_price_ils: 1_850_000,
    status: "priced",
    requires_review: false,
    warnings: [],
    explanation: [],
    override: null,
    locked: false,
    ...overrides,
  } as PtkPriceListRow;
}

function buildInventory(priceMultiplier = 1): PtkPriceListRow[] {
  const rows: PtkPriceListRow[] = [];
  let unit = 1;
  for (let i = 0; i < 24; i++) {
    rows.push(baseRow({ unit_number: String(unit++), family: "3R", family_key: "3R", proposed_list_price_ils: 1_850_000 * priceMultiplier }));
  }
  for (let i = 0; i < 8; i++) {
    rows.push(
      baseRow({
        unit_number: String(unit++),
        family: "5R",
        family_key: "5R",
        internal_area_sqm: 111.1,
        proposed_list_price_ils: 2_600_000 * priceMultiplier,
      })
    );
  }
  for (let i = 0; i < 2; i++) {
    rows.push(
      baseRow({
        unit_number: String(unit++),
        family: "garden_apartment",
        family_key: null,
        rooms: 3,
        proposed_list_price_ils: 2_100_000 * priceMultiplier,
      } as Partial<PtkPriceListRow>)
    );
  }
  rows.push(
    baseRow({
      unit_number: String(unit++),
      family: "garden_apartment",
      family_key: null,
      rooms: 2,
      proposed_list_price_ils: 1_700_000 * priceMultiplier,
    } as Partial<PtkPriceListRow>)
  );
  for (let i = 0; i < 2; i++) {
    rows.push(
      baseRow({
        unit_number: String(unit++),
        family: "triplex",
        family_key: null,
        rooms: 6,
        proposed_list_price_ils: 3_400_000 * priceMultiplier,
      } as Partial<PtkPriceListRow>)
    );
  }
  rows.push(
    baseRow({
      unit_number: String(unit++),
      family: "duplex",
      family_key: null,
      rooms: 7,
      proposed_list_price_ils: 3_900_000 * priceMultiplier,
    } as Partial<PtkPriceListRow>)
  );
  rows.push(
    baseRow({
      unit_number: String(unit++),
      family: "duplex",
      family_key: null,
      rooms: 5,
      proposed_list_price_ils: 2_950_000 * priceMultiplier,
    } as Partial<PtkPriceListRow>)
  );
  return rows;
}

function rowsByGroup(rows: PtkPriceListRow[], key: string): PtkPriceListRow[] {
  return rows.filter((r) => productGroupKeyOf(r) === key);
}

// Builds a row whose market_range is deliberately positioned relative to
// its own (unmodified) market indication -- lets a signal test control
// exactly one variable (price position) without touching sold/target/
// adjustment state at all.
function rowWithPosition(
  row: PtkPriceListRow,
  position: "above_range" | "within_range" | "below_range" | "no_range",
  confidence: string = "medium"
): PtkPriceListRow {
  if (position === "no_range") return { ...row, market_range: { lower: null, upper: null, confidence } };
  const price = row.proposed_list_price_ils!;
  if (position === "within_range") return { ...row, market_range: { lower: price - 50_000, upper: price + 50_000, confidence } };
  if (position === "above_range") return { ...row, market_range: { lower: price - 200_000, upper: price - 50_000, confidence } };
  return { ...row, market_range: { lower: price + 50_000, upper: price + 200_000, confidence } };
}

describe("sales performance by product group", () => {
  it("A. no internal sales data: everything stays unknown, no fake 0%, no price effect", () => {
    const rows = buildInventory();
    const state = defaultMarketingStrategyState();

    const groups = deriveProductGroupSales(rows, state);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.soldUnits).toBeNull();
      expect(g.sellThroughPct).toBeNull();
      expect(g.status).toBe("unknown");
      expect(g.adjustment.adjustment_pct).toBe(0);
      expect(g.effectIls).toBe(0);
    }

    for (const row of rows) {
      expect(salesPerformancePct(state, row)).toBe(0);
      const breakdown = computePriceBreakdown(state, row);
      expect(breakdown.salesPerformancePct).toBe(0);
      expect(breakdown.totalPct).toBe(0);
      expect(breakdown.proposedIls).toBe(row.proposed_list_price_ils);
    }
  });

  it("B. 3R stronger than 5R: sell-through and status differ, but no adjustment is auto-generated", () => {
    const rows = buildInventory();
    let state = defaultMarketingStrategyState();
    state = {
      ...state,
      productGroupSales: {
        "3R": { soldUnits: 15, targetSellThroughPct: 50, adjustment: { ...EMPTY_ADJUSTMENT } },
        "5R": { soldUnits: 2, targetSellThroughPct: 50, adjustment: { ...EMPTY_ADJUSTMENT } },
      },
    };

    const groups = deriveProductGroupSales(rows, state);
    const g3 = groups.find((g) => g.key === "3R")!;
    const g5 = groups.find((g) => g.key === "5R")!;

    expect(g3.inventoryCount).toBe(24);
    expect(g3.sellThroughPct).toBeCloseTo(62.5, 5);
    expect(g3.status).toBe("above_target");

    expect(g5.inventoryCount).toBe(8);
    expect(g5.sellThroughPct).toBeCloseTo(25, 5);
    expect(g5.status).toBe("below_target");

    // Explicit CRITICAL requirement: strong sell-through never auto-creates
    // a price adjustment.
    expect(g3.adjustment.adjustment_pct).toBe(0);
    expect(g5.adjustment.adjustment_pct).toBe(0);
    for (const row of rows) {
      expect(salesPerformancePct(state, row)).toBe(0);
      expect(computePriceBreakdown(state, row).totalPct).toBe(0);
    }
  });

  it("C. explicit Marketing decision affects only its own group; market indication/range/confidence stay bit-for-bit unchanged", () => {
    const rows = buildInventory();
    let state = defaultMarketingStrategyState();
    state = {
      ...state,
      productGroupSales: {
        "3R": { soldUnits: 15, targetSellThroughPct: 50, adjustment: { adjustment_pct: 2, rationale: "קצב מכירה גבוה מהיעד" } },
        "5R": { soldUnits: 2, targetSellThroughPct: 50, adjustment: { ...EMPTY_ADJUSTMENT } },
      },
    };

    const standard3R = rowsByGroup(rows, "3R");
    const standard5R = rowsByGroup(rows, "5R");
    const garden3R = rowsByGroup(rows, "garden_apartment:3");

    expect(standard3R).toHaveLength(24);
    expect(standard5R).toHaveLength(8);
    expect(garden3R).toHaveLength(2);

    for (const row of standard3R) {
      const before = row.proposed_list_price_ils!;
      const breakdown = computePriceBreakdown(state, row);
      expect(breakdown.salesPerformancePct).toBe(2);
      expect(breakdown.proposedIls).toBeCloseTo(before * 1.02, 5);
      // Market indication itself, the row's own range and confidence: untouched.
      expect(row.proposed_list_price_ils).toBe(before);
      expect(row.market_range).toEqual({ lower: 1_800_000, upper: 1_900_000, confidence: "high" });
    }

    for (const row of [...standard5R, ...garden3R]) {
      const breakdown = computePriceBreakdown(state, row);
      expect(breakdown.salesPerformancePct).toBe(0);
      expect(breakdown.proposedIls).toBe(row.proposed_list_price_ils);
    }
  });

  it("D. special groups stay distinct and multi-floor units never inflate inventory counts", () => {
    const rows = buildInventory();
    expect(rows).toHaveLength(39);

    const segments = deriveComparisonSelectorOptions(rows);
    const segmentKeys = segments.map((s) => s.key);
    expect(segmentKeys).toEqual(
      expect.arrayContaining(["3R", "5R", "garden_apartment:3", "garden_apartment:2", "triplex:6", "duplex:7", "duplex:5"])
    );

    const state = defaultMarketingStrategyState();
    const groups = deriveProductGroupSales(rows, state);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));

    expect(byKey["garden_apartment:3"].inventoryCount).toBe(2);
    expect(byKey["garden_apartment:2"].inventoryCount).toBe(1);
    expect(byKey["triplex:6"].inventoryCount).toBe(2); // units 36 & 37 -- one row each
    expect(byKey["duplex:7"].inventoryCount).toBe(1);
    expect(byKey["duplex:5"].inventoryCount).toBe(1);

    const totalAcrossGroups = groups.reduce((sum, g) => sum + g.inventoryCount, 0);
    expect(totalAcrossGroups).toBe(39);
  });

  it("E. reset: clearing a group's entered data returns it to unknown and restores the prior proposed price", () => {
    const rows = buildInventory();
    let state = defaultMarketingStrategyState();
    const priorPrices = rows.map((r) => computePriceBreakdown(state, r).proposedIls);

    state = {
      ...state,
      productGroupSales: {
        "3R": { soldUnits: 15, targetSellThroughPct: 50, adjustment: { adjustment_pct: 2, rationale: "test" } },
      },
    };
    const threeRRow = rowsByGroup(rows, "3R")[0];
    expect(computePriceBreakdown(state, threeRRow).proposedIls).not.toBe(priorPrices[0]);

    // Clear (the panel's "נקה" action removes the group's entry entirely).
    const cleared: MarketingStrategyState = { ...state, productGroupSales: {} };
    const clearedGroups = deriveProductGroupSales(rows, cleared);
    for (const g of clearedGroups) {
      expect(g.status).toBe("unknown");
      expect(g.soldUnits).toBeNull();
    }
    rows.forEach((row, i) => {
      expect(computePriceBreakdown(cleared, row).proposedIls).toBe(priorPrices[i]);
    });
  });

  it("G. project-wide sales-progress and group-level sales-performance adjustments compose additively, with no double-counting", () => {
    // Two independent, explicitly-entered Marketing decisions: the
    // pre-existing project-wide salesProgressAdjustment (tied to overall
    // sell-through pace) and the new per-product-group salesPerformance
    // adjustment. Neither is derived from the other or from entered
    // sell-through figures -- both must show up as separate, additive terms.
    const rows = buildInventory();
    let state = defaultMarketingStrategyState();
    state = {
      ...state,
      salesProgressAdjustment: { adjustment_pct: -0.5, rationale: "project-wide pace" },
      productGroupSales: {
        "3R": { soldUnits: 15, targetSellThroughPct: 50, adjustment: { adjustment_pct: 2, rationale: "3R group decision" } },
      },
    };

    const threeRRow = rowsByGroup(rows, "3R")[0];
    const breakdown = computePriceBreakdown(state, threeRRow);
    expect(breakdown.salesProgressPct).toBe(-0.5);
    expect(breakdown.salesPerformancePct).toBe(2);
    // Additive, not compounded: -0.5 + 2 = 1.5, applied once to market
    // indication -- never (1 - 0.005) * (1 + 0.02).
    expect(breakdown.totalPct).toBe(1.5);
    expect(breakdown.proposedIls).toBeCloseTo(threeRRow.proposed_list_price_ils! * 1.015, 5);
    // Each term's own ₪ effect is independently computed from the market
    // indication (never from each other), and the two effects sum exactly
    // to the total ₪ effect -- proof there is no double-counting between
    // the two levers.
    const totalEffectIls = breakdown.proposedIls! - breakdown.marketIndicationIls!;
    expect(breakdown.salesProgressEffectIls! + breakdown.salesPerformanceEffectIls!).toBeCloseTo(totalEffectIls, 5);

    // A group with no group-level adjustment still gets the project-wide
    // term, and only the project-wide term.
    const fiveRRow = rowsByGroup(rows, "5R")[0];
    const breakdown5R = computePriceBreakdown(state, fiveRRow);
    expect(breakdown5R.salesProgressPct).toBe(-0.5);
    expect(breakdown5R.salesPerformancePct).toBe(0);
    expect(breakdown5R.totalPct).toBe(-0.5);
  });

  it("H. project-stage adjustment is tied to its own stage and never carries across a stage switch", () => {
    const rows = buildInventory();
    let state = defaultMarketingStrategyState();
    state = {
      ...state,
      projectPhase: "presale",
      phaseAdjustments: { ...state.phaseAdjustments, presale: { adjustment_pct: 1, rationale: "presale test" } },
      productGroupSales: {
        "5R": { soldUnits: null, targetSellThroughPct: null, adjustment: { adjustment_pct: 2, rationale: "5R group test" } },
      },
    };

    const fiveRRow = rowsByGroup(rows, "5R")[0];
    const beforeSwitch = computePriceBreakdown(state, fiveRRow);
    expect(beforeSwitch.phasePct).toBe(1);
    expect(beforeSwitch.salesPerformancePct).toBe(2);
    expect(beforeSwitch.totalPct).toBe(3);

    // Switching the project phase (exactly what the phase selector's onClick
    // does -- it only ever sets projectPhase, never touches
    // phaseAdjustments/productGroupSales/unitAdjustments/etc.).
    const afterSwitch: MarketingStrategyState = { ...state, projectPhase: "launch" };
    const afterBreakdown = computePriceBreakdown(afterSwitch, fiveRRow);

    // Launch has no entry of its own yet -- reads as 0%, never inherits
    // presale's +1%. No percentage is invented from the phase name either.
    expect(afterBreakdown.phasePct).toBe(0);
    // The 5R group adjustment is a fully independent input and must be
    // completely unaffected by a phase switch.
    expect(afterBreakdown.salesPerformancePct).toBe(2);
    expect(afterBreakdown.totalPct).toBe(2);
    // Market indication itself never moves because of a strategy input.
    expect(afterBreakdown.marketIndicationIls).toBe(beforeSwitch.marketIndicationIls);
    expect(afterBreakdown.marketIndicationIls).toBe(fiveRRow.proposed_list_price_ils);

    // Switching back to presale restores the value previously entered for
    // it (the preferred, per-stage-keyed implementation) rather than
    // leaving it at whatever launch last had.
    const backToPresale: MarketingStrategyState = { ...afterSwitch, projectPhase: "presale" };
    expect(computePriceBreakdown(backToPresale, fiveRRow).phasePct).toBe(1);

    // Now explicitly set launch's own adjustment -- it must not retroactively
    // change presale's stored value.
    const withLaunchSet: MarketingStrategyState = {
      ...afterSwitch,
      phaseAdjustments: { ...afterSwitch.phaseAdjustments, launch: { adjustment_pct: -1.5, rationale: "launch test" } },
    };
    expect(computePriceBreakdown(withLaunchSet, fiveRRow).phasePct).toBe(-1.5);
    expect(computePriceBreakdown({ ...withLaunchSet, projectPhase: "presale" }, fiveRRow).phasePct).toBe(1);
  });

  it("F. market-context switching: company sales inputs persist across a different external market baseline", () => {
    const cityARows = buildInventory(1);
    const cityBRows = buildInventory(1.15); // a different market context -> different market indication only

    let state = defaultMarketingStrategyState();
    state = {
      ...state,
      productGroupSales: {
        "3R": { soldUnits: 15, targetSellThroughPct: 50, adjustment: { adjustment_pct: 2, rationale: "test" } },
      },
    };

    // Same company adjustment percentage applies regardless of which
    // market-context row set is evaluated -- switching context never
    // erases or mutates productGroupSales itself.
    const rowA = rowsByGroup(cityARows, "3R")[0];
    const rowB = rowsByGroup(cityBRows, "3R")[0];
    expect(salesPerformancePct(state, rowA)).toBe(2);
    expect(salesPerformancePct(state, rowB)).toBe(2);

    // External market indication legitimately differs between contexts...
    expect(rowA.proposed_list_price_ils).not.toBe(rowB.proposed_list_price_ils);
    // ...while the resulting proposed price for each still reflects that
    // context's own baseline plus the same 2% company decision (no
    // cross-city contamination of the market figure itself).
    expect(computePriceBreakdown(state, rowA).proposedIls).toBeCloseTo(rowA.proposed_list_price_ils! * 1.02, 5);
    expect(computePriceBreakdown(state, rowB).proposedIls).toBeCloseTo(rowB.proposed_list_price_ils! * 1.02, 5);
  });
});

describe("marketing decision signals (Tab 3 decision-support redesign)", () => {
  it("Test H. below target + price above supported range -> review_price, adjustment stays 0%", () => {
    const rows = buildInventory().map((r) => (productGroupKeyOf(r) === "3R" ? rowWithPosition(r, "above_range") : r));
    const state: MarketingStrategyState = {
      ...defaultMarketingStrategyState(),
      productGroupSales: { "3R": { soldUnits: 6, targetSellThroughPct: 50, adjustment: { ...EMPTY_ADJUSTMENT } } }, // 6/24 = 25%
    };

    const group = deriveProductGroupSalesSummary(rows, state).find((g) => g.key === "3R")!;
    expect(group.sellThroughPct).toBeCloseTo(25, 5);
    expect(group.status).toBe("below_target");
    expect(group.market.aggregatePosition).toBe("above_range");
    expect(group.signal.kind).toBe("review_price");
    expect(group.signal.label).toBe("דורש בדיקת מחיר");
    expect(group.adjustment.adjustment_pct).toBe(0);
  });

  it("Test I. below target + price inside supported range -> review, no automatic price change", () => {
    const rows = buildInventory().map((r) => (productGroupKeyOf(r) === "3R" ? rowWithPosition(r, "within_range") : r));
    const state: MarketingStrategyState = {
      ...defaultMarketingStrategyState(),
      productGroupSales: { "3R": { soldUnits: 6, targetSellThroughPct: 50, adjustment: { ...EMPTY_ADJUSTMENT } } },
    };

    const group = deriveProductGroupSalesSummary(rows, state).find((g) => g.key === "3R")!;
    expect(group.status).toBe("below_target");
    expect(group.market.aggregatePosition).toBe("within_range");
    expect(group.signal.kind).toBe("review");
    expect(group.signal.label).toBe("דורש בחינה");
    expect(group.adjustment.adjustment_pct).toBe(0);
    for (const row of rowsByGroup(rows, "3R")) {
      expect(computePriceBreakdown(state, row).totalPct).toBe(0);
    }
  });

  it("Test J. above target + price inside supported range -> opportunity, adjustment stays 0%", () => {
    const rows = buildInventory().map((r) => (productGroupKeyOf(r) === "3R" ? rowWithPosition(r, "within_range") : r));
    const state: MarketingStrategyState = {
      ...defaultMarketingStrategyState(),
      productGroupSales: { "3R": { soldUnits: 20, targetSellThroughPct: 50, adjustment: { ...EMPTY_ADJUSTMENT } } }, // 20/24 ~= 83%
    };

    const group = deriveProductGroupSalesSummary(rows, state).find((g) => g.key === "3R")!;
    expect(group.status).toBe("above_target");
    expect(group.market.aggregatePosition).toBe("within_range");
    expect(group.signal.kind).toBe("opportunity");
    expect(group.signal.label).toBe("אפשר לבחון העלאת מחיר");
    expect(group.adjustment.adjustment_pct).toBe(0);
  });

  it("Test K. above target + price above supported range -> strong-sales context, never a second automatic premium", () => {
    const rows = buildInventory().map((r) => (productGroupKeyOf(r) === "3R" ? rowWithPosition(r, "above_range") : r));
    const state: MarketingStrategyState = {
      ...defaultMarketingStrategyState(),
      productGroupSales: { "3R": { soldUnits: 20, targetSellThroughPct: 50, adjustment: { ...EMPTY_ADJUSTMENT } } },
    };

    const group = deriveProductGroupSalesSummary(rows, state).find((g) => g.key === "3R")!;
    expect(group.status).toBe("above_target");
    expect(group.market.aggregatePosition).toBe("above_range");
    expect(group.signal.kind).toBe("strong_sales");
    expect(group.signal.label).toBe("מכירות חזקות");
    // Strong sales + already above range must NOT auto-generate a further
    // adjustment -- the group's own adjustment is still exactly whatever
    // Marketing entered (0% here), never inferred from the signal.
    expect(group.adjustment.adjustment_pct).toBe(0);
    for (const row of rowsByGroup(rows, "3R")) {
      expect(computePriceBreakdown(state, row).salesPerformancePct).toBe(0);
    }
  });

  it("Test L. missing sales data -> insufficient_data, never a false below-target signal, no price change", () => {
    const rows = buildInventory();
    const state = defaultMarketingStrategyState(); // no productGroupSales entries at all

    const group = deriveProductGroupSalesSummary(rows, state).find((g) => g.key === "3R")!;
    expect(group.status).toBe("unknown");
    expect(group.signal.kind).toBe("insufficient_data");
    expect(group.signal.label).toBe("אין מספיק נתוני מכירות");
    expect(group.signal.kind).not.toBe("review");
    expect(group.signal.kind).not.toBe("review_price");
    for (const row of rowsByGroup(rows, "3R")) {
      expect(computePriceBreakdown(state, row).totalPct).toBe(0);
    }

    // Sold entered but no target -> still insufficient, same rule.
    const partial: MarketingStrategyState = {
      ...state,
      productGroupSales: { "3R": { soldUnits: 6, targetSellThroughPct: null, adjustment: { ...EMPTY_ADJUSTMENT } } },
    };
    const partialGroup = deriveProductGroupSalesSummary(rows, partial).find((g) => g.key === "3R")!;
    expect(partialGroup.signal.kind).toBe("insufficient_data");
  });

  it("Test M. low confidence appends a caveat but never changes the primary signal or the price", () => {
    const rows = buildInventory().map((r) => (productGroupKeyOf(r) === "3R" ? rowWithPosition(r, "within_range", "low") : r));
    const state: MarketingStrategyState = {
      ...defaultMarketingStrategyState(),
      productGroupSales: { "3R": { soldUnits: 20, targetSellThroughPct: 50, adjustment: { ...EMPTY_ADJUSTMENT } } },
    };

    const group = deriveProductGroupSalesSummary(rows, state).find((g) => g.key === "3R")!;
    expect(group.signal.kind).toBe("opportunity"); // unchanged by confidence
    expect(group.signal.reasons).toContain("ראיות השוק מוגבלות.");
    for (const row of rowsByGroup(rows, "3R")) {
      expect(computePriceBreakdown(state, row).totalPct).toBe(0);
    }

    // Directly confirm the pure signal function's confidence handling too.
    const highConfidenceSignal = deriveMarketingDecisionSignal({ salesStatus: "above_target", pricePosition: "within_range", confidence: "high" });
    expect(highConfidenceSignal.reasons).not.toContain("ראיות השוק מוגבלות.");
    const insufficientConfidenceSignal = deriveMarketingDecisionSignal({
      salesStatus: "above_target",
      pricePosition: "within_range",
      confidence: "insufficient",
    });
    expect(insufficientConfidenceSignal.reasons).toContain("ראיות השוק מוגבלות.");
  });

  it("Test N. group isolation: applying -1% to standard 5R affects only 5R, never 3R or 5R-duplex, market indications untouched", () => {
    const rows = buildInventory();
    const state: MarketingStrategyState = {
      ...defaultMarketingStrategyState(),
      productGroupSales: { "5R": { soldUnits: null, targetSellThroughPct: null, adjustment: { adjustment_pct: -1, rationale: "test" } } },
    };

    const standard5R = rowsByGroup(rows, "5R");
    const standard3R = rowsByGroup(rows, "3R");
    const duplex5R = rowsByGroup(rows, "duplex:5");
    expect(standard5R).toHaveLength(8);
    expect(duplex5R).toHaveLength(1);

    for (const row of standard5R) {
      const before = row.proposed_list_price_ils!;
      const breakdown = computePriceBreakdown(state, row);
      expect(breakdown.salesPerformancePct).toBe(-1);
      expect(breakdown.proposedIls).toBeCloseTo(before * 0.99, 5);
      expect(row.proposed_list_price_ils).toBe(before); // market indication itself untouched
    }
    for (const row of [...standard3R, ...duplex5R]) {
      const breakdown = computePriceBreakdown(state, row);
      expect(breakdown.salesPerformancePct).toBe(0);
      expect(breakdown.proposedIls).toBe(row.proposed_list_price_ils);
    }

    const impact = deriveProductGroupStrategyImpact(rows, state, "5R");
    expect(impact.affectedUnitsCount).toBe(8);
    expect(impact.isUniform).toBe(true);
    expect(impact.beforeIlsRange).not.toBeNull();
    expect(impact.afterIlsRange).not.toBeNull();
    expect(impact.afterIlsRange!.min).toBeLessThan(impact.beforeIlsRange!.min);
  });

  it("Test P. a special group with multiple, materially different units never gets a fabricated shared range", () => {
    const rows = buildInventory();
    // Give the two garden-3R units genuinely different prices/ranges (real
    // special-unit heterogeneity) instead of buildInventory's default
    // shared range -- one ends up above its own range, the other within.
    const gardenRows = rowsByGroup(rows, "garden_apartment:3");
    expect(gardenRows).toHaveLength(2);
    const adjustedRows = rows.map((r) => {
      if (r === gardenRows[0]) return { ...r, proposed_list_price_ils: 2_100_000, market_range: { lower: 1_900_000, upper: 2_000_000, confidence: "medium" } }; // above its own range
      if (r === gardenRows[1]) return { ...r, proposed_list_price_ils: 1_700_000, market_range: { lower: 1_650_000, upper: 1_800_000, confidence: "high" } }; // within its own range
      return r;
    });

    const state = defaultMarketingStrategyState();
    const group = deriveProductGroupSalesSummary(adjustedRows, state).find((g) => g.key === "garden_apartment:3")!;

    // Never a single fabricated representative figure for a non-uniform group.
    expect(group.market.isUniform).toBe(false);
    expect(group.market.representativeIls).toBeNull();
    expect(group.market.representativeRange).toBeNull();
    // Each unit compared to its OWN range, tallied independently.
    expect(group.market.positionCounts.above_range).toBe(1);
    expect(group.market.positionCounts.within_range).toBe(1);
    // The group's aggregate signal position follows the documented
    // priority (any above-range unit dominates) -- not an average, not a
    // synthetic midpoint.
    expect(group.market.aggregatePosition).toBe("above_range");
  });
});
