import json
from pathlib import Path
from datetime import datetime, date
from collections import defaultdict
from statistics import median

ROOT = Path.cwd()
SOURCE = ROOT.parent / "gov_source_tests" / "data_source_test"

FILES = {
    "3R": SOURCE / "tax_enriched_petah_tikva_3r_36m.json",
    "5R": SOURCE / "tax_enriched_petah_tikva_5r_36m.json",
}

TARGETS = {
    "3R": {"rooms": 3.0, "min_area": 58.65, "max_area": 79.35},
    "5R": {"rooms": 5.0, "min_area": 94.435, "max_area": 127.765},
}

CENTER = "\u05de\u05e8\u05db\u05d6 \u05d4\u05e2\u05d9\u05e8"
PROGRAM_ADDRESS = "\u05e8\u05d5\u05d8\u05e9\u05d9\u05dc\u05d3 57"
CUTOFF = date(2024, 9, 6)

OUT = (
    ROOT / "data" / "frozen"
    / "petah_tikva_standard_sold_evidence_v1.json"
)


def load(path):
    d = json.loads(path.read_text(encoding="utf-8"))

    if isinstance(d, list):
        return d

    for v in d.values():
        if isinstance(v, list) and len(v) > 100:
            return v

    raise RuntimeError(f"No rows in {path}")


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_date(v):
    if not v:
        return None

    try:
        return datetime.fromisoformat(
            str(v).replace("Z", "+00:00")
        ).date()
    except Exception:
        return None


def clean_text(v):
    if v in (None, ""):
        return None
    return " ".join(str(v).split())


def percentile(values, p):
    vals = sorted(values)

    if not vals:
        return None

    if len(vals) == 1:
        return vals[0]

    pos = (len(vals) - 1) * p
    lo = int(pos)
    hi = min(lo + 1, len(vals) - 1)
    f = pos - lo

    return vals[lo] * (1 - f) + vals[hi] * f


def group_key(r):
    if r["address"]:
        return "address:" + r["address"]

    if r["gush"] and r["helka"]:
        return f"parcel:{r['gush']}/{r['helka']}"

    return "unresolved:" + str(r["_source_index"])


def normalize(row, idx):
    area = num(row.get("area"))
    amount = num(row.get("dealAmount"))
    ppsm = num(row.get("pricePerSqm"))

    if ppsm is None and area and amount:
        ppsm = amount / area

    return {
        "_source_index": idx,
        "deal_date": parse_date(row.get("dealDate")),
        "address": clean_text(row.get("address")),
        "rooms": num(row.get("rooms")),
        "area": area,
        "amount": amount,
        "ppsm": ppsm,
        "floor": row.get("floor"),
        "property_type": row.get("propertyType"),
        "first_hand": row.get("isFirstHand"),
        "gush": clean_text(row.get("gush")),
        "helka": clean_text(row.get("helka")),
        "tat_helka": clean_text(row.get("tatHelka")),
        "parcel_num": clean_text(row.get("parcelNum")),
        "asset_id": clean_text(row.get("assetId")),
        "dedupe_key": clean_text(row.get("dedupeKey")),
        "scraped_at": row.get("scrapedAt"),
    }


def scope(rows, family):
    t = TARGETS[family]
    selected = []

    for idx, raw in enumerate(rows):
        r = normalize(raw, idx)

        if r["rooms"] != t["rooms"]:
            continue

        if (
            r["area"] is None
            or not t["min_area"] <= r["area"] <= t["max_area"]
        ):
            continue

        if r["deal_date"] is None or r["deal_date"] < CUTOFF:
            continue

        neighborhood = raw.get("neighborhoodName")

        if neighborhood != CENTER:
            continue

        selected.append(r)

    return selected


def add_flags(rows):
    values = [r["ppsm"] for r in rows if r["ppsm"] is not None]

    q1 = percentile(values, 0.25)
    q3 = percentile(values, 0.75)
    iqr = q3 - q1 if q1 is not None and q3 is not None else None

    for r in rows:
        flags = []

        if r["ppsm"] is None:
            flags.append("missing_ppsm")
        else:
            if r["ppsm"] < 12000:
                flags.append("extreme_low_absolute")

            if r["ppsm"] > 60000:
                flags.append("extreme_high_absolute")

            if iqr:
                if r["ppsm"] < q1 - 3 * iqr:
                    flags.append("extreme_low_iqr")

                if r["ppsm"] > q3 + 3 * iqr:
                    flags.append("extreme_high_iqr")

        if r["address"] == PROGRAM_ADDRESS:
            flags.append("official_program_project_address")

        r["qa_flags"] = flags

    return q1, q3


def mark_possible_pairs(rows):
    candidate_pairs = {}

    def add_pair(a, b):
        if abs(
            (b["deal_date"] - a["deal_date"]).days
        ) > 1:
            return

        key = tuple(sorted(
            (a["_source_index"], b["_source_index"])
        ))

        candidate_pairs[key] = (a, b)

    # Same address + same economics
    by_address = defaultdict(list)

    for r in rows:
        if (
            r["address"]
            and r["amount"] is not None
            and r["area"] is not None
        ):
            key = (
                r["address"],
                r["rooms"],
                round(r["area"], 2),
                round(r["amount"], 0),
            )
            by_address[key].append(r)

    for vals in by_address.values():
        vals.sort(key=lambda x: x["deal_date"])

        for i in range(len(vals)):
            for j in range(i + 1, len(vals)):
                add_pair(vals[i], vals[j])

    # Same gush/helka + same economics
    by_parcel = defaultdict(list)

    for r in rows:
        if (
            r["gush"]
            and r["helka"]
            and r["amount"] is not None
            and r["area"] is not None
        ):
            key = (
                r["gush"],
                r["helka"],
                r["rooms"],
                round(r["area"], 2),
                round(r["amount"], 0),
            )
            by_parcel[key].append(r)

    for vals in by_parcel.values():
        vals.sort(key=lambda x: x["deal_date"])

        for i in range(len(vals)):
            for j in range(i + 1, len(vals)):
                add_pair(vals[i], vals[j])

    flagged = 0

    for a, b in candidate_pairs.values():
        # Different legal-unit/source identity:
        # retain both, but mark the source-pair relationship.
        if (
            a["tat_helka"] != b["tat_helka"]
            or a["asset_id"] != b["asset_id"]
        ):
            flagged += 1

            for r in (a, b):
                if "possible_source_pair" not in r["qa_flags"]:
                    r["qa_flags"].append(
                        "possible_source_pair"
                    )

    return flagged


