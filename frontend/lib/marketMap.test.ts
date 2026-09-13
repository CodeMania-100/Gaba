// Regression tests for "fix overlapping approximate competitor markers in
// multi-city maps" -- groupCompetitorPointsByCoordinate must aggregate
// competitors that only ever resolved to the same approximate
// (neighborhood-centroid) coordinate, while leaving genuine per-project
// address coordinates exactly as individual points, even when several of
// those happen to share a coordinate too (never grouped) or sit close to an
// aggregated cluster. After the one-time map-coordinate enrichment pass
// (build_multi_city_competitor_coordinate_enrichment_v1.py), a
// "street"-precision coordinate (a road-level geocode with no
// distinguishing house number) can also legitimately collide between two
// different projects on the same street -- that case must aggregate too,
// scoped separately from approximate collisions so the group's own
// precision label stays honest.

import { describe, expect, it } from "vitest";
import { PetahTikvaWorkspace } from "./api";
import {
  deriveSpecialAskingPoints,
  deriveSpecialCompetitorPoints,
  deriveSpecialSoldPoints,
  groupCompetitorPointsByCoordinate,
  MarketMapPoint,
  pointContributesForFamily,
} from "./marketMap";

function competitorPoint(overrides: Partial<MarketMapPoint>): MarketMapPoint {
  return {
    id: overrides.id ?? `competitor:${overrides.title}`,
    kind: "competitor",
    lat: 32.3,
    lng: 34.87,
    title: "פרויקט",
    contributesToPricing: false,
    coordinatePrecision: "approximate",
    ...overrides,
  };
}

