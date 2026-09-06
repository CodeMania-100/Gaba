import os
import json

from dotenv import load_dotenv
from apify_client import ApifyClient


load_dotenv(override=True)

client = ApifyClient(os.environ["APIFY_TOKEN"])

run_input = {
    "location": "אשקלון",
    "locationType": "city",
    "operation": "sale",
    "includeNewDevelopments": True,
    "minRooms": 3,
    "maxRooms": 5,
    "maxItems": 200,
}

print("=" * 70)
print("MADLAN NEW-DEVELOPMENT TEST")
print("=" * 70)

print(json.dumps(
    run_input,
    ensure_ascii=False,
    indent=2,
))

run = client.actor(
    "igolaizola/madlan-scraper"
).call(
    run_input=run_input
)

print("\nStatus:", run.status)
print("Dataset:", run.default_dataset_id)

items = list(
    client.dataset(
        run.default_dataset_id
    ).iterate_items()
)

print("\nTOTAL RECORDS:", len(items))

projects = []

for item in items:
    if (
        item.get("projectName")
        or item.get("developers")
        or item.get("promotionStatus")
        or item.get("blockDetails")
        or str(item.get("type", "")).lower()
        in {"project", "development"}
    ):
        projects.append(item)


print("PROJECT-LIKE RECORDS:", len(projects))

print("\nALL KEYS")
print("=" * 70)

keys = sorted({
    key
    for item in items
    for key in item.keys()
})

for key in keys:
    print("-", key)


print("\nPROJECT RECORDS")
print("=" * 70)

for i, item in enumerate(projects, 1):
    print(f"\n--- PROJECT {i} ---")

    interesting = {
        k: item.get(k)
        for k in [
            "id",
            "type",
            "url",
            "projectName",
            "developers",
            "promotionStatus",
            "blockDetails",
            "price",
            "beds",
            "baths",
            "floor",
            "area",
            "address",
            "addressDetails",
            "generalCondition",
            "lastUpdated",
            "description",
        ]
        if k in item
    }

    print(json.dumps(
        interesting,
        ensure_ascii=False,
        indent=2,
        default=str,
    ))


with open(
    "madlan_projects_all.json",
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


with open(
    "madlan_projects_only.json",
    "w",
    encoding="utf-8",
) as f:
    json.dump(
        projects,
        f,
        ensure_ascii=False,
        indent=2,
        default=str,
    )


print("\nSaved:")
print("- madlan_projects_all.json")
print("- madlan_projects_only.json")