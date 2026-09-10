import json
from pathlib import Path
from datetime import datetime
from statistics import median

ROOT = Path.cwd()

OUT = (
    ROOT
    / "data"
    / "frozen"
    / "petah_tikva_standard_competitor_evidence_v1.json"
)

# Local-file-only Yad2 (accessed via RapidAPI "yad21" -- an access method, not a
# separate source) 3-room new-development probe, already deduplicated by
# token/orderId and grouped into independent projects by
# inspect_yad2_deep_output / the probe script itself. Read verbatim; no live
# RapidAPI call is made here.
YAD2_3R_SUMMARY = (
    ROOT.parent
    / "gov_source_tests"
    / "data_source_test"
    / "yad2_standard_probe"
    / "petah_tikva_3r_exact_target_newdev_summary.json"
)

CHECKED_AT = "2026-09-06"
TARGET_NEIGHBORHOOD = "המרכז השקט / מרכז העיר"


def calc_ppsm(price, area):
    if not price or not area:
        return None
    return round(price / area, 2)


def _load_yad2_3r_records():
    """One record per individual Yad2 ad (not one per project): the market-range
    engine itself groups records that share ``project_name`` into a single
    independent contribution (see pricing_core.market_range._new_development_lane
    / _group_candidates) and takes the median price-per-sqm across them -- so
    letting it group these, rather than pre-averaging here, is the unmodified,
    already-existing "one project = one independent contribution" methodology
    doing the work, not a new rule.

    Every ad in the summary file already has neighborhood == TARGET_NEIGHBORHOOD
    (it is the "exact_target_newdev_summary" probe output), so every record here
    is geo_tier 1. Kept as separate project entries from the pre-existing
    developer-sourced "zeev_branda_22" competitor row (same street, but Yad2
    supplies no house number, so identity with that record is plausible, not
    proven) -- harmless either way, since that developer row has no exact area
    and therefore never enters the quantitative comparable pool regardless.
    """

    data = json.loads(YAD2_3R_SUMMARY.read_text(encoding="utf-8"))
    assert data["target"]["neighborhood"] == TARGET_NEIGHBORHOOD

    records = []
    for project in data["projects"]:
        # project_key e.g. "זאב ברנדה||32.0803,34.8854"
        # or "הרב ניימן|8|32.0840,34.8791"
        street = project["records"][0]["street"]
        house = project["records"][0]["house"]
        project_label = f"{street} {house}" if house else street

        for rec in project["records"]:
            assert rec["neighborhood"] == TARGET_NEIGHBORHOOD
            area = rec["sqm"]
            price = rec["price"]
            records.append({
                "family": "3R",
                "project_id": f"yad2_{rec['token']}",
                "project_name": project_label,
                "developer": None,
                "address": f"{street}, פתח תקווה",
                "commercial_area": TARGET_NEIGHBORHOOD,
                "geo_tier": 1,
                "rooms": rec["rooms"],
                "unit_type": "standard_flat",
                "area_sqm": area,
                "area_min_sqm": None,
                "area_max_sqm": None,
                "price_ils": price,
                "price_type": "live_listing_price",
                "ppsm": calc_ppsm(price, area),
                "floor": rec.get("floor"),
                "parking": None,
                "storage": None,
                "evidence_status": "PRIMARY_QUANTITATIVE",
                "warnings": (
                    []
                    if house
                    else [
                        "yad2_listing_house_number_not_published; identity with the existing "
                        "'zeev_branda_22' developer-sourced competitor record (same street) is "
                        "plausible but NOT confirmed -- kept as a separate project entry rather than "
                        "silently merged"
                    ]
                ),
                "sources": [
                    {
                        "source": "Yad2",
                        "access_method": "RapidAPI (yad21)",
                        "url": f"https://www.yad2.co.il/item/{rec['token']}",
                        "yad2_token": rec["token"],
                        "yad2_order_id": rec["orderId"],
                        "supports": [
                            "address",
                            "neighborhood",
                            "rooms",
                            "area",
                            "floor",
                            "price",
                            "coordinates",
                        ],
                        "checked_at": CHECKED_AT,
                    }
                ],
                # Field-level provenance (per-field source + retrieval time) so a value's
                # origin is visible without opening the raw sources array. Disagreements
                # are recorded as warnings above, never silently reconciled.
                "field_provenance": {
                    "price": {"value": price, "source": "Yad2", "retrieved_at": CHECKED_AT},
                    "area": {"value": area, "source": "Yad2", "retrieved_at": CHECKED_AT},
                    "project_identity": {
                        "value": project_label,
                        "source": (
                            "Yad2 (street name only; no house number published in this listing)"
                            if not house else "Yad2"
                        ),
                        "developer_verification": "not available",
                    },
                    "location": {
                        "value": {
                            "lat": rec["lat"], "lon": rec["lon"], "neighborhood": TARGET_NEIGHBORHOOD,
                        },
                        "source": "Yad2",
                    },
                },
            })
    return records


