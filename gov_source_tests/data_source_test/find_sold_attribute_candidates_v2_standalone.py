# -*- coding: utf-8 -*-
"""
Local-only enrichment pass for selected sold comparables.

Reads:
  special_attribute_evidence_v2.json

Scans the current project folder recursively for existing JSON/CSV/JSONL/TXT/MD/HTML
records that mention the exact sold building/address.

Creates:
  sold_attribute_candidates_v2.json
  sold_attribute_candidates_v2.txt

NO NETWORK/API CALLS.
"""

import csv
import json
import re
from pathlib import Path
from collections import defaultdict

ROOT = Path.cwd()
V2_FILE = ROOT / "special_attribute_evidence_v2.json"

JSON_OUT = ROOT / "sold_attribute_candidates_v2.json"
TXT_OUT = ROOT / "sold_attribute_candidates_v2.txt"

SKIP_DIRS = {
    ".git", ".venv", "venv", "node_modules", ".next", "__pycache__",
    ".model-cache", "test-results"
}

SKIP_NAME_PARTS = (
    "special_attribute_evidence",
    "special_review_evidence",
    "special_sold_shortlist",
    "sold_attribute_candidates",
    "special_evidence_audit",
)

# Registered-deal sources are baseline transaction evidence, not enrichment evidence.
SKIP_ENRICHMENT_NAME_PARTS = (
    "tax_enriched",
    "nearby_deals",
    "nearby-deals",
    "latest_deals",
    "latest-deals",
)

STRUCTURED_EXTS = {".json", ".csv", ".jsonl"}
TEXT_EXTS = {".txt", ".md", ".html", ".htm"}
MAX_TEXT_BYTES = 20 * 1024 * 1024


def first(d, *keys):
    for k in keys:
        if isinstance(d, dict) and k in d and d[k] not in (None, "", []):
            return d[k]
    return None


def text(v):
    if v is None:
        return ""
    return str(v).replace("\r", " ").replace("\n", " ").strip()


def num(v):
    if v in (None, "") or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d+(?:\.\d+)?", str(v).replace(",", "").replace("₪", ""))
    return float(m.group()) if m else None


def walk(obj):
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from walk(v)
    elif isinstance(obj, list):
        for x in obj:
            yield from walk(x)


def normalize_hebrew_quotes(s):
    return (
        text(s)
        .replace("״", '"')
        .replace("׳", "'")
        .replace("”", '"')
        .replace("“", '"')
    )


