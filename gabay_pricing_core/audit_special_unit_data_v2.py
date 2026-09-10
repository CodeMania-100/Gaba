from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd


# ============================================================
# CONFIG
# ============================================================

SUPPORTED_EXTENSIONS = {
    ".json",
    ".jsonl",
    ".csv",
    ".parquet",
    ".xlsx",
    ".xls",
}

SPECIAL_KEYWORDS = {
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
        "roof apt",
    ],
}


# ============================================================
# FIELD ALIASES
# ============================================================

ALIASES_RAW = {
    "rooms": [
        "rooms",
        "room",
        "room_count",
        "rooms_count",
        "num_rooms",
        "number_of_rooms",
        "חדרים",
        "מספר חדרים",
    ],

    "area": [
        "area",
        "area_sqm",
        "areasqm",
        "sqm",
        "size",
        "built_area",
        "builtarea",
        "internal_area",
        "internalarea",
        "deal_area",
        "dealarea",
        "property_area",
        "שטח",
        "שטח דירה",
    ],

    "outdoor_area": [
        "balcony_area",
        "balconyarea",
        "terrace_area",
        "terracearea",
        "garden_area",
        "gardenarea",
        "outdoor_area",
        "outdoorarea",
        "שטח מרפסת",
        "מרפסת",
        "שטח גינה",
        "גינה",
    ],

    # FIXED: includes dealAmount / deal_amount
    "price": [
        "price",
        "deal_price",
        "dealprice",
        "deal_amount",
        "dealamount",
        "sale_price",
        "saleprice",
        "asking_price",
        "askingprice",
        "total_price",
        "totalprice",
        "amount",
        "מחיר",
    ],

    "price_per_sqm": [
        "price_per_sqm",
        "pricepersqm",
        "price_per_meter",
        "pricepermeter",
        "price_per_m2",
        "priceperm2",
        "sqm_price",
        "sqmprice",
        "מחיר למטר",
    ],

    "floor": [
        "floor",
        "floor_number",
        "floornumber",
        "asset_floor",
        "assetfloor",
        "קומה",
    ],

    "total_floors": [
        "total_floors",
        "totalfloors",
        "building_floors",
        "buildingfloors",
        "floors_in_building",
    ],

    "property_type": [
        "property_type",
        "propertytype",
        "asset_type",
        "assettype",
        "unit_type",
        "unittype",
        "subtype",
        "סוג נכס",
        "סוג",
    ],

    "description": [
        "description",
        "desc",
        "details",
        "remarks",
        "notes",
        "title",
        "subtitle",
        "text",
        "תיאור",
        "הערות",
    ],

    "address": [
        "address",
        "full_address",
        "fulladdress",
        "street_address",
        "streetaddress",
        "כתובת",
    ],

    "street": [
        "street",
        "street_name",
        "streetname",
        "רחוב",
    ],

    "city": [
        "city",
        "city_name",
        "cityname",
        "settlement",
        "יישוב",
        "עיר",
    ],

    "neighborhood": [
        "neighborhood",
        "neighbourhood",
        "neighborhood_name",
        "neighborhoodname",
        "שכונה",
    ],

    "date": [
        "date",
        "deal_date",
        "dealdate",
        "sale_date",
        "saledate",
        "transaction_date",
        "event_date",
        "eventdate",
        "published_at",
        "created_at",
        "תאריך",
    ],

    "lane": [
        "lane",
        "evidence_lane",
        "evidencelane",
    ],

    "source": [
        "source",
        "source_name",
        "sourcename",
    ],

    "deal_type": [
        "deal_type",
        "dealtype",
        "is_first_hand",
        "isfirsthand",
        "first_hand",
        "firsthand",
    ],

    "parking": [
        "parking",
        "parkings",
        "parking_count",
        "parkingcount",
        "parking_places",
        "חניה",
        "חניות",
    ],

    "storage": [
        "storage",
        "storage_room",
        "storageroom",
        "storage_size",
        "מחסן",
    ],

    "gush": [
        "gush",
        "block",
        "גוש",
    ],

    "helka": [
        "helka",
        "parcel",
        "חלקה",
    ],

    "tat_helka": [
        "tat_helka",
        "tathelka",
        "sub_parcel",
        "subparcel",
        "תת חלקה",
    ],

    "parcel_num": [
        "parcel_num",
        "parcelnum",
        "parcel_id",
        "parcelid",
    ],

    "latitude": [
        "latitude",
        "lat",
    ],

    "longitude": [
        "longitude",
        "lon",
        "lng",
    ],

    "source_id": [
        "source_id",
        "sourceid",
        "asset_id",
        "assetid",
        "id",
    ],
}