describe("groupCompetitorPointsByCoordinate", () => {
  it("collapses multiple approximate-precision competitors sharing the exact same coordinate into one competitor_group point", () => {
    // Real shape of the Netanya/Kiryat Hasharon case: 9 projects, all
    // NEIGHBORHOOD_CENTROID, all resolved to the identical lat/lng.
    const points = Array.from({ length: 9 }, (_, i) =>
      competitorPoint({ id: `competitor:project-${i}`, title: `פרויקט ${i}`, lat: 32.30321, lng: 34.87567, coordinatePrecision: "approximate" })
    );

    const grouped = groupCompetitorPointsByCoordinate(points);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].kind).toBe("competitor_group");
    expect(grouped[0].groupMembers).toHaveLength(9);
    // The group sits at exactly the one real coordinate the geocoding pass
    // resolved -- never an invented/adjusted position.
    expect(grouped[0].lat).toBeCloseTo(32.30321, 5);
    expect(grouped[0].lng).toBeCloseTo(34.87567, 5);
    expect(grouped[0].title).toContain("9");
  });

  it("never groups genuine PROJECT/address-precision coordinates, even when several happen to share one", () => {
    const addressA = competitorPoint({ id: "competitor:a", title: "פרויקט א", lat: 31.676, lng: 34.596, coordinatePrecision: "address" });
    const addressB = competitorPoint({ id: "competitor:b", title: "פרויקט ב", lat: 31.676, lng: 34.596, coordinatePrecision: "address" }); // same coord, real precision
    const addressC = competitorPoint({ id: "competitor:c", title: "פרויקט ג", lat: 31.691, lng: 34.5956, coordinatePrecision: "address" });

    const grouped = groupCompetitorPointsByCoordinate([addressA, addressB, addressC]);

    expect(grouped).toHaveLength(3);
    expect(grouped.every((p) => p.kind === "competitor")).toBe(true);
  });

  it("keeps genuine PROJECT coordinates separate while aggregating only the centroid-fallback ones (mixed-precision case, e.g. Ashkelon)", () => {
    const centroidGroup = Array.from({ length: 7 }, (_, i) =>
      competitorPoint({ id: `competitor:centroid-${i}`, title: `מתחם ${i}`, lat: 31.68751, lng: 34.57109, coordinatePrecision: "approximate" })
    );
    const individualA = competitorPoint({ id: "competitor:ramot", title: "רמות אשקלון", lat: 31.67666, lng: 34.59663, coordinatePrecision: "address" });
    const individualB = competitorPoint({ id: "competitor:peretz", title: "אייל פרץ ברמות", lat: 31.67493, lng: 34.59457, coordinatePrecision: "address" });

    const grouped = groupCompetitorPointsByCoordinate([...centroidGroup, individualA, individualB]);

    const groups = grouped.filter((p) => p.kind === "competitor_group");
    const individuals = grouped.filter((p) => p.kind === "competitor");
    expect(groups).toHaveLength(1);
    expect(groups[0].groupMembers).toHaveLength(7);
    expect(individuals).toHaveLength(2);
    expect(individuals.map((p) => p.title).sort()).toEqual(["אייל פרץ ברמות", "רמות אשקלון"].sort());
  });

  it("leaves a coordinate shared by only one competitor as a normal individual point", () => {
    const solo = competitorPoint({ id: "competitor:solo", title: "פרויקט יחיד", coordinatePrecision: "approximate" });
    const grouped = groupCompetitorPointsByCoordinate([solo]);
    expect(grouped).toEqual([solo]);
  });

  it("does not invent or adjust coordinates -- the group's lat/lng is exactly the shared input coordinate", () => {
    const points = [
      competitorPoint({ id: "competitor:x", title: "X", lat: 32.05899, lng: 34.79285, coordinatePrecision: "approximate" }),
      competitorPoint({ id: "competitor:y", title: "Y", lat: 32.05899, lng: 34.79285, coordinatePrecision: "approximate" }),
    ];
    const grouped = groupCompetitorPointsByCoordinate(points);
    expect(grouped[0].lat).toBe(32.05899);
    expect(grouped[0].lng).toBe(34.79285);
  });

  it("also collapses two street-precision competitors that resolved to the exact same road-level coordinate (post-enrichment fallback collision)", () => {
    const streetA = competitorPoint({ id: "competitor:street-a", title: "פרויקט על נגבה 1", lat: 32.0543827, lng: 34.7959971, coordinatePrecision: "street" });
    const streetB = competitorPoint({ id: "competitor:street-b", title: "פרויקט על נגבה 2", lat: 32.0543827, lng: 34.7959971, coordinatePrecision: "street" });

    const grouped = groupCompetitorPointsByCoordinate([streetA, streetB]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].kind).toBe("competitor_group");
    expect(grouped[0].coordinatePrecision).toBe("street");
    expect(grouped[0].groupMembers).toHaveLength(2);
  });

  it("keeps an approximate collision and a street collision as two separate groups even if the underlying coordinates were ever equal", () => {
    const approx = [
      competitorPoint({ id: "competitor:approx-a", title: "A", lat: 32.1, lng: 34.8, coordinatePrecision: "approximate" }),
      competitorPoint({ id: "competitor:approx-b", title: "B", lat: 32.1, lng: 34.8, coordinatePrecision: "approximate" }),
    ];
    const street = [
      competitorPoint({ id: "competitor:street-a", title: "C", lat: 32.2, lng: 34.9, coordinatePrecision: "street" }),
      competitorPoint({ id: "competitor:street-b", title: "D", lat: 32.2, lng: 34.9, coordinatePrecision: "street" }),
    ];

    const grouped = groupCompetitorPointsByCoordinate([...approx, ...street]);
    const groups = grouped.filter((p) => p.kind === "competitor_group");

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.coordinatePrecision).sort()).toEqual(["approximate", "street"]);
  });

  it("leaves a lone street-precision competitor (no collision) as a normal individual point", () => {
    const solo = competitorPoint({ id: "competitor:street-solo", title: "פרויקט רחוב יחיד", lat: 31.68, lng: 34.59, coordinatePrecision: "street" });
    const grouped = groupCompetitorPointsByCoordinate([solo]);
    expect(grouped).toEqual([solo]);
  });
});

