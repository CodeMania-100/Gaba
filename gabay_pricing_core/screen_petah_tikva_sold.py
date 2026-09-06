from __future__ import annotations

import json
import os
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from apify_client import ApifyClient
from dotenv import load_dotenv


CITY = "פתח תקווה"

OUT = Path(
    r"C:\Users\vpine\Desktop\RealEstate\gov_source_tests\data_source_test"
)

FAMILIES = {
    "3R": {
        "actor_rooms": "3",
        "exact_rooms": 3,
        "min_area": 58.65,
        "max_area": 79.35,
    },
    "5R": {
        # Actor means 5 rooms OR MORE.
        # We filter exact 5 locally.
        "actor_rooms": "5",
        "exact_rooms": 5,
        "min_area": 94.435,
        "max_area": 127.765,
    },
}


def parse_date(value):
    if not value:
        return None

    s = str(value).strip()

    for fmt in (
        "%Y-%m-%d",
        "%Y-%m-%dT%H:%M:%S",
        "%d/%m/%Y",
        "%d-%m-%Y",
    ):
        try:
            return datetime.strptime(s[:19], fmt)
        except ValueError:
            pass

    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def clean(v):
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def summarize(label, rows, cfg):
    exact = [
        r for r in rows
        if num(r.get("rooms")) == cfg["exact_rooms"]
    ]

    target = []

    for r in exact:
        area = num(r.get("area"))
        if area is None:
            continue

        if cfg["min_area"] <= area <= cfg["max_area"]:
            target.append(r)

    cutoff_24m = datetime(2024, 9, 6)

    target_24m = []

    for r in target:
        d = parse_date(r.get("dealDate"))

        if d is not None and d >= cutoff_24m:
            target_24m.append(r)

    print("\n" + "=" * 100)
    print(label)
    print("=" * 100)

    print("RAW ACTOR ROWS:          ", len(rows))
    print("EXACT ROOM COUNT:        ", len(exact))
    print("TARGET SIZE - 36M:       ", len(target))
    print("TARGET SIZE - LAST 24M:  ", len(target_24m))

    print(
        "WITH ADDRESS - 24M:      ",
        sum(clean(r.get("address")) is not None for r in target_24m)
    )

    print(
        "WITH NEIGHBORHOOD - 24M: ",
        sum(clean(r.get("neighborhoodName")) is not None for r in target_24m)
    )

    print(
        "WITH PARCEL - 24M:       ",
        sum(
            r.get("gush") is not None and r.get("helka") is not None
            for r in target_24m
        )
    )

    # ------------------------------------------------------------
    # Neighborhood coverage
    # ------------------------------------------------------------

    by_neighborhood = defaultdict(list)

    for r in target_24m:
        neighborhood = clean(r.get("neighborhoodName")) or "[MISSING]"
        by_neighborhood[neighborhood].append(r)

    neighborhood_rows = []

    for neighborhood, records in by_neighborhood.items():

        addresses = {
            clean(r.get("address"))
            for r in records
            if clean(r.get("address"))
        }

        parcels = {
            (str(r.get("gush")), str(r.get("helka")))
            for r in records
            if r.get("gush") is not None and r.get("helka") is not None
        }

        areas = sorted(
            num(r.get("area"))
            for r in records
            if num(r.get("area")) is not None
        )

        neighborhood_rows.append({
            "neighborhood": neighborhood,
            "transactions": len(records),
            "addresses": len(addresses),
            "parcels": len(parcels),
            "min_area": min(areas) if areas else None,
            "max_area": max(areas) if areas else None,
        })

    neighborhood_rows.sort(
        key=lambda x: (
            x["addresses"],
            x["parcels"],
            x["transactions"],
        ),
        reverse=True,
    )

    print("\nTOP NEIGHBORHOODS - TARGET SIZE / LAST 24M")
    print("-" * 100)

    for x in neighborhood_rows[:25]:
        print(
            f"{x['neighborhood'][:35]:35} "
            f"tx={x['transactions']:3}  "
            f"addresses={x['addresses']:3}  "
            f"parcels={x['parcels']:3}  "
            f"area={x['min_area']}-{x['max_area']}"
        )

    # ------------------------------------------------------------
    # Specifically inspect our current candidate
    # ------------------------------------------------------------

    candidate_names = {
        "המרכז השקט",
        "מרכז העיר",
    }

    candidate = [
        r for r in target_24m
        if clean(r.get("neighborhoodName")) in candidate_names
    ]

    print("\nCANDIDATE: המרכז השקט / מרכז העיר")
    print("-" * 100)
    print("TARGET TRANSACTIONS:", len(candidate))

    for r in sorted(
        candidate,
        key=lambda x: str(x.get("dealDate") or ""),
        reverse=True,
    )[:40]:

        print(
            r.get("dealDate"),
            "|", r.get("neighborhoodName"),
            "|", r.get("address"),
            "|", r.get("area"), "sqm",
            "| floor", r.get("floor"),
            "| price", r.get("dealAmount"),
            "| ppsm", r.get("pricePerSqm"),
            "| parcel", r.get("gush"), r.get("helka"),
            "| firstHand", r.get("isFirstHand"),
        )

    return {
        "raw_count": len(rows),
        "exact_room_count": len(exact),
        "target_36m_count": len(target),
        "target_24m_count": len(target_24m),
        "neighborhoods_24m": neighborhood_rows,
        "candidate_transactions_24m": candidate,
    }


def main():
    load_dotenv(override=True)

    token = os.environ.get("APIFY_TOKEN")

    if not token:
        raise SystemExit("APIFY_TOKEN is missing")

    client = ApifyClient(token)

    summary = {
        "city": CITY,
        "screen_date": "2026-09-06",
    }

    for family, cfg in FAMILIES.items():

        print("\n\n" + "#" * 100)
        print("FETCHING", CITY, family)
        print("#" * 100)

        run_input = {
            "cities": [CITY],
            "dealDateRange": "36m",
            "rooms": cfg["actor_rooms"],
            "includeNonResidential": False,
            "maxItems": 2000,
        }

        print(json.dumps(run_input, ensure_ascii=False, indent=2))

        run = client.actor(
            "swerve/nadlan-gov-deals"
        ).call(
            run_input=run_input
        )

        print("\nSTATUS:", run.status)
        print("DATASET:", run.default_dataset_id)

        rows = list(
            client.dataset(
                run.default_dataset_id
            ).iterate_items()
        )

        raw_path = OUT / f"tax_enriched_petah_tikva_{family.lower()}_36m.json"

        raw_path.write_text(
            json.dumps(
                rows,
                ensure_ascii=False,
                indent=2,
                default=str,
            ),
            encoding="utf-8",
        )

        print("SAVED RAW:", raw_path)

        summary[family] = summarize(
            f"{CITY} - {family}",
            rows,
            cfg,
        )

    summary_path = OUT / "petah_tikva_sold_screen_summary.json"

    summary_path.write_text(
        json.dumps(
            summary,
            ensure_ascii=False,
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )

    print("\n\n" + "=" * 100)
    print("DONE")
    print("=" * 100)
    print("SUMMARY:", summary_path)


if __name__ == "__main__":
    main()
