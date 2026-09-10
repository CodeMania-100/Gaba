from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(".").resolve()
OUT = ROOT / "special_evidence_v5"
OUT.mkdir(exist_ok=True)


# ============================================================
# RAW SOURCES ONLY
# ============================================================

SOURCES = {
    "sold_raw": "sold_deals_raw.json",
    "sold_usable": "sold_deals_usable.json",
    "sold_flagged": "sold_deals_flagged.json",
    "nadlan": "nadlan_gov_7100.json",

    "madlan_asking": "madlan_apify_200.json",
    "madlan_3r": "madlan_city_wine_3r_targeted.json",
    "madlan_5r": "madlan_city_wine_5r_targeted.json",

    "yad2": "yad2_apify_enriched_100.json",
    "yad2_smoke": "yad2_apify_smoke.json",
    "yad2_3r": "yad2_city_wine_3r_targeted.json",
    "yad2_5r": "yad2_city_wine_5r_targeted.json",

    "projects_all": "madlan_projects_all.json",
    "projects_only": "madlan_projects_only.json",
}


# ============================================================
# SPECIAL TYPES
# ============================================================

SPECIAL_TERMS = {
    "garden": [
        "דירת גן",
        "garden apartment",
        "garden apt",
    ],
    "duplex": [
        "דופלקס",
        "דו פלקס",
        "duplex",
    ],
    "triplex": [
        "טריפלקס",
        "תלת מפלסי",
        "triplex",
    ],
    "penthouse": [
        "פנטהאוז",
        "מיני פנטהאוז",
        "מיני-פנטהאוז",
        "penthouse",
    ],
    "roof": [
        "דירת גג",
        "roof apartment",
        "roof apt",
    ],
}


# ============================================================
# HELPERS
# ============================================================

def nk(value: Any) -> str:
    return re.sub(
        r"[\s_\-./\\()\[\]{}:]+",
        "",
        str(value).strip().lower(),
    )


def as_number(value: Any) -> float | None:
    if value is None:
        return None

    if isinstance(value, bool):
        return None

    if isinstance(value, (int, float)):
        return float(value)

    text = str(value)
    text = (
        text.replace(",", "")
        .replace("₪", "")
        .replace("מ״ר", "")
        .replace('מ"ר', "")
    )

    m = re.search(r"-?\d+(?:\.\d+)?", text)

    if not m:
        return None

    try:
        return float(m.group())
    except ValueError:
        return None


def first(record: dict, aliases: list[str]) -> Any:
    lookup = {nk(k): v for k, v in record.items()}

    for alias in aliases:
        key = nk(alias)

        if key in lookup:
            value = lookup[key]

            if value is not None and str(value).strip():
                return value

    return None


ROOM_KEYS = [
    "rooms",
    "roomCount",
    "room_count",
    "roomsCount",
    "beds",               # V5 FIX
    "bedrooms",
    "numberOfRooms",
]

AREA_KEYS = [
    "area",
    "areaSqm",
    "area_sqm",
    "sqm",
    "size",
    "builtArea",
    "built_area",
    "internalArea",
    "internal_area",
]

PRICE_KEYS = [
    "price",
    "dealAmount",
    "deal_amount",
    "askingPrice",
    "asking_price",
    "salePrice",
]

FLOOR_KEYS = [
    "floor",
    "floorNumber",
    "floor_number",
]

ADDRESS_KEYS = [
    "address",
    "fullAddress",
    "full_address",
]

CITY_KEYS = [
    "city",
    "cityName",
    "city_name",
]

NEIGHBORHOOD_KEYS = [
    "neighborhood",
    "neighborhoodName",
    "neighborhood_name",
]

TYPE_KEYS = [
    "propertyType",
    "property_type",
    "assetType",
    "asset_type",
    "unitType",
    "unit_type",
    "type",
    "subtype",
]

DESCRIPTION_KEYS = [
    "description",
    "details",
    "text",
    "title",
    "subtitle",
    "notes",
]

