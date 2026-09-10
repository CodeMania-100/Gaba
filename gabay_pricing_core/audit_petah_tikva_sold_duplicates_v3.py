import json
from pathlib import Path
from collections import defaultdict
from datetime import datetime, date

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / "gov_source_tests" / "data_source_test"

FILES = {
    "3R": SOURCE / "tax_enriched_petah_tikva_3r_36m.json",
    "5R": SOURCE / "tax_enriched_petah_tikva_5r_36m.json",
}

TARGETS = {
    "3R": (3.0, 58.65, 79.35),
    "5R": (5.0, 94.435, 127.765),
}

CENTER = "מרכז העיר"
CUTOFF = date(2024, 9, 6)

OUT = (
    ROOT / "data" / "diagnostics"
    / "petah_tikva_sold_duplicate_audit_v3.json"
)


def load(path):
    d = json.loads(path.read_text(encoding="utf-8"))

    if isinstance(d, list):
        return d

    for v in d.values():
        if isinstance(v, list) and len(v) > 100:
            return v

    raise RuntimeError(path)


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def dt(v):
    if not v:
        return None

    try:
        return datetime.fromisoformat(
            str(v).replace("Z", "+00:00")
        ).date()
    except Exception:
        try:
            return datetime.strptime(
                str(v)[:10], "%Y-%m-%d"
            ).date()
        except Exception:
            return None


def norm_address(v):
    if not v:
        return None
    return " ".join(str(v).split())


def select(rows, family):
    rooms, amin, amax = TARGETS[family]
    out = []

    for idx, r in enumerate(rows):
        rr = num(r.get("rooms"))
        area = num(r.get("area"))
        day = dt(r.get("dealDate"))

        if rr != rooms:
            continue

        if area is None or not amin <= area <= amax:
            continue

        if day is None or day < CUTOFF:
            continue

        if r.get("neighborhoodName") != CENTER:
            continue

        out.append({
            "_index": idx,
            "date": day,
            "address": norm_address(r.get("address")),
            "rooms": rr,
            "area": area,
            "amount": num(r.get("dealAmount")),
            "ppsm": num(r.get("pricePerSqm")),
            "gush": str(r.get("gush")) if r.get("gush") is not None else None,
            "helka": str(r.get("helka")) if r.get("helka") is not None else None,
            "tatHelka": str(r.get("tatHelka")) if r.get("tatHelka") is not None else None,
            "firstHand": r.get("isFirstHand"),
            "assetId": r.get("assetId"),
            "dedupeKey": r.get("dedupeKey"),
            "parcelNum": r.get("parcelNum"),
        })

    return out


def signature(r):
    return (
        r["address"],
        round(r["rooms"], 2),
        round(r["area"], 2),
        round(r["amount"], 0) if r["amount"] is not None else None,
    )


def parcel_signature(r):
    return (
        r["gush"],
        r["helka"],
        round(r["rooms"], 2),
        round(r["area"], 2),
        round(r["amount"], 0) if r["amount"] is not None else None,
    )


def public(r):
    x = dict(r)
    x["date"] = r["date"].isoformat()
    return x


def detect(rows):
    candidate_pairs = {}

    # Same address + same rooms/area/amount, within 1 day.
    by_address = defaultdict(list)

    for r in rows:
        if r["address"] and r["amount"] is not None:
            by_address[signature(r)].append(r)

    for vals in by_address.values():
        vals = sorted(vals, key=lambda x: x["date"])

        for i in range(len(vals)):
            for j in range(i + 1, len(vals)):
                delta = abs(
                    (vals[j]["date"] - vals[i]["date"]).days
                )

                if delta > 1:
                    continue

                key = tuple(sorted(
                    (vals[i]["_index"], vals[j]["_index"])
                ))

                candidate_pairs.setdefault(
                    key,
                    {
                        "reasons": set(),
                        "a": vals[i],
                        "b": vals[j],
                        "date_delta_days": delta,
                    }
                )

                candidate_pairs[key]["reasons"].add(
                    "same_address_rooms_area_amount_within_1_day"
                )

    # Same actual gush/helka + economics, within 1 day.
    # tatHelka may differ; that difference is preserved for review.
    by_parcel = defaultdict(list)

    for r in rows:
        if (
            r["gush"]
            and r["helka"]
            and r["amount"] is not None
        ):
            by_parcel[parcel_signature(r)].append(r)

    for vals in by_parcel.values():
        vals = sorted(vals, key=lambda x: x["date"])

        for i in range(len(vals)):
            for j in range(i + 1, len(vals)):
                delta = abs(
                    (vals[j]["date"] - vals[i]["date"]).days
                )

                if delta > 1:
                    continue

                key = tuple(sorted(
                    (vals[i]["_index"], vals[j]["_index"])
                ))

                candidate_pairs.setdefault(
                    key,
                    {
                        "reasons": set(),
                        "a": vals[i],
                        "b": vals[j],
                        "date_delta_days": delta,
                    }
                )

                candidate_pairs[key]["reasons"].add(
                    "same_gush_helka_rooms_area_amount_within_1_day"
                )

    result = []

    for pair in candidate_pairs.values():
        a = pair["a"]
        b = pair["b"]

        flags = []

        if a["firstHand"] != b["firstHand"]:
            flags.append("first_hand_value_differs")

        if a["tatHelka"] != b["tatHelka"]:
            flags.append("subparcel_differs")

        if a["assetId"] != b["assetId"]:
            flags.append("asset_id_differs")

        result.append({
            "reasons": sorted(pair["reasons"]),
            "date_delta_days": pair["date_delta_days"],
            "flags": flags,
            "a": public(a),
            "b": public(b),
        })

    result.sort(
        key=lambda x: (
            x["a"]["date"],
            x["a"]["address"] or "",
        ),
        reverse=True,
    )

    return result


report = {
    "version": "petah_tikva_sold_duplicate_audit_v3",
    "rule": (
        "candidate only: same address OR same gush/helka, "
        "with same rooms, area and amount, within one day"
    ),
    "families": {},
}

for family, path in FILES.items():
    scoped = select(load(path), family)
    pairs = detect(scoped)

    report["families"][family] = {
        "scoped_transactions": len(scoped),
        "candidate_pair_count": len(pairs),
        "pairs": pairs,
    }

    print()
    print("=" * 90)
    print(family)
    print("=" * 90)
    print("SCOPED TRANSACTIONS:", len(scoped))
    print("DUPLICATE CANDIDATE PAIRS:", len(pairs))

    for p in pairs:
        a = p["a"]
        b = p["b"]

        print()
        print(
            a["date"], "<->", b["date"],
            "|", a["address"],
            "| area", a["area"],
            "| amount", a["amount"],
            "| gush/helka",
            a["gush"], a["helka"],
            "| tat", a["tatHelka"], "->", b["tatHelka"],
            "| firstHand",
            a["firstHand"], "->", b["firstHand"],
            "|", ",".join(p["flags"]),
        )

OUT.parent.mkdir(parents=True, exist_ok=True)

OUT.write_text(
    json.dumps(
        report,
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)

print()
print("=" * 90)
print("SAVED:")
print(OUT)
