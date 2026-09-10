from __future__ import annotations

import json
import os
import re
from pathlib import Path

ROOT = Path(".").resolve()

# Generated / derived material we do NOT want to treat as a raw source.
SKIP_PARTS = {
    "special_unit_data_audit",
    "special_unit_data_audit_v2",
    "special_unit_data_audit_v3",
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
}

SKIP_NAME_CONTAINS = [
    "project_dry_run",
    "comparable_demo",
    "market_range_demo",
    "engineering_demo",
    "historical_validation",
]

INTERESTING_FILENAME_WORDS = [
    "madlan",
    "yad2",
    "tax",
    "govmap",
    "nadlan",
    "sold",
    "transaction",
    "project",
    "listing",
    "competitor",
    "deal",
]

CONTENT_TERMS = [
    "דירת גן",
    "דירת גג",
    "דופלקס",
    "טריפלקס",
    "פנטהאוז",
    "מיני פנטהאוז",
    "garden",
    "duplex",
    "triplex",
    "penthouse",
    "rooms",
    "חדרים",
]

SUPPORTED = {
    ".json",
    ".jsonl",
    ".csv",
    ".parquet",
    ".xlsx",
    ".xls",
}


def should_skip(path: Path) -> bool:
    lower_parts = {p.lower() for p in path.parts}

    if lower_parts & SKIP_PARTS:
        return True

    name = path.name.lower()

    return any(
        token in name
        for token in SKIP_NAME_CONTAINS
    )


def filename_score(path: Path) -> list[str]:
    name = path.name.lower()

    return [
        word
        for word in INTERESTING_FILENAME_WORDS
        if word in name
    ]


def inspect_text_file(path: Path) -> dict:
    result = {
        "terms": [],
        "rooms_2": False,
        "rooms_6": False,
        "rooms_7": False,
        "rooms_over_7": False,
    }

    if path.suffix.lower() not in {".json", ".jsonl", ".csv"}:
        return result

    try:
        text = path.read_text(
            encoding="utf-8-sig",
            errors="ignore",
        )
    except Exception:
        return result

    low = text.lower()

    result["terms"] = [
        term
        for term in CONTENT_TERMS
        if term.lower() in low
    ]

    # These are intentionally broad.
    room_patterns = {
        "rooms_2": [
            r'"rooms"\s*:\s*"?2(?:\.0)?"?',
            r'"roomCount"\s*:\s*"?2(?:\.0)?"?',
            r'2\s*חדרים',
        ],
        "rooms_6": [
            r'"rooms"\s*:\s*"?6(?:\.0)?"?',
            r'"roomCount"\s*:\s*"?6(?:\.0)?"?',
            r'6\s*חדרים',
        ],
        "rooms_7": [
            r'"rooms"\s*:\s*"?7(?:\.0)?"?',
            r'"roomCount"\s*:\s*"?7(?:\.0)?"?',
            r'7\s*חדרים',
        ],
    }

    for field, patterns in room_patterns.items():
        result[field] = any(
            re.search(pattern, text, re.I)
            for pattern in patterns
        )

    # Broad 8+ indicator.
    result["rooms_over_7"] = bool(
        re.search(
            r'"rooms"\s*:\s*"?(?:8|9|10)(?:\.0)?"?',
            text,
            re.I,
        )
    )

    return result


rows = []

all_files = [
    p
    for p in ROOT.rglob("*")
    if p.is_file()
]

print(f"All files under root: {len(all_files)}")

for i, path in enumerate(all_files, 1):

    if should_skip(path):
        continue

    suffix = path.suffix.lower()

    if suffix not in SUPPORTED:
        continue

    file_hits = filename_score(path)
    content = inspect_text_file(path)

    has_special = any(
        term.lower() in {
            "דירת גן",
            "דירת גג",
            "דופלקס",
            "טריפלקס",
            "פנטהאוז",
            "מיני פנטהאוז",
            "garden",
            "duplex",
            "triplex",
            "penthouse",
        }
        for term in content["terms"]
    )

    rows.append({
        "path": str(path),
        "name": path.name,
        "extension": suffix,
        "size_mb": round(
            path.stat().st_size / 1024 / 1024,
            3,
        ),
        "filename_signals": ", ".join(file_hits),
        "content_terms": ", ".join(content["terms"]),
        "contains_special_type": has_special,
        "contains_2_room": content["rooms_2"],
        "contains_6_room": content["rooms_6"],
        "contains_7_room": content["rooms_7"],
        "contains_8plus_room": content["rooms_over_7"],
    })


# Standard library CSV only.
import csv

output = ROOT / "special_source_inventory_v3.csv"

with output.open(
    "w",
    encoding="utf-8-sig",
    newline="",
) as f:

    fields = [
        "path",
        "name",
        "extension",
        "size_mb",
        "filename_signals",
        "content_terms",
        "contains_special_type",
        "contains_2_room",
        "contains_6_room",
        "contains_7_room",
        "contains_8plus_room",
    ]

    writer = csv.DictWriter(
        f,
        fieldnames=fields,
    )

    writer.writeheader()
    writer.writerows(rows)


interesting = [
    r
    for r in rows
    if (
        r["filename_signals"]
        or r["contains_special_type"]
        or r["contains_2_room"]
        or r["contains_6_room"]
        or r["contains_7_room"]
        or r["contains_8plus_room"]
    )
]

print()
print("=" * 120)
print("INTERESTING RAW SOURCE FILES")
print("=" * 120)

for r in interesting:
    print()
    print(r["name"])
    print(" path:", r["path"])
    print(" size:", r["size_mb"], "MB")
    print(" filename:", r["filename_signals"] or "-")
    print(" special:", r["content_terms"] or "-")
    print(
        " rooms:",
        "2=", r["contains_2_room"],
        "6=", r["contains_6_room"],
        "7=", r["contains_7_room"],
        "8+=", r["contains_8plus_room"],
    )

print()
print(f"Saved: {output}")