# ============================================================
# HELPERS
# ============================================================

def normalize_key(value: Any) -> str:
    value = str(value).strip().lower()

    return re.sub(
        r"[\s_\-./\\()\[\]{}:]+",
        "",
        value,
    )


ALIASES = {
    key: {normalize_key(x) for x in vals}
    for key, vals in ALIASES_RAW.items()
}


def clean_scalar(value: Any) -> Any:
    if value is None:
        return None

    try:
        if pd.isna(value):
            return None
    except Exception:
        pass

    if isinstance(value, (dict, list, tuple)):
        try:
            return json.dumps(
                value,
                ensure_ascii=False,
            )
        except Exception:
            return str(value)

    return value


def get_value(
    record: dict[str, Any],
    field: str,
) -> Any:

    aliases = ALIASES[field]

    for key, value in record.items():
        if normalize_key(key) in aliases:
            value = clean_scalar(value)

            if value is not None and str(value).strip():
                return value

    return None


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

    text = str(value)

    text = (
        text
        .replace(",", "")
        .replace("₪", "")
        .replace('מ"ר', "")
        .replace("מ״ר", "")
    )

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


def parse_date(value: Any) -> pd.Timestamp | None:
    if value is None:
        return None

    try:
        result = pd.to_datetime(
            value,
            errors="coerce",
        )

        if pd.isna(result):
            return None

        return result
    except Exception:
        return None


def all_text(record: dict[str, Any]) -> str:
    parts = []

    for key, value in record.items():
        if value is None:
            continue

        if isinstance(value, (str, int, float)):
            parts.append(str(value))

    return " ".join(parts).lower()


def detect_special_types(
    record: dict[str, Any],
) -> list[str]:

    text = all_text(record)

    result = []

    for label, keywords in SPECIAL_KEYWORDS.items():
        if any(
            keyword.lower() in text
            for keyword in keywords
        ):
            result.append(label)

    return sorted(set(result))


def make_parcel_key(
    gush: Any,
    helka: Any,
) -> str | None:

    if gush is None or helka is None:
        return None

    return f"{gush}-{helka}"


# ============================================================
# SOURCE CLASSIFICATION
# ============================================================

def normalize_lane_value(
    value: Any,
) -> str | None:

    if value is None:
        return None

    text = str(value).lower().strip()

    if text in {
        "sold",
        "sale",
        "transaction",
        "transactions",
        "completed_sale",
        "completed_sales",
    }:
        return "sold"

    if text in {
        "asking",
        "current_asking",
        "listing",
        "listings",
        "current_listing",
    }:
        return "asking"

    if text in {
        "new_project",
        "new_development",
        "competitor_project",
        "development",
    }:
        return "new_project"

    return None