DATE_KEYS = [
    "dealDate",
    "deal_date",
    "eventDate",
    "event_date",
    "publishedAt",
    "published_at",
    "date",
]

ID_KEYS = [
    "sourceId",
    "source_id",
    "assetId",
    "asset_id",
    "listingId",
    "listing_id",
    "id",
]

URL_KEYS = [
    "url",
    "sourceUrl",
    "source_url",
    "listingUrl",
    "listing_url",
]


def combine_text(*values) -> str:
    return " ".join(
        str(v)
        for v in values
        if v is not None
    ).strip()


def detect_special(text: str) -> list[str]:
    low = text.lower()

    result = []

    for label, terms in SPECIAL_TERMS.items():
        if any(term.lower() in low for term in terms):
            result.append(label)

    return sorted(set(result))


# ============================================================
# DESCRIPTION AREA EXTRACTION
# ============================================================

def extract_explicit_areas(text: str) -> dict:
    """
    Only extracts areas when description explicitly associates
    a number with built/internal, balcony/terrace, or garden.

    We DO NOT convert advertised area into internal area.
    """

    result = {
        "explicit_internal_area": None,
        "explicit_balcony_area": None,
        "explicit_garden_area": None,
        "area_extraction_notes": [],
    }

    if not text:
        return result

    clean = (
        text.replace("מ״ר", 'מ"ר')
        .replace("מטרים רבועים", 'מ"ר')
        .replace("מטר רבוע", 'מ"ר')
    )

    internal_patterns = [
        # 145 מ"ר בנוי
        r'(\d{2,3}(?:\.\d+)?)\s*(?:מ"ר|מטר)?\s*(?:בנוי|בנויים|בנויה)',
        # בנוי 145
        r'(?:בנוי|בנויים|בנויה)\s*(?:כ-?|כ)?\s*(\d{2,3}(?:\.\d+)?)',
        # 145 sqm built
        r'(\d{2,3}(?:\.\d+)?)\s*(?:sqm|m2)\s*(?:built|internal)',
        r'(?:built|internal)\s*(?:area)?\s*[:\-]?\s*(\d{2,3}(?:\.\d+)?)',
    ]

    balcony_patterns = [
        # 45 מ"ר מרפסת
        r'(\d{1,3}(?:\.\d+)?)\s*(?:מ"ר|מטר)?\s*(?:מרפסת|מרפסות|טרסה)',
        # מרפסת 45
        r'(?:מרפסת|מרפסות|טרסה)\s*(?:בשטח)?\s*(?:כ-?|כ)?\s*(\d{1,3}(?:\.\d+)?)',
        # 45 sqm balcony/terrace
        r'(\d{1,3}(?:\.\d+)?)\s*(?:sqm|m2)\s*(?:balcony|terrace)',
        r'(?:balcony|terrace)\s*[:\-]?\s*(\d{1,3}(?:\.\d+)?)',
    ]

    garden_patterns = [
        r'(\d{1,3}(?:\.\d+)?)\s*(?:מ"ר|מטר)?\s*(?:גינה|גן)',
        r'(?:גינה|גן)\s*(?:בשטח)?\s*(?:כ-?|כ)?\s*(\d{1,3}(?:\.\d+)?)',
        r'(\d{1,3}(?:\.\d+)?)\s*(?:sqm|m2)\s*garden',
        r'garden\s*[:\-]?\s*(\d{1,3}(?:\.\d+)?)',
    ]

    def find_first(patterns):
        for pattern in patterns:
            m = re.search(
                pattern,
                clean,
                flags=re.I,
            )

            if m:
                try:
                    return float(m.group(1)), m.group(0)
                except Exception:
                    pass

        return None, None

    internal, internal_match = find_first(
        internal_patterns
    )

    balcony, balcony_match = find_first(
        balcony_patterns
    )

    garden, garden_match = find_first(
        garden_patterns
    )

    if internal is not None:
        result["explicit_internal_area"] = internal
        result["area_extraction_notes"].append(
            f"internal:{internal_match}"
        )

    if balcony is not None:
        result["explicit_balcony_area"] = balcony
        result["area_extraction_notes"].append(
            f"balcony:{balcony_match}"
        )

    if garden is not None:
        result["explicit_garden_area"] = garden
        result["area_extraction_notes"].append(
            f"garden:{garden_match}"
        )

    return result


