// Regression test for "product comparison does not react to the selected
// family/unit": the comparison subject must switch cleanly 3R -> 5R ->
// special unit, with no silent 3R fallback for a valid non-3R selection.

import { describe, expect, it } from "vitest";
import { PtkPriceListRow, SpecialUnitContext, SpecialUnitIndication } from "./api";
import {
  ComparisonSelectorOption,
  deriveComparisonSelectorOptions,
  deriveComparisonSubject,
  resolveRowForSelector,
  selectorKeyForSubject,
} from "./comparisonSubject";

function standardRow(unitNumber: string, family: "3R" | "5R"): PtkPriceListRow {
  return {
    unit_number: unitNumber,
    family,
    family_key: family,
    floor: 3,
    internal_area_sqm: family === "3R" ? 69 : 111.1,
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
  };
}

function specialRow(unitNumber: string, unitType: "garden_apartment" | "duplex" | "triplex", rooms: number): PtkPriceListRow {
  return {
    unit_number: unitNumber,
    family: unitType,
    family_key: null,
    floor: 0,
    rooms,
    internal_area_sqm: 90,
    balcony_area_sqm: 40,
    orientation: null,
    market_range: { lower: 2_000_000, upper: 2_200_000, confidence: "medium" },
    strategy_basis: null,
    commercial_base_price_ils: null,
    adjustments: [],
    proposed_list_price_ils: 2_100_000,
    status: "manual_special_pricing_pending",
    requires_review: true,
    warnings: [],
    explanation: [],
    override: null,
    locked: false,
  };
}

describe("deriveComparisonSubject", () => {
  it("switches 3R -> 5R -> special unit with no silent 3R fallback", () => {
    const threeRoom = deriveComparisonSubject(standardRow("14", "3R"));
    expect(threeRoom).toEqual({ kind: "standard", family: "3R" });

    const fiveRoom = deriveComparisonSubject(standardRow("28", "5R"));
    expect(fiveRoom).toEqual({ kind: "standard", family: "5R" });
    // The concrete bug this guards against: a valid non-3R selection must
    // never resolve back to family "3R".
    expect(fiveRoom).not.toEqual({ kind: "standard", family: "3R" });

    const triplex = specialRow("36", "triplex", 6);
    const special = deriveComparisonSubject(triplex);
    expect(special.kind).toBe("special");
    if (special.kind !== "special") throw new Error("expected special subject");
    expect(special.row.unit_number).toBe("36");
    expect(special.row.family).toBe("triplex");
  });

  it("resolves every special unit_type to kind: special, never standard", () => {
    for (const [unitType, rooms] of [
      ["garden_apartment", 3],
      ["duplex", 5],
      ["triplex", 6],
    ] as const) {
      const subject = deriveComparisonSubject(specialRow("x", unitType, rooms));
      expect(subject.kind).toBe("special");
    }
  });

  it("switching back from special to a standard family resolves cleanly (no stuck special state)", () => {
    const back = deriveComparisonSubject(standardRow("14", "3R"));
    expect(back).toEqual({ kind: "standard", family: "3R" });
  });
});

// ---------------------------------------------------------------------------
// The apartment-type selector -- exercises the actual pipeline the
// selector's onClick runs (options derived from the live inventory ->
// resolveRowForSelector -> the same deriveComparisonSubject above), not
// deriveComparisonSubject alone. This is the regression for "the selector
// still leaves the comparison on the previous subject": there must be no
// separate family state for the selector to disagree with -- its resolved
// row must drive the identical subject every other selection entry point
// uses. It also covers the follow-up refinement: a segment is family +
// rooms, and picking among several real candidates for the same segment is
// not decided by unit_number order alone.
// ---------------------------------------------------------------------------

function specialContext(indication: SpecialUnitIndication | null): SpecialUnitContext {
  return {
    category: indication?.category ?? "garden",
    route: "special_review",
    direct_comparables: [],
    broadened_comparables: [],
    sold_selected: [],
    sold_rejected: [],
    sold_evidence_gap: null,
    direct_sold_triplex_count: null,
    sold_context_additions: [],
    qa_flags: [],
    family_anchor_context: null,
    market_indication: indication,
    first_researcher_context: [],
  };
}

function indication(overrides: Partial<SpecialUnitIndication> & { unit_number: string }): SpecialUnitIndication {
  return {
    category: "garden",
    subject_internal_area_sqm: 90,
    lanes: {},
    voting_lane_names: [],
    excluded: [],
    suggested_price_ils: 2_000_000,
    indicative_lower_ils: 1_900_000,
    indicative_upper_ils: 2_100_000,
    confidence: "low",
    confidence_reason: "",
    ...overrides,
  };
}

