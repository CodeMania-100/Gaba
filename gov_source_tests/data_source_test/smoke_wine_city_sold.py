import os
import json

from dotenv import load_dotenv
from apify_client import ApifyClient


load_dotenv(override=True)

client = ApifyClient(
    os.environ["APIFY_TOKEN"]
)


run_input = {
    "cities": [
        "אשקלון"
    ],

    "neighborhoods": [
        "עיר היין",
        "רמת כרמים",
    ],

    "dealDateRange": "60",

    # Only our first target family.
    "rooms": "3",

    # Smoke test only.
    # We first want to see whether GovMap has useful
    # neighborhood-specific transactions here.
    "maxItems": 60,
}


print(
    json.dumps(
        run_input,
        ensure_ascii=False,
        indent=2,
    )
)


run = client.actor(
    "swerve/nadlan-deals"
).call(
    run_input=run_input,
    logger=None,
)


print("\nStatus:", run.status)
print(
    "Dataset:",
    run.default_dataset_id,
)


items = list(
    client.dataset(
        run.default_dataset_id
    ).iterate_items()
)


print("\nDeals:", len(items))


neighborhood_counts = {}

for item in items:
    neighborhood = (
        item.get("neighborhoodName")
        or "(missing)"
    )

    neighborhood_counts[neighborhood] = (
        neighborhood_counts.get(
            neighborhood,
            0,
        )
        + 1
    )


print("\nNEIGHBORHOODS")

for name, count in sorted(
    neighborhood_counts.items(),
    key=lambda x: -x[1],
):
    print(
        count,
        "|",
        name,
    )


print("\nDEALS")

for item in items[:60]:

    print(
        item.get("dealDate"),
        "| ₪",
        item.get("dealAmount"),
        "|",
        item.get("area"),
        "m² | floor",
        item.get("floor"),
        "|",
        item.get("propertyType"),
        "|",
        item.get("address"),
        "|",
        item.get("neighborhoodName"),
    )


with open(
    "wine_city_sold_raw.json",
    "w",
    encoding="utf-8",
) as f:

    json.dump(
        items,
        f,
        ensure_ascii=False,
        indent=2,
    )


print(
    "\nSaved: wine_city_sold_raw.json"
)