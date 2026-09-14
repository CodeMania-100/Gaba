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
  countFamilyRelevantCompetitors,
  deriveCompetitorHighlights,
  deriveSpecialAskingPoints,
  deriveSpecialCompetitorPoints,
  deriveSpecialSoldPoints,
  deriveSpecialTypologyContextPoints,
  groupCompetitorPointsByCoordinate,
  isRelevantToFamily,
  MarketMapPoint,
  pointContributesForFamily,
  rematchCompetitorPointForFamily,
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

  // Final P0 data-visibility audit: source/geographyTier were never read for
  // a special sold point -- every multi-city row's real geography_tier and
  // source_name never reached the popup, which instead ALWAYS fell back to
  // the hardcoded "רשות המסים (נתוני עסקאות)" label even for non-Petah-Tikva
  // evidence from an entirely different source (e.g. "Yad1 / public
  // transaction mirror"). Petah Tikva's own tax-archive rows genuinely carry
  // neither field, so they correctly keep falling back to that label.
  it("deriveSpecialSoldPoints reads source/geographyTier from the multi-city column names (source_name/geography_tier)", () => {
    const workspace = {
      special_unit_market_context: {
        units: {
          "1": {
            sold_selected: [
              {
                address: "דרך הפארק 15",
                deal_amount: "4050000",
                deal_date: "2025-10-30",
                internal_area: "159",
                rooms: "5",
                geography_tier: "CORE",
                source_name: "Yad1 / public transaction mirror",
              },
            ],
            sold_rejected: [],
            market_indication: { lanes: {}, excluded: [] },
          },
        },
      },
      market_map_geocodes: { special_sold: { resolved: [{ record_id: "x", address: "דרך הפארק 15", ...RESOLVED_GEO, precision: "address", resolved_label: null }] } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const points = deriveSpecialSoldPoints(workspace, 1);
    expect(points).toHaveLength(1);
    expect(points[0].geographyTier).toBe("CORE");
    expect(points[0].source).toBe("Yad1 / public transaction mirror");
  });

  it("deriveSpecialSoldPoints leaves source/geographyTier undefined for Petah Tikva's own tax-archive rows (no such field on file)", () => {
    const workspace = {
      special_unit_market_context: {
        units: {
          "38": {
            sold_selected: [{ address: "כתובת פ״ת", price: "2720000", date: "2026-01-01", internal_area: "165", tax_property_type: "דירה בבית קומות" }],
            sold_rejected: [],
            market_indication: { lanes: {}, excluded: [] },
          },
        },
      },
      market_map_geocodes: { special_sold: { resolved: [{ record_id: "x", address: "כתובת פ״ת", ...RESOLVED_GEO, precision: "address", resolved_label: null }] } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const points = deriveSpecialSoldPoints(workspace, 38);
    expect(points[0].source).toBeUndefined();
    expect(points[0].geographyTier).toBeUndefined();
    expect(points[0].specialEvidenceType).toBe("דירה בבית קומות"); // tax_property_type fallback
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

  // Final P0 data-visibility audit: date/geographyTier/parkingCount/
  // hasSecureRoom/source were never read for a special asking point at all,
  // even though every multi-city listing carries real values for all five
  // under observed_date/geography_tier/parking/mamad/source_name -- and
  // mamad arrives as the literal string "True"/"False" (a Python str(bool)
  // artifact), not a JSON boolean.
  it("deriveSpecialAskingPoints reads date/geographyTier/parkingCount/hasSecureRoom/source from the multi-city column names, including mamad's string-boolean shape", () => {
    const workspace = {
      special_unit_market_context: {
        units: {
          "39": {
            direct_comparables: [
              {
                address: "דרך היין 22",
                price: "3780000",
                internal_area: "160",
                rooms: "5",
                floor: "19",
                product_type: "penthouse",
                observed_date: "2026-09-11",
                geography_tier: "CORE",
                parking: "3",
                mamad: "True",
                source_name: "ad — דרך היין 22 פנטהאוז",
              },
            ],
            broadened_comparables: [],
            market_indication: { lanes: {}, excluded: [] },
          },
        },
      },
      market_map_geocodes: { special_asking: { resolved: [{ record_id: "x", address: "דרך היין 22", ...RESOLVED_GEO, precision: "address", resolved_label: null }] } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const points = deriveSpecialAskingPoints(workspace, 39);
    expect(points).toHaveLength(1);
    expect(points[0].date).toBe("2026-09-11");
    expect(points[0].geographyTier).toBe("CORE");
    expect(points[0].parkingCount).toBe(3);
    expect(points[0].hasSecureRoom).toBe(true);
    expect(points[0].source).toBe("ad — דרך היין 22 פנטהאוז");
  });

  it("deriveSpecialAskingPoints never confuses mamad: 'False' with mamad genuinely unknown", () => {
    const base = {
      address: "כתובת",
      price: "1000000",
      internal_area: "60",
    };
    const workspaceFor = (mamad: unknown) => ({
      special_unit_market_context: {
        units: { "39": { direct_comparables: [{ ...base, mamad }], broadened_comparables: [], market_indication: { lanes: {}, excluded: [] } } },
      },
      market_map_geocodes: { special_asking: { resolved: [{ record_id: "x", address: "כתובת", ...RESOLVED_GEO, precision: "address", resolved_label: null }] } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    expect(deriveSpecialAskingPoints(workspaceFor("False"), 39)[0].hasSecureRoom).toBe(false);
    expect(deriveSpecialAskingPoints(workspaceFor(undefined), 39)[0].hasSecureRoom).toBeUndefined();
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

// ---------------------------------------------------------------------------
// P0 — "Fix competitor/product matching globally". deriveCompetitorPoints
// builds every standard competitor point once, family-agnostically (a real
// architectural constraint -- the same points are reused across a 3R<->5R
// toggle). rematchCompetitorPointForFamily is what MarketGeoMap's own
// competitorVisible now calls before display, so the map popup/tooltip/
// group-member price the user actually sees is always the currently
// selected family's own real variant -- never an unrelated room count's
// price baked in at derivation time.
// ---------------------------------------------------------------------------

function workspaceWithCompetitorProject(project: Record<string, unknown>): PetahTikvaWorkspace {
  return {
    competitor_landscape: { projects: [project] },
    standard_attribute_enrichment: {
      families: { standard_3r: { new_development_comparables: [] }, standard_5r: { new_development_comparables: [] } },
    },
    special_unit_market_context: { units: {} },
    // No subject area on file -- rematchCompetitorPointForFamily's own
    // familyTargetAreaSqm helper reads this (top-level, PtkFamily[]), then
    // falls back to cheapest-among-eligible when it's absent, exactly
    // preserving these tests' existing "cheapest wins" expectations.
    families: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("rematchCompetitorPointForFamily (P0 fix)", () => {
  it("re-matches a standard competitor point's price/fact to the given family's own room count", () => {
    const workspace = workspaceWithCompetitorProject({
      project_name: "זאב ברנדה 22",
      display_classification: "direct",
      relevance: ["standard_3r", "standard_5r"],
      known_unit_variants: [
        { rooms: "3", price_ils: "2400000", price_basis: null },
        { rooms: "5", price_ils: "1900000", price_basis: null }, // deliberately cheaper
      ],
    });
    const point = competitorPoint({ title: "זאב ברנדה 22", priceIls: 1900000 }); // stale, cross-family value as built once by deriveCompetitorPoints

    const rematched3R = rematchCompetitorPointForFamily(point, workspace, "3R");
    expect(rematched3R.priceIls).toBe(2400000);
    expect(rematched3R.fact?.currentPriceIls).toBe(2400000);

    const rematched5R = rematchCompetitorPointForFamily(point, workspace, "5R");
    expect(rematched5R.priceIls).toBe(1900000);
  });

  it("re-matches every member of a competitor_group point independently", () => {
    const workspace = {
      competitor_landscape: {
        projects: [
          { project_name: "A", display_classification: "relevant", relevance: ["standard_3r"], known_unit_variants: [{ rooms: "3", price_ils: "2000000", price_basis: null }] },
          { project_name: "B", display_classification: "relevant", relevance: ["standard_5r"], known_unit_variants: [{ rooms: "5", price_ils: "3500000", price_basis: null }] },
        ],
      },
      standard_attribute_enrichment: {
        families: { standard_3r: { new_development_comparables: [] }, standard_5r: { new_development_comparables: [] } },
      },
      special_unit_market_context: { units: {} },
      families: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const group = competitorPoint({
      kind: "competitor_group",
      title: "2 פרויקטים",
      groupMembers: [competitorPoint({ title: "A" }), competitorPoint({ title: "B" })],
    });

    const rematched = rematchCompetitorPointForFamily(group, workspace, "3R");
    expect(rematched.groupMembers?.[0].priceIls).toBe(2000000); // A has a 3R match
    expect(rematched.groupMembers?.[1].priceIls).toBeUndefined(); // B has no 3R match -- never shows its 5R price
  });

  it("never touches a special-unit competitor point -- it already sources price from its own matched comparable, not a standard family", () => {
    const workspace = workspaceWithCompetitorProject({
      project_name: "פרויקט מיוחד",
      display_classification: "relevant",
      relevance: ["standard_3r"],
      known_unit_variants: [{ rooms: "3", price_ils: "9999999", price_basis: null }],
    });
    const specialPoint = competitorPoint({ title: "פרויקט מיוחד", specialUnitNumber: 39, priceIls: 4800000 });
    const rematched = rematchCompetitorPointForFamily(specialPoint, workspace, "3R");
    expect(rematched.priceIls).toBe(4800000); // untouched, never overwritten with the standard register's 3R price
    expect(rematched).toBe(specialPoint); // same object -- not even copied
  });
});

// P0 fix ("the map still does not follow the selected product"): relevance
// (the project's researched room_range, coarser than the quantitative
// eligibility that drives "רק ראיות שנכנסו לחישוב") must independently
// govern visual emphasis/muting and the aggregate marker's own split label.
describe("isRelevantToFamily (P0 fix)", () => {
  it("is relevant when the project's relevance tags include the selected family's product", () => {
    const workspace = workspaceWithCompetitorProject({
      project_name: "A",
      relevance: ["standard_3r", "standard_5r"],
    });
    const point = competitorPoint({ title: "A" });
    expect(isRelevantToFamily(point, workspace, "3R")).toBe(true);
    expect(isRelevantToFamily(point, workspace, "5R")).toBe(true);
  });

  it("is not relevant when the project is known NOT to offer that room count", () => {
    const workspace = workspaceWithCompetitorProject({
      project_name: "A",
      relevance: ["standard_5r"], // known to be 5R only
    });
    const point = competitorPoint({ title: "A" });
    expect(isRelevantToFamily(point, workspace, "3R")).toBe(false);
    expect(isRelevantToFamily(point, workspace, "5R")).toBe(true);
  });

  it("treats unknown/unresearched product mix (no relevance tags) as context, not a confirmed match", () => {
    const workspace = workspaceWithCompetitorProject({ project_name: "A", relevance: [] });
    const point = competitorPoint({ title: "A" });
    expect(isRelevantToFamily(point, workspace, "3R")).toBe(false);
  });

  it("for a competitor_group, is relevant iff at least one member is relevant", () => {
    const workspace = {
      competitor_landscape: {
        projects: [
          { project_name: "A", relevance: ["standard_5r"] },
          { project_name: "B", relevance: [] },
        ],
      },
      standard_attribute_enrichment: {
        families: { standard_3r: { new_development_comparables: [] }, standard_5r: { new_development_comparables: [] } },
      },
      special_unit_market_context: { units: {} },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const group = competitorPoint({
      kind: "competitor_group",
      title: "2 פרויקטים",
      groupMembers: [competitorPoint({ title: "A" }), competitorPoint({ title: "B" })],
    });
    expect(isRelevantToFamily(group, workspace, "3R")).toBe(false); // neither A nor B is 3R-relevant
    expect(isRelevantToFamily(group, workspace, "5R")).toBe(true); // A is
  });
});

describe("rematchCompetitorPointForFamily -- family-aware group aggregate title (P0 fix)", () => {
  function threeMemberWorkspace() {
    return {
      competitor_landscape: {
        projects: [
          { project_name: "A", relevance: ["standard_3r"] }, // relevant
          { project_name: "B", relevance: ["standard_3r"] }, // relevant
          { project_name: "C", relevance: ["standard_5r"] }, // context (not 3R)
        ],
      },
      standard_attribute_enrichment: {
        families: { standard_3r: { new_development_comparables: [] }, standard_5r: { new_development_comparables: [] } },
      },
      special_unit_market_context: { units: {} },
      families: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("splits the aggregate label into 'X רלוונטיים · Y הקשר' when the group is a mix", () => {
    const workspace = threeMemberWorkspace();
    const group = competitorPoint({
      kind: "competitor_group",
      title: "3 פרויקטים",
      groupMembers: [competitorPoint({ title: "A" }), competitorPoint({ title: "B" }), competitorPoint({ title: "C" })],
    });
    const rematched = rematchCompetitorPointForFamily(group, workspace, "3R");
    expect(rematched.title).toBe("2 רלוונטיים · 1 הקשר");
    expect(rematched.groupRelevantCount).toBe(2);
    expect(rematched.familyRelevant).toBe(true);
  });

  it("labels a fully-relevant group as just 'X רלוונטיים' with no context split", () => {
    const workspace = threeMemberWorkspace();
    const group = competitorPoint({
      kind: "competitor_group",
      title: "2 פרויקטים",
      groupMembers: [competitorPoint({ title: "A" }), competitorPoint({ title: "B" })],
    });
    const rematched = rematchCompetitorPointForFamily(group, workspace, "3R");
    expect(rematched.title).toBe("2 רלוונטיים");
    expect(rematched.groupRelevantCount).toBe(2);
  });

  it("labels a fully-context group (none relevant) distinctly, never claiming a confirmed match count", () => {
    const workspace = threeMemberWorkspace();
    const group = competitorPoint({
      kind: "competitor_group",
      title: "1 פרויקטים",
      groupMembers: [competitorPoint({ title: "C" })],
    });
    const rematched = rematchCompetitorPointForFamily(group, workspace, "3R");
    expect(rematched.title).toBe("1 פרויקטים בהקשר");
    expect(rematched.groupRelevantCount).toBe(0);
    expect(rematched.familyRelevant).toBe(false);
  });

  it("stamps familyRelevant on individual (non-group) points too", () => {
    const workspace = workspaceWithCompetitorProject({ project_name: "A", relevance: ["standard_5r"] });
    const point = competitorPoint({ title: "A" });
    const rematched3R = rematchCompetitorPointForFamily(point, workspace, "3R");
    expect(rematched3R.familyRelevant).toBe(false);
    const rematched5R = rematchCompetitorPointForFamily(point, workspace, "5R");
    expect(rematched5R.familyRelevant).toBe(true);
  });
});

describe("countFamilyRelevantCompetitors (P0 fix -- same derivation as the map's own rendered set)", () => {
  it("counts individual points and only the relevant members inside groups, never raw group entry counts", () => {
    const workspace = {
      competitor_landscape: {
        projects: [
          { project_name: "A", relevance: ["standard_3r"] },
          { project_name: "B", relevance: ["standard_3r"] },
          { project_name: "C", relevance: ["standard_5r"] },
          { project_name: "D", relevance: ["standard_3r"] },
        ],
      },
      standard_attribute_enrichment: {
        families: { standard_3r: { new_development_comparables: [] }, standard_5r: { new_development_comparables: [] } },
      },
      special_unit_market_context: { units: {} },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const points: MarketMapPoint[] = [
      competitorPoint({ title: "D" }), // individually resolved, relevant
      competitorPoint({
        kind: "competitor_group",
        title: "3 פרויקטים",
        groupMembers: [competitorPoint({ title: "A" }), competitorPoint({ title: "B" }), competitorPoint({ title: "C" })],
      }),
    ];
    // Netanya-shaped case from the bug report: 1 standalone + a group of 3
    // (2 relevant, 1 context) => 3 total relevant, never "4 map entries" or
    // the group's raw member count alone.
    expect(countFamilyRelevantCompetitors(points, workspace, "3R")).toBe(3);
  });
});

// Final P0 data-visibility audit: deriveCompetitorHighlights previously read
// storage/parking as object-only ({value: "..."}) -- silently dropping every
// multi-city project's plain-boolean true -- and mamad as boolean-only
// (=== true) -- silently dropping every Petah Tikva project's
// {status, value: true} shape. Both datasets' already-collected facts must
// show up regardless of which shape this particular project happens to use.
describe("deriveCompetitorHighlights (P0 data-visibility fix)", () => {
  it("shows parking/storage/mamad from Petah Tikva's own {status, value} object shape", () => {
    const project = {
      project_name: "פרויקט פתח תקווה",
      room_range: null,
      product_types: [],
      parking: { status: "verified_project_level", value: "parking registered to every apartment" },
      storage: { status: "verified_project_level", value: "private storage registered to every apartment" },
      mamad: { status: "verified_project_level", value: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const bullets = deriveCompetitorHighlights(project);
    expect(bullets).toContain("חניה לכל דירה");
    expect(bullets).toContain("מחסן פרטי לכל דירה");
    expect(bullets).toContain("ממ״ד");
  });

  it("shows parking/storage/mamad/elevator from the multi-city register's plain-boolean shape", () => {
    const project = {
      project_name: "פרויקט רב-עירוני",
      room_range: null,
      product_types: [],
      parking: true,
      storage: true,
      mamad: true,
      elevator: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const bullets = deriveCompetitorHighlights(project);
    expect(bullets).toContain("חניה");
    expect(bullets).toContain("מחסן פרטי");
    expect(bullets).toContain("ממ״ד");
    expect(bullets).toContain("מעלית");
  });

  it("never claims a feature that is explicitly false or genuinely absent, in either shape", () => {
    const projectFalse = {
      project_name: "A",
      room_range: null,
      product_types: [],
      parking: false,
      storage: { status: "verified_project_level", value: false },
      mamad: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const bullets = deriveCompetitorHighlights(projectFalse);
    expect(bullets).not.toContain("חניה");
    expect(bullets).not.toContain("מחסן פרטי");
    expect(bullets).not.toContain("ממ״ד");
  });

  it("room-range bullet uses the same canonical roomRangeLabel (variant-fallback-aware), never a second reimplementation", () => {
    const project = {
      project_name: "TIDHAR-like",
      room_range: null, // absent at project level
      product_types: [],
      known_unit_variants: [
        { rooms: "3", price_ils: "1", internal_area_sqm: "1" },
        { rooms: "5", price_ils: "1", internal_area_sqm: "1" },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    expect(deriveCompetitorHighlights(project)).toContain("3–5 חדרים");
  });

  it("shows a distinct building-height bullet from number_of_floors -- a real number, never confused with a specific unit's own floor", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const projectNumeric = { project_name: "A", room_range: null, product_types: [], number_of_floors: 23 } as any;
    expect(deriveCompetitorHighlights(projectNumeric)).toContain("בניין בן 23 קומות");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const projectRange = { project_name: "B", room_range: null, product_types: [], number_of_floors: "7-15" } as any;
    expect(deriveCompetitorHighlights(projectRange)).toContain("בניין בן 7-15 קומות");
  });

  it("omits the building-height bullet when number_of_floors is genuinely unknown", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const project = { project_name: "A", room_range: null, product_types: [], number_of_floors: null } as any;
    expect(deriveCompetitorHighlights(project).some((b) => b.includes("בניין"))).toBe(false);
  });
});

// Regression test: "triplex map record lost by address-prefix mismatch"
// (real Petah Tikva data) -- the geocode for "מנחם אוסישקין 22" (street
// precision, resolved_label "אוסישקין, נווה מעוז, ...") never matched
// TRIPLEX_USSISHKIN_22_ARCHIVE's own normalized.address ("אוסישקין 22, פתח
// תקווה", missing the "מנחם" given-name prefix the geocode query used), so
// this real record's point was silently dropped from the map. Fixed by
// falling back to the geocoder's own already-verified canonical street name
// (never a fuzzy/invented match) when the raw substring check fails.
describe("deriveSpecialTypologyContextPoints (P0 fix -- address-prefix mismatch)", () => {
  function workspaceWith(records: Partial<Record<string, unknown>>[]) {
    return {
      special_unit_market_context: { units: { "36": { first_researcher_context: records } } },
      market_map_geocodes: {
        special_typology_context: {
          resolved: [
            {
              record_id: "special_typology_context:מנחם אוסישקין 22",
              address: "מנחם אוסישקין 22",
              lat: 32.0901831,
              lng: 34.8892991,
              coordinate_source: "geocoded_address",
              precision: "street",
              resolved_label: "אוסישקין, נווה מעוז, לב המושבה, פתח תקווה, נפת פתח תקווה, מחוז המרכז, 4926040, ישראל",
              verified: true,
            },
          ],
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("matches a record whose own address drops the geocoded street's given-name prefix", () => {
    const workspace = workspaceWith([
      {
        context_type: "triplex_context",
        normalized: { address: "אוסישקין 22, פתח תקווה", rooms: 6, advertised_area_m2: 150, asking_price_ils: 2300000 },
      },
    ]);
    const points = deriveSpecialTypologyContextPoints(workspace, 36);
    expect(points).toHaveLength(1);
    expect(points[0].address).toBe("מנחם אוסישקין 22");
    expect(points[0].rooms).toBe(6);
    expect(points[0].internalArea).toBe(150);
    expect(points[0].priceIls).toBe(2300000);
  });

  it("still matches the exact/full-substring case directly, unchanged", () => {
    const workspace = workspaceWith([{ context_type: "triplex_context", normalized: { address: "מנחם אוסישקין 22, פתח תקווה" } }]);
    expect(deriveSpecialTypologyContextPoints(workspace, 36)).toHaveLength(1);
  });

  it("never matches a genuinely different street, even one sharing the house number", () => {
    const workspace = workspaceWith([{ context_type: "triplex_context", normalized: { address: "מונטיפיורי 22, פתח תקווה" } }]);
    expect(deriveSpecialTypologyContextPoints(workspace, 36)).toHaveLength(0);
  });

  it("never falls back for an address-precision geocode (house number leads resolved_label there, not the street) -- no invented match", () => {
    const workspace = {
      special_unit_market_context: {
        units: { "36": { first_researcher_context: [{ context_type: "triplex_context", normalized: { address: "רופין 8, פתח תקווה" } }] } },
      },
      market_map_geocodes: {
        special_typology_context: {
          resolved: [
            {
              record_id: "x",
              address: "ארתור רופין 8",
              lat: 32.09,
              lng: 34.87,
              coordinate_source: "geocoded_address",
              precision: "address",
              resolved_label: "8, ארתור רופין, נווה מעוז, פתח תקווה, ישראל",
              verified: true,
            },
          ],
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    expect(deriveSpecialTypologyContextPoints(workspace, 36)).toHaveLength(0);
  });
});
