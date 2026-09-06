import os
import json
from collections import Counter

from dotenv import load_dotenv
from apify_client import ApifyClient


load_dotenv(override=True)

token = os.getenv("APIFY_TOKEN")

if not token:
    raise RuntimeError("APIFY_TOKEN was not found in .env")

token = token.strip()

print("Token loaded:", token[:10] + "..." + token[-4:])
print("Token length:", len(token))

client = ApifyClient(token)


run_input = {
    "city": "אשקלון",
    "dealType": "buy",
    "minRooms": 3,
    "maxRooms": 5,
    "maxItems": 100,
    "enrichListings": True,
}

print("=" * 70)
print("YAD2 APIFY SMOKE TEST")
print("=" * 70)
print(json.dumps(run_input, ensure_ascii=False, indent=2))

run = client.actor("swerve/yad2-scraper").call(
    run_input=run_input
)

print("\nRun status:", run.status)
print("Dataset:", run.default_dataset_id)

items = list(
    client.dataset(
        run.default_dataset_id
    ).iterate_items()
)

print("\nListings returned:", len(items))

print("\n" + "=" * 70)
print("ACTUAL KEYS RETURNED")
print("=" * 70)

all_keys = sorted(
    {
        key
        for item in items
        for key in item.keys()
    }
)

for key in all_keys:
    print(key)


print("\n" + "=" * 70)
print("CORE FIELD COMPLETENESS")
print("=" * 70)

fields = [
    "listingId",
    "url",
    "dealType",
    "propertyType",
    "city",
    "cityHebrew",
    "neighbourhood",
    "address",
    "streetName",
    "price",
    "rooms",
    "floor",
    "areaSqm",
    "parking",
    "hasParking",
    "hasElevator",
    "hasBalcony",
    "hasSecureRoom",
    "updatedAt",
    "scrapedAt",
]

for field in fields:
    count = sum(
        item.get(field) not in (None, "", [])
        for item in items
    )

    pct = (
        count / len(items) * 100
        if items
        else 0
    )

    print(
        f"{field:20} "
        f"{count:2}/{len(items):2} "
        f"{pct:5.1f}%"
    )


print("\n" + "=" * 70)
print("ROOMS")
print("=" * 70)

for value, count in Counter(
    item.get("rooms") for item in items
).items():
    print(value, ":", count)


print("\n" + "=" * 70)
print("PROPERTY TYPES")
print("=" * 70)

for value, count in Counter(
    item.get("propertyType") for item in items
).items():
    print(value, ":", count)


print("\n" + "=" * 70)
print("LISTINGS")
print("=" * 70)

for i, item in enumerate(items, 1):

    print(f"\n--- {i} ---")

    sample = {
        key: item.get(key)
        for key in [
            "listingId",
            "url",
            "propertyType",
            "neighbourhood",
            "address",
            "streetName",
            "price",
            "rooms",
            "floor",
            "areaSqm",
            "parking",
            "hasParking",
            "hasElevator",
            "hasBalcony",
            "hasSecureRoom",
            "updatedAt",
            "scrapedAt",
        ]
    }

    print(
        json.dumps(
            sample,
            ensure_ascii=False,
            indent=2,
            default=str,
        )
    )


with open(
    "yad2_apify_enriched_100.json",
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

print("\nSaved: yad2_apify_smoke.json")