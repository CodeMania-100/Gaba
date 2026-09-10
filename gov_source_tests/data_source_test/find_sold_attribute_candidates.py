# -*- coding: utf-8 -*-

import csv
import json
import re
from pathlib import Path
from collections import defaultdict

ROOT = Path.cwd()

TAX_FILE = ROOT / "tax_enriched_petah_tikva_5r_36m.json"

JSON_OUT = ROOT / "sold_attribute_candidates_v1.json"
TXT_OUT  = ROOT / "sold_attribute_candidates_v1.txt"

# ==============================================================
# The final curated apartment transactions.
# Deliberately excludes the cottage at מסקין 11.
# ==============================================================

TARGETS = {
    "APT36_37": [
        "3629954505", # היבנר 38
        "3603100099", # נקאש 15
        "3635365586", # תרזה קוגלמן 4
        "3635637403", # החרוב 25
        "3625659199", # מסקין 26
        "3626929892", # עין גדי 38
    ],

    "APT38": [
        "3606035885", # כנסת ישראל 17
        "3605884041", # י"ד הבנים 3
        "3626587054", # ישראל ישעיהו 6
        "3602707207", # פנחס חגין 1
        "3602250022", # הפרדס 8
        "3635365586", # תרזה קוגלמן 4
    ],

    "APT39": [
        "3633131484", # מבצע דקל 14
        "3601967910", # איסר הראל 6
        "3605029846", # כנסת ישראל 17
        "3655065895", # התשעים ושלוש 3
        "3603812310", # יעל רום 17
        "3633966655", # שלומציון המלכה 6
    ],
}

SKIP_PARTS = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    ".next",
    "__pycache__",
    ".model-cache",
    "test-results",
}

# Avoid circular evidence from our own generated reports.
SKIP_NAMES = (
    "special_attribute_evidence",
    "special_review_evidence",
    "special_sold_shortlist",
    "sold_attribute_candidates",
    "special_evidence_audit",
)

# Registered transaction sources are used for the target baseline,
# not as enrichment sources.
SKIP_ENRICHMENT_NAMES = (
    "tax_enriched",
    "nearby_deals",
    "nearby-deals",
    "latest_deals",
    "latest-deals",
)

TEXT_EXTENSIONS = {
    ".txt", ".md", ".html", ".htm"
}

STRUCTURED_EXTENSIONS = {
    ".json", ".csv", ".jsonl"
}

MAX_TEXT_FILE = 15 * 1024 * 1024

# ==============================================================
# Basic helpers
# ==============================================================

def first(d, *keys):
    for k in keys:
        if isinstance(d, dict) and k in d:
            v = d[k]
            if v not in (None, "", []):
                return v
    return None


def text(v):
    if v is None:
        return ""

    return (
        str(v)
        .replace("\r", " ")
        .replace("\n", " ")
        .strip()
    )


def number(v):
    if v in (None, "") or isinstance(v, bool):
        return None

    if isinstance(v, (int, float)):
        return float(v)

    s = (
        str(v)
        .replace(",", "")
        .replace("₪", "")
    )

    m = re.search(r"-?\d+(?:\.\d+)?", s)

    return float(m.group()) if m else None


def walk(obj):
    if isinstance(obj, dict):
        yield obj

        for v in obj.values():
            yield from walk(v)

    elif isinstance(obj, list):
        for x in obj:
            yield from walk(x)


def norm(s):
    s = text(s).lower()

    for x in (
        "פתח תקווה",
        "פתח-תקווה",
        "petah tikva",
        "petach tikva",
    ):
        s = s.replace(x, "")

    s = re.sub(
        r'[,.;:"״׳\-–—()]',
        " ",
        s
    )

    s = re.sub(r"\s+", " ", s)

    return s.strip()