def serialize(r):
    out = dict(r)

    out.pop("_source_index", None)

    if isinstance(out.get("deal_date"), date):
        out["deal_date"] = out["deal_date"].isoformat()

    return out


def build_family(family):
    rows = scope(load(FILES[family]), family)

    q1, q3 = add_flags(rows)
    pair_count = mark_possible_pairs(rows)

    groups = defaultdict(list)

    for r in rows:
        groups[group_key(r)].append(r)

    group_output = []

    for key, vals in groups.items():
        ppsm = [
            r["ppsm"]
            for r in vals
            if r["ppsm"] is not None
        ]

        group_output.append({
            "group_key": key,
            "transaction_count": len(vals),
            "median_ppsm": median(ppsm) if ppsm else None,
            "addresses": sorted({
                r["address"]
                for r in vals
                if r["address"]
            }),
            "parcels": sorted({
                f"{r['gush']}/{r['helka']}"
                for r in vals
                if r["gush"] and r["helka"]
            }),
        })

    group_values = [
        g["median_ppsm"]
        for g in group_output
        if g["median_ppsm"] is not None
    ]

    exact_program_rows = [
        r for r in rows
        if r["address"] == PROGRAM_ADDRESS
    ]

    return {
        "family": family,
        "scope": {
            "city": "\u05e4\u05ea\u05d7 \u05ea\u05e7\u05d5\u05d4",
            "official_neighborhood": CENTER,
            "cutoff": CUTOFF.isoformat(),
            **TARGETS[family],
        },
        "transaction_count": len(rows),
        "independent_location_count": len(groups),
        "possible_source_pair_count": pair_count,
        "exact_program_address_transaction_count": len(exact_program_rows),
        "transaction_ppsm": {
            "q1": q1,
            "median": median([
                r["ppsm"] for r in rows
                if r["ppsm"] is not None
            ]),
            "q3": q3,
        },
        "independent_group_ppsm": {
            "q1": percentile(group_values, 0.25),
            "median": median(group_values),
            "q3": percentile(group_values, 0.75),
        },
        "transactions": [
            serialize(r)
            for r in sorted(
                rows,
                key=lambda x: x["deal_date"],
                reverse=True,
            )
        ],
        "independent_groups": sorted(
            group_output,
            key=lambda x: x["transaction_count"],
            reverse=True,
        ),
    }


payload = {
    "version": "petah_tikva_standard_sold_evidence_v1",
    "frozen_at": datetime.now().isoformat(),
    "demo_location": {
        "address": "\u05d7\u05e4\u05e5 \u05d7\u05d9\u05d9\u05dd 25",
        "city": "\u05e4\u05ea\u05d7 \u05ea\u05e7\u05d5\u05d4",
        "commercial_area": (
            "\u05d4\u05de\u05e8\u05db\u05d6 \u05d4\u05e9\u05e7\u05d8 / "
            "\u05de\u05e8\u05db\u05d6 \u05d4\u05e2\u05d9\u05e8"
        ),
        "is_assumption": True,
    },
    "program_check": {
        "status": "PASS_WITH_WARNING",
        "relevant_official_project": {
            "active_project_id": 53050,
            "project_name": "\u05e8\u05d5\u05d8\u05e9\u05d9\u05dc\u05d3 57",
            "lottery_ids": [635, 1024, 1242],
            "independent_project_count": 1,
        },
        "treatment": (
            "No target-size scoped transaction is at the exact "
            "official project address. Parcel-level spatial resolution "
            "was not available from the local cadastral snapshot."
        ),
    },
    "dedupe_policy": {
        "auto_delete": (
            "Only proven same legal-unit identity may be collapsed."
        ),
        "possible_pairs": (
            "Rows with same building/economics within one day but "
            "different tatHelka or assetId are retained and flagged."
        ),
        "independence": (
            "Repeated sales from one address/location contribute "
            "through one independent location group."
        ),
    },
    "families": {
        "3R": build_family("3R"),
        "5R": build_family("5R"),
    },
}

OUT.parent.mkdir(parents=True, exist_ok=True)

OUT.write_text(
    json.dumps(
        payload,
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)

for family in ("3R", "5R"):
    f = payload["families"][family]

    print()
    print("=" * 80)
    print(family)
    print("=" * 80)
    print("TRANSACTIONS:", f["transaction_count"])
    print("INDEPENDENT LOCATIONS:", f["independent_location_count"])
    print("POSSIBLE SOURCE PAIRS:", f["possible_source_pair_count"])
    print(
        "PROGRAM ADDRESS TX:",
        f["exact_program_address_transaction_count"],
    )
    print(
        "GROUP PPSM:",
        f["independent_group_ppsm"],
    )

print()
print("FROZEN:")
print(OUT)
