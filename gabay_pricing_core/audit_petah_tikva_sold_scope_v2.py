import json
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime, date
from statistics import median

ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT.parent / "gov_source_tests" / "data_source_test"

FILES = {
    "3R": SOURCE_DIR / "tax_enriched_petah_tikva_3r_36m.json",
    "5R": SOURCE_DIR / "tax_enriched_petah_tikva_5r_36m.json",
}

TARGETS = {
    "3R": {"rooms": 3.0, "min_area": 58.65, "max_area": 79.35},
    "5R": {"rooms": 5.0, "min_area": 94.435, "max_area": 127.765},
}

TARGET_NEIGHBORHOOD = "מרכז העיר"
CUTOFF = date(2024, 9, 6)

OUT = (
    ROOT
    / "data"
    / "diagnostics"
    / "petah_tikva_sold_scope_audit_v2.json"
)

PARCEL_OUT = (
    ROOT
    / "data"
    / "diagnostics"
    / "petah_tikva_center_program_parcels_v1.json"
)


def load_rows(path):
    data = json.loads(path.read_text(encoding="utf-8"))

    if isinstance(data, list):
        return data

    if isinstance(data, dict):
        for key in (
            "items", "results", "deals", "records",
            "data", "transactions"
        ):
            if isinstance(data.get(key), list):
                return data[key]

        lists = [
            v for v in data.values()
            if isinstance(v, list)
        ]
        if lists:
            return max(lists, key=len)

    raise RuntimeError(f"Could not locate records in {path}")


def first(row, *keys):
    for k in keys:
        if k in row and row[k] not in (None, ""):
            return row[k]
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


def text(v):
    if v is None:
        return None
    return " ".join(str(v).strip().split())


def parse_date(v):
    if not v:
        return None

    s = str(v).strip()

    try:
        return datetime.fromisoformat(
            s.replace("Z", "+00:00")
        ).date()
    except Exception:
        pass

    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except Exception:
            pass

    return None


def extract(r):
    rooms = num(first(
        r,
        "rooms", "roomNum", "room_num",
        "assetRooms", "roomsNum"
    ))

    area = num(first(
        r,
        "assetArea", "asset_area",
        "area", "areaSqm", "sqm"
    ))

    amount = num(first(
        r,
        "dealAmount", "deal_amount",
        "price", "amount", "dealPrice"
    ))

    ppsm = num(first(
        r,
        "pricePerMeter", "price_per_sqm",
        "pricePerSqm", "priceForMeter"
    ))

    if ppsm is None and amount and area:
        ppsm = amount / area

    street = text(first(
        r,
        "streetNameHeb", "street_name",
        "street", "streetName"
    ))

    house = text(first(
        r,
        "houseNum", "house_number",
        "house", "buildingNumber"
    ))

    address = text(first(
        r,
        "address", "addressDescription",
        "assetAddress"
    ))

    if not address and street:
        address = f"{street} {house or ''}".strip()

    return {
        "deal_id": first(
            r,
            "dealId", "deal_id",
            "transactionId", "transaction_id"
        ),
        "object_id": first(r, "objectid", "OBJECTID"),
        "date": parse_date(first(
            r,
            "dealDate", "deal_date",
            "date", "transactionDate"
        )),
        "rooms": rooms,
        "area": area,
        "amount": amount,
        "ppsm": ppsm,
        "neighborhood": text(first(
            r,
            "neighborhood", "neighbourhood",
            "neighborhoodName"
        )),
        "street": street,
        "house": house,
        "address": address,
        "gush": first(
            r,
            "gushNum", "gush", "block"
        ),
        "parcel": first(
            r,
            "helka", "parcel",
            "parcelNum"
        ),
        "subparcel": first(
            r,
            "tatHelka", "subParcelNum",
            "subparcel", "sub_parcel"
        ),
        "first_hand": first(
            r,
            "firstHand", "first_hand",
            "isFirstHand", "dealType"
        ),
    }


def serialize(x):
    out = {}
    for k, v in x.items():
        if isinstance(v, date):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


def location_key(x):
    if x["address"]:
        return f"address:{x['address']}"

    if x["gush"] is not None and x["parcel"] is not None:
        return f"parcel:{x['gush']}/{x['parcel']}"

    return "unresolved"


def percentile(values, p):
    if not values:
        return None

    vals = sorted(values)

    if len(vals) == 1:
        return vals[0]

    pos = (len(vals) - 1) * p
    lo = int(pos)
    hi = min(lo + 1, len(vals) - 1)
    frac = pos - lo

    return vals[lo] * (1 - frac) + vals[hi] * frac