def get_address(d):
    addr = text(first(
        d,
        "address",
        "fullAddress",
        "address_text",
        "full_address",
    ))

    if addr:
        return addr

    street = text(first(
        d,
        "street",
        "streetName",
        "streetNameHeb",
        "street_name",
    ))

    house = text(first(
        d,
        "house",
        "houseNum",
        "houseNumber",
        "house_number",
    ))

    if street:
        return f"{street} {house}".strip()

    return ""


def split_address(addr):
    a = norm(addr)

    if not a:
        return "", None

    m = re.search(
        r"\s+(\d+[א-ת]?)$",
        a
    )

    if not m:
        return a, None

    return (
        a[:m.start()].strip(),
        m.group(1)
    )


def same_building(a, b):
    sa, ha = split_address(a)
    sb, hb = split_address(b)

    return bool(
        sa
        and sb
        and sa == sb
        and ha
        and hb
        and ha == hb
    )


def same_street(a, b):
    sa, _ = split_address(a)
    sb, _ = split_address(b)

    return bool(
        sa
        and sb
        and sa == sb
    )


def full_blob(d):
    try:
        return json.dumps(
            d,
            ensure_ascii=False
        )
    except Exception:
        return str(d)


# ==============================================================
# Floor normalization
# ==============================================================

HEBREW_FLOORS = {
    "קרקע": 0,

    "ראשונה": 1,
    "שניה": 2,
    "שנייה": 2,
    "שלישית": 3,
    "רביעית": 4,
    "חמישית": 5,
    "שישית": 6,
    "שביעית": 7,
    "שמינית": 8,
    "תשיעית": 9,
    "עשירית": 10,

    "אחת עשרה": 11,
    "שתים עשרה": 12,
    "שתיים עשרה": 12,
    "שלוש עשרה": 13,
    "ארבע עשרה": 14,
    "חמש עשרה": 15,
    "שש עשרה": 16,
    "שבע עשרה": 17,
    "שמונה עשרה": 18,
    "תשע עשרה": 19,

    "עשרים": 20,
    "עשרים ואחת": 21,
    "עשרים ושתיים": 22,
    "עשרים ושלוש": 23,
    "עשרים וארבע": 24,
    "עשרים וחמש": 25,
    "עשרים ושש": 26,
    "עשרים ושבע": 27,
    "עשרים ושמונה": 28,
    "עשרים ותשע": 29,
    "שלושים": 30,
}


def floor_tokens(v):
    s = text(v)

    if not s:
        return set()

    result = set()

    # Digits.
    for x in re.findall(r"\b\d{1,2}\b", s):
        result.add(int(x))

    # Hebrew floor names.
    # Longest first so "עשרים ושבע" matches before "עשרים".
    for phrase, value in sorted(
        HEBREW_FLOORS.items(),
        key=lambda x: -len(x[0])
    ):
        if phrase in s:
            result.add(value)

    if "גג" in s:
        result.add("roof")

    if "מרתף" in s:
        result.add("basement")

    return result


def floor_similarity(a, b):
    aa = floor_tokens(a)
    bb = floor_tokens(b)

    if not aa or not bb:
        return None

    inter = aa & bb

    if aa == bb:
        return 1.0

    if inter:
        return len(inter) / max(
            len(aa),
            len(bb)
        )

    return 0.0


# ==============================================================
# Extract explicit listing/project attributes
# ==============================================================

def detect_type(blob):
    b = blob.lower()

    if "טריפלקס" in b or "triplex" in b:
        return "triplex"

    if "דופלקס" in b or "duplex" in b:
        return "duplex"

    if (
        "פנטהאוז" in b
        or "פנטהאוס" in b
        or "דירת גג" in b
        or "penthouse" in b
    ):
        return "penthouse"

    if (
        "דירת גן" in b
        or "דירת-גן" in b
        or "garden apartment" in b
    ):
        return "garden"

    return None


def description(d):
    return text(first(
        d,
        "description",
        "listingDescription",
        "description_raw",
        "description_start",
        "text",
        "title",
    ))


def structured_rooms(d):
    return number(first(
        d,
        "rooms",
        "roomCount",
        "numberOfRooms",
        "rooms_count",
    ))


