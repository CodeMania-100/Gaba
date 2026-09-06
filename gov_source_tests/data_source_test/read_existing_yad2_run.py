import os
import json
from dotenv import load_dotenv
from apify_client import ApifyClient

load_dotenv(override=True)

client = ApifyClient(os.environ["APIFY_TOKEN"])

RUN_ID = "yX7FwAMSbyebhbbqd"

run = client.run(RUN_ID).get()

if run is None:
    raise RuntimeError("Run not found")

print("Run status:", run.status)
print("Dataset:", run.default_dataset_id)

items = list(
    client.dataset(run.default_dataset_id).iterate_items()
)

print("Listings returned:", len(items))

print("\nACTUAL KEYS:")
all_keys = sorted({
    key
    for item in items
    for key in item.keys()
})

for key in all_keys:
    print("-", key)

print("\nFIRST 3 RAW ITEMS:")
for i, item in enumerate(items[:3], 1):
    print(f"\n--- {i} ---")
    print(json.dumps(
        item,
        ensure_ascii=False,
        indent=2,
        default=str,
    ))

with open(
    "yad2_apify_smoke.json",
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