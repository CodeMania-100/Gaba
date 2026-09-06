import os
import json

from dotenv import load_dotenv
from apify_client import ApifyClient


load_dotenv(override=True)

client = ApifyClient(os.environ["APIFY_TOKEN"])

run_input = {
    "city": "אשקלון",
    "dealType": "buy",
    "minRooms": 3,
    "maxRooms": 5,
    "maxItems": 200,

    # Don't pay for neighborhood analytics yet.
    "enrichInsights": False,
}

print("=" * 70)
print("MADLAN APIFY TEST")
print("=" * 70)

print(json.dumps(
    run_input,
    ensure_ascii=False,
    indent=2,
))

run = client.actor(
    "swerve/madlan-scraper"
).call(
    run_input=run_input
)

print("\nRun status:", run.status)
print("Dataset:", run.default_dataset_id)

items = list(
    client.dataset(
        run.default_dataset_id
    ).iterate_items()
)

print("\nRecords returned:", len(items))

print("\nACTUAL KEYS")
print("=" * 70)

keys = sorted({
    key
    for item in items
    for key in item.keys()
})

for key in keys:
    print("-", key)


print("\nFIRST 10 RECORDS")
print("=" * 70)

for i, item in enumerate(items[:10], 1):
    print(f"\n--- {i} ---")
    print(json.dumps(
        item,
        ensure_ascii=False,
        indent=2,
        default=str,
    ))


with open(
    "madlan_apify_200.json",
    "w",
    encoding="utf-8",
) as f:
    json.dump(
        items,
        f,
        ensure_ascii=False,
        indent=2,
        default=str,
    )

print("\nSaved: madlan_apify_200.json")