def rooms_from_text(desc):
    patterns = [
        r"(\d+(?:\.\d+)?)\s*חדרים",
        r"(\d+(?:\.\d+)?)\s*חד[\"״']?",
    ]

    for p in patterns:
        m = re.search(p, desc)

        if m:
            return float(m.group(1))

    return None


def built_area(d, desc):
    x = number(first(
        d,
        "built_area",
        "builtArea",
        "squareMeterBuild",
        "buildingMR",
    ))

    if x is not None:
        return x

    for p in (
        r"(\d+(?:\.\d+)?)\s*מ[\"״']?ר\s*בנוי",
        r"בנוי[:\s]+(\d+(?:\.\d+)?)\s*מ",
        r"שטח\s*בנוי[:\s]+(\d+(?:\.\d+)?)",
    ):
        m = re.search(p, desc)

        if m:
            return float(m.group(1))

    return None


def advertised_area(d):
    return number(first(
        d,
        "advertised_area",
        "advertisedArea",
        "squareMeter",
        "areaSqm",
        "area",
    ))


def explicit_outdoor(desc):
    balconies = []
    gardens = []

    # "מרפסת 72 מ"ר"
    for m in re.finditer(
        r"(?:מרפסות|מרפסת(?:\s+שמש)?)"
        r"\s*(?:בשטח|של|כ|:|-)?\s*"
        r"(\d+(?:\.\d+)?)\s*"
        r"(?:מ[\"״']?ר|מר|מטר)",
        desc
    ):
        balconies.append(
            float(m.group(1))
        )

    # "80 מ"ר מרפסות"
    for m in re.finditer(
        r"(\d+(?:\.\d+)?)\s*"
        r"(?:מ[\"״']?ר|מר|מטר)\s*"
        r"(?:של\s+)?מרפסות",
        desc
    ):
        balconies.append(
            float(m.group(1))
        )

    # "23 מ"ר גינה"
    for m in re.finditer(
        r"(\d+(?:\.\d+)?)\s*"
        r"(?:מ[\"״']?ר|מר|מטר)\s*"
        r"(?:של\s+)?(?:גינה|חצר)",
        desc
    ):
        gardens.append(
            float(m.group(1))
        )

    for m in re.finditer(
        r"(?:גינה|חצר)"
        r"\s*(?:בשטח|של|כ|:|-)?\s*"
        r"(\d+(?:\.\d+)?)\s*"
        r"(?:מ[\"״']?ר|מר|מטר)",
        desc
    ):
        gardens.append(
            float(m.group(1))
        )

    balconies = list(
        dict.fromkeys(balconies)
    )

    gardens = list(
        dict.fromkeys(gardens)
    )

    return {
        "balcony_components": balconies or None,
        "balcony_total": (
            sum(balconies)
            if balconies
            else None
        ),
        "garden_components": gardens or None,
        "garden_total": (
            sum(gardens)
            if gardens
            else None
        ),
    }


def parking(desc, d):
    structured = number(first(
        d,
        "parkingSpacesCount",
        "parking_count",
        "parkingCount",
    ))

    if structured is not None:
        return {
            "count": structured,
            "present": True
        }

    mapping = [
        (r"(?:3|שלוש)\s*חניות", 3),
        (r"(?:2|שתי)\s*חניות", 2),
    ]

    for pattern, value in mapping:
        if re.search(pattern, desc):
            return {
                "count": float(value),
                "present": True
            }

    if (
        "חניה" in desc
        and "ללא חניה" not in desc
    ):
        return {
            "count": 1.0,
            "present": True
        }

    has = first(
        d,
        "hasParking",
        "has_parking",
    )

    if has is True:
        return {
            "count": None,
            "present": True
        }

    if has is False:
        return {
            "count": 0,
            "present": False
        }

    return {
        "count": None,
        "present": None
    }


def storage(desc, d):
    if "ללא מחסן" in desc:
        return False

    if "מחסן" in desc:
        return True

    v = first(
        d,
        "hasStorage",
        "has_storage",
        "storage",
    )

    if isinstance(v, bool):
        return v

    return None


