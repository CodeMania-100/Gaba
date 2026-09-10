from __future__ import annotations

import json
import re
from pathlib import Path
from collections import Counter

ROOT = Path(".").resolve()

FILES = [
    "nadlan_gov_7100.json",
    "sold_deals_raw.json",
    "sold_deals_usable.json",
    "sold_deals_flagged.json",

    "madlan_apify_200.json",
    "madlan_city_wine_3r_targeted.json",
    "madlan_city_wine_5r_targeted.json",

    "yad2_apify_enriched_100.json",
    "yad2_apify_smoke.json",
    "yad2_city_wine_3r_targeted.json",
    "yad2_city_wine_5r_targeted.json",

    "madlan_projects_all.json",
    "madlan_projects_only.json",
]

SPECIAL_TERMS = {
    "garden": [
        "דירת גן",
        "garden",
    ],
    "duplex": [
        "דופלקס",
        "duplex",
    ],
    "triplex": [
        "טריפלקס",
        "triplex",
        "תלת מפלסי",
    ],
    "penthouse": [
        "פנטהאוז",
        "penthouse",
        "מיני פנטהאוז",
    ],
    "roof": [
        "דירת גג",
        "roof apartment",
    ],
}

ROOM_KEYS = {
    "rooms",
    "roomcount",
    "room_count",
    "rooms_count",
    "numberofrooms",
    "number_of_rooms",
    "numrooms",
    "num_rooms",
}

AREA_KEYS = {
    "area",
    "areasqm",
    "area_sqm",
    "sqm",
    "size",
    "builtarea",
    "built_area",
    "internalarea",
    "internal_area",
    "dealarea",
    "deal_area",
}

PRICE_KEYS = {
    "price",
    "dealamount",
    "deal_amount",
    "dealprice",
    "deal_price",
    "askingprice",
    "asking_price",
    "saleprice",
    "sale_price",
}

FLOOR_KEYS = {
    "floor",
    "floornumber",
    "floor_number",
}

TYPE_KEYS = {
    "propertytype",
    "property_type",
    "assettype",
    "asset_type",
    "type",
    "subtype",
}

ADDRESS_KEYS = {
    "address",
    "fulladdress",
    "full_address",
}

DATE_KEYS = {
    "date",
    "dealdate",
    "deal_date",
    "eventdate",
    "event_date",
    "publishedat",
    "published_at",
}

DESCRIPTION_KEYS = {
    "description",
    "desc",
    "details",
    "text",
    "title",
    "subtitle",
    "notes",
}


def nk(x):
    return re.sub(
        r"[\s_\-./\\()\[\]{}:]+",
        "",
        str(x).lower().strip(),
    )


def walk(obj):
    if isinstance(obj, dict):
        yield obj

        for value in obj.values():
            yield from walk(value)

    elif isinstance(obj, list):
        for value in obj:
            yield from walk(value)


def get_any(record, aliases):
    normalized = {
        nk(k): v
        for k, v in record.items()
    }

    for alias in aliases:
        key = nk(alias)

        if key in normalized:
            value = normalized[key]

            if value is not None and str(value).strip():
                return value

    return None


def number(value):
    if value is None:
        return None

    if isinstance(value, (int, float)):
        return float(value)

    text = (
        str(value)
        .replace(",", "")
        .replace("₪", "")
        .replace('מ"ר', "")
        .replace("מ״ר", "")
    )

    m = re.search(r"\d+(?:\.\d+)?", text)

    return float(m.group()) if m else None


def detect_special(record):
    text = " ".join(
        str(v)
        for v in record.values()
        if isinstance(v, (str, int, float))
    ).lower()

    result = []

    for label, terms in SPECIAL_TERMS.items():
        if any(
            term.lower() in text
            for term in terms
        ):
            result.append(label)

    return sorted(set(result))


def looks_property_like(record):
    keys = {nk(k) for k in record}

    groups = [
        ROOM_KEYS,
        AREA_KEYS,
        PRICE_KEYS,
        TYPE_KEYS,
        ADDRESS_KEYS,
    ]

    hits = 0

    for group in groups:
        if keys & {nk(x) for x in group}:
            hits += 1

    return hits >= 2


def classify_interest(rooms, area, special):
    reasons = []

    if rooms is not None:
        if 1.5 <= rooms <= 2.5:
            reasons.append("2_room")

        if 5.5 <= rooms < 7:
            reasons.append("6_room")

        if rooms >= 7:
            reasons.append("7_plus_room")

    if area is not None:
        if 140 <= area <= 195:
            reasons.append("large_140_195")

        if 210 <= area <= 310:
            reasons.append("very_large_210_310")

    for s in special:
        reasons.append(f"special_{s}")

    return reasons


def load_json(path):
    with path.open(
        "r",
        encoding="utf-8-sig",
        errors="ignore",
    ) as f:
        return json.load(f)


rows = []
schemas = []