def detect_near_duplicates(rows):
    candidates = []

    # Strong candidate:
    # same parcel + subparcel + rooms + area + amount
    # within 2 days.
    groups = defaultdict(list)

    for x in rows:
        if (
            x["gush"] is None
            or x["parcel"] is None
            or x["subparcel"] is None
            or x["date"] is None
        ):
            continue

        key = (
            str(x["gush"]),
            str(x["parcel"]),
            str(x["subparcel"]),
            round(x["rooms"], 2) if x["rooms"] else None,
            round(x["area"], 2) if x["area"] else None,
            round(x["amount"], 0) if x["amount"] else None,
        )

        groups[key].append(x)

    for key, vals in groups.items():
        vals = sorted(
            vals,
            key=lambda x: x["date"]
        )

        for i in range(len(vals)):
            for j in range(i + 1, len(vals)):
                delta = abs(
                    (vals[j]["date"] - vals[i]["date"]).days
                )

                if delta <= 2:
                    candidates.append({
                        "strength": "strong",
                        "date_delta_days": delta,
                        "a": serialize(vals[i]),
                        "b": serialize(vals[j]),
                    })

    # Medium candidate for cases where subparcel is absent:
    # same address, exact economics, <= 1 day.
    groups = defaultdict(list)

    for x in rows:
        if (
            not x["address"]
            or x["date"] is None
            or x["subparcel"] is not None
        ):
            continue

        key = (
            x["address"],
            round(x["rooms"], 2) if x["rooms"] else None,
            round(x["area"], 2) if x["area"] else None,
            round(x["amount"], 0) if x["amount"] else None,
        )

        groups[key].append(x)

    for key, vals in groups.items():
        vals = sorted(
            vals,
            key=lambda x: x["date"]
        )

        for i in range(len(vals)):
            for j in range(i + 1, len(vals)):
                delta = abs(
                    (vals[j]["date"] - vals[i]["date"]).days
                )

                if delta <= 1:
                    candidates.append({
                        "strength": "medium",
                        "date_delta_days": delta,
                        "a": serialize(vals[i]),
                        "b": serialize(vals[j]),
                    })

    return candidates


def audit(label, rows):
    target = TARGETS[label]

    x = [extract(r) for r in rows]

    selected = [
        r for r in x
        if r["rooms"] is not None
        and abs(r["rooms"] - target["rooms"]) < 0.001
        and r["area"] is not None
        and target["min_area"] <= r["area"] <= target["max_area"]
        and r["date"] is not None
        and r["date"] >= CUTOFF
        and r["neighborhood"] == TARGET_NEIGHBORHOOD
    ]

    ppsm = [
        r["ppsm"]
        for r in selected
        if r["ppsm"] is not None
    ]

    q1 = percentile(ppsm, 0.25)
    q3 = percentile(ppsm, 0.75)
    med = median(ppsm) if ppsm else None
    iqr = (
        q3 - q1
        if q1 is not None and q3 is not None
        else None
    )

    outliers = []

    for r in selected:
        flags = []

        if r["ppsm"] is None:
            flags.append("missing_ppsm")
        else:
            if r["ppsm"] < 12000:
                flags.append("extreme_low_absolute")

            if r["ppsm"] > 60000:
                flags.append("extreme_high_absolute")

            if iqr and r["ppsm"] < q1 - 3 * iqr:
                flags.append("extreme_low_iqr")

            if iqr and r["ppsm"] > q3 + 3 * iqr:
                flags.append("extreme_high_iqr")

        if flags:
            rr = serialize(r)
            rr["audit_flags"] = flags
            outliers.append(rr)

    locations = defaultdict(list)

    for r in selected:
        locations[location_key(r)].append(r)

    group_rows = []

    for key, vals in locations.items():
        vals_ppsm = [
            x["ppsm"]
            for x in vals
            if x["ppsm"] is not None
        ]

        group_rows.append({
            "location_key": key,
            "transactions": len(vals),
            "median_ppsm": (
                median(vals_ppsm)
                if vals_ppsm else None
            ),
            "addresses": sorted({
                x["address"]
                for x in vals
                if x["address"]
            }),
            "parcels": sorted({
                f"{x['gush']}/{x['parcel']}"
                for x in vals
                if (
                    x["gush"] is not None
                    and x["parcel"] is not None
                )
            }),
        })

    group_ppsm = sorted(
        x["median_ppsm"]
        for x in group_rows
        if x["median_ppsm"] is not None
    )

    parcel_groups = defaultdict(list)

    for r in selected:
        if (
            r["gush"] is not None
            and r["parcel"] is not None
        ):
            parcel_groups[
                (str(r["gush"]), str(r["parcel"]))
            ].append(r)

    parcels = []

    for (gush, parcel), vals in parcel_groups.items():
        vals_ppsm = [
            x["ppsm"]
            for x in vals
            if x["ppsm"] is not None
        ]

        parcels.append({
            "gush": gush,
            "parcel": parcel,
            "transactions": len(vals),
            "median_ppsm": (
                median(vals_ppsm)
                if vals_ppsm else None
            ),
            "addresses": sorted({
                x["address"]
                for x in vals
                if x["address"]
            }),
        })

    near_dups = detect_near_duplicates(selected)

    return {
        "family": label,
        "scope": {
            "city": "פתח תקווה",
            "official_neighborhood": TARGET_NEIGHBORHOOD,
            "cutoff": CUTOFF.isoformat(),
            "rooms": target["rooms"],
            "area_min": target["min_area"],
            "area_max": target["max_area"],
        },
        "selected_transactions": len(selected),
        "independent_locations": len(locations),
        "unique_parcels": len(parcel_groups),
        "first_hand_values": dict(Counter(
            str(r["first_hand"])
            for r in selected
        )),
        "transaction_distribution": {
            "ppsm_min": min(ppsm) if ppsm else None,
            "ppsm_q1": q1,
            "ppsm_median": med,
            "ppsm_q3": q3,
            "ppsm_max": max(ppsm) if ppsm else None,
        },
        "independent_group_distribution": {
            "group_ppsm_min": (
                min(group_ppsm)
                if group_ppsm else None
            ),
            "group_ppsm_q1": percentile(
                group_ppsm, 0.25
            ),
            "group_ppsm_median": (
                median(group_ppsm)
                if group_ppsm else None
            ),
            "group_ppsm_q3": percentile(
                group_ppsm, 0.75
            ),
            "group_ppsm_max": (
                max(group_ppsm)
                if group_ppsm else None
            ),
        },
        "outlier_candidates": outliers,
        "outlier_candidate_count": len(outliers),
        "near_duplicate_candidates": near_dups,
        "near_duplicate_candidate_count": len(near_dups),
        "top_independent_locations": sorted(
            group_rows,
            key=lambda x: x["transactions"],
            reverse=True
        )[:30],
        "parcels": sorted(
            parcels,
            key=lambda x: x["transactions"],
            reverse=True
        ),
    }


