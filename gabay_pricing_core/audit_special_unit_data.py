from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import pandas as pd


# ============================================================
# CONFIG
# ============================================================

SPECIAL_KEYWORDS = [
    # Hebrew
    "דירת גן",
    "דירת-גן",
    "גן",
    "דופלקס",
    "דו פלקס",
    "טריפלקס",
    "תלת מפלסי",
    "פנטהאוז",
    "מיני פנטהאוז",
    "מיני-פנטהאוז",
    "דירת גג",
    "גג",
    "מרפסת גג",

    # English
    "garden apartment",
    "garden apt",
    "duplex",
    "triplex",
    "penthouse",
    "mini penthouse",
    "roof apartment",
]

ROOM_ALIASES = [
    "rooms",
    "room",
    "roomcount",
    "room_count",
    "rooms_count",
    "numrooms",
    "num_rooms",
    "numberofrooms",
    "number_of_rooms",
    "assetrooms",
    "roomsnum",
    "roomnum",
    "חדרים",
    "מספרחדרים",
    "מסחדרים",
]

AREA_ALIASES = [
    "area",
    "areasqm",
    "area_sqm",
    "sqm",
    "size",
    "size_sqm",
    "builtarea",
    "built_area",
    "propertyarea",
    "property_area",
    "netarea",
    "net_area",
    "internalarea",
    "internal_area",
    "dealarea",
    "deal_area",
    "assetsize",
    "שטח",
    "שטחדירה",
]

OUTDOOR_AREA_ALIASES = [
    "balconyarea",
    "balcony_area",
    "terracearea",
    "terrace_area",
    "gardenarea",
    "garden_area",
    "outdoorarea",
    "outdoor_area",
    "yardsize",
    "yard_size",
    "מרפסת",
    "שטחמרפסת",
    "שטחגינה",
    "גינה",
]

PRICE_ALIASES = [
    "price",
    "dealprice",
    "deal_price",
    "saleprice",
    "sale_price",
    "askingprice",
    "asking_price",
    "totalprice",
    "total_price",
    "amount",
    "מחיר",
]

PPM_ALIASES = [
    "pricepermeter",
    "price_per_meter",
    "pricepersqm",
    "price_per_sqm",
    "pricepersquaremeter",
    "sqmprice",
    "sqm_price",
    "priceperm2",
    "price_per_m2",
    "מחירלמטר",
]

FLOOR_ALIASES = [
    "floor",
    "floornumber",
    "floor_number",
    "assetfloor",
    "קומה",
]

TOTAL_FLOORS_ALIASES = [
    "totalfloors",
    "total_floors",
    "buildingfloors",
    "building_floors",
    "floorsinbuilding",
    "floors_in_building",
]

TYPE_ALIASES = [
    "propertytype",
    "property_type",
    "assettype",
    "asset_type",
    "hometype",
    "home_type",
    "type",
    "subtype",
    "propertysubtype",
    "property_subtype",
    "סוגנכס",
    "סוג",
]

DESCRIPTION_ALIASES = [
    "description",
    "desc",
    "details",
    "remarks",
    "remark",
    "notes",
    "note",
    "title",
    "subtitle",
    "text",
    "תיאור",
    "הערות",
]

ADDRESS_ALIASES = [
    "address",
    "fulladdress",
    "full_address",
    "streetaddress",
    "street_address",
    "כתובת",
]

STREET_ALIASES = [
    "street",
    "streetname",
    "street_name",
    "רחוב",
]

CITY_ALIASES = [
    "city",
    "cityname",
    "city_name",
    "settlement",
    "יישוב",
    "עיר",
]

NEIGHBORHOOD_ALIASES = [
    "neighborhood",
    "neighbourhood",
    "neighborhoodname",
    "neighborhood_name",
    "שכונה",
]

DATE_ALIASES = [
    "date",
    "dealdate",
    "deal_date",
    "saledate",
    "sale_date",
    "transactiondate",
    "transaction_date",
    "createdat",
    "created_at",
    "publishedat",
    "published_at",
    "תאריך",
]

