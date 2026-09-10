import json
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime
from statistics import median

ROOT = Path.cwd()
SOURCE = ROOT.parent / "gov_source_tests" / "data_source_test"

FILES = {
    "3R": SOURCE / "madlan_petah_tikva_3r_screen.json",
    "5R": SOURCE / "madlan_petah_tikva_5r_screen.json",
}

TARGETS = {
    "3R": {
        "rooms": 3.0,
        "min_area": 58.65,
        "max_area": 79.35,
    },
    "5R": {
        "rooms": 5.0,
        "min_area": 94.435,
        "max_area": 127.765,
    },
}

# המרכז השקט
TARGET_NEIGHBORHOOD = (
    "\u05d4\u05de\u05e8\u05db\u05d6 "
    "\u05d4\u05e9\u05e7\u05d8"
)

OUT = (
    ROOT
    / "data"
    / "frozen"
    / "petah_tikva_standard_asking_evidence_v1.json"
)


def load(path):
    data = json.loads(path.read_text(encoding="utf-8"))

    if not isinstance(data, list):
        raise RuntimeError(
            f"Expected list source: {path}"
        )

    return data


def num(v):
    try:
        if v in (None, ""):
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def text(v):
    if v in (None, ""):
        return None
    return " ".join(str(v).split())


def percentile(values, p):
    vals = sorted(values)

    if not vals:
        return None

    if len(vals) == 1:
        return vals[0]

    pos = (len(vals) - 1) * p
    lo = int(pos)
    hi = min(lo + 1, len(vals) - 1)
    frac = pos - lo

    return (
        vals[lo] * (1 - frac)
        + vals[hi] * frac
    )


def normalize(raw):
    price = num(raw.get("price"))
    area = num(raw.get("areaSqm"))
    ppsm = num(raw.get("pricePerSqm"))

    if (
        ppsm is None
        and price is not None
        and area
    ):
        ppsm = price / area

    return {
        "listing_id": text(raw.get("id")),
        "url": raw.get("url"),
        "deal_type": text(raw.get("dealType")),
        "property_type": text(
            raw.get("propertyType")
        ),
        "city": text(raw.get("cityHebrew")),
        "neighborhood": text(
            raw.get("neighbourhood")
        ),
        "address": text(raw.get("address")),
        "street_name": text(
            raw.get("streetName")
        ),
        "street_number": text(
            raw.get("streetNumber")
        ),
        "rooms": num(raw.get("rooms")),
        "area": area,
        "asking_price": price,
        "asking_ppsm": ppsm,
        "floor": raw.get("floor"),
        "total_floors": raw.get(
            "totalFloors"
        ),
        "parking": raw.get("parking"),
        "has_balcony": raw.get(
            "hasBalcony"
        ),
        "has_elevator": raw.get(
            "hasElevator"
        ),
        "has_secure_room": raw.get(
            "hasSecureRoom"
        ),
        "condition": raw.get("condition"),
        "latitude": num(
            raw.get("latitude")
        ),
        "longitude": num(
            raw.get("longitude")
        ),
        "contact_type": raw.get(
            "contactType"
        ),
        "has_agent": raw.get("hasAgent"),
        "first_seen": raw.get(
            "firstSeen"
        ),
        "scraped_at": raw.get(
            "scrapedAt"
        ),
    }


def independent_key(r):
    if r["address"]:
        return "address:" + r["address"]

    if (
        r["latitude"] is not None
        and r["longitude"] is not None
    ):
        return (
            "coords:"
            f"{r['latitude']:.5f},"
            f"{r['longitude']:.5f}"
        )

    if r["listing_id"]:
        return "listing:" + r["listing_id"]

    return "unresolved"


def classify(r, family):
    t = TARGETS[family]
    reasons = []

    if r["deal_type"] != "buy":
        reasons.append("not_for_sale")

    if r["property_type"] != "flat":
        reasons.append(
            "not_standard_flat"
        )

    if r["rooms"] != t["rooms"]:
        reasons.append(
            "room_count_mismatch"
        )

    if r["area"] is None:
        reasons.append("missing_area")
    elif not (
        t["min_area"]
        <= r["area"]
        <= t["max_area"]
    ):
        reasons.append(
            "outside_target_area_band"
        )

    if (
        r["asking_price"] is None
        or r["asking_price"] <= 0
    ):
        reasons.append(
            "missing_or_invalid_price"
        )

    if (
        r["neighborhood"]
        != TARGET_NEIGHBORHOOD
    ):
        reasons.append(
            "outside_target_commercial_area"
        )

    return reasons