def elevator(desc, d):
    if "ללא מעלית" in desc:
        return False

    if "מעלית" in desc:
        return True

    v = first(
        d,
        "hasElevator",
        "has_elevator",
        "elevator",
    )

    if isinstance(v, bool):
        return v

    return None


def orientation(desc):
    found = []

    for value, words in {
        "north": ("צפון", "north"),
        "south": ("דרום", "south"),
        "east": ("מזרח", "east"),
        "west": ("מערב", "west"),
    }.items():

        if any(
            word.lower() in desc.lower()
            for word in words
        ):
            found.append(value)

    return found or None


def view(desc):
    found = []

    mapping = {
        "open_view": (
            "נוף פתוח",
            "open view",
        ),
        "sea_view": (
            "נוף לים",
            "sea view",
        ),
        "park_view": (
            "נוף לפארק",
            "park view",
        ),
    }

    for value, words in mapping.items():

        if any(
            w.lower() in desc.lower()
            for w in words
        ):
            found.append(value)

    return found or None


def condition(desc):
    found = []

    if any(x in desc for x in (
        "שופצה",
        "שופץ",
        "משופצת",
        "משופץ",
        "שופצה מהיסוד",
    )):
        found.append("renovated")

    if any(x in desc for x in (
        "משודרג",
        "משודרגת",
    )):
        found.append("upgraded")

    if any(x in desc for x in (
        "חדש מקבלן",
        "דירה חדשה",
        "חדש בפרויקט",
    )):
        found.append("new_property")

    if any(x in desc for x in (
        "לשיפוץ",
        "דרוש שיפוץ",
        "דורש שיפוץ",
    )):
        found.append(
            "needs_renovation"
        )

    return found or None


def floor_value(d, desc):
    structured = text(first(
        d,
        "floor",
        "floorNo",
        "floor_number",
        "floorNumber",
    ))

    # Prefer a two-level pattern from description.
    for p in (
        r"(?:קומה|קומות|בקומות)\s*(\d+)\s*[\+\-]\s*(\d+)",
        r"(\d+)\s*[\+\-]\s*(\d+)\s*(?:קומה|קומות)",
    ):
        m = re.search(p, desc)

        if m:
            return (
                f"{m.group(1)}+"
                f"{m.group(2)}"
            )

    return structured or None


def identifiers(d):
    result = {}

    key_map = {
        "listing_id": (
            "listingId",
            "listing_id",
            "token",
            "id",
        ),
        "deal_id": (
            "dealId",
            "deal_id",
        ),
        "unit_number": (
            "unitNumber",
            "unit_number",
            "apartmentNumber",
            "apartment_number",
            "apartmentNo",
        ),
        "sub_parcel": (
            "subParcelNum",
            "sub_parcel",
        ),
        "project_id": (
            "projectId",
            "project_id",
        ),
    }

    for outkey, keys in key_map.items():
        v = first(d, *keys)

        if v not in (None, ""):
            result[outkey] = str(v)

    return result


def source_category(path):
    p = str(path).lower()

    if "yad2" in p:
        return "yad2"

    if "yad1" in p:
        return "yad1"

    if "madlan" in p:
        return "madlan"

    if "diraly" in p:
        return "project_directory"

    if "developer" in p:
        return "developer"

    if "floorplan" in p or "floor_plan" in p:
        return "floorplan"

    if "brochure" in p:
        return "brochure"

    return "other_local"


# ==============================================================
# Load exact Tax targets by deal ID
# ==============================================================

if not TAX_FILE.exists():
    raise SystemExit(
        f"NOT FOUND: {TAX_FILE}"
    )

with TAX_FILE.open(
    "r",
    encoding="utf-8-sig"
) as f:
    tax_raw = json.load(f)

wanted_ids = {
    deal_id
    for ids in TARGETS.values()
    for deal_id in ids
}

