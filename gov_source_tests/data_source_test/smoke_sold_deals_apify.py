import os
import json
import math
import statistics
from collections import defaultdict
from datetime import datetime, timezone

from dotenv import load_dotenv
from apify_client import ApifyClient


load_dotenv(override=True)

client = ApifyClient(os.environ["APIFY_TOKEN"])


# ---------------------------------------------------------
# TEST CONFIGURATION
# ---------------------------------------------------------

CITY = "אשקלון"

# Our first ordinary apartment to test.
TARGET = {
    "rooms": 3,
    "area": 69,
    "floor": 1,
}

run_input = {
    "cities": [CITY],

    # Last 5 years.
    "dealDateRange": "60",

    # Relevant ordinary inventory.
    "rooms": "3,4,5",

    # Enough data to test matching + cleaning.
    "maxItems": 500,
}


print("=" * 70)
print("AUTOMATED SOLD TRANSACTIONS TEST")
print("=" * 70)
print(json.dumps(
    run_input,
    ensure_ascii=False,
    indent=2,
))


# ---------------------------------------------------------
# FETCH
# ---------------------------------------------------------

run = client.actor(
    "swerve/nadlan-deals"
).call(
    run_input=run_input,
    logger=None,
)

print("\nRun status:", run.status)
print("Dataset:", run.default_dataset_id)

items = list(
    client.dataset(
        run.default_dataset_id
    ).iterate_items()
)

print("\nRaw transactions:", len(items))


# ---------------------------------------------------------
# HELPERS
# ---------------------------------------------------------