def classify_source(
    path: Path,
    record: dict[str, Any],
) -> str:

    filename = path.name.lower()

    # --------------------------------------------------------
    # SUBJECT INVENTORY MUST NEVER COUNT AS MARKET EVIDENCE
    # --------------------------------------------------------

    if filename == "project_dry_run.json":
        return "subject_inventory"

    # --------------------------------------------------------
    # 1. explicit embedded lane is strongest
    # --------------------------------------------------------

    embedded_lane = normalize_lane_value(
        get_value(record, "lane")
    )

    if embedded_lane:
        return embedded_lane

    # --------------------------------------------------------
    # 2. embedded source
    # --------------------------------------------------------

    source = str(
        get_value(record, "source") or ""
    ).lower()

    if any(x in source for x in [
        "govmap",
        "nadlan_deals",
        "tax",
        "transaction",
    ]):
        return "sold"

    if any(x in source for x in [
        "madlan_listing",
        "yad2",
        "listing",
    ]):
        return "asking"

    if any(x in source for x in [
        "madlan_project",
        "new_project",
        "development",
    ]):
        return "new_project"

    # --------------------------------------------------------
    # 3. filename fallback
    # --------------------------------------------------------

    if any(x in filename for x in [
        "tax_",
        "tax-",
        "sold_",
        "transactions",
        "govmap",
    ]):
        return "sold"

    if any(x in filename for x in [
        "madlan_apify",
        "yad2",
        "listing",
        "listings",
    ]):
        return "asking"

    if any(x in filename for x in [
        "madlan_projects",
        "competitor",
        "developments",
    ]):
        return "new_project"

    return "unknown"


# ============================================================
# FILE LOADERS
# ============================================================

def walk_json(obj: Any):
    if isinstance(obj, dict):
        yield obj

        for value in obj.values():
            yield from walk_json(value)

    elif isinstance(obj, list):
        for value in obj:
            yield from walk_json(value)


def load_json(path: Path):
    try:
        with path.open(
            "r",
            encoding="utf-8-sig",
        ) as f:
            obj = json.load(f)

        yield from walk_json(obj)

    except Exception as exc:
        print(
            f"[WARN] JSON failed: "
            f"{path}: {exc}"
        )


def load_jsonl(path: Path):
    try:
        with path.open(
            "r",
            encoding="utf-8-sig",
        ) as f:

            for line in f:
                line = line.strip()

                if not line:
                    continue

                try:
                    obj = json.loads(line)
                except Exception:
                    continue

                yield from walk_json(obj)

    except Exception as exc:
        print(
            f"[WARN] JSONL failed: "
            f"{path}: {exc}"
        )


def dataframe_records(df: pd.DataFrame):
    df = df.copy()

    df.columns = [
        str(column)
        for column in df.columns
    ]

    for row in df.to_dict(
        orient="records",
    ):
        yield row


def load_tabular(path: Path):
    suffix = path.suffix.lower()

    try:
        if suffix == ".csv":
            try:
                df = pd.read_csv(
                    path,
                    low_memory=False,
                )
            except UnicodeDecodeError:
                df = pd.read_csv(
                    path,
                    encoding="cp1255",
                    low_memory=False,
                )

            yield from dataframe_records(df)

        elif suffix == ".parquet":
            df = pd.read_parquet(path)

            yield from dataframe_records(df)

        elif suffix in {".xlsx", ".xls"}:
            sheets = pd.read_excel(
                path,
                sheet_name=None,
            )

            for sheet_name, df in sheets.items():
                for record in dataframe_records(df):
                    record["_sheet_name"] = sheet_name
                    yield record

    except Exception as exc:
        print(
            f"[WARN] table failed: "
            f"{path}: {exc}"
        )


def read_records(path: Path):
    suffix = path.suffix.lower()

    if suffix == ".json":
        yield from load_json(path)

    elif suffix == ".jsonl":
        yield from load_jsonl(path)

    elif suffix in {
        ".csv",
        ".parquet",
        ".xlsx",
        ".xls",
    }:
        yield from load_tabular(path)


# ============================================================
# PROPERTY RECORD DETECTION
# ============================================================

def looks_like_property_record(
    record: dict[str, Any],
) -> bool:

    normalized_keys = {
        normalize_key(k)
        for k in record
    }

    evidence = 0

    for field in [
        "rooms",
        "area",
        "price",
        "address",
        "property_type",
        "floor",
    ]:
        if normalized_keys & ALIASES[field]:
            evidence += 1

    return evidence >= 2


# ============================================================
# TARGET CLASSIFICATION
# ============================================================