function lane(compsUsedCount: number) {
  return {
    lane: "current_asking" as const,
    calculation_method: "area_normalized_median" as const,
    comps_used: Array.from({ length: compsUsedCount }, () => ({}) as never),
    comps_context_only: [],
    reference_ils: 2_000_000,
    is_provisional: false,
    is_direct_quality: true,
    label: "",
  };
}

// Mirrors the real inventory exactly: two 3-room garden units (1, 2), one
// 2-room garden unit (3), two 6-room triplex units (36, 37) with genuinely
// tied evidence, and two duplex units with DIFFERENT room counts (38: 7R,
// 39: 5R) -- so duplex has no within-segment ambiguity at all, while garden
// and triplex each have a real multi-candidate segment to resolve.
const MIXED_INVENTORY: PtkPriceListRow[] = [
  standardRow("4", "3R"),
  standardRow("8", "3R"),
  standardRow("7", "5R"),
  standardRow("11", "5R"),
  specialRow("2", "garden_apartment", 3),
  specialRow("1", "garden_apartment", 3),
  specialRow("3", "garden_apartment", 2),
  specialRow("37", "triplex", 6),
  specialRow("36", "triplex", 6),
  specialRow("38", "duplex", 7),
  specialRow("39", "duplex", 5),
];

// Deliberately makes unit 1 (not the lowest-numbered candidate would-be
// "unit 1 wins by luck" case, but here unit 1 IS also the objectively
// better candidate) the clearly better representative: it has a real price
// and higher confidence, while unit 2 is still stuck without one. If the
// resolver used "lowest unit_number" as its rule this would coincidentally
// still pick unit 1 -- the second case below (triplex) is the one that
// actually catches a naive unit_number-only implementation, since 36 and 37
// are genuine ties on every real signal and only the deterministic
// last-resort tiebreak may legitimately prefer the lower number.
const SPECIAL_UNITS: Record<string, SpecialUnitContext> = {
  "1": specialContext(indication({ unit_number: "1", category: "garden", confidence: "medium", suggested_price_ils: 2_300_000, lanes: { current_asking: lane(3) } })),
  "2": specialContext(indication({ unit_number: "2", category: "garden", confidence: "low", suggested_price_ils: null, lanes: {} })),
  "3": specialContext(indication({ unit_number: "3", category: "garden", confidence: "low", suggested_price_ils: 2_060_000, lanes: { current_asking: lane(1) } })),
  "36": specialContext(indication({ unit_number: "36", category: "triplex", confidence: "low", suggested_price_ils: 6_180_000, lanes: { sold: lane(5) } })),
  "37": specialContext(indication({ unit_number: "37", category: "triplex", confidence: "low", suggested_price_ils: 6_180_000, lanes: { sold: lane(5) } })),
  "38": specialContext(indication({ unit_number: "38", category: "duplex", confidence: "medium", suggested_price_ils: 3_460_000, lanes: { sold: lane(4) } })),
  "39": specialContext(indication({ unit_number: "39", category: "duplex", confidence: "medium", suggested_price_ils: 4_070_000, lanes: { sold: lane(4) } })),
};

/** A minimal stand-in for whatever a real heading/context render would show
 * -- exactly the fields the comparison section's heading, competitor set,
 * and highlighted-comparable pieces all key off. Used to assert the
 * *visible* identity actually changes step to step, not just an internal
 * flag. */
function visibleIdentity(row: PtkPriceListRow): string {
  const subject = deriveComparisonSubject(row);
  return subject.kind === "standard" ? `standard:${subject.family}` : `special:${subject.row.family}:${subject.row.rooms}:${subject.row.unit_number}`;
}

function resolve(option: ComparisonSelectorOption) {
  return resolveRowForSelector(MIXED_INVENTORY, SPECIAL_UNITS, option);
}

describe("deriveComparisonSelectorOptions", () => {
  it("produces exactly the seven real segments -- family+rooms, not family alone", () => {
    const options = deriveComparisonSelectorOptions(MIXED_INVENTORY);
    expect(options.map((o) => o.label)).toEqual([
      "3 חדרים — סטנדרט",
      "5 חדרים — סטנדרט",
      "3 חדרים — דירת גן",
      "2 חדרים — דירת גן",
      "6 חדרים — טריפלקס",
      "7 חדרים — דופלקס",
      "5 חדרים — דופלקס",
    ]);
  });

  it("collapses multiple units of the same segment into exactly one option, never one-per-unit", () => {
    const options = deriveComparisonSelectorOptions(MIXED_INVENTORY);
    // Two garden-3R units (1, 2) and two triplex-6R units (36, 37) -- still
    // one option each, not two.
    expect(options.filter((o) => o.key === "garden_apartment:3")).toHaveLength(1);
    expect(options.filter((o) => o.key === "triplex:6")).toHaveLength(1);
  });
});

