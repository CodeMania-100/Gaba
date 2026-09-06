from __future__ import annotations

import json
import os
from pathlib import Path

from apify_client import ApifyClient
from dotenv import load_dotenv


OUTPUT = Path("tax_enriched_ashkelon_3room_36m.json")


def main() -> None:
    load_dotenv(override=True)

    token = os.environ.get("APIFY_TOKEN")
    if not token:
        raise SystemExit("APIFY_TOKEN is missing")

    client = ApifyClient(token)

    run_input = {
        "cities": ["אשקלון"],
        "dealDateRange": "36m",
        "rooms": "3",
        "includeNonResidential": False,
        "maxItems": 1000,
    }

    print("Running enriched Ashkelon 3-room transaction diagnostic")
    print(json.dumps(run_input, ensure_ascii=False, indent=2))

    run = client.actor("swerve/nadlan-gov-deals").call(
        run_input=run_input,
        logger=None,
    )

    print("Status:", run.status)
    print("Dataset:", run.default_dataset_id)

    rows = list(
        client.dataset(run.default_dataset_id).iterate_items()
    )

    OUTPUT.write_text(
        json.dumps(rows, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    exact = [r for r in rows if r.get("rooms") == 3]

    print()
    print("Total rows:", len(rows))
    print("Exact 3-room rows:", len(exact))
    print("With yearBuilt:", sum(r.get("yearBuilt") is not None for r in exact))
    print("With buildingFloors:", sum(r.get("buildingFloors") is not None for r in exact))
    print("With isFirstHand:", sum(r.get("isFirstHand") is not None for r in exact))
    print("With neighborhood:", sum(r.get("neighborhoodName") is not None for r in exact))
    print("With address:", sum(r.get("address") is not None for r in exact))
    print("With parcel:", sum(r.get("gush") and r.get("helka") for r in exact))

    target_size = [
        r for r in exact
        if r.get("area") is not None and 65 <= float(r["area"]) <= 75
    ]

    larger = [
        r for r in exact
        if r.get("area") is not None and 80 <= float(r["area"]) <= 95
    ]

    print()
    print("65-75 sqm exact 3-room:", len(target_size))
    print("80-95 sqm exact 3-room:", len(larger))

    print()
    print("Sample 65-75 sqm:")
    for r in target_size[:20]:
        print(
            r.get("dealDate"),
            "|", r.get("address"),
            "|", r.get("neighborhoodName"),
            "|", r.get("area"), "sqm",
            "| floor", r.get("floor"),
            "| year", r.get("yearBuilt"),
            "| firstHand", r.get("isFirstHand"),
            "| price", r.get("dealAmount"),
            "| ppsm", r.get("pricePerSqm"),
            "| parcel", r.get("gush"), r.get("helka"), r.get("tatHelka"),
        )

    print()
    print("Saved:", OUTPUT)


if __name__ == "__main__":
    main()