def classify_targets(
    rooms: float | None,
    area: float | None,
    special_types: list[str],
) -> list[str]:

    result = []

    if rooms is not None:

        if 1.5 <= rooms <= 2.5:
            result.append("2_room")

            if "garden" in special_types:
                result.append(
                    "2_room_garden"
                )

        if 5.5 <= rooms < 7:
            result.append("6_room")

            if "triplex" in special_types:
                result.append(
                    "6_room_triplex"
                )

            if "duplex" in special_types:
                result.append(
                    "6_room_duplex"
                )

            if "penthouse" in special_types:
                result.append(
                    "6_room_penthouse"
                )

            if "roof" in special_types:
                result.append(
                    "6_room_roof"
                )

        if rooms >= 7:
            result.append("7_plus_room")

            if "duplex" in special_types:
                result.append(
                    "7_plus_duplex"
                )

            if "triplex" in special_types:
                result.append(
                    "7_plus_triplex"
                )

            if "penthouse" in special_types:
                result.append(
                    "7_plus_penthouse"
                )

            if "roof" in special_types:
                result.append(
                    "7_plus_roof"
                )

    if area is not None:

        if 45 <= area <= 80:
            result.append(
                "small_area_45_80"
            )

        if 140 <= area <= 195:
            result.append(
                "large_area_140_195"
            )

        if 210 <= area <= 310:
            result.append(
                "very_large_area_210_310"
            )

    if special_types:
        result.append(
            "special_property_type"
        )

    return sorted(set(result))


# ============================================================
# RECORD EXTRACTION
# ============================================================

def extract_record(
    path: Path,
    record: dict[str, Any],
    record_index: int,
) -> dict[str, Any] | None:

    if not looks_like_property_record(record):
        return None

    rooms = to_number(
        get_value(record, "rooms")
    )

    area = to_number(
        get_value(record, "area")
    )

    outdoor = to_number(
        get_value(record, "outdoor_area")
    )

    price = to_number(
        get_value(record, "price")
    )

    ppm = to_number(
        get_value(record, "price_per_sqm")
    )

    floor = to_number(
        get_value(record, "floor")
    )

    total_floors = to_number(
        get_value(record, "total_floors")
    )

    special_types = detect_special_types(
        record
    )

    targets = classify_targets(
        rooms,
        area,
        special_types,
    )

    if not targets:
        return None

    if (
        ppm is None
        and price is not None
        and area
        and area > 0
    ):
        ppm = price / area

    gush = get_value(
        record,
        "gush",
    )

    helka = get_value(
        record,
        "helka",
    )

    tat_helka = get_value(
        record,
        "tat_helka",
    )

    parcel_num = get_value(
        record,
        "parcel_num",
    )

    parcel_key = (
        str(parcel_num)
        if parcel_num
        else make_parcel_key(
            gush,
            helka,
        )
    )

    raw_preview = {}

    for key, value in record.items():

        if len(raw_preview) >= 30:
            break

        value = clean_scalar(value)

        if value is None:
            continue

        text = str(value)

        if len(text) > 400:
            text = text[:400] + "..."

        raw_preview[str(key)] = text

    return {
        "source_class":
            classify_source(
                path,
                record,
            ),

        "file":
            str(path),

        "record_index":
            record_index,

        "lane_raw":
            get_value(record, "lane"),

        "source_raw":
            get_value(record, "source"),

        "source_id":
            get_value(record, "source_id"),

        "targets":
            " | ".join(targets),

        "special_types":
            " | ".join(special_types),

        "date":
            get_value(record, "date"),

        "city":
            get_value(record, "city"),

        "neighborhood":
            get_value(
                record,
                "neighborhood",
            ),

        "address":
            get_value(record, "address"),

        "street":
            get_value(record, "street"),

        "rooms":
            rooms,

        "area_sqm":
            area,

        "outdoor_area_sqm":
            outdoor,

        "floor":
            floor,

        "total_floors":
            total_floors,

        "property_type":
            get_value(
                record,
                "property_type",
            ),

        "deal_type":
            get_value(
                record,
                "deal_type",
            ),

        "price":
            price,

        "price_per_sqm":
            ppm,

        "parking":
            get_value(
                record,
                "parking",
            ),

        "storage":
            get_value(
                record,
                "storage",
            ),

        "gush":
            gush,

        "helka":
            helka,

        "tat_helka":
            tat_helka,

        "parcel_key":
            parcel_key,

        "latitude":
            to_number(
                get_value(
                    record,
                    "latitude",
                )
            ),

        "longitude":
            to_number(
                get_value(
                    record,
                    "longitude",
                )
            ),

        "description":
            get_value(
                record,
                "description",
            ),

        "raw_preview":
            json.dumps(
                raw_preview,
                ensure_ascii=False,
            ),
    }