tax_by_id = {}

for d in walk(tax_raw):

    if not isinstance(d, dict):
        continue

    deal_id = first(
        d,
        "dealId",
        "deal_id",
    )

    if deal_id is None:
        continue

    deal_id = str(deal_id)

    if deal_id not in wanted_ids:
        continue

    tax_by_id[deal_id] = {
        "deal_id": deal_id,

        "address": get_address(d),

        "rooms": number(first(
            d,
            "rooms",
            "roomCount",
        )),

        "area": number(first(
            d,
            "asset_area",
            "area",
            "buildingMR",
        )),

        "price": number(first(
            d,
            "deal_amount",
            "dealAmount",
            "price",
        )),

        "date": text(first(
            d,
            "deal_date",
            "dealDate",
        )),

        "floor": text(first(
            d,
            "floorNo",
            "floor",
        )) or None,

        "tax_property_type": text(first(
            d,
            "dealNatureDescription",
            "property_type_description",
            "propertyType",
        )) or None,

        "sub_parcel": (
            str(first(
                d,
                "subParcelNum",
                "sub_parcel"
            ))
            if first(
                d,
                "subParcelNum",
                "sub_parcel"
            ) is not None
            else None
        ),
    }

missing = wanted_ids - set(
    tax_by_id.keys()
)

if missing:
    print(
        "WARNING — target Tax IDs not found:",
        sorted(missing)
    )


# ==============================================================
# Candidate extraction and matching
# ==============================================================

def score_candidate(target, record):
    addr = record.get("address") or ""

    exact_building = same_building(
        target["address"],
        addr
    )

    street_only = (
        not exact_building
        and same_street(
            target["address"],
            addr
        )
    )

    if not exact_building and not street_only:
        return None

    score = 0
    reasons = []

    if exact_building:
        score += 40
        reasons.append("exact_building")

    elif street_only:
        score += 5
        reasons.append("same_street_only")

    rooms = record["attributes"].get(
        "rooms"
    )

    if (
        rooms is not None
        and target["rooms"] is not None
    ):
        diff = abs(
            rooms - target["rooms"]
        )

        if diff <= 0.1:
            score += 20
            reasons.append("exact_rooms")

        elif diff <= 1:
            score += 5
            reasons.append("rooms_within_1")

    area = (
        record["attributes"].get(
            "built_area"
        )
        or record["attributes"].get(
            "advertised_area"
        )
    )

    if (
        area is not None
        and target["area"] is not None
    ):

        diff = abs(
            area - target["area"]
        )

        pct = (
            diff / target["area"]
            if target["area"]
            else 99
        )

        if pct <= 0.03:
            score += 20
            reasons.append(
                "area_within_3pct"
            )

        elif pct <= 0.07:
            score += 12
            reasons.append(
                "area_within_7pct"
            )

        elif pct <= 0.15:
            score += 5
            reasons.append(
                "area_within_15pct"
            )

    floor_sim = floor_similarity(
        target.get("floor"),
        record["attributes"].get(
            "floor_configuration"
        )
    )

    if floor_sim == 1:
        score += 25
        reasons.append(
            "exact_floor_pattern"
        )

    elif (
        floor_sim is not None
        and floor_sim >= 0.5
    ):
        score += 12
        reasons.append(
            "partial_floor_overlap"
        )

    typ = record["attributes"].get(
        "property_type"
    )

    if typ in {
        "duplex",
        "triplex",
        "penthouse",
        "garden",
    }:
        score += 8
        reasons.append(
            f"special_type_{typ}"
        )

    ids = record.get(
        "identifiers",
        {}
    )

    exact_link = False

    # Same deal ID is a genuine stable link,
    # although such a record is usually another deal mirror.
    if (
        ids.get("deal_id")
        and ids["deal_id"]
        == target["deal_id"]
    ):
        score += 100
        reasons.append(
            "same_deal_id"
        )
        exact_link = True

    # Same registered sub-parcel is also strong.
    if (
        target.get("sub_parcel")
        and ids.get("sub_parcel")
        and ids["sub_parcel"]
        == target["sub_parcel"]
    ):
        score += 100
        reasons.append(
            "same_sub_parcel"
        )
        exact_link = True

    if exact_link:
        match_class = (
            "EXACT_UNIT_LINKED"
        )

    elif (
        exact_building
        and score >= 90
    ):
        match_class = (
            "HIGH_MATCH_CANDIDATE"
        )

    elif (
        exact_building
        and score >= 60
    ):
        match_class = (
            "STRONG_BUILDING_UNIT_CANDIDATE"
        )

    elif exact_building:
        match_class = (
            "SAME_BUILDING_PRODUCT_CONTEXT"
        )

    else:
        match_class = (
            "SAME_STREET_ONLY"
        )

    return {
        "score": score,
        "match_class": match_class,
        "reasons": reasons,
        "exact_unit_linked": exact_link,
        "floor_similarity": floor_sim,
    }