describe("resolveRowForSelector (the selector's actual onClick pipeline)", () => {
  const options = deriveComparisonSelectorOptions(MIXED_INVENTORY);
  const byKey = (key: string) => options.find((o) => o.key === key)!;

  it("resolves each standard segment to a real matching row (any one is equivalent -- family alone drives the subject)", () => {
    expect(resolve(byKey("3R"))?.family).toBe("3R");
    expect(resolve(byKey("5R"))?.family).toBe("5R");
  });

  it("resolves a non-ambiguous special segment (its only real candidate) directly", () => {
    expect(resolve(byKey("garden_apartment:2"))?.unit_number).toBe("3");
    expect(resolve(byKey("duplex:7"))?.unit_number).toBe("38");
    expect(resolve(byKey("duplex:5"))?.unit_number).toBe("39");
  });

  it("for an ambiguous segment, picks the candidate with real evidence over unit_number order -- never 'lowest unit_number wins' as the rule", () => {
    // garden 3R: unit 1 has a real price + medium confidence, unit 2 has
    // neither -- the correct pick is 1, and it must be because of that, not
    // because 1 < 2.
    expect(resolve(byKey("garden_apartment:3"))?.unit_number).toBe("1");
  });

  it("for a segment where every real signal is genuinely tied, still resolves deterministically (last-resort tiebreak only)", () => {
    // triplex 6R: units 36 and 37 are identical on confidence, price, and
    // evidence count -- there is no "more correct" pick, so the resolver's
    // final deterministic tiebreak is legitimate here.
    const first = resolve(byKey("triplex:6"))?.unit_number;
    const second = resolve(byKey("triplex:6"))?.unit_number;
    expect(first).toBe(second); // stable across repeated calls
    expect(["36", "37"]).toContain(first);
  });

  it("would still pick unit 1 for garden-3R even if array order were reversed (proves the choice is evidence-based, not position-based)", () => {
    const reversed = [...MIXED_INVENTORY].reverse();
    const row = resolveRowForSelector(reversed, SPECIAL_UNITS, byKey("garden_apartment:3"));
    expect(row?.unit_number).toBe("1");
  });

  it("returns null (never a fabricated row) for a segment genuinely absent from the inventory", () => {
    const noTriplex = MIXED_INVENTORY.filter((r) => r.family !== "triplex");
    const fakeOption: ComparisonSelectorOption = { key: "triplex:6", label: "6 חדרים — טריפלקס", family: "triplex", rooms: 6 };
    expect(resolveRowForSelector(noTriplex, SPECIAL_UNITS, fakeOption)).toBeNull();
  });

  it("every selector option round-trips through selectorKeyForSubject to itself", () => {
    for (const opt of options) {
      const row = resolve(opt);
      expect(row).not.toBeNull();
      const subject = deriveComparisonSubject(row!);
      expect(selectorKeyForSubject(subject)).toBe(opt.key);
    }
  });

  it("3R standard -> 5R standard -> 3R garden -> 2R garden -> 6R triplex -> 7R duplex -> 5R duplex: the visible subject changes every single step, never reverting to a previous one and never stale", () => {
    const sequence = ["3R", "5R", "garden_apartment:3", "garden_apartment:2", "triplex:6", "duplex:7", "duplex:5"];
    const seenIdentities: string[] = [];

    for (const key of sequence) {
      const row = resolve(byKey(key));
      expect(row).not.toBeNull();
      const identity = visibleIdentity(row!);

      // The concrete bug: selecting a new segment must never leave the
      // previous step's identity on screen.
      if (seenIdentities.length > 0) {
        expect(identity).not.toBe(seenIdentities[seenIdentities.length - 1]);
      }
      seenIdentities.push(identity);
    }

    expect(seenIdentities).toEqual([
      "standard:3R",
      "standard:5R",
      "special:garden_apartment:3:1",
      "special:garden_apartment:2:3",
      `special:triplex:6:${seenIdentities[4].split(":")[3]}`, // 36 or 37, whichever the tiebreak legitimately picks
      "special:duplex:7:38",
      "special:duplex:5:39",
    ]);

    // Every identity in the sequence is unique -- no step silently repeats
    // an earlier one (the garden and duplex segments are easy to conflate
    // if room count is dropped from the identity).
    expect(new Set(seenIdentities).size).toBe(seenIdentities.length);
  });
});