describe("pointContributesForFamily with competitor_group points", () => {
  function fakeWorkspace(projects: { project_name: string; standard_3r_eligible: boolean; standard_5r_eligible: boolean }[]): PetahTikvaWorkspace {
    return {
      competitor_landscape: {
        projects: projects.map((p) => ({
          project_name: p.project_name,
          quantitative_eligibility: {
            standard_3r: { eligible: p.standard_3r_eligible },
            standard_5r: { eligible: p.standard_5r_eligible },
          },
        })),
      },
      // Only the fields pointContributesForFamily actually reads are real;
      // everything else is irrelevant to this pure function.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("contributes for a family whenever ANY member individually would, even if most would not", () => {
    const workspace = fakeWorkspace([
      { project_name: "A", standard_3r_eligible: false, standard_5r_eligible: false },
      { project_name: "B", standard_3r_eligible: true, standard_5r_eligible: false },
      { project_name: "C", standard_3r_eligible: false, standard_5r_eligible: false },
    ]);
    const group = competitorPoint({
      kind: "competitor_group",
      title: "3 פרויקטים",
      groupMembers: [
        competitorPoint({ title: "A", contributesToPricing: false }),
        competitorPoint({ title: "B", contributesToPricing: true }),
        competitorPoint({ title: "C", contributesToPricing: false }),
      ],
    });

    expect(pointContributesForFamily(group, workspace, "3R")).toBe(true); // B is eligible for 3R
    expect(pointContributesForFamily(group, workspace, "5R")).toBe(false); // none eligible for 5R
  });

  it("returns false for a group with no eligible member in either family", () => {
    const workspace = fakeWorkspace([{ project_name: "A", standard_3r_eligible: false, standard_5r_eligible: false }]);
    const group = competitorPoint({ kind: "competitor_group", title: "1 פרויקט", groupMembers: [competitorPoint({ title: "A" })] });
    expect(pointContributesForFamily(group, workspace, "3R")).toBe(false);
    expect(pointContributesForFamily(group, workspace, "5R")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P0 display-integrity fix: a participating special-unit comparable must
// never show a real normalized_value_ils next to a missing evidence-side
// area -- the presentation derivation must prefer the pricing engine's own
// canonical comparable_area_sqm/comparable_price_ils (guaranteed non-null
// whenever normalized_value_ils is set, since NormalizedComparable is a
// required-field dataclass), falling back to a raw-source field ONLY for
// records with no canonical comparable at all (excluded records). The bug
// was that several derive*Points functions read a raw field name that only
// exists on Petah Tikva's own hand-curated special-unit data (price/date/
// area_m2/type), silently returning undefined for the three multi-city
// contexts, which use different column names (deal_amount/deal_date/
// internal_area/product_type) on the exact same shared derivation path.
// ---------------------------------------------------------------------------

const RESOLVED_GEO = { lat: 32.3, lng: 34.87, coordinate_source: "geocoded_address" as const, verified: true };

describe("special-unit evidence field mapping (P0 display-integrity fix)", () => {
  it("deriveSpecialSoldPoints reads price/date from the multi-city dataset's own column names (deal_amount/deal_date), not only Petah Tikva's (price/date)", () => {
    const workspace = {
      special_unit_market_context: {
        units: {
          "1": {
            sold_selected: [
              {
                address: "הדקל 5",
                // Multi-city sold_special_v2.csv column names -- NOT price/date.
                deal_amount: "2400000",
                deal_date: "2026-01-15",
                internal_area: "80",
                rooms: "4",
                product_type: "duplex",
              },
            ],
            sold_rejected: [],
            market_indication: {
              lanes: {
                sold: {
                  calculation_method: "raw_price_median",
                  comps_used: [
                    {
                      lane: "sold", tier: "tier_b_size_relaxed", label: "הדקל 5",
                      comparable_price_ils: 2400000, comparable_area_sqm: 80, subject_area_sqm: 75,
                      normalized_value_ils: 2250000, note: "", raw: {},
                    },
                  ],
                  comps_context_only: [], reference_ils: 2400000, is_provisional: false, is_direct_quality: false, label: "",
                },
              },
              excluded: [],
            },
          },
        },
      },
      market_map_geocodes: { special_sold: { resolved: [{ record_id: "x", address: "הדקל 5", ...RESOLVED_GEO, precision: "address", resolved_label: null }] } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const points = deriveSpecialSoldPoints(workspace, 1);
    expect(points).toHaveLength(1);
    expect(points[0].priceIls).toBe(2400000);
    expect(points[0].date).toBe("2026-01-15");
    expect(points[0].internalArea).toBe(80);
    expect(points[0].rooms).toBe(4);
    expect(points[0].specialEvidenceType).toBe("duplex");
  });

  it("deriveSpecialSoldPoints prefers the canonical comparable_area_sqm/comparable_price_ils over the raw record even when both are present", () => {
    const workspace = {
      special_unit_market_context: {
        units: {
          "1": {
            sold_selected: [{ address: "הדקל 5", deal_amount: "9999999", internal_area: "999" }], // raw values deliberately wrong/stale
            sold_rejected: [],
            market_indication: {
              lanes: {
                sold: {
                  calculation_method: "raw_price_median",
                  comps_used: [
                    {
                      lane: "sold", tier: "tier_b_size_relaxed", label: "הדקל 5",
                      comparable_price_ils: 2400000, comparable_area_sqm: 80, subject_area_sqm: 75,
                      normalized_value_ils: 2250000, note: "", raw: {},
                    },
                  ],
                  comps_context_only: [], reference_ils: 2400000, is_provisional: false, is_direct_quality: false, label: "",
                },
              },
              excluded: [],
            },
          },
        },
      },
      market_map_geocodes: { special_sold: { resolved: [{ record_id: "x", address: "הדקל 5", ...RESOLVED_GEO, precision: "address", resolved_label: null }] } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const points = deriveSpecialSoldPoints(workspace, 1);
    expect(points[0].priceIls).toBe(2400000); // canonical, not the raw 9999999
    expect(points[0].internalArea).toBe(80); // canonical, not the raw 999
  });

  it("deriveSpecialAskingPoints reads price/area/product-type from the multi-city dataset's own column names (price/internal_area/product_type), not only Petah Tikva's (price_ils/area_m2/type)", () => {
    const workspace = {
      special_unit_market_context: {
        units: {
          "39": {
            direct_comparables: [
              { address: "הדקל 12", price: "5250000", internal_area: "160", rooms: "6", floor: "11", product_type: "duplex" },
            ],
            broadened_comparables: [],
            market_indication: {
              lanes: {
                current_asking: {
                  calculation_method: "area_normalized_median",
                  comps_used: [
                    {
                      lane: "current_asking", tier: "tier_a_direct", label: "הדקל 12",
                      comparable_price_ils: 5250000, comparable_area_sqm: 160, subject_area_sqm: 158.6,
                      normalized_value_ils: 5211000, note: "", raw: {},
                    },
                  ],
                  comps_context_only: [], reference_ils: 5211000, is_provisional: false, is_direct_quality: true, label: "",
                },
              },
              excluded: [],
            },
          },
        },
      },
      market_map_geocodes: { special_asking: { resolved: [{ record_id: "x", address: "הדקל 12", ...RESOLVED_GEO, precision: "address", resolved_label: null }] } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const points = deriveSpecialAskingPoints(workspace, 39);
    expect(points).toHaveLength(1);
    expect(points[0].priceIls).toBe(5250000);
    expect(points[0].internalArea).toBe(160);
    expect(points[0].specialEvidenceType).toBe("duplex");
    expect(points[0].specialNormalizedValueIls).toBe(5211000);
  });

  it("invariant: a participating comparable whose lane calculation_method is area_normalized_median always has a visible internalArea (asking)", () => {
    const workspace = {
      special_unit_market_context: {
        units: {
          "39": {
            direct_comparables: [{ address: "הדקל 12", price: "5250000", internal_area: "160" }],
            broadened_comparables: [],
            market_indication: {
              lanes: {
                current_asking: {
                  calculation_method: "area_normalized_median",
                  comps_used: [
                    {
                      lane: "current_asking", tier: "tier_a_direct", label: "הדקל 12",
                      comparable_price_ils: 5250000, comparable_area_sqm: 160, subject_area_sqm: 158.6,
                      normalized_value_ils: 5211000, note: "", raw: {},
                    },
                  ],
                  comps_context_only: [], reference_ils: 5211000, is_provisional: false, is_direct_quality: true, label: "",
                },
              },
              excluded: [],
            },
          },
        },
      },
      market_map_geocodes: { special_asking: { resolved: [{ record_id: "x", address: "הדקל 12", ...RESOLVED_GEO, precision: "address", resolved_label: null }] } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const points = deriveSpecialAskingPoints(workspace, 39);
    const violatesInvariant = points.some((p) => p.specialNormalizedValueIls != null && p.specialCalculationMethod === "area_normalized_median" && p.internalArea == null);
    expect(violatesInvariant).toBe(false);
    expect(points[0].internalArea).not.toBeNull();
    expect(points[0].internalArea).toBeDefined();
  });

  it("deriveSpecialCompetitorPoints reads internalArea/rooms/price from the specific matched variant's own raw row, not only the generic register fact", () => {
    const workspace = {
      special_unit_market_context: {
        units: {
          "39": {
            market_indication: {
              lanes: {
                new_development: {
                  calculation_method: "area_normalized_median",
                  comps_used: [
                    {
                      lane: "new_development", tier: "tier_a_direct", label: "פרויקט X (duplex)",
                      comparable_price_ils: 4800000, comparable_area_sqm: 150, subject_area_sqm: 158.6,
                      normalized_value_ils: 5078400, note: "",
                      raw: { internal_area_sqm: "150", price_ils: "4800000", rooms: "5", floor: "8", unit_type: "duplex" },
                    },
                  ],
                  comps_context_only: [], reference_ils: 5078400, is_provisional: false, is_direct_quality: true, label: "",
                },
              },
              excluded: [],
            },
          },
        },
      },
      market_map_geocodes: { competitors: { resolved: [{ record_id: "competitor:פרויקט X", address: "פרויקט X", ...RESOLVED_GEO, precision: "address", resolved_label: null }] } },
      competitor_landscape: { projects: [{ project_name: "פרויקט X", display_classification: "relevant", known_unit_variants: [] }] },
      standard_attribute_enrichment: { families: { standard_3r: { new_development_comparables: [] }, standard_5r: { new_development_comparables: [] } } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const points = deriveSpecialCompetitorPoints(workspace, 39);
    expect(points).toHaveLength(1);
    expect(points[0].internalArea).toBe(150);
    expect(points[0].rooms).toBe(5);
    expect(points[0].priceIls).toBe(4800000); // the matched variant's own price, not a generic register figure
    expect(points[0].specialEvidenceType).toBe("duplex");
    // Same invariant, competitor lane.
    expect(points[0].specialNormalizedValueIls).not.toBeNull();
    expect(points[0].internalArea).not.toBeNull();
  });

  it("an excluded record (no canonical comparable) never claims a normalized value, so the invariant does not apply even when its area is unknown", () => {
    const workspace = {
      special_unit_market_context: {
        units: {
          "39": {
            direct_comparables: [{ address: "רחוב לא ידוע 1" }], // no area/price at all
            broadened_comparables: [],
            market_indication: {
              lanes: {},
              excluded: [{ lane: "current_asking", label: "רחוב לא ידוע 1", reason: "numeric_completeness_failed", raw: {} }],
            },
          },
        },
      },
      market_map_geocodes: { special_asking: { resolved: [{ record_id: "x", address: "רחוב לא ידוע 1", ...RESOLVED_GEO, precision: "approximate", resolved_label: null }] } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const points = deriveSpecialAskingPoints(workspace, 39);
    expect(points).toHaveLength(1);
    expect(points[0].specialStatus).toBe("excluded");
    expect(points[0].specialNormalizedValueIls).toBeUndefined();
    expect(points[0].internalArea).toBeUndefined();
  });
});