# ============================================================
# DEDUPE
# ============================================================

def dedupe_candidates(
    df: pd.DataFrame,
) -> pd.DataFrame:

    if df.empty:
        return df

    dedupe_fields = [
        "source_class",
        "source_id",
        "date",
        "address",
        "rooms",
        "area_sqm",
        "price",
        "property_type",
    ]

    existing = [
        column
        for column in dedupe_fields
        if column in df.columns
    ]

    return (
        df
        .drop_duplicates(
            subset=existing,
            keep="first",
        )
        .reset_index(drop=True)
    )


# ============================================================
# MATCHED PAIRS
# ============================================================

def same_location(
    a: pd.Series,
    b: pd.Series,
) -> tuple[bool, str]:

    address_a = str(
        a.get("address") or ""
    ).strip()

    address_b = str(
        b.get("address") or ""
    ).strip()

    parcel_a = str(
        a.get("parcel_key") or ""
    ).strip()

    parcel_b = str(
        b.get("parcel_key") or ""
    ).strip()

    if (
        address_a
        and address_b
        and address_a == address_b
    ):
        return True, "same_address"

    if (
        parcel_a
        and parcel_b
        and parcel_a == parcel_b
    ):
        return True, "same_parcel"

    return False, ""


def date_difference_days(
    a: Any,
    b: Any,
) -> int | None:

    da = parse_date(a)
    db = parse_date(b)

    if da is None or db is None:
        return None

    return abs(
        (da - db).days
    )


def make_pair(
    special: pd.Series,
    normal: pd.Series,
    match_type: str,
) -> dict[str, Any]:

    price_special = special.get(
        "price"
    )

    price_normal = normal.get(
        "price"
    )

    area_special = special.get(
        "area_sqm"
    )

    area_normal = normal.get(
        "area_sqm"
    )

    ppm_special = special.get(
        "price_per_sqm"
    )

    ppm_normal = normal.get(
        "price_per_sqm"
    )

    price_delta = None
    price_delta_pct = None
    ppm_delta = None
    ppm_delta_pct = None

    if (
        pd.notna(price_special)
        and pd.notna(price_normal)
        and price_normal
    ):
        price_delta = (
            price_special
            - price_normal
        )

        price_delta_pct = (
            price_delta
            / price_normal
        )

    if (
        pd.notna(ppm_special)
        and pd.notna(ppm_normal)
        and ppm_normal
    ):
        ppm_delta = (
            ppm_special
            - ppm_normal
        )

        ppm_delta_pct = (
            ppm_delta
            / ppm_normal
        )

    area_diff_pct = None

    if (
        pd.notna(area_special)
        and pd.notna(area_normal)
        and area_normal
    ):
        area_diff_pct = abs(
            area_special
            - area_normal
        ) / area_normal

    return {
        "match_type":
            match_type,

        "special_type":
            special.get(
                "special_types"
            ),

        "address_special":
            special.get("address"),

        "address_normal":
            normal.get("address"),

        "parcel_key":
            special.get(
                "parcel_key"
            ),

        "date_special":
            special.get("date"),

        "date_normal":
            normal.get("date"),

        "date_difference_days":
            date_difference_days(
                special.get("date"),
                normal.get("date"),
            ),

        "rooms_special":
            special.get("rooms"),

        "rooms_normal":
            normal.get("rooms"),

        "area_special":
            area_special,

        "area_normal":
            area_normal,

        "area_difference_pct":
            area_diff_pct,

        "floor_special":
            special.get("floor"),

        "floor_normal":
            normal.get("floor"),

        "price_special":
            price_special,

        "price_normal":
            price_normal,

        "price_delta":
            price_delta,

        "price_delta_pct":
            price_delta_pct,

        "ppm_special":
            ppm_special,

        "ppm_normal":
            ppm_normal,

        "ppm_delta":
            ppm_delta,

        "ppm_delta_pct":
            ppm_delta_pct,

        "source_special":
            special.get("file"),

        "source_normal":
            normal.get("file"),

        "source_id_special":
            special.get(
                "source_id"
            ),

        "source_id_normal":
            normal.get(
                "source_id"
            ),
    }