report = {
    "audit_version": "petah_tikva_sold_scope_audit_v2",
    "generated_at": datetime.now().isoformat(),
    "important_note": (
        "Audit flags are candidates only. "
        "No transaction is rejected automatically."
    ),
    "families": {},
}

program_parcels = {}

for label, path in FILES.items():
    rows = load_rows(path)
    result = audit(label, rows)
    report["families"][label] = result

    program_parcels[label] = result["parcels"]

    print("\n" + "=" * 80)
    print(label)
    print("=" * 80)

    print(
        "CENTER TARGET TRANSACTIONS:",
        result["selected_transactions"]
    )

    print(
        "INDEPENDENT LOCATIONS:",
        result["independent_locations"]
    )

    print(
        "UNIQUE PARCELS:",
        result["unique_parcels"]
    )

    print(
        "NEAR-DUP CANDIDATES:",
        result["near_duplicate_candidate_count"]
    )

    print(
        "OUTLIER CANDIDATES:",
        result["outlier_candidate_count"]
    )

    print(
        "FIRST HAND:",
        result["first_hand_values"]
    )

    print(
        "TRANSACTION PPSM:",
        result["transaction_distribution"]
    )

    print(
        "GROUP PPSM:",
        result["independent_group_distribution"]
    )

    if result["near_duplicate_candidates"]:
        print("\nNEAR DUPLICATE SAMPLES:")

        for x in result["near_duplicate_candidates"][:5]:
            print(
                x["strength"],
                x["date_delta_days"],
                x["a"]["address"],
                x["a"]["date"],
                x["b"]["date"],
                x["a"]["amount"],
                x["a"]["area"],
            )

    if result["outlier_candidates"]:
        print("\nOUTLIER SAMPLES:")

        for x in result["outlier_candidates"][:10]:
            print(
                x["date"],
                x["address"],
                x["rooms"],
                x["area"],
                x["amount"],
                round(x["ppsm"], 2)
                if x["ppsm"] else None,
                x["audit_flags"],
            )


OUT.parent.mkdir(parents=True, exist_ok=True)

OUT.write_text(
    json.dumps(
        report,
        ensure_ascii=False,
        indent=2,
        default=str,
    ),
    encoding="utf-8",
)

PARCEL_OUT.write_text(
    json.dumps(
        {
            "city": "פתח תקווה",
            "official_neighborhood": TARGET_NEIGHBORHOOD,
            "purpose": "GIS_Dira program overlap verification",
            "families": program_parcels,
        },
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)

print("\n" + "=" * 80)
print("SAVED:")
print(OUT)
print(PARCEL_OUT)