# ============================================================
# JSON WALK WITH PARENT PROJECT CONTEXT
# ============================================================

PROJECT_CONTEXT_KEYS = {
    "project_name": [
        "projectName",
        "project_name",
        "name",
        "title",
    ],
    "project_address": [
        "address",
        "projectAddress",
        "project_address",
    ],
    "project_neighborhood": [
        "neighborhood",
        "neighborhoodName",
        "neighborhood_name",
    ],
    "project_city": [
        "city",
        "cityName",
        "city_name",
    ],
}


def project_context_from_record(record: dict) -> dict:
    context = {}

    for target, aliases in PROJECT_CONTEXT_KEYS.items():
        value = first(record, aliases)

        if value is not None:
            context[target] = value

    return context


def walk_with_context(
    obj: Any,
    inherited: dict | None = None,
):
    inherited = dict(inherited or {})

    if isinstance(obj, dict):
        local_context = dict(inherited)

        # only propagate plausible project-level context
        if any(
            nk(k) in {
                "projectname",
                "projectid",
                "developer",
                "developername",
            }
            for k in obj.keys()
        ):
            local_context.update(
                project_context_from_record(obj)
            )

        yield obj, local_context

        for value in obj.values():
            yield from walk_with_context(
                value,
                local_context,
            )

    elif isinstance(obj, list):
        for value in obj:
            yield from walk_with_context(
                value,
                inherited,
            )


# ============================================================
# SOURCE LANES
# ============================================================

def lane_for(source_name: str) -> str:
    if source_name in {
        "sold_raw",
        "sold_usable",
        "sold_flagged",
        "nadlan",
    }:
        return "sold"

    if source_name.startswith("madlan_") and (
        source_name not in {
            "projects_all",
            "projects_only",
        }
    ):
        return "asking"

    if source_name.startswith("yad2"):
        return "asking"

    if source_name in {
        "projects_all",
        "projects_only",
    }:
        return "new_project"

    return "unknown"


def qa_status_for(source_name: str) -> str:
    if source_name == "sold_usable":
        return "usable"

    if source_name == "sold_flagged":
        return "flagged"

    if source_name == "sold_raw":
        return "raw_unclassified"

    return ""


# ============================================================
# PROPERTY-LIKE RECORD
# ============================================================

def looks_like_property(record: dict) -> bool:
    rooms = first(record, ROOM_KEYS)
    area = first(record, AREA_KEYS)
    price = first(record, PRICE_KEYS)
    ptype = first(record, TYPE_KEYS)
    address = first(record, ADDRESS_KEYS)

    hits = sum(
        value is not None
        for value in [
            rooms,
            area,
            price,
            ptype,
            address,
        ]
    )

    return hits >= 2


# ============================================================
# NORMALIZE
# ============================================================