def build_family(family):
    raw_rows = load(FILES[family])

    normalized = [
        normalize(r)
        for r in raw_rows
    ]

    # Source should normally have unique listing IDs.
    # If the same ID appears twice, retain the latest
    # occurrence only for quantitative counting.
    by_id = {}
    no_id = []

    for r in normalized:
        if r["listing_id"]:
            by_id[r["listing_id"]] = r
        else:
            no_id.append(r)

    unique_rows = (
        list(by_id.values()) + no_id
    )

    accepted = []
    rejected = []

    funnel = Counter()

    t = TARGETS[family]

    for r in unique_rows:
        funnel["source_rows"] += 1

        if r["deal_type"] == "buy":
            funnel["buy"] += 1

        if (
            r["deal_type"] == "buy"
            and r["property_type"] == "flat"
        ):
            funnel[
                "buy_standard_flat"
            ] += 1

        if (
            r["deal_type"] == "buy"
            and r["property_type"] == "flat"
            and r["rooms"] == t["rooms"]
        ):
            funnel[
                "exact_rooms"
            ] += 1

        if (
            r["deal_type"] == "buy"
            and r["property_type"] == "flat"
            and r["rooms"] == t["rooms"]
            and r["area"] is not None
            and (
                t["min_area"]
                <= r["area"]
                <= t["max_area"]
            )
        ):
            funnel[
                "target_area"
            ] += 1

            if (
                r["neighborhood"]
                == TARGET_NEIGHBORHOOD
            ):
                funnel[
                    "target_area_target_neighborhood"
                ] += 1

        reasons = classify(r, family)

        rr = dict(r)
        rr["independent_group"] = (
            independent_key(r)
        )

        if reasons:
            rr["evidence_status"] = (
                "REJECTED_QUANTITATIVE"
            )
            rr["exclusion_reasons"] = (
                reasons
            )
            rejected.append(rr)
        else:
            rr["evidence_status"] = (
                "PRIMARY_QUANTITATIVE"
            )
            rr["exclusion_reasons"] = []
            accepted.append(rr)

    groups = defaultdict(list)

    for r in accepted:
        groups[
            r["independent_group"]
        ].append(r)

    group_output = []

    for key, rows in groups.items():
        ppsm = [
            r["asking_ppsm"]
            for r in rows
            if r["asking_ppsm"] is not None
        ]

        prices = [
            r["asking_price"]
            for r in rows
            if r["asking_price"] is not None
        ]

        group_output.append({
            "group_key": key,
            "listing_count": len(rows),
            "median_asking_ppsm": (
                median(ppsm)
                if ppsm else None
            ),
            "median_asking_price": (
                median(prices)
                if prices else None
            ),
            "listing_ids": [
                r["listing_id"]
                for r in rows
            ],
            "addresses": sorted({
                r["address"]
                for r in rows
                if r["address"]
            }),
        })

    listing_ppsm = sorted(
        r["asking_ppsm"]
        for r in accepted
        if r["asking_ppsm"] is not None
    )

    listing_prices = sorted(
        r["asking_price"]
        for r in accepted
        if r["asking_price"] is not None
    )

    group_ppsm = sorted(
        g["median_asking_ppsm"]
        for g in group_output
        if (
            g["median_asking_ppsm"]
            is not None
        )
    )

    group_prices = sorted(
        g["median_asking_price"]
        for g in group_output
        if (
            g["median_asking_price"]
            is not None
        )
    )

    rejection_counts = Counter()

    for r in rejected:
        for reason in r[
            "exclusion_reasons"
        ]:
            rejection_counts[reason] += 1

    return {
        "family": family,
        "target": {
            **t,
            "commercial_neighborhood":
                TARGET_NEIGHBORHOOD,
        },
        "source_file": str(
            FILES[family]
        ),
        "source_row_count": len(raw_rows),
        "unique_listing_count": len(
            unique_rows
        ),
        "duplicate_listing_id_count": (
            len(raw_rows)
            - len(unique_rows)
        ),
        "funnel": dict(funnel),
        "accepted_listing_count": len(
            accepted
        ),
        "independent_location_count": len(
            groups
        ),
        "rejected_listing_count": len(
            rejected
        ),
        "rejection_reason_counts": dict(
            rejection_counts
        ),
        "listing_distribution": {
            "asking_price_q1":
                percentile(
                    listing_prices, 0.25
                ),
            "asking_price_median":
                (
                    median(listing_prices)
                    if listing_prices
                    else None
                ),
            "asking_price_q3":
                percentile(
                    listing_prices, 0.75
                ),
            "asking_ppsm_q1":
                percentile(
                    listing_ppsm, 0.25
                ),
            "asking_ppsm_median":
                (
                    median(listing_ppsm)
                    if listing_ppsm
                    else None
                ),
            "asking_ppsm_q3":
                percentile(
                    listing_ppsm, 0.75
                ),
        },
        "independent_group_distribution": {
            "asking_price_q1":
                percentile(
                    group_prices, 0.25
                ),
            "asking_price_median":
                (
                    median(group_prices)
                    if group_prices
                    else None
                ),
            "asking_price_q3":
                percentile(
                    group_prices, 0.75
                ),
            "asking_ppsm_q1":
                percentile(
                    group_ppsm, 0.25
                ),
            "asking_ppsm_median":
                (
                    median(group_ppsm)
                    if group_ppsm
                    else None
                ),
            "asking_ppsm_q3":
                percentile(
                    group_ppsm, 0.75
                ),
        },
        "accepted_listings": sorted(
            accepted,
            key=lambda x: (
                x["address"] or "",
                x["listing_id"] or "",
            ),
        ),
        "independent_groups": sorted(
            group_output,
            key=lambda x: (
                -x["listing_count"],
                x["group_key"],
            ),
        ),
        "rejected_listings": rejected,
    }


