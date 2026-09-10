from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any

from nadlan_mcp.govmap import GovmapClient


# ============================================================
# DEMO SEARCH CONFIG
# ============================================================

ADDRESS = "חפץ חיים 25, פתח תקווה"

YEARS_BACK = 5
RADIUS_METERS = 500
MAX_DEALS = 300

OUT = Path("special_govmap_v6")
OUT.mkdir(exist_ok=True)


# deal_type:
# 1 = first hand / new
# 2 = second hand
DEAL_TYPES = {
    1: "first_hand",
    2: "second_hand",
}


# ============================================================
# HELPERS
# ============================================================

def model_to_dict(obj: Any) -> dict:
    if isinstance(obj, dict):
        return dict(obj)

    if hasattr(obj, "model_dump"):
        return obj.model_dump()

    if hasattr(obj, "dict"):
        return obj.dict()

    try:
        return dict(vars(obj))
    except Exception:
        return {
            "raw": str(obj)
        }


def pick(
    row: dict,
    *names: str,
):
    normalized = {
        re.sub(
            r"[\s_\-]+",
            "",
            str(k).lower(),
        ): v
        for k, v in row.items()
    }

    for name in names:
        key = re.sub(
            r"[\s_\-]+",
            "",
            name.lower(),
        )

        if key in normalized:
            value = normalized[key]

            if value is not None:
                return value

    return None


def num(value):
    if value is None:
        return None

    if isinstance(value, bool):
        return None

    if isinstance(value, (int, float)):
        return float(value)

    text = str(value).replace(",", "")

    m = re.search(
        r"-?\d+(?:\.\d+)?",
        text,
    )

    if not m:
        return None

    try:
        return float(m.group())
    except Exception:
        return None


def special_type(text: str) -> str:
    text = (text or "").lower()

    found = []

    terms = {
        "garden": [
            "דירת גן",
            "garden",
        ],
        "roof": [
            "דירת גג",
            "roof",
        ],
        "penthouse": [
            "פנטהאוז",
            "penthouse",
        ],
        "duplex": [
            "דופלקס",
            "duplex",
        ],
        "triplex": [
            "טריפלקס",
            "triplex",
        ],
    }

    for label, words in terms.items():
        if any(
            word.lower() in text
            for word in words
        ):
            found.append(label)

    return " | ".join(found)


# ============================================================
# QUERY
# ============================================================

client = GovmapClient()

rows = []

for deal_type, deal_label in DEAL_TYPES.items():

    print()
    print("=" * 90)
    print(
        f"QUERY: {deal_label}"
    )
    print("=" * 90)

    deals = client.find_recent_deals_for_address(
        ADDRESS,
        years_back=YEARS_BACK,
        radius=RADIUS_METERS,
        max_deals=MAX_DEALS,
        deal_type=deal_type,
    )

    print(
        "returned:",
        len(deals),
    )

    for deal in deals:

        raw = model_to_dict(deal)

        rooms = num(
            pick(
                raw,
                "rooms",
                "room_count",
                "rooms_count",
            )
        )

        area = num(
            pick(
                raw,
                "asset_area",
                "area",
                "deal_area",
                "property_area",
            )
        )

        price = num(
            pick(
                raw,
                "deal_amount",
                "price",
                "amount",
            )
        )

        ppm = num(
            pick(
                raw,
                "price_per_sqm",
                "price_per_meter",
            )
        )

        if (
            ppm is None
            and price
            and area
            and area > 0
        ):
            ppm = price / area

        property_type = pick(
            raw,
            "property_type",
            "property_type_description",
            "asset_type",
            "asset_type_description",
        )

        address = pick(
            raw,
            "address",
            "full_address",
        )

        floor = pick(
            raw,
            "floor",
            "floor_no",
            "floor_number",
        )

        date = pick(
            raw,
            "deal_date",
            "date",
        )

        distance = num(
            pick(
                raw,
                "distance_meters",
                "distance",
                "distance_m",
            )
        )

        source = pick(
            raw,
            "deal_source",
            "source",
        )

        source_id = pick(
            raw,
            "asset_id",
            "id",
            "source_id",
        )

        text = " ".join(
            str(x)
            for x in [
                property_type,
                raw,
            ]
            if x is not None
        )

        special = special_type(
            text
        )

        rows.append({
            "requested_deal_type":
                deal_type,

            "deal_group":
                deal_label,

            "date":
                date,

            "address":
                address,

            "rooms":
                rooms,

            "area":
                area,

            "floor":
                floor,

            "property_type":
                property_type,

            "special_type":
                special,

            "price":
                price,

            "price_per_sqm":
                ppm,

            "distance_m":
                distance,

            "deal_source":
                source,

            "source_id":
                source_id,

            "raw":
                json.dumps(
                    raw,
                    ensure_ascii=False,
                ),
        })


