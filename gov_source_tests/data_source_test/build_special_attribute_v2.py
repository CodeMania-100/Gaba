import csv
import json
import re
from pathlib import Path

ROOT = Path.cwd()

V1_FILE  = ROOT / "special_attribute_evidence_v1.json"
TAX_FILE = ROOT / "tax_enriched_petah_tikva_5r_36m.json"

JSON_OUT = ROOT / "special_attribute_evidence_v2.json"
TXT_OUT  = ROOT / "special_attribute_evidence_v2.txt"

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

def first(d, *keys):
    for k in keys:
        if isinstance(d, dict) and k in d and d[k] not in (None, "", []):
            return d[k]
    return None

def text(v):
    if v is None:
        return ""
    return str(v).replace("\r", " ").replace("\n", " ").strip()

def number(v):
    if v in (None, "") or isinstance(v, bool):
        return None

    if isinstance(v, (int, float)):
        return float(v)

    m = re.search(r"-?\d+(?:\.\d+)?", str(v).replace(",", "").replace("₪", ""))

    return float(m.group()) if m else None

def walk(x):
    if isinstance(x, dict):
        yield x
        for v in x.values():
            yield from walk(v)

    elif isinstance(x, list):
        for v in x:
            yield from walk(v)

def norm(s):
    s = text(s).lower()
    s = re.sub(r'[,.;:"״׳\-–—()]', " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()

def get_address(d):
    a = text(first(d, "address", "fullAddress", "address_text"))

    if a:
        return a

    street = text(first(
        d,
        "street",
        "streetName",
        "streetNameHeb"
    ))

    house = text(first(
        d,
        "house",
        "houseNum",
        "houseNumber"
    ))

    return f"{street} {house}".strip() if street else ""

def split_address(addr):
    a = norm(addr)

    m = re.search(r"\s+(\d+[א-ת]?)$", a)

    if not m:
        return a, None

    return a[:m.start()].strip(), m.group(1)

def same_building(a, b):
    sa, ha = split_address(a)
    sb, hb = split_address(b)

    return bool(
        sa and sb
        and sa == sb
        and ha is not None
        and hb is not None
        and ha == hb
    )

def same_street(a, b):
    sa, _ = split_address(a)
    sb, _ = split_address(b)

    return bool(sa and sb and sa == sb)

# ------------------------------------------------------------
# Safe description parsing
# ------------------------------------------------------------

def outdoor_mentions(desc):
    """
    Only recognizes numbers explicitly attached to a balcony /
    terrace / garden phrase.

    Never searches the whole JSON blob, so coordinates cannot
    become balcony areas.
    """

    d = text(desc)

    balconies = []
    gardens = []

    # Examples:
    # מרפסת 72 מ"ר
    # מרפסת שמש: 130 מ"ר
    # מרפסות ענקיות 117 מ"ר
    for m in re.finditer(
        r"(?:מרפסות|מרפסת(?:\s+שמש)?)"
        r"\s*(?:בשטח|של|כ|:|-)?\s*"
        r"(\d+(?:\.\d+)?)\s*"
        r"(?:מ[\"״']?ר|מר|מטר)",
        d
    ):
        balconies.append(float(m.group(1)))

    # Example:
    # 80 מר מרפסות
    for m in re.finditer(
        r"(\d+(?:\.\d+)?)\s*"
        r"(?:מ[\"״']?ר|מר|מטר)\s*"
        r"(?:של\s+)?מרפסות",
        d
    ):
        balconies.append(float(m.group(1)))

    # Examples:
    # 23 מ"ר גינה
    # גינה 90 מ"ר
    for m in re.finditer(
        r"(?:גינה|חצר)"
        r"\s*(?:בשטח|של|כ|:|-)?\s*"
        r"(\d+(?:\.\d+)?)\s*"
        r"(?:מ[\"״']?ר|מר|מטר)",
        d
    ):
        gardens.append(float(m.group(1)))

    for m in re.finditer(
        r"(\d+(?:\.\d+)?)\s*"
        r"(?:מ[\"״']?ר|מר|מטר)\s*"
        r"(?:של\s+)?(?:גינה|חצר)",
        d
    ):
        gardens.append(float(m.group(1)))

    # remove exact duplicates
    balconies = list(dict.fromkeys(balconies))
    gardens = list(dict.fromkeys(gardens))

    return {
        "balcony_components": balconies or None,
        "balcony_total": sum(balconies) if balconies else None,
        "garden_components": gardens or None,
        "garden_total": sum(gardens) if gardens else None,
    }

def parking_from_desc(desc, fallback=None):
    d = text(desc)

    patterns = [
        (r"3\s*חניות", 3),
        (r"שלוש\s+חניות", 3),
        (r"2\s*חניות", 2),
        (r"שתי\s+חניות", 2),
    ]

    for pattern, value in patterns:
        if re.search(pattern, d):
            return float(value)

    if fallback is not None:
        return fallback

    if "חניה" in d and "ללא חניה" not in d:
        return 1.0

    return None

def storage_from_desc(desc):
    d = text(desc)

    if "ללא מחסן" in d:
        return False

    if "מחסן" in d:
        return True

    return None

def elevator_from_desc(desc, fallback=None):
    d = text(desc)

    if "ללא מעלית" in d:
        return False

    if "מעלית" in d:
        return True

    return fallback

def orientations(desc):
    d = text(desc)

    found = []

    mapping = [
        ("north", "צפון"),
        ("south", "דרום"),
        ("east", "מזרח"),
        ("west", "מערב"),
    ]

    for label, word in mapping:
        if word in d:
            found.append(label)

    return found or None

def view_from_desc(desc):
    d = text(desc)

    found = []

    terms = {
        "open_view": "נוף פתוח",
        "sea_view": "נוף לים",
        "park_view": "נוף לפארק",
    }

    for label, phrase in terms.items():
        if phrase in d:
            found.append(label)

    return found or None

def condition_from_desc(desc):
    d = text(desc)

    found = []

    if any(x in d for x in (
        "שופצה מהיסוד",
        "משופצת",
        "משופץ",
        "שופצה",
    )):
        found.append("renovated")

    if any(x in d for x in (
        "משודרגת",
        "משודרג",
        "משודרג ומשופץ",
    )):
        found.append("upgraded")

    if any(x in d for x in (
        "חדש מקבלן",
        "דירה חדשה",
        "דירת גן חדשה",
    )):
        found.append("new_property")

    return found or None

def floor_configuration(desc, fallback=None):
    d = text(desc)

    patterns = [
        r"(?:קומה|קומות|בקומות)\s*(\d+)\s*\+\s*(\d+)",
        r"(\d+)\s*\+\s*(\d+)\s*(?:קומות|קומה)",
    ]

    for pattern in patterns:
        m = re.search(pattern, d)

        if m:
            return f"{m.group(1)}+{m.group(2)}"

    return fallback

def safe_listing_attributes(rec):
    old = rec.get("attributes") or {}
    desc = rec.get("description_excerpt") or ""

    ptype = old.get("property_type")
    ptype_text = text(ptype).lower()

    outdoor = outdoor_mentions(desc)

    # Only garden units can inherit an old garden_area field.
    garden = outdoor["garden_total"]

    if garden is None and (
        "גן" in ptype_text
        or "garden" in ptype_text
    ):
        garden = old.get("garden_area")

    # Never use old auto-extracted balcony values.
    balcony = outdoor["balcony_total"]

    parking = parking_from_desc(
        desc,
        old.get("parking_count")
    )

    storage = storage_from_desc(desc)

    elevator = elevator_from_desc(
        desc,
        old.get("elevator")
    )

    return {
        "property_type": ptype,
        "rooms": old.get("rooms"),
        "built_area": old.get("built_area"),
        "advertised_area": old.get("advertised_area"),

        "balcony_area_explicit": balcony,
        "balcony_components": outdoor["balcony_components"],

        "garden_area_explicit": garden,
        "garden_components": outdoor["garden_components"],

        "parking_count": parking,
        "storage": storage,
        "elevator": elevator,

        "floor_configuration": floor_configuration(
            desc,
            old.get("floor")
        ),

        "orientation": orientations(desc),
        "view": view_from_desc(desc),
        "condition": condition_from_desc(desc),

        "build_year": old.get("build_year"),

        "attribute_source": "listing_unit_fact",
        "description_excerpt": desc,
    }

# ------------------------------------------------------------
# Load V1
# ------------------------------------------------------------

if not V1_FILE.exists():
    raise SystemExit(f"NOT FOUND: {V1_FILE}")

with V1_FILE.open("r", encoding="utf-8") as f:
    v1 = json.load(f)

# ------------------------------------------------------------
# Load Tax records
# ------------------------------------------------------------

if not TAX_FILE.exists():
    raise SystemExit(f"NOT FOUND: {TAX_FILE}")

with TAX_FILE.open("r", encoding="utf-8-sig") as f:
    tax_raw = json.load(f)

tax = []

for d in walk(tax_raw):
    if not isinstance(d, dict):
        continue

    rooms = number(first(d, "rooms", "roomCount"))
    area = number(first(d, "asset_area", "area", "buildingMR"))
    price = number(first(d, "deal_amount", "dealAmount", "price"))

    if rooms is None or area is None or price is None:
        continue

    tax.append({
        "deal_id": first(
            d,
            "dealId",
            "assetId",
            "objectid"
        ),
        "address": get_address(d),
        "rooms": rooms,
        "area": area,
        "price": price,
        "date": text(first(
            d,
            "deal_date",
            "dealDate",
            "saleDay"
        )),
        "floor": text(first(
            d,
            "floorNo",
            "floor",
            "floor_number"
        )) or None,
        "tax_property_type": text(first(
            d,
            "dealNatureDescription",
            "property_type_description",
            "propertyType"
        )) or None,
    })

# ------------------------------------------------------------
# Find Tax transaction WITHOUT using the corrupted V1 address
# ------------------------------------------------------------

def find_tax_numeric(selection):
    result = []

    target_rooms = float(selection["rooms"])
    target_area  = float(selection["area"])
    target_price = float(selection["price"])

    for r in tax:
        if abs(r["rooms"] - target_rooms) > 0.1:
            continue

        if abs(r["area"] - target_area) > 1.0:
            continue

        if abs(r["price"] - target_price) > max(
            5000,
            target_price * 0.002
        ):
            continue

        result.append(r)

    return result

# ------------------------------------------------------------
# Correct sold enrichment
# ------------------------------------------------------------

sold_v2 = {}

for basket, items in v1["sold_evidence"].items():
    output_items = []

    for item in items:
        selection = dict(item["selection"])

        # IMPORTANT:
        # selection["address"] from V1 is ignored.
        matches = find_tax_numeric(selection)

        if len(matches) == 1:
            resolved_address = matches[0]["address"]
            status = "UNIQUE_NUMERIC_TAX_MATCH"

        elif len(matches) > 1:
            addresses = sorted(set(
                x["address"]
                for x in matches
                if x["address"]
            ))

            resolved_address = (
                addresses[0]
                if len(addresses) == 1
                else None
            )

            status = "MULTIPLE_TAX_MATCHES"

        else:
            resolved_address = None
            status = "NO_TAX_MATCH"

        output_items.append({
            "selection_numeric": {
                "rooms": selection["rooms"],
                "area": selection["area"],
                "price": selection["price"],
            },
            "resolved_address": resolved_address,
            "resolution_status": status,
            "tax_matches": matches,
            "sold_unit_attributes": {
                "rooms": (
                    matches[0]["rooms"]
                    if len(matches) == 1
                    else None
                ),
                "internal_area": (
                    matches[0]["area"]
                    if len(matches) == 1
                    else None
                ),
                "price": (
                    matches[0]["price"]
                    if len(matches) == 1
                    else None
                ),
                "date": (
                    matches[0]["date"]
                    if len(matches) == 1
                    else None
                ),
                "floor_configuration": (
                    matches[0]["floor"]
                    if len(matches) == 1
                    else None
                ),
                "tax_property_type": (
                    matches[0]["tax_property_type"]
                    if len(matches) == 1
                    else None
                ),

                # Explicitly unresolved unless another source proves them.
                "balcony_area": None,
                "garden_area": None,
                "parking_count": None,
                "storage": None,
                "elevator": None,
                "orientation": None,
                "view": None,
                "condition": None,
            },
        })

    sold_v2[basket] = output_items

# ------------------------------------------------------------
# Correct asking evidence
# ------------------------------------------------------------

asking_v2 = {}

for token, entry in v1["asking_evidence"].items():
    fixed = []

    for rec in entry.get("records", []):
        fixed.append({
            "token": token,
            "address": rec.get("address"),
            "attributes": safe_listing_attributes(rec),
            "source": rec.get("source"),
        })

    asking_v2[token] = fixed

# ------------------------------------------------------------
# Add known garden records that V1 failed to recover
# We keep only facts already found by the previous local audit.
# ------------------------------------------------------------

fallback_gardens = {
    "am2daomo": {
        "property_type": "garden",
        "rooms": 3.0,
        "built_area": 76.0,
        "advertised_area": 76.0,
        "garden_area_explicit": 90.0,
        "price": 2490000.0,
    },
    "kihl5wee": {
        "property_type": "garden",
        "rooms": 3.0,
        "built_area": 85.0,
        "advertised_area": 85.0,
        "garden_area_explicit": 89.0,
        "price": 2900000.0,
    },
}

for token, facts in fallback_gardens.items():
    if not asking_v2.get(token):
        asking_v2[token] = [{
            "token": token,
            "address": None,
            "attributes": {
                **facts,
                "parking_count": None,
                "storage": None,
                "elevator": None,
                "floor_configuration": "ground",
                "orientation": None,
                "view": None,
                "condition": None,
                "attribute_source": "previous_local_audit",
            },
            "source": "previous_local_audit",
        }]

# ------------------------------------------------------------
# Output
# ------------------------------------------------------------

result = {
    "version": "special_attribute_evidence_v2",
    "methodology": {
        "sold_matching": (
            "Curated sold transaction is re-resolved from the Tax "
            "Authority dataset by rooms + area + price. Corrupted V1 "
            "address strings are ignored."
        ),
        "attribute_policy": (
            "Only explicit structured fields or explicit listing text "
            "are accepted. Coordinate-like numbers are never interpreted "
            "as balcony/garden areas."
        ),
        "unknown_policy": (
            "Missing parking, storage, elevator, orientation, view, "
            "condition or outdoor area remains Unknown."
        ),
    },
    "subjects": v1["subjects"],
    "sold_evidence": sold_v2,
    "asking_evidence": asking_v2,
}

with JSON_OUT.open("w", encoding="utf-8") as f:
    json.dump(
        result,
        f,
        ensure_ascii=False,
        indent=2
    )

# Human-readable QA
lines = []

def out(x=""):
    lines.append(str(x))

out("=" * 135)
out("SPECIAL ATTRIBUTE EVIDENCE V2")
out("=" * 135)

out()
out("SOLD MATCH RESOLUTION")
out("-" * 135)

for basket, items in sold_v2.items():
    out()
    out(basket)

    for x in items:
        s = x["selection_numeric"]

        out(
            f"  {s['rooms']}R | "
            f"{s['area']}m2 | "
            f"{s['price']:,.0f} | "
            f"{x['resolution_status']} | "
            f"address={x['resolved_address']} | "
            f"matches={len(x['tax_matches'])}"
        )

        if len(x["tax_matches"]) == 1:
            t = x["tax_matches"][0]

            out(
                f"      date={t['date']} | "
                f"floor={t['floor']} | "
                f"tax_type={t['tax_property_type']} | "
                f"deal_id={t['deal_id']}"
            )

out()
out("=" * 135)
out("ASKING ATTRIBUTE QA")
out("=" * 135)

for token, records in asking_v2.items():
    out()
    out(f"TOKEN {token}")

    for r in records:
        a = r["attributes"]

        out(
            f"  type={a.get('property_type')} | "
            f"rooms={a.get('rooms')} | "
            f"built={a.get('built_area')} | "
            f"balcony={a.get('balcony_area_explicit')} | "
            f"garden={a.get('garden_area_explicit')} | "
            f"parking={a.get('parking_count')} | "
            f"storage={a.get('storage')} | "
            f"elevator={a.get('elevator')} | "
            f"floors={a.get('floor_configuration')} | "
            f"orientation={a.get('orientation')} | "
            f"view={a.get('view')} | "
            f"condition={a.get('condition')}"
        )

with TXT_OUT.open("w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print("CREATED:", JSON_OUT)
print("CREATED:", TXT_OUT)
print("SOLD RECORDS:", sum(len(x) for x in sold_v2.values()))
print("ASKING TOKENS:", len(asking_v2))