def find_matched_pairs(
    market_df: pd.DataFrame,
    special_label: str,
) -> pd.DataFrame:

    if market_df.empty:
        return pd.DataFrame()

    sold = market_df[
        market_df[
            "source_class"
        ] == "sold"
    ].copy()

    if sold.empty:
        return pd.DataFrame()

    special = sold[
        sold["special_types"]
        .fillna("")
        .str.contains(
            special_label,
            case=False,
        )
    ]

    normal = sold[
        ~sold["special_types"]
        .fillna("")
        .str.contains(
            "garden|roof|duplex|triplex|penthouse",
            case=False,
            regex=True,
        )
    ]

    pairs = []

    for _, special_row in special.iterrows():

        for _, normal_row in normal.iterrows():

            matches_location, match_type = (
                same_location(
                    special_row,
                    normal_row,
                )
            )

            if not matches_location:
                continue

            rs = special_row.get("rooms")
            rn = normal_row.get("rooms")

            if (
                pd.notna(rs)
                and pd.notna(rn)
                and abs(rs - rn) > 1
            ):
                continue

            as_ = special_row.get(
                "area_sqm"
            )

            an = normal_row.get(
                "area_sqm"
            )

            if (
                pd.notna(as_)
                and pd.notna(an)
                and an > 0
            ):
                area_diff = (
                    abs(as_ - an)
                    / an
                )

                if area_diff > 0.35:
                    continue

            date_diff = (
                date_difference_days(
                    special_row.get("date"),
                    normal_row.get("date"),
                )
            )

            # 5-year maximum for exploratory pairs
            if (
                date_diff is not None
                and date_diff > 1826
            ):
                continue

            pairs.append(
                make_pair(
                    special_row,
                    normal_row,
                    match_type,
                )
            )

    return pd.DataFrame(pairs)


# ============================================================
# COVERAGE
# ============================================================