# ============================================================
# DEDUPE
# ============================================================

unique = {}

for row in rows:

    key = (
        str(row.get("source_id") or ""),
        str(row.get("date") or ""),
        str(row.get("address") or ""),
        str(row.get("price") or ""),
        str(row.get("area") or ""),
    )

    if key not in unique:
        unique[key] = row


rows = list(
    unique.values()
)

print()
print(
    "unique transactions:",
    len(rows),
)


# ============================================================
# DISTANCE BAND
# ============================================================

for row in rows:

    d = row.get(
        "distance_m"
    )

    if d is None:
        row["distance_band"] = "unknown"

    elif d <= 750:
        row["distance_band"] = "0-750m"

    elif d <= 1500:
        row["distance_band"] = "750-1500m"

    elif d <= 3000:
        row["distance_band"] = "1500-3000m"

    else:
        row["distance_band"] = ">3000m"


# ============================================================
# OUTPUT
# ============================================================

FIELDS = [
    "requested_deal_type",
    "deal_group",
    "date",
    "address",
    "rooms",
    "area",
    "floor",
    "property_type",
    "special_type",
    "price",
    "price_per_sqm",
    "distance_m",
    "distance_band",
    "deal_source",
    "source_id",
    "raw",
]


def write(
    name: str,
    subset: list[dict],
):

    path = OUT / name

    with path.open(
        "w",
        encoding="utf-8-sig",
        newline="",
    ) as f:

        writer = csv.DictWriter(
            f,
            fieldnames=FIELDS,
        )

        writer.writeheader()
        writer.writerows(subset)

    print(
        f"{name}: {len(subset)}"
    )


write(
    "all_transactions.csv",
    rows,
)


# ============================================================
# EXACT ROOM-COUNT GAPS
# ============================================================

write(
    "direct_2_25_rooms.csv",
    [
        r for r in rows
        if (
            r["rooms"] is not None
            and 1.5 <= r["rooms"] <= 2.5
        )
    ],
)


write(
    "direct_6_65_rooms.csv",
    [
        r for r in rows
        if (
            r["rooms"] is not None
            and 5.5 <= r["rooms"] < 7
        )
    ],
)


write(
    "direct_7plus_rooms.csv",
    [
        r for r in rows
        if (
            r["rooms"] is not None
            and r["rooms"] >= 7
        )
    ],
)


# ============================================================
# SIZE ANALOGUES
# ============================================================

write(
    "small_45_80.csv",
    [
        r for r in rows
        if (
            r["area"] is not None
            and 45 <= r["area"] <= 80
        )
    ],
)


write(
    "large_140_195.csv",
    [
        r for r in rows
        if (
            r["area"] is not None
            and 140 <= r["area"] <= 195
        )
    ],
)


write(
    "very_large_210_310.csv",
    [
        r for r in rows
        if (
            r["area"] is not None
            and 210 <= r["area"] <= 310
        )
    ],
)


# ============================================================
# SPECIAL PROPERTY-TYPE TRANSACTIONS
# ============================================================

write(
    "special_types.csv",
    [
        r for r in rows
        if r["special_type"]
    ],
)


# ============================================================
# SPECIAL + TARGET SIZE
# ============================================================

write(
    "special_large_140_310.csv",
    [
        r for r in rows
        if (
            r["special_type"]
            and r["area"] is not None
            and 140 <= r["area"] <= 310
        )
    ],
)


# ============================================================
# PRINT SUMMARY
# ============================================================

def count_where(fn):
    return sum(
        1
        for row in rows
        if fn(row)
    )


print()
print("=" * 90)
print("SUMMARY")
print("=" * 90)

print(
    "First hand:",
    count_where(
        lambda r:
        r["requested_deal_type"] == 1
    ),
)

print(
    "Second hand:",
    count_where(
        lambda r:
        r["requested_deal_type"] == 2
    ),
)

print()

print(
    "2 / 2.5 room:",
    count_where(
        lambda r:
        r["rooms"] is not None
        and 1.5 <= r["rooms"] <= 2.5
    ),
)

print(
    "6 / 6.5 room:",
    count_where(
        lambda r:
        r["rooms"] is not None
        and 5.5 <= r["rooms"] < 7
    ),
)

print(
    "7+ room:",
    count_where(
        lambda r:
        r["rooms"] is not None
        and r["rooms"] >= 7
    ),
)

print()

print(
    "140-195 sqm:",
    count_where(
        lambda r:
        r["area"] is not None
        and 140 <= r["area"] <= 195
    ),
)

print(
    "210-310 sqm:",
    count_where(
        lambda r:
        r["area"] is not None
        and 210 <= r["area"] <= 310
    ),
)

print(
    "special property types:",
    count_where(
        lambda r:
        bool(r["special_type"])
    ),
)

print()
print(
    "Output folder:",
    OUT.resolve(),
)