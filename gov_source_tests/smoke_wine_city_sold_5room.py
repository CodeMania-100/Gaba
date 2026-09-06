from __future__ import annotations

import json
import os
from pathlib import Path

from apify_client import ApifyClient
from dotenv import load_dotenv


OUTPUT = Path("wine_city_sold_5room_raw.json")


def main() -> None:
    load_dotenv(override=True)
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        raise SystemExit("APIFY_TOKEN is missing")

    client = ApifyClient(token)
    run_input = {
        "cities": ["אשקלון"],
        "neighborhoods": ["עיר היין", "רמות אשקלון", "רמת כרמים"],
        "dealDateRange": "60",
        "rooms": "5",
        "maxItems": 100,
    }

    print(json.dumps(run_input, ensure_ascii=False, indent=2))
    run = client.actor("swerve/nadlan-deals").call(run_input=run_input, logger=None)
    print("Status:", run.status)
    print("Dataset:", run.default_dataset_id)

    rows = list(client.dataset(run.default_dataset_id).iterate_items())
    OUTPUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    print("Rows:", len(rows))
    print("Saved:", OUTPUT)
    for row in rows[:25]:
        print(
            row.get("dealDate"), "|",
            row.get("address"), "|",
            row.get("rooms"), "rooms |",
            row.get("area"), "m² | floor", row.get("floor"), "| ₪",
            row.get("dealAmount"), "|",
            row.get("propertyType"), "|",
            row.get("lat"), row.get("lng"),
        )


if __name__ == "__main__":
    main()