records = [

    # =========================================================
    # 3 ROOM
    # =========================================================

    {
        "family": "3R",
        "project_id": "zeev_branda_22",
        "project_name": "\u05d6\u05d0\u05d1 \u05d1\u05e8\u05e0\u05d3\u05d4 22",
        "developer": "\u05e8\u05db\u05e1\u05d9\u05dd \u05d1\u05e0\u05d9\u05d4 \u05d5\u05d9\u05d6\u05de\u05d5\u05ea",
        "address": "\u05d6\u05d0\u05d1 \u05d1\u05e8\u05e0\u05d3\u05d4 22, \u05e4\u05ea\u05d7 \u05ea\u05e7\u05d5\u05d5\u05d4",
        "commercial_area": "\u05d4\u05de\u05e8\u05db\u05d6 \u05d4\u05e9\u05e7\u05d8 / \u05de\u05e8\u05db\u05d6 \u05d4\u05e2\u05d9\u05e8",
        "geo_tier": 1,
        "rooms": 3,
        "unit_type": "standard_flat",
        "area_sqm": None,
        "area_min_sqm": 67,
        "area_max_sqm": 77,
        "price_ils": 2058000,
        "price_type": "starting_price",
        "ppsm": None,
        "floor": None,
        "parking": None,
        "storage": None,
        "evidence_status": "PRIMARY_QUANTITATIVE",
        "warnings": [
            "starting_price_is_room_specific_but_not_tied_to_one_exact_area_variant"
        ],
        "sources": [
            {
                "source": "developer",
                "url": "https://www.rehasimbuild.co.il/project/%D7%96%D7%90%D7%91-%D7%91%D7%A8%D7%A0%D7%93%D7%94-22/",
                "supports": [
                    "developer",
                    "rooms",
                    "area_range",
                    "price"
                ],
                "checked_at": CHECKED_AT
            }
        ]
    },

    {
        "family": "3R",
        "project_id": "the_spot",
        "project_name": "THE SPOT",
        "developer": "\u05e9\u05d9\u05d0 \u05e2\u05d9\u05e0\u05d1",
        "address": "\u05d9\u05d4\u05d5\u05e9\u05e2 \u05e9\u05d8\u05de\u05e4\u05e4\u05e8 83-87, \u05e4\u05ea\u05d7 \u05ea\u05e7\u05d5\u05d5\u05d4",
        "commercial_area": "\u05e9\u05d9\u05e4\u05e8",
        "geo_tier": 2,
        "rooms": 3,
        "unit_type": "standard_flat",
        "area_sqm": 70,
        "area_min_sqm": None,
        "area_max_sqm": None,
        "price_ils": 2250000,
        "price_type": "starting_price",
        "ppsm": calc_ppsm(2250000, 70),
        "floor": 1,
        "parking": None,
        "storage": None,
        "evidence_status": "PRIMARY_QUANTITATIVE_WITH_GEO_WARNING",
        "warnings": [
            "adjacent_submarket_shifer"
        ],
        "sources": [
            {
                "source": "Yad2",
                "url": "https://www.yad2.co.il/yad1/project/19459",
                "supports": [
                    "developer",
                    "address",
                    "rooms",
                    "area",
                    "floor",
                    "price"
                ],
                "checked_at": CHECKED_AT
            }
        ]
    },

    {
        "family": "3R",
        "project_id": "defour",
        "project_name": "DeFour",
        "developer": "\u05d1\u05d5\u05e0\u05d9 \u05d4\u05ea\u05d9\u05db\u05d5\u05df",
        "address": "\u05d1\u05e8\u05e0\u05d3\u05d4 \u05e4\u05d9\u05e0\u05ea \u05d1\u05dc\u05e4\u05d5\u05e8, \u05e4\u05ea\u05d7 \u05ea\u05e7\u05d5\u05d5\u05d4",
        "commercial_area": "\u05d4\u05de\u05e8\u05db\u05d6 \u05d4\u05e9\u05e7\u05d8 / \u05de\u05e8\u05db\u05d6 \u05d4\u05e2\u05d9\u05e8",
        "geo_tier": 1,
        "rooms": 3,
        "unit_type": "standard_flat",
        "area_sqm": None,
        "area_min_sqm": None,
        "area_max_sqm": None,
        "price_ils": 2200000,
        "price_type": "starting_price",
        "ppsm": None,
        "floor": None,
        "parking": None,
        "storage": None,
        "evidence_status": "CONTEXT_ONLY",
        "warnings": [
            "current_room_price_available_but_reliable_unit_area_not_published"
        ],
        "sources": [
            {
                "source": "Yad2",
                "url": "https://www.yad2.co.il/yad1/project/16523",
                "supports": [
                    "developer",
                    "location",
                    "rooms",
                    "price"
                ],
                "checked_at": CHECKED_AT
            }
        ]
    },

    {
        "family": "3R",
        "project_id": "hankin_11",
        "project_name": "\u05d7\u05e0\u05e7\u05d9\u05df 11",
        "developer": "\u05d0\u05d5\u05e8\u05d1\u05e0\u05d5\u05dc\u05d5\u05d2\u05d9\u05d4",
        "address": "\u05d9\u05d4\u05d5\u05e9\u05e2 \u05d7\u05e0\u05e7\u05d9\u05df 11, \u05e4\u05ea\u05d7 \u05ea\u05e7\u05d5\u05d5\u05d4",
        "commercial_area": "\u05db\u05e4\u05e8 \u05d0\u05d1\u05e8\u05d4\u05dd",
        "geo_tier": 2,
        "rooms": 3,
        "unit_type": "standard_flat",
        "area_sqm": 80,
        "area_min_sqm": None,
        "area_max_sqm": None,
        "price_ils": 2250000,
        "price_type": "starting_price",
        "ppsm": calc_ppsm(2250000, 80),
        "floor": "6-8",
        "parking": True,
        "storage": True,
        "evidence_status": "CONTEXT_ONLY",
        "warnings": [
            "outside_fixed_3R_target_area_band_58.65_79.35",
            "adjacent_submarket"
        ],
        "sources": [
            {
                "source": "Yad2",
                "url": "https://www.yad2.co.il/yad1/project/14561",
                "supports": [
                    "rooms",
                    "area",
                    "floor",
                    "price",
                    "parking",
                    "storage"
                ],
                "checked_at": CHECKED_AT
            }
        ]
    },

] + _load_yad2_3r_records() + [

    # =========================================================
    # 5 ROOM
    # =========================================================

    {
        "family": "5R",
        "project_id": "zeev_branda_22",
        "project_name": "\u05d6\u05d0\u05d1 \u05d1\u05e8\u05e0\u05d3\u05d4 22",
        "developer": "\u05e8\u05db\u05e1\u05d9\u05dd \u05d1\u05e0\u05d9\u05d4 \u05d5\u05d9\u05d6\u05de\u05d5\u05ea",
        "address": "\u05d6\u05d0\u05d1 \u05d1\u05e8\u05e0\u05d3\u05d4 22, \u05e4\u05ea\u05d7 \u05ea\u05e7\u05d5\u05d5\u05d4",
        "commercial_area": "\u05d4\u05de\u05e8\u05db\u05d6 \u05d4\u05e9\u05e7\u05d8 / \u05de\u05e8\u05db\u05d6 \u05d4\u05e2\u05d9\u05e8",
        "geo_tier": 1,
        "rooms": 5,
        "unit_type": "standard_flat",
        "area_sqm": 122,
        "area_min_sqm": None,
        "area_max_sqm": None,
        "price_ils": 3180000,
        "price_type": "starting_price",
        "ppsm": calc_ppsm(3180000, 122),
        "floor": 7,
        "parking": None,
        "storage": None,
        "evidence_status": "PRIMARY_QUANTITATIVE",
        "warnings": [],
        "sources": [
            {
                "source": "developer",
                "url": "https://www.rehasimbuild.co.il/project/%D7%96%D7%90%D7%91-%D7%91%D7%A8%D7%A0%D7%93%D7%94-22/",
                "supports": [
                    "developer",
                    "rooms",
                    "area",
                    "floor",
                    "price"
                ],
                "checked_at": CHECKED_AT
            }
        ]
    },

    {
        "family": "5R",
        "project_id": "rothschild_163_165",
        "project_name": "\u05e8\u05d5\u05d8\u05e9\u05d9\u05dc\u05d3 163-165",
        "developer": "\u05d9\u05d5\u05e1\u05d9 \u05e7\u05d8\u05e9 \u05d1\u05e0\u05d9\u05d4 \u05d5\u05d9\u05d6\u05de\u05d5\u05ea",
        "address": "\u05e8\u05d5\u05d8\u05e9\u05d9\u05dc\u05d3 163-165, \u05e4\u05ea\u05d7 \u05ea\u05e7\u05d5\u05d5\u05d4",
        "commercial_area": "\u05d4\u05de\u05e8\u05db\u05d6 \u05d4\u05e9\u05e7\u05d8 / \u05de\u05e8\u05db\u05d6 \u05d4\u05e2\u05d9\u05e8",
        "geo_tier": 1,
        "rooms": 5,
        "unit_type": "standard_flat",
        "area_sqm": 112,
        "area_min_sqm": None,
        "area_max_sqm": None,
        "balcony_sqm": 12,
        "price_ils": 2590000,
        "price_type": "starting_price",
        "ppsm": calc_ppsm(2590000, 112),
        "floor": None,
        "parking": 1,
        "storage": None,
        "payment_terms": "20% signing / 80% occupancy",
        "evidence_status": "PRIMARY_QUANTITATIVE_WITH_SOURCE_JOIN",
        "warnings": [
            "current_5R_price_is_room_level_price",
            "112sqm_area_is_developer_floorplan",
            "price_not_explicitly_tied_to_one_specific_112sqm_variant"
        ],
        "sources": [
            {
                "source": "Diraly",
                "url": "https://www.diraly.co.il/projects/%D7%A8%D7%95%D7%98%D7%A9%D7%99%D7%9C%D7%93-163-165-%D7%A4%D7%AA%D7%97-%D7%AA%D7%A7%D7%95%D7%95%D7%94",
                "supports": [
                    "current_5R_price",
                    "location",
                    "developer"
                ],
                "price_synced": "2026-09-02",
                "checked_at": CHECKED_AT
            },
            {
                "source": "developer",
                "url": "https://katash.co.il/%D7%A8%D7%95%D7%98%D7%A9%D7%99%D7%9C%D7%93-163-%D7%A4%D7%AA%D7%97-%D7%AA%D7%A7%D7%95%D7%95%D7%94/",
                "supports": [
                    "5R_floorplan",
                    "112sqm_area",
                    "12sqm_balcony",
                    "parking"
                ],
                "checked_at": CHECKED_AT
            }
        ],
        # Field-level provenance combining the two already-saved sources above --
        # no new collection. Preserved as-is: price and area come from different
        # documents and the developer's own floorplan warning (see "warnings")
        # means the price-to-112sqm linkage is asserted, not independently proven.
        "field_provenance": {
            "price": {"value": 2590000, "source": "Diraly", "retrieved_at": "2026-09-02"},
            "area": {"value": 112, "source": "developer (katash.co.il)", "retrieved_at": CHECKED_AT},
            "project_identity": {
                "value": "\u05e8\u05d5\u05d8\u05e9\u05d9\u05dc\u05d3 163-165",
                "source": "developer + Diraly (agree)",
                "developer_verification": "available (katash.co.il)",
            },
            "location": {
                "value": "\u05e8\u05d5\u05d8\u05e9\u05d9\u05dc\u05d3 163-165, \u05e4\u05ea\u05d7 \u05ea\u05e7\u05d5\u05d5\u05d4",
                "source": "Diraly + developer",
            },
            "disagreement_notes": [
                "price is a room-level current price synced via Diraly; area is the developer's own "
                "112sqm floorplan document. The two are not independently proven to describe the same "
                "unit variant (see existing warning price_not_explicitly_tied_to_one_specific_112sqm_variant)."
            ],
        },
    },

    {
        "family": "5R",
        "project_id": "hankin_11",
        "project_name": "\u05d7\u05e0\u05e7\u05d9\u05df 11",
        "developer": "\u05d0\u05d5\u05e8\u05d1\u05e0\u05d5\u05dc\u05d5\u05d2\u05d9\u05d4",
        "address": "\u05d9\u05d4\u05d5\u05e9\u05e2 \u05d7\u05e0\u05e7\u05d9\u05df 11, \u05e4\u05ea\u05d7 \u05ea\u05e7\u05d5\u05d5\u05d4",
        "commercial_area": "\u05db\u05e4\u05e8 \u05d0\u05d1\u05e8\u05d4\u05dd",
        "geo_tier": 2,
        "rooms": 5,
        "unit_type": "standard_flat",
        "area_sqm": 118,
        "area_min_sqm": None,
        "area_max_sqm": None,
        "price_ils": 2900000,
        "price_type": "starting_price",
        "ppsm": calc_ppsm(2900000, 118),
        "floor": "6-8",
        "parking": True,
        "storage": True,
        "payment_terms": "7% at contract; remainder in installments",
        "evidence_status": "PRIMARY_QUANTITATIVE_WITH_GEO_WARNING",
        "warnings": [
            "adjacent_submarket_kfar_avraham"
        ],
        "sources": [
            {
                "source": "Yad2",
                "url": "https://www.yad2.co.il/yad1/project/14561",
                "supports": [
                    "rooms",
                    "area",
                    "floor",
                    "price",
                    "parking",
                    "storage"
                ],
                "checked_at": CHECKED_AT
            },
            {
                "source": "Diraly",
                "url": "https://www.diraly.co.il/projects/%D7%97%D7%A0%D7%A7%D7%99%D7%9F-11-%D7%A4%D7%AA%D7%97-%D7%AA%D7%A7%D7%95%D7%95%D7%94",
                "supports": [
                    "current_price_confirmation",
                    "payment_terms",
                    "developer"
                ],
                "price_synced": "2026-09-02",
                "checked_at": CHECKED_AT
            }
        ]
    }
]


