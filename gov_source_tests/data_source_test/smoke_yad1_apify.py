import os
import json

from dotenv import load_dotenv
from apify_client import ApifyClient


load_dotenv(override=True)

client = ApifyClient(os.environ["APIFY_TOKEN"])

YAD1_URL = (
    "https://www.yad2.co.il/yad1/newprojects/south"
    "?area=21&category=1&city=7100"
)

run_input = {
    "start_urls": [
        {
            "url": YAD1_URL
        }
    ],
    "maxPagesPerSearch": 2,
    "maxRequestsPerCrawl": 150,
    "proxy": {
        "useApifyProxy": True,
        "apifyProxyGroups": ["RESIDENTIAL"],
        "apifyProxyCountry": "IL",
    },
}

print("=" * 70)
print("YAD1 / NEW PROJECTS SMOKE TEST")
print("=" * 70)
print("URL:", YAD1_URL)

run = client.actor("amit123/yadscraper").call(
    run_input=run_input
)

print("\nStatus:", run.status)
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


print("\nFIRST 10 RAW RECORDS")
print("=" * 70)

for i, item in enumerate(items[:10], 1):
    print(f"\n--- RECORD {i} ---")
    print(
        json.dumps(
            item,
            ensure_ascii=False,
            indent=2,
            default=str,
        )
    )


with open(
    "yad1_apify_smoke.json",
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

print("\nSaved: yad1_apify_smoke.json")