def normalize_record(
    source_name: str,
    record: dict,
    context: dict,
    index: int,
) -> dict | None:

    if not looks_like_property(record):
        return None

    rooms = as_number(
        first(record, ROOM_KEYS)
    )

    advertised_area = as_number(
        first(record, AREA_KEYS)
    )

    price = as_number(
        first(record, PRICE_KEYS)
    )

    floor = as_number(
        first(record, FLOOR_KEYS)
    )

    address = first(
        record,
        ADDRESS_KEYS,
    )

    neighborhood = first(
        record,
        NEIGHBORHOOD_KEYS,
    )

    city = first(
        record,
        CITY_KEYS,
    )

    ptype = first(
        record,
        TYPE_KEYS,
    )

    description = first(
        record,
        DESCRIPTION_KEYS,
    )

    title = first(
        record,
        ["title", "name", "subtitle"],
    )

    text = combine_text(
        ptype,
        title,
        description,
    )

    special = detect_special(text)

    extracted = extract_explicit_areas(
        text
    )

    internal = extracted[
        "explicit_internal_area"
    ]

    balcony = extracted[
        "explicit_balcony_area"
    ]

    garden = extracted[
        "explicit_garden_area"
    ]

    # For actual government transactions, area normally represents
    # transaction/registered area. Keep it as observed_area, not
    # "explicit internal".
    observed_transaction_area = None

    if lane_for(source_name) == "sold":
        observed_transaction_area = advertised_area

    effective_internal = (
        internal
        if internal is not None
        else (
            observed_transaction_area
            if lane_for(source_name) == "sold"
            else None
        )
    )

    project_name = context.get(
        "project_name"
    )

    project_address = context.get(
        "project_address"
    )

    project_neighborhood = context.get(
        "project_neighborhood"
    )

    project_city = context.get(
        "project_city"
    )

    combined_location = combine_text(
        address,
        neighborhood,
        city,
        project_address,
        project_neighborhood,
        project_city,
        project_name,
        description,
    ).lower()

    city_wine = any(
        token in combined_location
        for token in [
            "עיר היין",
            "city wine",
            "יין",
        ]
    )

    source_id = first(
        record,
        ID_KEYS,
    )

    url = first(
        record,
        URL_KEYS,
    )

    raw = json.dumps(
        record,
        ensure_ascii=False,
    )

    return {
        "source_name": source_name,
        "lane": lane_for(source_name),
        "qa_status": qa_status_for(source_name),

        "source_id": source_id,
        "url": url,

        "date": first(record, DATE_KEYS),

        "city": city or project_city,
        "neighborhood":
            neighborhood
            or project_neighborhood,

        "address":
            address
            or project_address,

        "project_name": project_name,

        "rooms": rooms,

        # IMPORTANT AREA FIELDS
        "advertised_area": advertised_area,
        "observed_transaction_area":
            observed_transaction_area,

        "explicit_internal_area":
            internal,

        "effective_internal_area":
            effective_internal,

        "explicit_balcony_area":
            balcony,

        "explicit_garden_area":
            garden,

        "floor": floor,

        "property_type": ptype,

        "special_types":
            " | ".join(special),

        "price": price,

        "price_per_effective_internal_sqm":
            (
                price / effective_internal
                if (
                    price is not None
                    and effective_internal
                    and effective_internal > 0
                )
                else None
            ),

        "city_wine_signal":
            city_wine,

        "area_extraction_notes":
            " | ".join(
                extracted[
                    "area_extraction_notes"
                ]
            ),

        "description": description,

        "record_index": index,

        "raw_record": raw[:6000],
    }


# ============================================================
# DEDUPE
# ============================================================

def dedupe_key(row: dict) -> str:
    source_id = str(
        row.get("source_id") or ""
    ).strip()

    if source_id:
        return (
            f"{row['lane']}:"
            f"id:{source_id}"
        )

    url = str(
        row.get("url") or ""
    ).strip()

    if url:
        return (
            f"{row['lane']}:"
            f"url:{url}"
        )

    return "|".join([
        str(row.get("lane") or ""),
        str(row.get("address") or "").strip().lower(),
        str(row.get("rooms") or ""),
        str(row.get("advertised_area") or ""),
        str(row.get("price") or ""),
        str(row.get("date") or ""),
    ])


# ============================================================
# PACKET RULES
# ============================================================

def contains_special(
    row: dict,
    label: str,
) -> bool:
    return label in (
        row.get("special_types") or ""
    )


def packet_2r_garden(row: dict) -> bool:
    rooms = row.get("rooms")

    # direct 2 / 2.5 room evidence
    if (
        rooms is not None
        and 1.5 <= rooms <= 2.5
    ):
        return True

    # garden analogues, including 3R
    if (
        contains_special(row, "garden")
        and rooms is not None
        and rooms <= 4
    ):
        return True

    return False