def family_summary(family):
    rows = [
        r for r in records
        if r["family"] == family
    ]

    quantitative = [
        r for r in rows
        if r["evidence_status"].startswith(
            "PRIMARY_QUANTITATIVE"
        )
    ]

    tier1 = [
        r for r in quantitative
        if r["geo_tier"] == 1
    ]

    tier2 = [
        r for r in quantitative
        if r["geo_tier"] == 2
    ]

    context = [
        r for r in rows
        if r["evidence_status"] == "CONTEXT_ONLY"
    ]

    prices = [
        r["price_ils"]
        for r in quantitative
        if r["price_ils"] is not None
    ]

    ppsm = [
        r["ppsm"]
        for r in quantitative
        if r["ppsm"] is not None
    ]

    if family == "3R":
        gate = "PASS_WITH_GEO_WARNING"
    else:
        gate = "PASS"

    # Independent-project identity here matches the actual pricing engine's own
    # grouping key (pricing_core.market_range._new_development_lane groups
    # candidates by project_name, not project_id -- see
    # comparables.competitor_candidates' source_id=project_id vs
    # neighborhood/project_name usage). Two Yad2 ads for the same building carry
    # distinct project_id (per-ad identifiers, for traceability/dedup) but the
    # same project_name, and must count as one independent project here too.
    return {
        "gate_status": gate,
        "project_records": len(rows),
        "quantitative_independent_projects":
            len({
                r["project_name"]
                for r in quantitative
            }),
        "tier1_quantitative_projects":
            len({
                r["project_name"]
                for r in tier1
            }),
        "tier2_quantitative_projects":
            len({
                r["project_name"]
                for r in tier2
            }),
        "context_only_projects":
            len({
                r["project_name"]
                for r in context
            }),
        "quantitative_starting_price_min":
            min(prices) if prices else None,
        "quantitative_starting_price_median":
            median(prices) if prices else None,
        "quantitative_starting_price_max":
            max(prices) if prices else None,
        "quantitative_ppsm_min":
            min(ppsm) if ppsm else None,
        "quantitative_ppsm_median":
            median(ppsm) if ppsm else None,
        "quantitative_ppsm_max":
            max(ppsm) if ppsm else None,
    }