DEAL_TYPE_ALIASES = [
    "dealtype",
    "deal_type",
    "transactiontype",
    "transaction_type",
    "newproject",
    "new_project",
    "firsthand",
    "first_hand",
    "isfirsthand",
    "is_first_hand",
]

PARKING_ALIASES = [
    "parking",
    "parkings",
    "parkingcount",
    "parking_count",
    "parkingplaces",
    "parking_places",
    "חניה",
    "חניות",
]

STORAGE_ALIASES = [
    "storage",
    "storageroom",
    "storage_room",
    "storagesize",
    "storage_size",
    "מחסן",
]

SOURCE_EXTENSIONS = {
    ".json",
    ".jsonl",
    ".csv",
    ".parquet",
    ".xlsx",
    ".xls",
}


# ============================================================
# NORMALIZATION HELPERS
# ============================================================

def normalize_key(value: Any) -> str:
    s = str(value).strip().lower()
    s = re.sub(r"[\s_\-./\\()\[\]{}:]+", "", s)
    return s


def alias_set(values: list[str]) -> set[str]:
    return {normalize_key(v) for v in values}


ALIASES = {
    "rooms": alias_set(ROOM_ALIASES),
    "area": alias_set(AREA_ALIASES),
    "outdoor_area": alias_set(OUTDOOR_AREA_ALIASES),
    "price": alias_set(PRICE_ALIASES),
    "price_per_sqm": alias_set(PPM_ALIASES),
    "floor": alias_set(FLOOR_ALIASES),
    "total_floors": alias_set(TOTAL_FLOORS_ALIASES),
    "property_type": alias_set(TYPE_ALIASES),
    "description": alias_set(DESCRIPTION_ALIASES),
    "address": alias_set(ADDRESS_ALIASES),
    "street": alias_set(STREET_ALIASES),
    "city": alias_set(CITY_ALIASES),
    "neighborhood": alias_set(NEIGHBORHOOD_ALIASES),
    "date": alias_set(DATE_ALIASES),
    "deal_type": alias_set(DEAL_TYPE_ALIASES),
    "parking": alias_set(PARKING_ALIASES),
    "storage": alias_set(STORAGE_ALIASES),
}


def clean_scalar(v: Any) -> Any:
    if v is None:
        return None

    try:
        if pd.isna(v):
            return None
    except Exception:
        pass

    if isinstance(v, (dict, list, tuple, set)):
        try:
            return json.dumps(v, ensure_ascii=False)
        except Exception:
            return str(v)

    return v


def to_number(value: Any) -> float | None:
    if value is None:
        return None

    if isinstance(value, bool):
        return float(value)

    if isinstance(value, (int, float)):
        try:
            if pd.isna(value):
                return None
        except Exception:
            pass
        return float(value)

    s = str(value).strip()

    if not s:
        return None

    s = s.replace(",", "")
    s = s.replace("₪", "")
    s = s.replace('מ"ר', "")
    s = s.replace("מ״ר", "")
    s = s.replace("sqm", "")
    s = s.strip()

    match = re.search(r"-?\d+(?:\.\d+)?", s)
    if not match:
        return None

    try:
        return float(match.group())
    except ValueError:
        return None


def first_matching_value(record: dict[str, Any], alias_group: set[str]) -> Any:
    for key, value in record.items():
        nk = normalize_key(key)
        if nk in alias_group:
            v = clean_scalar(value)
            if v is not None and str(v).strip() != "":
                return v
    return None


def combined_text(record: dict[str, Any]) -> str:
    parts = []

    for key, value in record.items():
        if value is None:
            continue

        nk = normalize_key(key)

        if (
            nk in ALIASES["property_type"]
            or nk in ALIASES["description"]
            or nk in ALIASES["address"]
            or nk in ALIASES["neighborhood"]
        ):
            parts.append(str(value))

    return " ".join(parts).lower()


def detect_special_types(text: str) -> list[str]:
    detected = []

    mapping = {
        "garden": [
            "דירת גן",
            "דירת-גן",
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
            "mini penthouse",
        ],
        "roof": [
            "דירת גג",
            "מרפסת גג",
            "roof apartment",
        ],
    }

    t = text.lower()

    for label, keywords in mapping.items():
        if any(k.lower() in t for k in keywords):
            detected.append(label)

    return detected