def norm(s):
    s = normalize_hebrew_quotes(s).lower()

    for x in ("פתח תקווה", "פתח-תקווה", "petah tikva", "petach tikva"):
        s = s.replace(x, "")

    s = re.sub(r"[,.;:(){}\[\]\"'־\-–—]", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def get_address(d):
    a = text(first(d, "address", "fullAddress", "address_text", "full_address"))
    if a:
        return a

    street = text(first(
        d, "street", "streetName", "streetNameHeb", "street_name"
    ))
    house = text(first(
        d, "house", "houseNum", "houseNumber", "house_number"
    ))

    if street:
        return f"{street} {house}".strip()
    return ""


def split_address(addr):
    a = norm(addr)
    if not a:
        return "", None

    m = re.search(r"\s+(\d+[א-ת]?)$", a)
    if not m:
        return a, None

    return a[:m.start()].strip(), m.group(1)


def same_building(a, b):
    sa, ha = split_address(a)
    sb, hb = split_address(b)

    return bool(
        sa and sb and sa == sb
        and ha is not None and hb is not None
        and ha == hb
    )


def same_street(a, b):
    sa, _ = split_address(a)
    sb, _ = split_address(b)
    return bool(sa and sb and sa == sb)


def full_blob(d):
    try:
        return json.dumps(d, ensure_ascii=False)
    except Exception:
        return str(d)


def explicit_address_mentioned(blob, target_address):
    nb = norm(blob)
    na = norm(target_address)
    return bool(na and na in nb)


def description(d):
    return text(first(
        d,
        "description",
        "listingDescription",
        "description_raw",
        "description_start",
        "text",
        "title",
        "projectDescription",
    ))


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
    if "דירת גן" in b or "דירת-גן" in b or "garden apartment" in b:
        return "garden"

    return None


def rooms_from(d, desc):
    x = num(first(d, "rooms", "roomCount", "numberOfRooms", "rooms_count"))
    if x is not None:
        return x

    for p in (
        r"(\d+(?:\.\d+)?)\s*חדרים",
        r"(\d+(?:\.\d+)?)\s*חד[\"״']?",
    ):
        m = re.search(p, desc)
        if m:
            return float(m.group(1))

    return None


def built_from(d, desc):
    x = num(first(
        d, "built_area", "builtArea", "squareMeterBuild", "buildingMR"
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


def advertised_from(d):
    return num(first(
        d,
        "advertised_area", "advertisedArea",
        "squareMeter", "areaSqm", "area"
    ))


def extract_outdoor(desc):
    balconies = []
    gardens = []

    balcony_patterns = (
        r"(?:מרפסות|מרפסת(?:\s+שמש)?)\s*(?:בשטח|של|כ|:|-)?\s*"
        r"(\d+(?:\.\d+)?)\s*(?:מ[\"״']?ר|מר|מטר)",
        r"(\d+(?:\.\d+)?)\s*(?:מ[\"״']?ר|מר|מטר)\s*(?:של\s+)?מרפסות",
    )

    garden_patterns = (
        r"(?:גינה|חצר)\s*(?:בשטח|של|כ|:|-)?\s*"
        r"(\d+(?:\.\d+)?)\s*(?:מ[\"״']?ר|מר|מטר)",
        r"(\d+(?:\.\d+)?)\s*(?:מ[\"״']?ר|מר|מטר)\s*(?:של\s+)?(?:גינה|חצר)",
    )

    for p in balcony_patterns:
        for m in re.finditer(p, desc):
            balconies.append(float(m.group(1)))

    for p in garden_patterns:
        for m in re.finditer(p, desc):
            gardens.append(float(m.group(1)))

    balconies = list(dict.fromkeys(balconies))
    gardens = list(dict.fromkeys(gardens))

    return {
        "balcony_components": balconies or None,
        "balcony_total": sum(balconies) if balconies else None,
        "garden_components": gardens or None,
        "garden_total": sum(gardens) if gardens else None,
    }


def parking(desc, d):
    x = num(first(
        d, "parkingSpacesCount", "parking_count", "parkingCount"
    ))

    if x is not None:
        return {"present": True, "count": x}

    for pattern, count in (
        (r"(?:3|שלוש)\s*חניות", 3),
        (r"(?:2|שתי)\s*חניות", 2),
    ):
        if re.search(pattern, desc):
            return {"present": True, "count": float(count)}

    if "ללא חניה" in desc:
        return {"present": False, "count": 0}

    if "חניה" in desc:
        return {"present": True, "count": 1.0}

    has = first(d, "hasParking", "has_parking")
    if has is True:
        return {"present": True, "count": None}
    if has is False:
        return {"present": False, "count": 0}

    return {"present": None, "count": None}


def storage(desc, d):
    if "ללא מחסן" in desc:
        return False
    if "מחסן" in desc:
        return True

    v = first(d, "hasStorage", "has_storage", "storage")
    return v if isinstance(v, bool) else None


def elevator(desc, d):
    if "ללא מעלית" in desc:
        return False
    if "מעלית" in desc:
        return True

    v = first(d, "hasElevator", "has_elevator", "elevator")
    return v if isinstance(v, bool) else None


def orientation(desc):
    found = []
    for value, words in {
        "north": ("צפון", "north"),
        "south": ("דרום", "south"),
        "east": ("מזרח", "east"),
        "west": ("מערב", "west"),
    }.items():
        if any(w.lower() in desc.lower() for w in words):
            found.append(value)

    return found or None


def view(desc):
    found = []

    for value, words in {
        "open_view": ("נוף פתוח", "open view"),
        "sea_view": ("נוף לים", "sea view"),
        "park_view": ("נוף לפארק", "park view"),
    }.items():
        if any(w.lower() in desc.lower() for w in words):
            found.append(value)

    return found or None


def condition(desc):
    found = []

    if any(x in desc for x in (
        "שופצה", "שופץ", "משופצת", "משופץ", "שופצה מהיסוד"
    )):
        found.append("renovated")

    if any(x in desc for x in ("משודרג", "משודרגת")):
        found.append("upgraded")

    if any(x in desc for x in (
        "חדש מקבלן", "דירה חדשה", "חדש בפרויקט"
    )):
        found.append("new_property")

    if any(x in desc for x in (
        "לשיפוץ", "דרוש שיפוץ", "דורש שיפוץ"
    )):
        found.append("needs_renovation")

    return found or None


def floor_from(d, desc):
    structured = text(first(
        d, "floor", "floorNo", "floor_number", "floorNumber"
    ))

    for p in (
        r"(?:קומה|קומות|בקומות)\s*(\d+)\s*[\+\-]\s*(\d+)",
        r"(\d+)\s*[\+\-]\s*(\d+)\s*(?:קומה|קומות)",
    ):
        m = re.search(p, desc)
        if m:
            return f"{m.group(1)}+{m.group(2)}"

    return structured or None


def floor_tokens(v):
    s = text(v)
    if not s:
        return set()

    values = set()

    for x in re.findall(r"\b\d{1,2}\b", s):
        values.add(int(x))

    heb = {
        "קרקע": 0,
        "ראשונה": 1,
        "שניה": 2, "שנייה": 2,
        "שלישית": 3,
        "רביעית": 4,
        "חמישית": 5,
        "שישית": 6,
        "שביעית": 7,
        "שמינית": 8,
        "תשיעית": 9,
        "עשירית": 10,
        "אחת עשרה": 11,
        "שתים עשרה": 12, "שתיים עשרה": 12,
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
    }

    for phrase, value in sorted(heb.items(), key=lambda kv: -len(kv[0])):
        if phrase in s:
            values.add(value)

    if "גג" in s:
        values.add("roof")
    if "מרתף" in s:
        values.add("basement")

    return values


def floor_similarity(a, b):
    aa = floor_tokens(a)
    bb = floor_tokens(b)

    if not aa or not bb:
        return None
    if aa == bb:
        return 1.0

    inter = aa & bb
    if not inter:
        return 0.0

    return len(inter) / max(len(aa), len(bb))


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


def parse_record(d, path):
    blob = full_blob(d)
    desc = description(d)

    attrs = {
        "property_type": (
            detect_type(blob)
            or text(first(
                d, "propertyType", "property_type", "propertyTypeText"
            ))
            or None
        ),
        "rooms": rooms_from(d, desc),
        "built_area": built_from(d, desc),
        "advertised_area": advertised_from(d),
        "floor_configuration": floor_from(d, desc),
        "parking": parking(desc, d),
        "storage": storage(desc, d),
        "elevator": elevator(desc, d),
        "orientation": orientation(desc),
        "view": view(desc),
        "condition": condition(desc),
    }

    attrs.update(extract_outdoor(desc))

    return {
        "address": get_address(d),
        "attributes": attrs,
        "description": desc[:1400] if desc else None,
        "source": str(path),
        "source_category": source_category(path),
        "raw_address_mentioned": False,
    }


# -------------------------------------------------------------------
# Build targets directly from the V2 evidence package.
# This avoids the deal-ID lookup bug in the previous scanner.
# -------------------------------------------------------------------

if not V2_FILE.exists():
    raise SystemExit(f"NOT FOUND: {V2_FILE}")

with V2_FILE.open("r", encoding="utf-8") as f:
    v2 = json.load(f)

targets = []
seen_target_ids = set()

for basket, items in v2.get("sold_evidence", {}).items():
    for item in items:
        matches = item.get("tax_matches", [])

        # For an ambiguous numeric match, keep apartment records and reject cottages.
        if len(matches) > 1:
            apartment_matches = [
                x for x in matches
                if "קוטג" not in text(x.get("tax_property_type"))
            ]
            if apartment_matches:
                matches = apartment_matches

        for t in matches:
            deal_id = str(t.get("deal_id") or "")
            if not deal_id:
                continue

            # Remove the known cottage that should not be in the apartment basket.
            if "קוטג" in text(t.get("tax_property_type")):
                continue

            key = (basket, deal_id)
            if key in seen_target_ids:
                continue

            seen_target_ids.add(key)

            targets.append({
                "basket": basket,
                "deal_id": deal_id,
                "address": t.get("address"),
                "rooms": num(t.get("rooms")),
                "area": num(t.get("area")),
                "price": num(t.get("price")),
                "date": t.get("date"),
                "floor": t.get("floor"),
                "tax_property_type": t.get("tax_property_type"),
            })

if not targets:
    raise SystemExit(
        "No targets loaded from special_attribute_evidence_v2.json. "
        "Check that the file is the V2 file that contains resolved tax_matches."
    )


def candidate_score(target, rec, blob=None):
    addr = rec.get("address") or ""
    exact_building = same_building(target["address"], addr)

    mentioned = False
    if blob:
        mentioned = explicit_address_mentioned(blob, target["address"])

    if not exact_building and not mentioned:
        return None

    score = 40
    reasons = ["exact_building_or_explicit_address"]

    rooms = rec["attributes"].get("rooms")
    if rooms is not None and target["rooms"] is not None:
        diff = abs(rooms - target["rooms"])
        if diff <= 0.1:
            score += 20
            reasons.append("exact_rooms")
        elif diff <= 1:
            score += 6
            reasons.append("rooms_within_1")

    area = (
        rec["attributes"].get("built_area")
        or rec["attributes"].get("advertised_area")
    )

    if area is not None and target["area"] is not None and target["area"] > 0:
        pct = abs(area - target["area"]) / target["area"]

        if pct <= 0.03:
            score += 20
            reasons.append("area_within_3pct")
        elif pct <= 0.07:
            score += 12
            reasons.append("area_within_7pct")
        elif pct <= 0.15:
            score += 5
            reasons.append("area_within_15pct")

    fs = floor_similarity(
        target.get("floor"),
        rec["attributes"].get("floor_configuration")
    )

    if fs == 1.0:
        score += 25
        reasons.append("exact_floor_pattern")
    elif fs is not None and fs >= 0.5:
        score += 12
        reasons.append("partial_floor_overlap")

    typ = rec["attributes"].get("property_type")
    if typ in {"duplex", "triplex", "penthouse", "garden"}:
        score += 8
        reasons.append(f"special_type_{typ}")

    if score >= 90:
        cls = "HIGH_MATCH_CANDIDATE"
    elif score >= 65:
        cls = "STRONG_BUILDING_UNIT_CANDIDATE"
    else:
        cls = "SAME_BUILDING_PRODUCT_CONTEXT"

    return {
        "score": score,
        "match_class": cls,
        "reasons": reasons,
        "floor_similarity": fs,
    }


candidates = defaultdict(list)
files_scanned = 0
records_checked = 0

for path in ROOT.rglob("*"):
    if not path.is_file():
        continue

    if any(part.lower() in SKIP_DIRS for part in path.parts):
        continue

    name_lower = path.name.lower()

    if any(x in name_lower for x in SKIP_NAME_PARTS):
        continue

    if any(x in name_lower for x in SKIP_ENRICHMENT_NAME_PARTS):
        continue

    suffix = path.suffix.lower()
    if suffix not in STRUCTURED_EXTS | TEXT_EXTS:
        continue

    files_scanned += 1

    if suffix in STRUCTURED_EXTS:
        try:
            if suffix == ".json":
                with path.open("r", encoding="utf-8-sig") as f:
                    raw = json.load(f)
                iterable = walk(raw)

            elif suffix == ".jsonl":
                rows = []
                with path.open("r", encoding="utf-8-sig") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            rows.append(json.loads(line))
                        except Exception:
                            pass
                iterable = rows

            else:
                with path.open("r", encoding="utf-8-sig", newline="") as f:
                    iterable = list(csv.DictReader(f))

            for d in iterable:
                if not isinstance(d, dict):
                    continue

                records_checked += 1
                blob = full_blob(d)
                rec = parse_record(d, path)

                for target in targets:
                    m = candidate_score(target, rec, blob)
                    if not m:
                        continue

                    candidates[(target["basket"], target["deal_id"])].append({
                        **rec,
                        **m,
                    })

        except Exception:
            pass

    else:
        try:
            if path.stat().st_size > MAX_TEXT_BYTES:
                continue

            content = path.read_text(
                encoding="utf-8-sig",
                errors="ignore"
            )
        except Exception:
            continue

        for target in targets:
            if not explicit_address_mentioned(content, target["address"]):
                continue

            # Pull a local snippet around the raw address if possible.
            pos = content.find(target["address"])
            if pos < 0:
                pos = 0

            snippet = content[max(0, pos - 1200): pos + 3500]

            fake = {
                "address": target["address"],
                "description": snippet,
            }

            rec = parse_record(fake, path)
            rec["raw_address_mentioned"] = True

            m = candidate_score(target, rec, snippet)
            if not m:
                continue

            candidates[(target["basket"], target["deal_id"])].append({
                **rec,
                **m,
            })


def dedupe_rows(rows):
    out = []
    seen = set()

    for r in sorted(rows, key=lambda x: (-x["score"], x["source"])):
        a = r["attributes"]

        key = (
            r["source"],
            norm(r.get("address")),
            a.get("property_type"),
            a.get("rooms"),
            a.get("built_area"),
            a.get("advertised_area"),
            a.get("floor_configuration"),
            (r.get("description") or "")[:180],
        )

        if key in seen:
            continue

        seen.add(key)
        out.append(r)

    return out


output = {
    "version": "sold_attribute_candidates_v2",
    "methodology": {
        "target_source": "special_attribute_evidence_v2.json resolved Tax transactions",
        "rule": (
            "Same-building/current listing attributes are candidates/context only. "
            "Nothing is promoted to an exact sold-unit fact automatically."
        ),
    },
    "files_scanned": files_scanned,
    "records_checked": records_checked,
    "baskets": {},
}

for basket in sorted(set(x["basket"] for x in targets)):
    rows = []

    for target in [x for x in targets if x["basket"] == basket]:
        key = (target["basket"], target["deal_id"])
        found = dedupe_rows(candidates.get(key, []))

        rows.append({
            "target_transaction": target,
            "candidate_count": len(found),
            "candidates": found[:30],
        })

    output["baskets"][basket] = rows


with JSON_OUT.open("w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)


lines = []


def out(v=""):
    lines.append(str(v))


out("=" * 150)
out("SOLD ATTRIBUTE CANDIDATES V2 — LOCAL DATA ONLY")
out("=" * 150)

out(f"TARGET TRANSACTIONS: {len(targets)}")
out(f"FILES SCANNED: {files_scanned}")
out(f"STRUCTURED RECORDS CHECKED: {records_checked}")

for basket, items in output["baskets"].items():
    out()
    out("#" * 150)
    out(basket)
    out("#" * 150)

    for item in items:
        t = item["target_transaction"]

        out()
        out(
            f"DEAL {t['deal_id']} | {t['address']} | "
            f"{t['rooms']}R | {t['area']}m² | ₪{t['price']:,.0f} | "
            f"floor={t['floor']} | candidates={item['candidate_count']}"
        )

        if not item["candidates"]:
            out("  NO LOCAL SAME-BUILDING ENRICHMENT FOUND")
            continue

        for i, c in enumerate(item["candidates"][:12], 1):
            a = c["attributes"]

            out(
                f"  {i:02}. {c['match_class']} SCORE={c['score']} | "
                f"source={c['source_category']} | address={c['address']}"
            )

            out(
                "      "
                f"type={a['property_type']} | rooms={a['rooms']} | "
                f"built={a['built_area']} | adv={a['advertised_area']} | "
                f"floor={a['floor_configuration']}"
            )

            out(
                "      "
                f"balcony={a['balcony_total']} | garden={a['garden_total']} | "
                f"parking={a['parking']} | storage={a['storage']} | "
                f"elevator={a['elevator']}"
            )

            out(
                "      "
                f"orientation={a['orientation']} | view={a['view']} | "
                f"condition={a['condition']}"
            )

            out("      REASONS: " + ", ".join(c["reasons"]))

            if c.get("description"):
                out("      DESC: " + c["description"][:550])

            out("      SRC: " + c["source"])


with TXT_OUT.open("w", encoding="utf-8") as f:
    f.write("\n".join(lines))


print("CREATED:", JSON_OUT)
print("CREATED:", TXT_OUT)
print("TARGET TRANSACTIONS:", len(targets))
print("FILES SCANNED:", files_scanned)
print("RECORDS CHECKED:", records_checked)

for basket, items in output["baskets"].items():
    with_candidates = sum(1 for x in items if x["candidate_count"] > 0)
    total_candidates = sum(x["candidate_count"] for x in items)

    print(
        basket,
        "| transactions with local enrichment:", with_candidates,
        "/", len(items),
        "| candidate records:", total_candidates
    )