def packet_6r_premium(row: dict) -> bool:
    rooms = row.get("rooms")

    if (
        rooms is not None
        and 5.5 <= rooms < 7
    ):
        return True

    if any(
        contains_special(row, s)
        for s in [
            "penthouse",
            "roof",
            "duplex",
            "triplex",
        ]
    ):
        area = (
            row.get("effective_internal_area")
            or row.get("advertised_area")
        )

        if area is not None and area >= 140:
            return True

    return False


def packet_7r_duplex(row: dict) -> bool:
    rooms = row.get("rooms")

    if (
        rooms is not None
        and rooms >= 7
    ):
        return True

    if contains_special(row, "duplex"):
        area = (
            row.get("effective_internal_area")
            or row.get("advertised_area")
        )

        if (
            area is not None
            and 140 <= area <= 210
        ):
            return True

    return False


def packet_large_premium(row: dict) -> bool:
    area = (
        row.get("effective_internal_area")
        or row.get("advertised_area")
    )

    if area is None:
        return False

    if area >= 140:
        return True

    return False


# ============================================================
# LOAD
# ============================================================

rows = []

for source_name, filename in SOURCES.items():

    path = ROOT / filename

    if not path.exists():
        print(
            f"[MISSING] {filename}"
        )
        continue

    print(
        f"Reading {filename}"
    )

    try:
        with path.open(
            "r",
            encoding="utf-8-sig",
            errors="ignore",
        ) as f:
            data = json.load(f)

    except Exception as exc:
        print(
            f"[FAILED] {filename}: {exc}"
        )
        continue

    count = 0

    for idx, (
        record,
        context,
    ) in enumerate(
        walk_with_context(data)
    ):

        if not isinstance(record, dict):
            continue

        normalized = normalize_record(
            source_name,
            record,
            context,
            idx,
        )

        if normalized is None:
            continue

        rows.append(normalized)
        count += 1

    print(
        f"  normalized: {count}"
    )


# ============================================================
# DEDUPLICATE
# ============================================================

deduped = {}

for row in rows:
    key = dedupe_key(row)

    # Prefer richer row if duplicate
    existing = deduped.get(key)

    if existing is None:
        deduped[key] = row
        continue

    existing_score = sum(
        existing.get(field) is not None
        and existing.get(field) != ""
        for field in [
            "explicit_internal_area",
            "explicit_balcony_area",
            "explicit_garden_area",
            "description",
            "address",
            "project_name",
        ]
    )

    new_score = sum(
        row.get(field) is not None
        and row.get(field) != ""
        for field in [
            "explicit_internal_area",
            "explicit_balcony_area",
            "explicit_garden_area",
            "description",
            "address",
            "project_name",
        ]
    )

    if new_score > existing_score:
        deduped[key] = row


rows = list(deduped.values())


# ============================================================
# CSV OUTPUT
# ============================================================

FIELDS = [
    "source_name",
    "lane",
    "qa_status",
    "source_id",
    "url",
    "date",

    "city",
    "neighborhood",
    "address",
    "project_name",

    "rooms",

    "advertised_area",
    "observed_transaction_area",
    "explicit_internal_area",
    "effective_internal_area",
    "explicit_balcony_area",
    "explicit_garden_area",

    "floor",
    "property_type",
    "special_types",

    "price",
    "price_per_effective_internal_sqm",

    "city_wine_signal",

    "area_extraction_notes",
    "description",

    "record_index",
    "raw_record",
]


def write_csv(
    filename: str,
    subset: list[dict],
):
    path = OUT / filename

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

        for row in subset:
            writer.writerow(row)

    print(
        f"{filename}: {len(subset)}"
    )


write_csv(
    "all_normalized.csv",
    rows,
)


# ------------------------------------------------------------
# EVIDENCE LANES
# ------------------------------------------------------------

