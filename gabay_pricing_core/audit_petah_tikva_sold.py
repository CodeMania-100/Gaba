import json
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime, date

ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT.parent / "gov_source_tests" / "data_source_test"

FILES = {
    "3R": SOURCE_DIR / "tax_enriched_petah_tikva_3r_36m.json",
    "5R": SOURCE_DIR / "tax_enriched_petah_tikva_5r_36m.json",
}

TARGETS = {
    "3R": {
        "rooms": 3.0,
        "min_area": 58.65,
        "max_area": 79.35,
    },
    "5R": {
        "rooms": 5.0,
        "min_area": 94.435,
        "max_area": 127.765,
    },
}

OUT = (
    ROOT
    / "data"
    / "diagnostics"
    / "petah_tikva_sold_audit_v1.json"
)


def load_rows(path):
    data = json.loads(path.read_text(encoding="utf-8"))

    if isinstance(data, list):
        return data

    if isinstance(data, dict):
        # Try common wrappers.
        for key in (
            "items", "results", "deals", "records",
            "data", "transactions"
        ):
            value = data.get(key)
            if isinstance(value, list):
                return value

        # Find the largest list nested one level down.
        lists = [
            (k, v)
            for k, v in data.items()
            if isinstance(v, list)
        ]
        if lists:
            lists.sort(key=lambda x: len(x[1]), reverse=True)
            return lists[0][1]

    raise RuntimeError(f"Could not locate records in {path}")


def first(row, *keys):
    for key in keys:
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


def num(v):
    if v is None:
        return None
    try:
        if isinstance(v, str):
            v = v.replace(",", "").replace("₪", "").strip()
        return float(v)
    except Exception:
        return None


def norm_text(v):
    if v is None:
        return None
    return " ".join(str(v).strip().split())


def parse_date(v):
    if not v:
        return None

    text = str(v).strip()

    for fmt in (
        "%Y-%m-%d",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%d/%m/%Y",
    ):
        try:
            return datetime.strptime(text[:26], fmt).date()
        except Exception:
            pass

    try:
        return datetime.fromisoformat(
            text.replace("Z", "+00:00")
        ).date()
    except Exception:
        return None


def extract(row):
    rooms = num(first(
        row,
        "rooms", "roomNum", "room_num",
        "assetRooms", "roomsNum"
    ))

    area = num(first(
        row,
        "assetArea", "asset_area",
        "area", "areaSqm", "sqm"
    ))

    amount = num(first(
        row,
        "dealAmount", "deal_amount",
        "price", "amount", "dealPrice"
    ))

    ppsm = num(first(
        row,
        "pricePerMeter", "price_per_sqm",
        "pricePerSqm", "priceForMeter"
    ))

    if ppsm is None and amount and area and area > 0:
        ppsm = amount / area

    street = norm_text(first(
        row,
        "streetNameHeb", "street_name",
        "street", "streetName"
    ))

    house = norm_text(first(
        row,
        "houseNum", "house_number",
        "house", "buildingNumber"
    ))

    address = norm_text(first(
        row,
        "address", "addressDescription",
        "assetAddress"
    ))

    if not address and street:
        address = f"{street} {house or ''}".strip()

    neighborhood = norm_text(first(
        row,
        "neighborhood", "neighbourhood",
        "neighborhoodName", "neighborhood_name"
    ))

    gush = first(
        row,
        "gushNum", "gush", "block",
        "GUSH_NUM"
    )

    parcel = first(
        row,
        "parcelNum", "helka", "parcel",
        "PARCEL_NUM"
    )

    subparcel = first(
        row,
        "subParcelNum", "subparcel",
        "sub_parcel"
    )

    deal_id = first(
        row,
        "dealId", "deal_id",
        "transactionId", "transaction_id",
        "objectid", "OBJECTID"
    )

    deal_date = parse_date(first(
        row,
        "dealDate", "deal_date",
        "date", "transactionDate"
    ))

    first_hand = first(
        row,
        "firstHand", "first_hand",
        "isFirstHand", "dealType"
    )

    return {
        "deal_id": deal_id,
        "date": deal_date,
        "rooms": rooms,
        "area": area,
        "amount": amount,
        "ppsm": ppsm,
        "address": address,
        "street": street,
        "house": house,
        "neighborhood": neighborhood,
        "gush": gush,
        "parcel": parcel,
        "subparcel": subparcel,
        "first_hand": first_hand,
    }


def fingerprint(x):
    """
    Structural fingerprint for potential duplicate transactions.

    We deliberately exclude deal_id so records with different IDs
    but identical economic/property facts can still be detected.
    """
    return (
        str(x["date"]) if x["date"] else None,
        norm_text(x["address"]),
        str(x["gush"]) if x["gush"] is not None else None,
        str(x["parcel"]) if x["parcel"] is not None else None,
        str(x["subparcel"]) if x["subparcel"] is not None else None,
        round(x["rooms"], 2) if x["rooms"] is not None else None,
        round(x["area"], 2) if x["area"] is not None else None,
        round(x["amount"], 0) if x["amount"] is not None else None,
    )


def location_key(x):
    if x["address"]:
        return f"address:{x['address']}"

    if x["gush"] is not None and x["parcel"] is not None:
        return f"parcel:{x['gush']}/{x['parcel']}"

    return "unresolved"