def property_record(d, path):
    blob = full_blob(d)
    desc = description(d)

    attrs = {
        "property_type": (
            detect_type(blob)
            or text(first(
                d,
                "propertyType",
                "property_type",
                "propertyTypeText"
            ))
            or None
        ),

        "rooms": (
            structured_rooms(d)
            or rooms_from_text(desc)
        ),

        "built_area": built_area(
            d,
            desc
        ),

        "advertised_area": (
            advertised_area(d)
        ),

        "floor_configuration": (
            floor_value(d, desc)
        ),

        "parking": parking(
            desc,
            d
        ),

        "storage": storage(
            desc,
            d
        ),

        "elevator": elevator(
            desc,
            d
        ),

        "orientation": (
            orientation(desc)
        ),

        "view": view(desc),

        "condition": condition(desc),
    }

    attrs.update(
        explicit_outdoor(desc)
    )

    return {
        "address": get_address(d),
        "attributes": attrs,
        "identifiers": identifiers(d),
        "description": (
            desc[:1200]
            if desc
            else None
        ),
        "source": str(path),
        "source_category": (
            source_category(path)
        ),
    }


# ==============================================================
# Scan structured files
# ==============================================================

candidates = defaultdict(list)

files_scanned = 0
records_checked = 0

for path in ROOT.rglob("*"):

    if not path.is_file():
        continue

    if any(
        part.lower() in SKIP_PARTS
        for part in path.parts
    ):
        continue

    name_lower = path.name.lower()

    if any(
        x in name_lower
        for x in SKIP_NAMES
    ):
        continue

    if any(
        x in name_lower
        for x in SKIP_ENRICHMENT_NAMES
    ):
        continue

    suffix = path.suffix.lower()

    if suffix not in (
        STRUCTURED_EXTENSIONS
        | TEXT_EXTENSIONS
    ):
        continue

    files_scanned += 1

    # ----------------------------------------------------------
    # JSON / CSV / JSONL
    # ----------------------------------------------------------

    if suffix in STRUCTURED_EXTENSIONS:

        try:
            if suffix == ".json":

                with path.open(
                    "r",
                    encoding="utf-8-sig"
                ) as f:
                    raw = json.load(f)

                iterable = walk(raw)

            elif suffix == ".jsonl":

                rows = []

                with path.open(
                    "r",
                    encoding="utf-8-sig"
                ) as f:

                    for line in f:

                        line = line.strip()

                        if not line:
                            continue

                        try:
                            rows.append(
                                json.loads(line)
                            )
                        except Exception:
                            pass

                iterable = rows

            else:

                with path.open(
                    "r",
                    encoding="utf-8-sig",
                    newline=""
                ) as f:
                    iterable = list(
                        csv.DictReader(f)
                    )

            for d in iterable:

                if not isinstance(d, dict):
                    continue

                records_checked += 1

                rec = property_record(
                    d,
                    path
                )

                if not rec["address"]:
                    continue

                for deal_id, target in (
                    tax_by_id.items()
                ):

                    match = score_candidate(
                        target,
                        rec
                    )

                    if match is None:
                        continue

                    candidates[
                        deal_id
                    ].append({
                        **rec,
                        **match,
                    })

        except Exception:
            pass

    # ----------------------------------------------------------
    # Free-text/HTML files
    # ----------------------------------------------------------

    else:

        try:
            if (
                path.stat().st_size
                > MAX_TEXT_FILE
            ):
                continue

            content = path.read_text(
                encoding="utf-8-sig",
                errors="ignore"
            )

        except Exception:
            continue

        compact = re.sub(
            r"\s+",
            " ",
            content
        )

        compact_norm = norm(compact)

        for deal_id, target in (
            tax_by_id.items()
        ):

            street, house = split_address(
                target["address"]
            )

            if not street:
                continue

            needle = norm(
                target["address"]
            )

            pos = compact_norm.find(
                needle
            )

            if pos < 0:
                continue

            # Use original string search where possible.
            raw_pos = content.find(
                target["address"]
            )

            if raw_pos < 0:
                raw_pos = 0

            snippet = content[
                max(0, raw_pos - 1200):
                raw_pos + 3000
            ]

            fake = {
                "address": (
                    target["address"]
                ),
                "description": snippet,
            }

            rec = property_record(
                fake,
                path
            )

            rec["text_file_match"] = True

            match = score_candidate(
                target,
                rec
            )

            if match:
                candidates[
                    deal_id
                ].append({
                    **rec,
                    **match,
                })