def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def parse_floor(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def log_ppsqm(item):
    value = item.get("pricePerSqm")

    if not numeric(value) or value <= 0:
        return None

    return math.log(value)


# ---------------------------------------------------------
# AUTOMATIC COORDINATE CHECK
# ---------------------------------------------------------

for item in items:
    lat = item.get("lat")
    lng = item.get("lng")

    item["_coordinateFix"] = None

    if not numeric(lat) or not numeric(lng):
        continue

    # Looks correctly like Israel.
    if 29 <= lat <= 34 and 34 <= lng <= 36:
        continue

    # Looks reversed.
    if 34 <= lat <= 36 and 29 <= lng <= 34:
        item["lat"], item["lng"] = lng, lat
        item["_coordinateFix"] = "lat_lng_swapped"


# ---------------------------------------------------------
# SAME UNIT + SAME DATE CLUSTERS
#
# Important:
# If multiple transactions exist for the same subparcel
# on the same date, we DO NOT sum them and pretend they are
# one full sale.
#
# Without "חלק נמכר" we cannot know that.
# We automatically flag the cluster as ambiguous.
# ---------------------------------------------------------

same_unit_date = defaultdict(list)

for i, item in enumerate(items):
    gush = item.get("gush")
    helka = item.get("helka")
    tat = item.get("tatHelka")
    date = item.get("dealDate")

    if gush and helka and tat and date:
        key = (
            str(gush),
            str(helka),
            str(tat),
            str(date),
        )

        same_unit_date[key].append(i)


ambiguous_indices = set()

for key, indexes in same_unit_date.items():
    if len(indexes) >= 2:
        ambiguous_indices.update(indexes)


# ---------------------------------------------------------
# ROBUST PRICE/SQM BASELINES
#
# Use neighborhood + rooms when enough data exists.
# Otherwise fall back to rooms across the city.
#
# No rule such as:
#   "under ₪700K = bad"
#
# The threshold adapts to the actual data.
# ---------------------------------------------------------

groups = defaultdict(list)

for item in items:
    value = log_ppsqm(item)

    if value is None:
        continue

    room = item.get("rooms")
    neighborhood = item.get("neighborhoodName")

    groups[("city", room)].append(value)

    if neighborhood:
        groups[("neighborhood", neighborhood, room)].append(value)


def robust_stats(values):
    if len(values) < 5:
        return None

    med = statistics.median(values)

    deviations = [
        abs(v - med)
        for v in values
    ]

    mad = statistics.median(deviations)

    if mad == 0:
        return None

    return med, mad


group_stats = {
    key: robust_stats(values)
    for key, values in groups.items()
}


# ---------------------------------------------------------
# QUALITY LAYER
# ---------------------------------------------------------

usable = []
flagged = []


for i, item in enumerate(items):

    reasons = []

    price = item.get("dealAmount")
    area = item.get("area")
    ppsqm = item.get("pricePerSqm")
    rooms = item.get("rooms")

    # Basic validity.
    if not numeric(price) or price <= 0:
        reasons.append("invalid_price")

    if not numeric(area) or area <= 0:
        reasons.append("invalid_area")

    if not numeric(ppsqm) or ppsqm <= 0:
        reasons.append("invalid_price_per_sqm")

    # Same exact registered unit sold multiple times
    # on the same date = ambiguous ownership-transfer case.
    if i in ambiguous_indices:
        reasons.append(
            "multiple_transactions_same_unit_same_date"
        )

    # Robust outlier detection.
    log_value = log_ppsqm(item)

    if log_value is not None:

        neighborhood = item.get("neighborhoodName")

        local_key = (
            "neighborhood",
            neighborhood,
            rooms,
        )

        city_key = (
            "city",
            rooms,
        )

        stats = None

        if (
            neighborhood
            and group_stats.get(local_key)
            and len(groups[local_key]) >= 8
        ):
            stats = group_stats[local_key]

        elif group_stats.get(city_key):
            stats = group_stats[city_key]

        if stats:
            median_log, mad_log = stats

            robust_z = (
                0.6745
                * abs(log_value - median_log)
                / mad_log
            )

            item["_robustPriceSqmZ"] = round(
                robust_z,
                3,
            )

            # Very conservative:
            # this doesn't say the transaction is false.
            # It says it is unsafe as an automatic comp.
            if robust_z > 4.5:
                reasons.append(
                    "extreme_price_per_sqm_outlier"
                )

    item["_qualityReasons"] = reasons

    if reasons:
        item["_qualityStatus"] = "flagged"
        flagged.append(item)
    else:
        item["_qualityStatus"] = "usable"
        usable.append(item)


# ---------------------------------------------------------
# FIRST STRUCTURAL MATCH
#
# This is deliberately NOT final pricing.
# Exact project geography will be added later.
# ---------------------------------------------------------

candidates = []

for item in usable:

    if item.get("rooms") != TARGET["rooms"]:
        continue

    area = item.get("area")

    if not numeric(area):
        continue

    # First search window: within 15% of target area.
    area_diff_pct = abs(
        area - TARGET["area"]
    ) / TARGET["area"]

    if area_diff_pct > 0.15:
        continue

    floor = parse_floor(item.get("floor"))

    floor_difference = None

    if floor is not None:
        floor_difference = abs(
            floor - TARGET["floor"]
        )

    candidate = dict(item)

    candidate["_match"] = {
        "areaDifferencePct": round(
            area_diff_pct * 100,
            2,
        ),
        "floorDifference": floor_difference,
    }

    candidates.append(candidate)


# Prefer closest area first, then closest floor.
candidates.sort(
    key=lambda x: (
        x["_match"]["areaDifferencePct"],
        (
            x["_match"]["floorDifference"]
            if x["_match"]["floorDifference"]
            is not None
            else 999
        ),
        x.get("dealDate") or "",
    )
)


# ---------------------------------------------------------
# OUTPUT
# ---------------------------------------------------------

def save(name, data):
    with open(
        name,
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(
            data,
            f,
            ensure_ascii=False,
            indent=2,
            default=str,
        )


save(
    "sold_deals_raw.json",
    items,
)

save(
    "sold_deals_usable.json",
    usable,
)

save(
    "sold_deals_flagged.json",
    flagged,
)

save(
    "sold_unit5_candidates.json",
    candidates,
)


print("\n" + "=" * 70)
print("QUALITY RESULTS")
print("=" * 70)

print("Raw:", len(items))
print("Usable:", len(usable))
print("Flagged:", len(flagged))

reason_counts = defaultdict(int)

for item in flagged:
    for reason in item["_qualityReasons"]:
        reason_counts[reason] += 1

print("\nFLAG REASONS:")

for reason, count in sorted(
    reason_counts.items()
):
    print(
        f"{reason:45} {count}"
    )


print("\n" + "=" * 70)
print("3 ROOM / 69 SQM STRUCTURAL CANDIDATES")
print("=" * 70)

print("Candidates:", len(candidates))

for i, item in enumerate(
    candidates[:20],
    1,
):
    print(
        i,
        "|",
        item.get("dealDate"),
        "|",
        item.get("dealAmount"),
        "|",
        item.get("area"),
        "m² |",
        item.get("rooms"),
        "rooms | floor",
        item.get("floor"),
        "|",
        item.get("neighborhoodName"),
        "|",
        item.get("address"),
        "| area diff",
        item["_match"]["areaDifferencePct"],
        "%",
    )


print("\nSaved:")
print("- sold_deals_raw.json")
print("- sold_deals_usable.json")
print("- sold_deals_flagged.json")
print("- sold_unit5_candidates.json")