write_csv(
    "sold_normalized.csv",
    [
        r for r in rows
        if r["lane"] == "sold"
    ],
)

write_csv(
    "asking_normalized.csv",
    [
        r for r in rows
        if r["lane"] == "asking"
    ],
)

write_csv(
    "new_projects_normalized.csv",
    [
        r for r in rows
        if r["lane"] == "new_project"
    ],
)


# ------------------------------------------------------------
# CITY WINE ONLY
# ------------------------------------------------------------

write_csv(
    "city_wine_only.csv",
    [
        r for r in rows
        if r["city_wine_signal"]
    ],
)


# ------------------------------------------------------------
# SUBJECT-SPECIFIC PACKETS
# ------------------------------------------------------------

packet_2 = [
    r for r in rows
    if packet_2r_garden(r)
]

packet_6 = [
    r for r in rows
    if packet_6r_premium(r)
]

packet_7 = [
    r for r in rows
    if packet_7r_duplex(r)
]

packet_large = [
    r for r in rows
    if packet_large_premium(r)
]


write_csv(
    "packet_apt3_2r_garden.csv",
    packet_2,
)

write_csv(
    "packet_apt36_37_6r_triplex.csv",
    packet_6,
)

write_csv(
    "packet_apt38_7r_duplex.csv",
    packet_7,
)

write_csv(
    "packet_large_premium_analogues.csv",
    packet_large,
)


# ------------------------------------------------------------
# DIRECT ROOM COUNTS
# ------------------------------------------------------------

write_csv(
    "direct_2_room.csv",
    [
        r for r in rows
        if (
            r["rooms"] is not None
            and 1.5 <= r["rooms"] <= 2.5
        )
    ],
)

write_csv(
    "direct_6_room.csv",
    [
        r for r in rows
        if (
            r["rooms"] is not None
            and 5.5 <= r["rooms"] < 7
        )
    ],
)

write_csv(
    "direct_7plus_room.csv",
    [
        r for r in rows
        if (
            r["rooms"] is not None
            and r["rooms"] >= 7
        )
    ],
)


# ------------------------------------------------------------
# SPECIAL TYPE FILES
# ------------------------------------------------------------

for label in [
    "garden",
    "duplex",
    "triplex",
    "penthouse",
    "roof",
]:

    write_csv(
        f"special_{label}.csv",
        [
            r for r in rows
            if contains_special(
                r,
                label,
            )
        ],
    )


# ============================================================
# SUMMARY
# ============================================================

print()
print("=" * 90)
print("V5 SUMMARY")
print("=" * 90)

print(
    "Unique normalized records:",
    len(rows),
)

print()

for lane in [
    "sold",
    "asking",
    "new_project",
]:

    print(
        lane,
        sum(
            r["lane"] == lane
            for r in rows
        ),
    )

print()

print(
    "Direct 2R:",
    sum(
        r["rooms"] is not None
        and 1.5 <= r["rooms"] <= 2.5
        for r in rows
    ),
)

print(
    "Direct 6R:",
    sum(
        r["rooms"] is not None
        and 5.5 <= r["rooms"] < 7
        for r in rows
    ),
)

print(
    "Direct 7+:",
    sum(
        r["rooms"] is not None
        and r["rooms"] >= 7
        for r in rows
    ),
)

print()

for label in SPECIAL_TERMS:
    print(
        label,
        sum(
            contains_special(
                r,
                label,
            )
            for r in rows
        ),
    )

print()
print(
    "Rows with explicit built/internal area:",
    sum(
        r["explicit_internal_area"]
        is not None
        for r in rows
    ),
)

print(
    "Rows with explicit balcony area:",
    sum(
        r["explicit_balcony_area"]
        is not None
        for r in rows
    ),
)

print(
    "Rows with explicit garden area:",
    sum(
        r["explicit_garden_area"]
        is not None
        for r in rows
    ),
)

print()
print("Output:", OUT)