payload = {
    "version":
        "petah_tikva_standard_competitor_evidence_v1",
    "frozen_at": datetime.now().isoformat(),
    "checked_at": CHECKED_AT,
    "evidence_lane":
        "current_new_development_competitors",
    "demo_location": {
        "address":
            "\u05d7\u05e4\u05e5 \u05d7\u05d9\u05d9\u05dd 25",
        "city":
            "\u05e4\u05ea\u05d7 \u05ea\u05e7\u05d5\u05d5\u05d4",
        "commercial_area":
            "\u05d4\u05de\u05e8\u05db\u05d6 "
            "\u05d4\u05e9\u05e7\u05d8 / "
            "\u05de\u05e8\u05db\u05d6 "
            "\u05d4\u05e2\u05d9\u05e8",
        "is_assumption": True
    },
    "methodology": {
        "one_project_one_independent_contribution":
            True,
        "tier1":
            "target commercial submarket",
        "tier2":
            "adjacent competitive submarket with warning",
        "context_only":
            "visible to user but excluded from quantitative competitor range",
        "missing_area_not_inferred":
            True,
        "fixed_subject_area_bands_not_widened":
            True
    },
    "summary": {
        "3R": family_summary("3R"),
        "5R": family_summary("5R")
    },
    "records": records
}

OUT.parent.mkdir(
    parents=True,
    exist_ok=True
)

OUT.write_text(
    json.dumps(
        payload,
        ensure_ascii=False,
        indent=2
    ),
    encoding="utf-8"
)

for family in ("3R", "5R"):
    s = payload["summary"][family]

    print()
    print("=" * 80)
    print(family)
    print("=" * 80)

    for k, v in s.items():
        print(k + ":", v)

print()
print("FROZEN:")
print(OUT)