# ==============================================================
# Dedupe candidate representations
# ==============================================================

def dedupe(rows):
    result = []
    seen = set()

    for r in sorted(
        rows,
        key=lambda x: (
            -x["score"],
            x["source"]
        )
    ):

        key = (
            r["source"],
            r["identifiers"].get(
                "listing_id"
            ),
            norm(
                r.get("address")
            ),
            r["attributes"].get(
                "rooms"
            ),
            r["attributes"].get(
                "built_area"
            ),
            r["attributes"].get(
                "advertised_area"
            ),
            (
                r.get("description")
                or ""
            )[:150],
        )

        if key in seen:
            continue

        seen.add(key)
        result.append(r)

    return result


# ==============================================================
# Build report
# ==============================================================

output = {
    "version": (
        "sold_attribute_candidates_v1"
    ),

    "rules": {
        "EXACT_UNIT_LINKED": (
            "Stable deal/subparcel link. "
            "Potentially usable as exact-unit enrichment after review."
        ),

        "HIGH_MATCH_CANDIDATE": (
            "Exact building plus very strong rooms/area/floor match. "
            "NOT automatically treated as the same sold unit."
        ),

        "SAME_BUILDING_PRODUCT_CONTEXT": (
            "Building/project context only."
        ),

        "SAME_STREET_ONLY": (
            "Directional context only; never copied to sold unit."
        ),
    },

    "files_scanned": files_scanned,
    "records_checked": records_checked,

    "baskets": {},
}

for basket, deal_ids in TARGETS.items():

    basket_rows = []

    for deal_id in deal_ids:

        target = tax_by_id.get(
            deal_id
        )

        if target is None:
            continue

        rows = dedupe(
            candidates.get(
                deal_id,
                []
            )
        )

        # Same-street records are much less useful.
        strong = [
            x for x in rows
            if x["match_class"]
            != "SAME_STREET_ONLY"
        ]

        street = [
            x for x in rows
            if x["match_class"]
            == "SAME_STREET_ONLY"
        ]

        basket_rows.append({
            "target_transaction": (
                target
            ),

            "strong_candidates": (
                strong[:25]
            ),

            "same_street_context": (
                street[:5]
            ),

            "counts": {
                "exact_unit_linked": sum(
                    x["match_class"]
                    == "EXACT_UNIT_LINKED"
                    for x in rows
                ),

                "high_match_candidate": sum(
                    x["match_class"]
                    == "HIGH_MATCH_CANDIDATE"
                    for x in rows
                ),

                "strong_building_unit_candidate": sum(
                    x["match_class"]
                    == "STRONG_BUILDING_UNIT_CANDIDATE"
                    for x in rows
                ),

                "same_building_product_context": sum(
                    x["match_class"]
                    == "SAME_BUILDING_PRODUCT_CONTEXT"
                    for x in rows
                ),

                "same_street_only": len(
                    street
                ),
            },
        })

    output["baskets"][
        basket
    ] = basket_rows