payload = {
    "version":
        "petah_tikva_standard_asking_evidence_v1",
    "frozen_at": datetime.now().isoformat(),
    "evidence_lane": "current_asking",
    "demo_location": {
        "address":
            "\u05d7\u05e4\u05e5 "
            "\u05d7\u05d9\u05d9\u05dd 25",
        "city":
            "\u05e4\u05ea\u05d7 "
            "\u05ea\u05e7\u05d5\u05d5\u05d4",
        "commercial_area":
            "\u05d4\u05de\u05e8\u05db\u05d6 "
            "\u05d4\u05e9\u05e7\u05d8 / "
            "\u05de\u05e8\u05db\u05d6 "
            "\u05d4\u05e2\u05d9\u05e8",
        "is_assumption": True,
    },
    "methodology": {
        "market_evidence_only": True,
        "strategy_applied": False,
        "one_location_one_independent_contribution":
            True,
        "note": (
            "Asking prices are seller asks, not "
            "completed transaction prices."
        ),
    },
    "families": {
        "3R": build_family("3R"),
        "5R": build_family("5R"),
    },
}

OUT.parent.mkdir(
    parents=True,
    exist_ok=True,
)

OUT.write_text(
    json.dumps(
        payload,
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)

for family in ("3R", "5R"):
    f = payload["families"][family]

    print()
    print("=" * 80)
    print(family)
    print("=" * 80)
    print("SOURCE:", f["source_row_count"])
    print(
        "UNIQUE LISTINGS:",
        f["unique_listing_count"]
    )
    print("FUNNEL:", f["funnel"])
    print(
        "ACCEPTED TARGET LISTINGS:",
        f["accepted_listing_count"]
    )
    print(
        "INDEPENDENT LOCATIONS:",
        f["independent_location_count"]
    )
    print(
        "LISTING DISTRIBUTION:",
        f["listing_distribution"]
    )
    print(
        "GROUP DISTRIBUTION:",
        f[
            "independent_group_distribution"
        ]
    )

print()
print("FROZEN:")
print(OUT)
