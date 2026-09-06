import json
import re
from pathlib import Path

import requests


# ============================================================
# CONFIG
# ============================================================

RESOURCE_ID = "b072e36c-a53b-49e1-be08-4a608fcf4638"

API_URL = (
    "https://data.gov.il/api/3/action/"
    "datastore_search"
)

CITY = "אשקלון"

OUTPUT_DIR = Path("gov_source_tests")
OUTPUT_DIR.mkdir(exist_ok=True)


# ============================================================
# HELPERS
# ============================================================

def save_json(name, data):
    path = OUTPUT_DIR / name

    with open(
        path,
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

    print("Saved:", path)


def fetch_city(city):
    params = {
        "resource_id": RESOURCE_ID,
        "limit": 5000,
        "filters": json.dumps(
            {
                "city_name": city,
            },
            ensure_ascii=False,
        ),
    }

    response = requests.get(
        API_URL,
        params=params,
        timeout=60,
    )

    print("HTTP:", response.status_code)
    response.raise_for_status()

    payload = response.json()

    if not payload.get("success"):
        raise RuntimeError(
            payload.get("error")
        )

    return payload


def clean_text(value):
    if value is None:
        return ""

    value = str(value)

    value = re.sub(
        r"\s+",
        " ",
        value,
    )

    return value.strip()


def is_residential(row):
    build_type = clean_text(
        row.get("build_types")
    )

    return "מגורים" in build_type


# ============================================================
# FETCH
# ============================================================

print("=" * 75)
print("ACTIVE CONSTRUCTION SITES — ASHKELON")
print("=" * 75)

payload = fetch_city(CITY)

save_json(
    "ashkelon_active_construction_raw.json",
    payload,
)

result = payload.get("result", {})
records = result.get("records", [])

print("\nTotal Ashkelon sites:", len(records))


# ============================================================
# FIELD COVERAGE
# ============================================================

print("\n" + "=" * 75)
print("FIELD COVERAGE")
print("=" * 75)

fields_to_check = [
    "work_id",
    "site_name",
    "executor_name",
    "executor_id",
    "foreman_name",
    "has_cranes",
    "city_name",
    "build_types",
    "safety_warrents",
    "sanctions",
    "sanctions_sum",
]

for field in fields_to_check:

    present = sum(
        1
        for row in records
        if clean_text(
            row.get(field)
        )
    )

    print(
        f"{field:20}"
        f"{present:4}/{len(records)}"
    )


# ============================================================
# RESIDENTIAL ONLY
# ============================================================

residential = [
    row
    for row in records
    if is_residential(row)
]

save_json(
    "ashkelon_active_residential.json",
    residential,
)

print("\nResidential sites:", len(residential))


# ============================================================
# BUILD TYPE BREAKDOWN
# ============================================================

print("\n" + "=" * 75)
print("BUILD TYPE BREAKDOWN")
print("=" * 75)

build_type_counts = {}

for row in records:

    value = clean_text(
        row.get("build_types")
    )

    if not value:
        value = "(missing)"

    build_type_counts[value] = (
        build_type_counts.get(
            value,
            0,
        )
        + 1
    )


for value, count in sorted(
    build_type_counts.items(),
    key=lambda x: (-x[1], x[0]),
):
    print(
        f"{count:4} | {value}"
    )


# ============================================================
# PRINT ALL RESIDENTIAL SITES
# ============================================================

print("\n" + "=" * 75)
print("ASHKELON RESIDENTIAL SITES")
print("=" * 75)

for i, row in enumerate(
    residential,
    1,
):

    print(f"\n--- {i} ---")

    print(
        "work_id:",
        row.get("work_id"),
    )

    print(
        "site:",
        row.get("site_name"),
    )

    print(
        "executor:",
        row.get("executor_name"),
    )

    print(
        "executor_id:",
        row.get("executor_id"),
    )

    print(
        "build_types:",
        row.get("build_types"),
    )

    print(
        "cranes:",
        row.get("has_cranes"),
    )

    print(
        "safety_warrents:",
        row.get("safety_warrents"),
    )

    print(
        "sanctions:",
        row.get("sanctions"),
    )


# ============================================================
# SEARCH FOR KNOWN COMPETITOR NAMES / DEVELOPERS
# ============================================================

KNOWN_TERMS = [
    "דמרי",
    "פרץ",
    "אביסרור",
    "אפי",
    "עיר היין",
    "רמות",
    "אגמים",
]

print("\n" + "=" * 75)
print("KNOWN COMPETITOR TERM MATCHES")
print("=" * 75)

matches = []

for row in residential:

    haystack = " ".join([
        clean_text(
            row.get("site_name")
        ),
        clean_text(
            row.get("executor_name")
        ),
    ])

    matched_terms = [
        term
        for term in KNOWN_TERMS
        if term in haystack
    ]

    if matched_terms:

        matches.append({
            **row,
            "_matched_terms":
                matched_terms,
        })


save_json(
    "ashkelon_construction_competitor_matches.json",
    matches,
)


print(
    "Matches:",
    len(matches),
)

for row in matches:

    print(
        "\n",
        row.get("site_name"),
    )

    print(
        " executor:",
        row.get("executor_name"),
    )

    print(
        " matched:",
        row["_matched_terms"],
    )


# ============================================================
# SIMPLE DATA-QUALITY CHECK
# ============================================================

print("\n" + "=" * 75)
print("DATA QUALITY")
print("=" * 75)

missing_site_name = sum(
    1
    for row in residential
    if not clean_text(
        row.get("site_name")
    )
)

missing_executor = sum(
    1
    for row in residential
    if not clean_text(
        row.get("executor_name")
    )
)

duplicate_work_ids = []

seen = set()

for row in residential:

    work_id = row.get("work_id")

    if work_id in seen:
        duplicate_work_ids.append(
            work_id
        )

    seen.add(work_id)


print(
    "Missing site name:",
    missing_site_name,
)

print(
    "Missing executor:",
    missing_executor,
)

print(
    "Duplicate work IDs:",
    len(duplicate_work_ids),
)


# ============================================================
# SUMMARY
# ============================================================

summary = {
    "city": CITY,

    "total_active_sites":
        len(records),

    "residential_sites":
        len(residential),

    "known_competitor_matches":
        len(matches),

    "missing_residential_site_names":
        missing_site_name,

    "missing_residential_executors":
        missing_executor,

    "duplicate_residential_work_ids":
        len(duplicate_work_ids),

    "build_type_counts":
        build_type_counts,
}


save_json(
    "active_construction_summary.json",
    summary,
)


print("\n" + "=" * 75)
print("SUMMARY")
print("=" * 75)

print(
    json.dumps(
        summary,
        ensure_ascii=False,
        indent=2,
    )
)