with JSON_OUT.open(
    "w",
    encoding="utf-8"
) as f:

    json.dump(
        output,
        f,
        ensure_ascii=False,
        indent=2
    )


# ==============================================================
# Human-readable report
# ==============================================================

lines = []

def out(x=""):
    lines.append(str(x))


out("=" * 150)
out("SOLD ATTRIBUTE ENRICHMENT CANDIDATES V1")
out("NO NETWORK / API REQUESTS")
out("=" * 150)

out(
    f"FILES SCANNED: {files_scanned}"
)

out(
    f"STRUCTURED RECORDS CHECKED: "
    f"{records_checked}"
)


for basket, items in (
    output["baskets"].items()
):

    out()
    out("#" * 150)
    out(basket)
    out("#" * 150)

    for item in items:

        t = item[
            "target_transaction"
        ]

        out()
        out(
            f"DEAL {t['deal_id']} | "
            f"{t['address']} | "
            f"{t['rooms']}R | "
            f"{t['area']}m² | "
            f"₪{t['price']:,.0f} | "
            f"floor={t['floor']} | "
            f"{t['date']}"
        )

        out(
            "COUNTS: "
            + json.dumps(
                item["counts"],
                ensure_ascii=False
            )
        )

        if not item[
            "strong_candidates"
        ]:
            out(
                "  NO SAME-BUILDING "
                "ENRICHMENT RECORD FOUND"
            )

        for i, c in enumerate(
            item[
                "strong_candidates"
            ][:12],
            1
        ):

            a = c["attributes"]

            out(
                f"  {i:02}. "
                f"{c['match_class']} "
                f"SCORE={c['score']} | "
                f"source={c['source_category']}"
            )

            out(
                "      "
                f"address={c['address']} | "
                f"type={a['property_type']} | "
                f"rooms={a['rooms']} | "
                f"built={a['built_area']} | "
                f"adv={a['advertised_area']} | "
                f"floor={a['floor_configuration']}"
            )

            out(
                "      "
                f"balcony={a['balcony_total']} | "
                f"garden={a['garden_total']} | "
                f"parking={a['parking']} | "
                f"storage={a['storage']} | "
                f"elevator={a['elevator']}"
            )

            out(
                "      "
                f"orientation={a['orientation']} | "
                f"view={a['view']} | "
                f"condition={a['condition']}"
            )

            out(
                "      REASONS: "
                + ", ".join(
                    c["reasons"]
                )
            )

            if c.get(
                "description"
            ):
                out(
                    "      DESC: "
                    + c[
                        "description"
                    ][:500]
                )

            out(
                "      SRC: "
                + c["source"]
            )


with TXT_OUT.open(
    "w",
    encoding="utf-8"
) as f:

    f.write(
        "\n".join(lines)
    )


print("CREATED:", JSON_OUT)
print("CREATED:", TXT_OUT)
print("FILES SCANNED:", files_scanned)
print("RECORDS CHECKED:", records_checked)

for basket, items in output["baskets"].items():

    exact = sum(
        x["counts"][
            "exact_unit_linked"
        ]
        for x in items
    )

    high = sum(
        x["counts"][
            "high_match_candidate"
        ]
        for x in items
    )

    building = sum(
        x["counts"][
            "strong_building_unit_candidate"
        ]
        + x["counts"][
            "same_building_product_context"
        ]
        for x in items
    )

    print(
        basket,
        "| exact linked:", exact,
        "| high candidates:", high,
        "| building context:", building
    )