for filename in FILES:

    path = ROOT / filename

    if not path.exists():
        print(f"[MISSING] {filename}")
        continue

    print()
    print("=" * 100)
    print(filename)
    print("=" * 100)

    try:
        data = load_json(path)
    except Exception as exc:
        print("FAILED:", exc)
        continue

    all_dicts = list(walk(data))

    property_records = [
        r
        for r in all_dicts
        if looks_property_like(r)
    ]

    print("All dict objects:", len(all_dicts))
    print("Property-like:", len(property_records))

    key_counter = Counter()

    for record in property_records:
        key_counter.update(record.keys())

    top_keys = [
        key
        for key, count in key_counter.most_common(40)
    ]

    print("Top keys:")
    print(", ".join(top_keys))

    schemas.append({
        "file": filename,
        "all_dict_objects": len(all_dicts),
        "property_records": len(property_records),
        "top_keys": ", ".join(top_keys),
    })

    file_interest = []

    for idx, record in enumerate(property_records):

        rooms = number(
            get_any(record, ROOM_KEYS)
        )

        area = number(
            get_any(record, AREA_KEYS)
        )

        price = number(
            get_any(record, PRICE_KEYS)
        )

        floor = number(
            get_any(record, FLOOR_KEYS)
        )

        special = detect_special(record)

        reasons = classify_interest(
            rooms,
            area,
            special,
        )

        if not reasons:
            continue

        row = {
            "file": filename,
            "record_index": idx,
            "reasons": " | ".join(reasons),

            "rooms": rooms,
            "area": area,
            "price": price,
            "floor": floor,

            "special_type":
                " | ".join(special),

            "property_type":
                get_any(record, TYPE_KEYS),

            "address":
                get_any(record, ADDRESS_KEYS),

            "date":
                get_any(record, DATE_KEYS),

            "description":
                get_any(record, DESCRIPTION_KEYS),

            "raw_record":
                json.dumps(
                    record,
                    ensure_ascii=False,
                )[:4000],
        }

        rows.append(row)
        file_interest.append(row)

    print("Interesting records:", len(file_interest))

    counts = Counter()

    for row in file_interest:
        for reason in row["reasons"].split(" | "):
            counts[reason] += 1

    for reason, count in sorted(counts.items()):
        print(f"  {reason}: {count}")


# ------------------------------------------------------------
# CSV EXPORT
# ------------------------------------------------------------

import csv

OUT = ROOT / "special_raw_sources_v4.csv"

fields = [
    "file",
    "record_index",
    "reasons",
    "rooms",
    "area",
    "price",
    "floor",
    "special_type",
    "property_type",
    "address",
    "date",
    "description",
    "raw_record",
]

with OUT.open(
    "w",
    encoding="utf-8-sig",
    newline="",
) as f:

    writer = csv.DictWriter(
        f,
        fieldnames=fields,
    )

    writer.writeheader()
    writer.writerows(rows)


SCHEMA_OUT = ROOT / "special_raw_source_schemas_v4.csv"

with SCHEMA_OUT.open(
    "w",
    encoding="utf-8-sig",
    newline="",
) as f:

    writer = csv.DictWriter(
        f,
        fieldnames=[
            "file",
            "all_dict_objects",
            "property_records",
            "top_keys",
        ],
    )

    writer.writeheader()
    writer.writerows(schemas)


# ------------------------------------------------------------
# SMALL PER-TARGET FILES
# ------------------------------------------------------------

targets = {
    "2_room": "2_room",
    "6_room": "6_room",
    "7_plus": "7_plus_room",
    "garden": "special_garden",
    "duplex": "special_duplex",
    "triplex": "special_triplex",
    "penthouse": "special_penthouse",
    "roof": "special_roof",
    "large": "large_140_195",
    "very_large": "very_large_210_310",
}

for output_name, token in targets.items():

    subset = [
        row
        for row in rows
        if token in row["reasons"]
    ]

    path = ROOT / f"v4_{output_name}.csv"

    with path.open(
        "w",
        encoding="utf-8-sig",
        newline="",
    ) as f:

        writer = csv.DictWriter(
            f,
            fieldnames=fields,
        )

        writer.writeheader()
        writer.writerows(subset)


print()
print("=" * 100)
print("DONE")
print("=" * 100)
print("Total interesting raw records:", len(rows))
print()
print("Upload these:")
print(OUT)
print(SCHEMA_OUT)
print(ROOT / "v4_2_room.csv")
print(ROOT / "v4_6_room.csv")
print(ROOT / "v4_7_plus.csv")
print(ROOT / "v4_garden.csv")
print(ROOT / "v4_duplex.csv")
print(ROOT / "v4_triplex.csv")
print(ROOT / "v4_penthouse.csv")
print(ROOT / "v4_roof.csv")
print(ROOT / "v4_large.csv")
print(ROOT / "v4_very_large.csv")