def audit_family(label, rows):
    target = TARGETS[label]
    extracted = [extract(r) for r in rows]

    schema = Counter()
    for row in rows:
        schema.update(row.keys())

    exact_rooms = [
        x for x in extracted
        if x["rooms"] is not None
        and abs(x["rooms"] - target["rooms"]) < 0.001
    ]

    target_area = [
        x for x in exact_rooms
        if x["area"] is not None
        and target["min_area"] <= x["area"] <= target["max_area"]
    ]

    cutoff = date(2024, 9, 6)

    recent = [
        x for x in target_area
        if x["date"] is not None
        and x["date"] >= cutoff
    ]

    fingerprint_groups = defaultdict(list)
    deal_id_groups = defaultdict(list)

    for x in recent:
        fingerprint_groups[fingerprint(x)].append(x)

        if x["deal_id"] is not None:
            deal_id_groups[str(x["deal_id"])].append(x)

    duplicate_fingerprints = {
        str(k): v
        for k, v in fingerprint_groups.items()
        if len(v) > 1
    }

    duplicate_deal_ids = {
        k: v
        for k, v in deal_id_groups.items()
        if len(v) > 1
    }

    suspicious = []

    for x in recent:
        reasons = []

        if x["amount"] is None or x["amount"] <= 0:
            reasons.append("missing_or_nonpositive_amount")

        if x["area"] is None or x["area"] <= 0:
            reasons.append("missing_or_nonpositive_area")

        if x["ppsm"] is not None:
            # Intentionally broad — this is an audit flag,
            # NOT yet a rejection rule.
            if x["ppsm"] < 12000:
                reasons.append("very_low_ppsm")
            if x["ppsm"] > 60000:
                reasons.append("very_high_ppsm")

        if reasons:
            suspicious.append({
                **{
                    k: (
                        v.isoformat()
                        if isinstance(v, date)
                        else v
                    )
                    for k, v in x.items()
                },
                "audit_flags": reasons,
            })

    locations = Counter(location_key(x) for x in recent)

    neighborhoods = Counter(
        x["neighborhood"] or "UNKNOWN"
        for x in recent
    )

    first_hand = Counter(
        str(x["first_hand"])
        for x in recent
    )

    ppsm_values = sorted(
        x["ppsm"]
        for x in recent
        if x["ppsm"] is not None
    )

    amounts = sorted(
        x["amount"]
        for x in recent
        if x["amount"] is not None
    )

    def median(vals):
        if not vals:
            return None
        n = len(vals)
        if n % 2:
            return vals[n // 2]
        return (vals[n // 2 - 1] + vals[n // 2]) / 2

    return {
        "family": label,
        "source_rows": len(rows),
        "exact_room_rows": len(exact_rooms),
        "target_area_rows": len(target_area),
        "target_area_recent_24m_rows": len(recent),

        "field_frequency": dict(schema.most_common()),

        "coverage": {
            "with_date": sum(x["date"] is not None for x in recent),
            "with_address": sum(bool(x["address"]) for x in recent),
            "with_neighborhood": sum(
                bool(x["neighborhood"])
                for x in recent
            ),
            "with_gush_parcel": sum(
                x["gush"] is not None
                and x["parcel"] is not None
                for x in recent
            ),
            "with_subparcel": sum(
                x["subparcel"] is not None
                for x in recent
            ),
            "with_deal_id": sum(
                x["deal_id"] is not None
                for x in recent
            ),
        },

        "duplicate_analysis": {
            "duplicate_deal_id_groups":
                len(duplicate_deal_ids),
            "duplicate_fingerprint_groups":
                len(duplicate_fingerprints),
            "duplicate_fingerprint_rows":
                sum(
                    len(v)
                    for v in duplicate_fingerprints.values()
                ),
            "sample_duplicate_fingerprints":
                list(duplicate_fingerprints.values())[:20],
        },

        "location_analysis": {
            "independent_location_count":
                len(locations),
            "top_locations":
                locations.most_common(30),
        },

        "neighborhoods":
            neighborhoods.most_common(),

        "first_hand_values":
            dict(first_hand),

        "distribution": {
            "amount_min":
                min(amounts) if amounts else None,
            "amount_median":
                median(amounts),
            "amount_max":
                max(amounts) if amounts else None,
            "ppsm_min":
                min(ppsm_values) if ppsm_values else None,
            "ppsm_median":
                median(ppsm_values),
            "ppsm_max":
                max(ppsm_values) if ppsm_values else None,
        },

        "suspicious_count":
            len(suspicious),

        "suspicious_records":
            suspicious[:100],
    }


report = {
    "audit_version": "petah_tikva_sold_audit_v1",
    "purpose": (
        "Non-destructive readiness audit before defining "
        "deduplication, QA, geographic and program rules."
    ),
    "generated_at": datetime.now().isoformat(),
    "families": {},
}

for label, path in FILES.items():
    print("\n" + "=" * 80)
    print(label)
    print(path)

    rows = load_rows(path)

    print("RAW:", len(rows))

    result = audit_family(label, rows)
    report["families"][label] = result

    print(
        "EXACT ROOMS:",
        result["exact_room_rows"]
    )
    print(
        "TARGET AREA:",
        result["target_area_rows"]
    )
    print(
        "TARGET AREA + 24M:",
        result["target_area_recent_24m_rows"]
    )
    print(
        "INDEPENDENT LOCATIONS:",
        result["location_analysis"]["independent_location_count"]
    )
    print(
        "DUP FINGERPRINT GROUPS:",
        result["duplicate_analysis"]["duplicate_fingerprint_groups"]
    )
    print(
        "SUSPICIOUS:",
        result["suspicious_count"]
    )
    print(
        "FIRST HAND VALUES:",
        result["first_hand_values"]
    )
    print(
        "NEIGHBORHOODS:",
        result["neighborhoods"][:10]
    )
    print(
        "DISTRIBUTION:",
        result["distribution"]
    )


OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(
    json.dumps(
        report,
        ensure_ascii=False,
        indent=2,
        default=str
    ),
    encoding="utf-8"
)

print("\n" + "=" * 80)
print("AUDIT SAVED:")
print(OUT)