# ============================================================
# FILE READERS
# ============================================================

def walk_json_objects(obj: Any):
    """
    Recursively yield dicts.
    We later filter them, so nested API response structures are okay.
    """
    if isinstance(obj, dict):
        yield obj
        for value in obj.values():
            yield from walk_json_objects(value)

    elif isinstance(obj, list):
        for value in obj:
            yield from walk_json_objects(value)


def load_json(path: Path):
    try:
        with path.open("r", encoding="utf-8-sig") as f:
            obj = json.load(f)

        yield from walk_json_objects(obj)

    except Exception as e:
        print(f"[WARN] JSON failed: {path}: {e}")


def load_jsonl(path: Path):
    try:
        with path.open("r", encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    yield from walk_json_objects(obj)
                except Exception:
                    continue
    except Exception as e:
        print(f"[WARN] JSONL failed: {path}: {e}")


def dataframe_records(df: pd.DataFrame):
    df = df.copy()
    df.columns = [str(c) for c in df.columns]

    for row in df.to_dict(orient="records"):
        yield row


def load_tabular(path: Path):
    suffix = path.suffix.lower()

    try:
        if suffix == ".csv":
            # Try normal UTF-8 first, then Hebrew Windows encoding.
            try:
                df = pd.read_csv(path, low_memory=False)
            except UnicodeDecodeError:
                df = pd.read_csv(path, encoding="cp1255", low_memory=False)

        elif suffix == ".parquet":
            df = pd.read_parquet(path)

        elif suffix in {".xlsx", ".xls"}:
            sheets = pd.read_excel(path, sheet_name=None)

            for sheet_name, df in sheets.items():
                for row in dataframe_records(df):
                    row["_sheet_name"] = sheet_name
                    yield row
            return

        else:
            return

        yield from dataframe_records(df)

    except Exception as e:
        print(f"[WARN] table failed: {path}: {e}")


def read_records(path: Path):
    suffix = path.suffix.lower()

    if suffix == ".json":
        yield from load_json(path)

    elif suffix == ".jsonl":
        yield from load_jsonl(path)

    elif suffix in {".csv", ".parquet", ".xlsx", ".xls"}:
        yield from load_tabular(path)


# ============================================================
# SOURCE CLASSIFICATION
# ============================================================

def classify_source(path: Path, record: dict[str, Any]) -> str:
    name = path.name.lower()
    full = str(path).lower()

    if "project" in name or "projects" in name or "development" in name:
        return "new_project"

    if "gis_dira" in full or "gis-dira" in full:
        return "government_program"

    if (
        "tax" in name
        or "govmap" in name
        or "nadlan" in name and "madlan" not in name
        or "transaction" in name
        or "deal" in name
    ):
        return "sold"

    if (
        "yad2" in name
        or "madlan" in name
        or "listing" in name
        or "listings" in name
    ):
        return "asking"

    deal_type = first_matching_value(record, ALIASES["deal_type"])

    if deal_type is not None:
        return "sold"

    return "unknown"


# ============================================================
# RELEVANCE
# ============================================================

def classify_target(
    rooms: float | None,
    area: float | None,
    special_types: list[str],
) -> list[str]:

    targets = []

    # Apartment 3: 2R garden
    if rooms is not None and 1.5 <= rooms <= 2.5:
        targets.append("2_room")

        if "garden" in special_types:
            targets.append("2_room_garden")

    # Apartments 36/37: 6R triplex
    if rooms is not None and 5.5 <= rooms < 7:
        targets.append("6_room")

        if "triplex" in special_types:
            targets.append("6_room_triplex")

        if "penthouse" in special_types:
            targets.append("6_room_penthouse")

        if "duplex" in special_types:
            targets.append("6_room_duplex")

    # Apartment 38: 7R duplex
    if rooms is not None and rooms >= 7:
        targets.append("7_plus_room")

        if "duplex" in special_types:
            targets.append("7_plus_duplex")

        if "penthouse" in special_types:
            targets.append("7_plus_penthouse")

        if "triplex" in special_types:
            targets.append("7_plus_triplex")

    # Area analogues:
    # useful even if room count is missing/wrong
    if area is not None:
        if 45 <= area <= 80:
            targets.append("small_area_45_80")

        if 140 <= area <= 195:
            targets.append("large_area_140_195")

        if 210 <= area <= 310:
            targets.append("very_large_area_210_310")

    # Any special property type is worth preserving
    if special_types:
        targets.append("special_property_type")

    return sorted(set(targets))


def looks_like_property_record(record: dict[str, Any]) -> bool:
    normalized_keys = {normalize_key(k) for k in record}

    evidence_groups = [
        ALIASES["rooms"],
        ALIASES["area"],
        ALIASES["price"],
        ALIASES["property_type"],
        ALIASES["address"],
        ALIASES["floor"],
    ]

    hits = 0

    for group in evidence_groups:
        if normalized_keys & group:
            hits += 1

    return hits >= 2


# ============================================================
# EXTRACTION
# ============================================================

def extract_candidate(
    path: Path,
    record: dict[str, Any],
    record_index: int,
) -> dict[str, Any] | None:

    if not looks_like_property_record(record):
        return None

    rooms_raw = first_matching_value(record, ALIASES["rooms"])
    area_raw = first_matching_value(record, ALIASES["area"])
    outdoor_raw = first_matching_value(record, ALIASES["outdoor_area"])
    price_raw = first_matching_value(record, ALIASES["price"])
    ppm_raw = first_matching_value(record, ALIASES["price_per_sqm"])
    floor_raw = first_matching_value(record, ALIASES["floor"])
    total_floors_raw = first_matching_value(record, ALIASES["total_floors"])

    rooms = to_number(rooms_raw)
    area = to_number(area_raw)
    outdoor_area = to_number(outdoor_raw)
    price = to_number(price_raw)
    ppm = to_number(ppm_raw)
    floor = to_number(floor_raw)
    total_floors = to_number(total_floors_raw)

    text = combined_text(record)
    special_types = detect_special_types(text)

    targets = classify_target(
        rooms=rooms,
        area=area,
        special_types=special_types,
    )

    if not targets:
        return None

    property_type = first_matching_value(record, ALIASES["property_type"])
    description = first_matching_value(record, ALIASES["description"])
    address = first_matching_value(record, ALIASES["address"])
    street = first_matching_value(record, ALIASES["street"])
    city = first_matching_value(record, ALIASES["city"])
    neighborhood = first_matching_value(record, ALIASES["neighborhood"])
    date = first_matching_value(record, ALIASES["date"])
    deal_type = first_matching_value(record, ALIASES["deal_type"])
    parking = first_matching_value(record, ALIASES["parking"])
    storage = first_matching_value(record, ALIASES["storage"])

    if ppm is None and price and area and area > 0:
        ppm = price / area

    # Short raw preview helps us discover fields we have not normalized yet.
    raw_preview = {}

    for k, v in record.items():
        if len(raw_preview) >= 20:
            break

        val = clean_scalar(v)

        if val is None:
            continue

        text_val = str(val)

        if len(text_val) > 300:
            text_val = text_val[:300] + "..."

        raw_preview[str(k)] = text_val

    return {
        "source_class": classify_source(path, record),
        "file": str(path),
        "record_index": record_index,

        "targets": " | ".join(targets),
        "special_types": " | ".join(special_types),

        "date": date,
        "city": city,
        "neighborhood": neighborhood,
        "address": address,
        "street": street,

        "rooms": rooms,
        "area_sqm": area,
        "outdoor_area_sqm": outdoor_area,

        "floor": floor,
        "total_floors": total_floors,

        "property_type": property_type,
        "deal_type": deal_type,

        "price": price,
        "price_per_sqm": ppm,

        "parking": parking,
        "storage": storage,

        "description": description,

        "raw_preview": json.dumps(
            raw_preview,
            ensure_ascii=False,
        ),
    }


# ============================================================
# REPORTS
# ============================================================

def create_coverage_summary(df: pd.DataFrame) -> pd.DataFrame:
    target_order = [
        "2_room",
        "2_room_garden",
        "6_room",
        "6_room_triplex",
        "6_room_penthouse",
        "6_room_duplex",
        "7_plus_room",
        "7_plus_duplex",
        "7_plus_penthouse",
        "7_plus_triplex",
        "small_area_45_80",
        "large_area_140_195",
        "very_large_area_210_310",
        "special_property_type",
    ]

    rows = []

    for target in target_order:
        mask = df["targets"].fillna("").str.contains(
            rf"(^|\s\|\s){re.escape(target)}($|\s\|\s)",
            regex=True,
        )

        subset = df[mask]

        row = {
            "target": target,
            "total": len(subset),
        }

        for source in [
            "sold",
            "asking",
            "new_project",
            "government_program",
            "unknown",
        ]:
            row[source] = int(
                (subset["source_class"] == source).sum()
            )

        row["with_price"] = int(subset["price"].notna().sum())
        row["with_area"] = int(subset["area_sqm"].notna().sum())
        row["with_outdoor_area"] = int(
            subset["outdoor_area_sqm"].notna().sum()
        )
        row["with_floor"] = int(subset["floor"].notna().sum())
        row["with_property_type"] = int(
            subset["property_type"].notna().sum()
        )

        rows.append(row)

    return pd.DataFrame(rows)


def create_file_summary(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()

    return (
        df.groupby(["file", "source_class"], dropna=False)
        .agg(
            candidate_rows=("file", "size"),
            with_rooms=("rooms", lambda x: x.notna().sum()),
            with_area=("area_sqm", lambda x: x.notna().sum()),
            with_price=("price", lambda x: x.notna().sum()),
            with_outdoor_area=(
                "outdoor_area_sqm",
                lambda x: x.notna().sum(),
            ),
            special_type_rows=(
                "special_types",
                lambda x: (x.fillna("") != "").sum(),
            ),
        )
        .reset_index()
        .sort_values(
            ["candidate_rows", "file"],
            ascending=[False, True],
        )
    )


def print_top_examples(df: pd.DataFrame, title: str, mask, limit=20):
    subset = df[mask].copy()

    print()
    print("=" * 100)
    print(title)
    print("=" * 100)
    print(f"Rows: {len(subset)}")

    if subset.empty:
        print("NONE")
        return

    columns = [
        "source_class",
        "date",
        "city",
        "neighborhood",
        "address",
        "rooms",
        "area_sqm",
        "outdoor_area_sqm",
        "floor",
        "property_type",
        "special_types",
        "price",
        "price_per_sqm",
        "file",
    ]

    columns = [c for c in columns if c in subset.columns]

    print(
        subset[columns]
        .head(limit)
        .to_string(index=False)
    )


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Audit existing datasets for special apartment pricing evidence."
    )

    parser.add_argument(
        "root",
        nargs="?",
        default=".",
        help="Root folder to scan recursively. Default: current folder",
    )

    parser.add_argument(
        "--out",
        default="special_unit_data_audit",
        help="Output folder",
    )

    args = parser.parse_args()

    root = Path(args.root).resolve()
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Scanning: {root}")
    print(f"Output:   {out_dir}")
    print()

    files = sorted(
        p
        for p in root.rglob("*")
        if p.is_file()
        and p.suffix.lower() in SOURCE_EXTENSIONS
        and out_dir not in p.parents
    )

    print(f"Files found: {len(files)}")

    candidates = []
    scanned_records = 0

    for file_no, path in enumerate(files, start=1):
        print(f"[{file_no}/{len(files)}] {path}")

        try:
            for idx, record in enumerate(read_records(path)):
                scanned_records += 1

                if not isinstance(record, dict):
                    continue

                candidate = extract_candidate(
                    path=path,
                    record=record,
                    record_index=idx,
                )

                if candidate:
                    candidates.append(candidate)

        except KeyboardInterrupt:
            raise
        except Exception as e:
            print(f"[WARN] failed file {path}: {e}")

    df = pd.DataFrame(candidates)

    print()
    print("=" * 100)
    print("SCAN COMPLETE")
    print("=" * 100)
    print(f"Records inspected: {scanned_records:,}")
    print(f"Candidate records: {len(df):,}")

    if df.empty:
        print("No relevant candidates found.")
        return

    # Basic cleaning / dedupe
    dedupe_cols = [
        "source_class",
        "date",
        "address",
        "rooms",
        "area_sqm",
        "price",
        "property_type",
    ]

    existing_dedupe_cols = [
        c for c in dedupe_cols if c in df.columns
    ]

    df = df.drop_duplicates(
        subset=existing_dedupe_cols,
        keep="first",
    ).reset_index(drop=True)

    # Save all candidates
    all_path = out_dir / "all_special_candidates.csv"
    df.to_csv(
        all_path,
        index=False,
        encoding="utf-8-sig",
    )

    # Save per evidence lane
    for source in [
        "sold",
        "asking",
        "new_project",
        "government_program",
        "unknown",
    ]:
        subset = df[df["source_class"] == source]

        subset.to_csv(
            out_dir / f"{source}_candidates.csv",
            index=False,
            encoding="utf-8-sig",
        )

    # Coverage
    coverage = create_coverage_summary(df)
    coverage.to_csv(
        out_dir / "coverage_summary.csv",
        index=False,
        encoding="utf-8-sig",
    )

    # File coverage
    file_summary = create_file_summary(df)
    file_summary.to_csv(
        out_dir / "file_summary.csv",
        index=False,
        encoding="utf-8-sig",
    )

    # Dedicated target files
    target_filters = {
        "2_room_candidates": df["rooms"].between(
            1.5, 2.5, inclusive="both"
        ),

        "6_room_candidates": df["rooms"].between(
            5.5, 6.99, inclusive="both"
        ),

        "7_plus_candidates": df["rooms"].fillna(-1) >= 7,

        "garden_candidates": df["special_types"]
        .fillna("")
        .str.contains("garden"),

        "duplex_candidates": df["special_types"]
        .fillna("")
        .str.contains("duplex"),

        "triplex_candidates": df["special_types"]
        .fillna("")
        .str.contains("triplex"),

        "penthouse_candidates": df["special_types"]
        .fillna("")
        .str.contains("penthouse"),

        "large_140_195": df["area_sqm"].between(
            140, 195, inclusive="both"
        ),

        "very_large_210_310": df["area_sqm"].between(
            210, 310, inclusive="both"
        ),
    }

    for name, mask in target_filters.items():
        df[mask].to_csv(
            out_dir / f"{name}.csv",
            index=False,
            encoding="utf-8-sig",
        )

    print()
    print("COVERAGE SUMMARY")
    print("-" * 100)
    print(coverage.to_string(index=False))

    print_top_examples(
        df,
        "2-ROOM CANDIDATES",
        df["rooms"].between(1.5, 2.5, inclusive="both"),
    )

    print_top_examples(
        df,
        "6-ROOM CANDIDATES",
        df["rooms"].between(5.5, 6.99, inclusive="both"),
    )

    print_top_examples(
        df,
        "7+ ROOM CANDIDATES",
        df["rooms"].fillna(-1) >= 7,
    )

    print_top_examples(
        df,
        "GARDEN CANDIDATES",
        df["special_types"].fillna("").str.contains("garden"),
    )

    print_top_examples(
        df,
        "DUPLEX / TRIPLEX / PENTHOUSE CANDIDATES",
        df["special_types"]
        .fillna("")
        .str.contains("duplex|triplex|penthouse"),
    )

    print()
    print("=" * 100)
    print("FILES CREATED")
    print("=" * 100)

    for p in sorted(out_dir.glob("*.csv")):
        print(p)

    print()
    print("SEND ME THESE FIRST:")
    print("1. coverage_summary.csv")
    print("2. file_summary.csv")
    print("3. 2_room_candidates.csv")
    print("4. 6_room_candidates.csv")
    print("5. 7_plus_candidates.csv")
    print("6. garden_candidates.csv")
    print("7. duplex_candidates.csv")
    print("8. triplex_candidates.csv")
    print("9. penthouse_candidates.csv")


if __name__ == "__main__":
    main()