def coverage_table(
    market_df: pd.DataFrame,
) -> pd.DataFrame:

    targets = [
        "2_room",
        "2_room_garden",
        "6_room",
        "6_room_triplex",
        "6_room_duplex",
        "6_room_penthouse",
        "6_room_roof",
        "7_plus_room",
        "7_plus_duplex",
        "7_plus_triplex",
        "7_plus_penthouse",
        "7_plus_roof",
        "large_area_140_195",
        "very_large_area_210_310",
        "special_property_type",
    ]

    rows = []

    for target in targets:

        mask = (
            market_df["targets"]
            .fillna("")
            .str.contains(
                re.escape(target)
            )
        )

        subset = market_df[mask]

        row = {
            "target":
                target,

            "external_total":
                len(subset),
        }

        for lane in [
            "sold",
            "asking",
            "new_project",
            "unknown",
        ]:
            row[lane] = int(
                (
                    subset[
                        "source_class"
                    ] == lane
                ).sum()
            )

        row["with_price"] = int(
            subset["price"]
            .notna()
            .sum()
        )

        row["with_area"] = int(
            subset["area_sqm"]
            .notna()
            .sum()
        )

        row["with_outdoor_area"] = int(
            subset[
                "outdoor_area_sqm"
            ]
            .notna()
            .sum()
        )

        row["with_property_type"] = int(
            subset[
                "property_type"
            ]
            .notna()
            .sum()
        )

        rows.append(row)

    return pd.DataFrame(rows)


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "root",
        nargs="?",
        default=".",
    )

    parser.add_argument(
        "--out",
        default="special_unit_data_audit_v2",
    )

    args = parser.parse_args()

    root = Path(
        args.root
    ).resolve()

    out_dir = Path(
        args.out
    ).resolve()

    out_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    files = sorted(
        path
        for path in root.rglob("*")
        if (
            path.is_file()
            and path.suffix.lower()
            in SUPPORTED_EXTENSIONS
            and out_dir not in path.parents
        )
    )

    all_candidates = []
    file_stats = []

    print(
        f"Scanning {len(files)} files..."
    )

    for number, path in enumerate(
        files,
        start=1,
    ):

        print(
            f"[{number}/{len(files)}] "
            f"{path}"
        )

        inspected = 0
        property_records = 0
        candidates = 0

        lane_counts = {
            "sold": 0,
            "asking": 0,
            "new_project": 0,
            "subject_inventory": 0,
            "unknown": 0,
        }

        try:
            for index, record in enumerate(
                read_records(path)
            ):

                inspected += 1

                if not isinstance(
                    record,
                    dict,
                ):
                    continue

                if looks_like_property_record(
                    record
                ):
                    property_records += 1

                extracted = extract_record(
                    path,
                    record,
                    index,
                )

                if extracted is None:
                    continue

                candidates += 1

                lane = extracted[
                    "source_class"
                ]

                lane_counts[lane] = (
                    lane_counts.get(
                        lane,
                        0,
                    )
                    + 1
                )

                all_candidates.append(
                    extracted
                )

        except Exception as exc:
            print(
                f"[WARN] {path}: {exc}"
            )

        file_stats.append({
            "file":
                str(path),

            "records_inspected":
                inspected,

            "property_records":
                property_records,

            "candidate_records":
                candidates,

            **{
                f"{lane}_candidates": count
                for lane, count
                in lane_counts.items()
            },
        })

    df = pd.DataFrame(
        all_candidates
    )

    file_stats_df = pd.DataFrame(
        file_stats
    )

    file_stats_df.to_csv(
        out_dir
        / "scanned_files_summary.csv",
        index=False,
        encoding="utf-8-sig",
    )

    if df.empty:
        print(
            "No candidates found."
        )
        return

    df = dedupe_candidates(df)

    # --------------------------------------------------------
    # SUBJECT vs MARKET
    # --------------------------------------------------------

    subject_df = df[
        df["source_class"]
        == "subject_inventory"
    ].copy()

    market_df = df[
        df["source_class"]
        != "subject_inventory"
    ].copy()

    subject_df.to_csv(
        out_dir
        / "subject_inventory.csv",
        index=False,
        encoding="utf-8-sig",
    )

    market_df.to_csv(
        out_dir
        / "external_market_candidates.csv",
        index=False,
        encoding="utf-8-sig",
    )

    # --------------------------------------------------------
    # LANES
    # --------------------------------------------------------

    for lane in [
        "sold",
        "asking",
        "new_project",
        "unknown",
    ]:

        market_df[
            market_df[
                "source_class"
            ] == lane
        ].to_csv(
            out_dir
            / f"{lane}_external.csv",
            index=False,
            encoding="utf-8-sig",
        )

    # --------------------------------------------------------
    # TARGET OUTPUTS
    # --------------------------------------------------------

    filters = {
        "2_room_external":
            market_df[
                "rooms"
            ].between(
                1.5,
                2.5,
                inclusive="both",
            ),

        "6_room_external":
            market_df[
                "rooms"
            ].between(
                5.5,
                6.99,
                inclusive="both",
            ),

        "7_plus_external":
            market_df[
                "rooms"
            ].fillna(-1) >= 7,

        "garden_external":
            market_df[
                "special_types"
            ]
            .fillna("")
            .str.contains(
                "garden"
            ),

        "roof_external":
            market_df[
                "special_types"
            ]
            .fillna("")
            .str.contains(
                "roof"
            ),

        "duplex_external":
            market_df[
                "special_types"
            ]
            .fillna("")
            .str.contains(
                "duplex"
            ),

        "triplex_external":
            market_df[
                "special_types"
            ]
            .fillna("")
            .str.contains(
                "triplex"
            ),

        "penthouse_external":
            market_df[
                "special_types"
            ]
            .fillna("")
            .str.contains(
                "penthouse"
            ),

        "large_140_195_external":
            market_df[
                "area_sqm"
            ].between(
                140,
                195,
                inclusive="both",
            ),

        "very_large_210_310_external":
            market_df[
                "area_sqm"
            ].between(
                210,
                310,
                inclusive="both",
            ),
    }

    for name, mask in filters.items():

        market_df[mask].to_csv(
            out_dir
            / f"{name}.csv",
            index=False,
            encoding="utf-8-sig",
        )

    # --------------------------------------------------------
    # COVERAGE
    # --------------------------------------------------------

    coverage = coverage_table(
        market_df
    )

    coverage.to_csv(
        out_dir
        / "coverage_external_only.csv",
        index=False,
        encoding="utf-8-sig",
    )

    # --------------------------------------------------------
    # MATCHED-PAIR SEARCH
    # --------------------------------------------------------

    garden_pairs = (
        find_matched_pairs(
            market_df,
            "garden",
        )
    )

    garden_pairs.to_csv(
        out_dir
        / "garden_matched_pairs.csv",
        index=False,
        encoding="utf-8-sig",
    )

    roof_pairs = (
        find_matched_pairs(
            market_df,
            "roof",
        )
    )

    roof_pairs.to_csv(
        out_dir
        / "roof_matched_pairs.csv",
        index=False,
        encoding="utf-8-sig",
    )

    duplex_pairs = (
        find_matched_pairs(
            market_df,
            "duplex",
        )
    )

    duplex_pairs.to_csv(
        out_dir
        / "duplex_matched_pairs.csv",
        index=False,
        encoding="utf-8-sig",
    )

    penthouse_pairs = (
        find_matched_pairs(
            market_df,
            "penthouse",
        )
    )

    penthouse_pairs.to_csv(
        out_dir
        / "penthouse_matched_pairs.csv",
        index=False,
        encoding="utf-8-sig",
    )

    # --------------------------------------------------------
    # ZERO-CANDIDATE FILES
    # --------------------------------------------------------

    zero_files = file_stats_df[
        (
            file_stats_df[
                "property_records"
            ] > 0
        )
        &
        (
            file_stats_df[
                "candidate_records"
            ] == 0
        )
    ]

    zero_files.to_csv(
        out_dir
        / "files_with_property_data_but_no_special_candidates.csv",
        index=False,
        encoding="utf-8-sig",
    )

    # --------------------------------------------------------
    # TERMINAL SUMMARY
    # --------------------------------------------------------

    print()
    print("=" * 110)
    print("EXTERNAL MARKET COVERAGE")
    print("=" * 110)

    print(
        coverage.to_string(
            index=False
        )
    )

    print()
    print("=" * 110)
    print("MATCHED PAIRS")
    print("=" * 110)

    print(
        f"Garden pairs:     "
        f"{len(garden_pairs)}"
    )

    print(
        f"Roof pairs:       "
        f"{len(roof_pairs)}"
    )

    print(
        f"Duplex pairs:     "
        f"{len(duplex_pairs)}"
    )

    print(
        f"Penthouse pairs:  "
        f"{len(penthouse_pairs)}"
    )

    print()
    print(
        "Files containing property data "
        "but no special candidates:"
    )

    print(
        len(zero_files)
    )

    print()
    print("=" * 110)
    print("SEND ME THESE FILES")
    print("=" * 110)

    wanted = [
        "coverage_external_only.csv",
        "scanned_files_summary.csv",
        "2_room_external.csv",
        "6_room_external.csv",
        "7_plus_external.csv",
        "garden_external.csv",
        "roof_external.csv",
        "duplex_external.csv",
        "triplex_external.csv",
        "penthouse_external.csv",
        "large_140_195_external.csv",
        "very_large_210_310_external.csv",
        "garden_matched_pairs.csv",
        "roof_matched_pairs.csv",
        "files_with_property_data_but_no_special_candidates.csv",
    ]

    for name in wanted:
        print(
            out_dir / name
        )


if __name__ == "__main__":
    main()