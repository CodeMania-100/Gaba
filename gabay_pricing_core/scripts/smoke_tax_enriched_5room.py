from __future__ import annotations

import json
import os
from pathlib import Path

from apify_client import ApifyClient
from dotenv import load_dotenv


OUTPUT = Path("tax_enriched_ashkelon_5room_36m.json")


def main() -> None:
    load_dotenv(override=True)
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        raise SystemExit("APIFY_TOKEN is missing")

    client = ApifyClient(token)

    # Narrow diagnostic run first: recent Ashkelon 5+ room transactions only.
    # The actor documents that rooms="5" means 5 rooms or more, so we keep
    # the raw actor result and filter exact 5-room matches during analysis.
    run_input = {
        "cities": ["אשקלון"],
        "dealDateRange": "36m",
        "rooms": "5",
        "includeNonResidential": False,
        "maxItems": 250,
    }

    print("Running enriched nadlan.gov / Tax Authority diagnostic")
    print(json.dumps(run_input, ensure_ascii=False, indent=2))
    print("This may take a few minutes. The output is capped at 250 rows.")

    run = client.actor("swerve/nadlan-gov-deals").call(run_input=run_input, logger=None)
    print("Status:", run.status)
    print("Dataset:", run.default_dataset_id)

    rows = list(client.dataset(run.default_dataset_id).iterate_items())
    OUTPUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    exact_five = [r for r in rows if r.get("rooms") == 5]
    with_first_hand = [r for r in exact_five if r.get("isFirstHand") is not None]
    with_year = [r for r in exact_five if r.get("yearBuilt") is not None]
    with_building_floors = [r for r in exact_five if r.get("buildingFloors") is not None]
    with_prev = [r for r in exact_five if r.get("prevDeals")]

    print("Rows:", len(rows))
    print("Exact 5-room rows:", len(exact_five))
    print("Exact 5-room with isFirstHand known:", len(with_first_hand))
    print("Exact 5-room with yearBuilt:", len(with_year))
    print("Exact 5-room with buildingFloors:", len(with_building_floors))
    print("Exact 5-room with prior-sale history:", len(with_prev))
    print("Saved:", OUTPUT)

    print("\nSample exact 5-room rows:")
    for row in exact_five[:20]:
        print(
            row.get("dealDate"), "|",
            row.get("address"), "|",
            row.get("area"), "m² | floor", row.get("floor"), "/", row.get("buildingFloors"),
            "| year", row.get("yearBuilt"),
            "| firstHand", row.get("isFirstHand"),
            "| ₪", row.get("dealAmount"),
            "| ₪/m²", row.get("pricePerSqm"),
            "| parcel", row.get("gush"), row.get("helka"), row.get("tatHelka"),
            "| prev", len(row.get("prevDeals") or []),
        )


if __name__ == "__main__":
    main()
