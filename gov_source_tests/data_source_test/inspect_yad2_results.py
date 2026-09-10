import json
from pathlib import Path

BASE = Path("yad2_petah_special")

FILES = [
    "10_apt36_37_6r_premium.json",
    "20_apt38_39_duplex.json",
    "30_apt1_2_3_garden.json",
]

INTERESTING_KEYS = {
    "id", "token", "feedId", "feed_id",
    "property", "propertyType", "property_type",
    "title", "address", "street", "city", "neighborhood",
    "rooms", "roomCount", "room_count",
    "sqm", "squareMeter", "squareMeters", "area",
    "price",
    "floor", "totalFloors",
    "parking", "storage", "balcony",
    "newFromContractor",
    "url",
}

def walk(obj, path="root"):
    if isinstance(obj, dict):
        yield path, obj
        for k, v in obj.items():
            yield from walk(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk(v, f"{path}[{i}]")

def looks_like_listing(d):
    keys = set(d.keys())

    has_price = any(k.lower() == "price" for k in keys)
    has_rooms = any("room" in k.lower() for k in keys)
    has_property = any(
        x in k.lower()
        for k in keys
        for x in ("property", "asset", "feed")
    )

    return has_price and (has_rooms or has_property)

for filename in FILES:
    path = BASE / filename

    print("\n" + "=" * 120)
    print(filename)
    print("=" * 120)

    data = json.loads(path.read_text(encoding="utf-8"))

    if isinstance(data, dict):
        print("TOP-LEVEL KEYS:", list(data.keys()))
        print("success:", data.get("success"))
    else:
        print("TOP LEVEL:", type(data).__name__)

    objects = list(walk(data))

    print("Total dict/list traversal objects:", len(objects))

    candidates = []

    for obj_path, obj in objects:
        if isinstance(obj, dict) and looks_like_listing(obj):
            candidates.append((obj_path, obj))

    print("Possible listing objects:", len(candidates))

    for i, (obj_path, obj) in enumerate(candidates[:30], 1):
        print("\n--- CANDIDATE", i, "---")
        print("PATH:", obj_path)

        compact = {}

        for k, v in obj.items():
            if (
                k in INTERESTING_KEYS
                or any(term in k.lower() for term in [
                    "price", "room", "sqm", "area",
                    "property", "floor", "address",
                    "street", "hood", "neighborhood",
                    "parking", "storage", "balcony",
                    "token", "feed", "url"
                ])
            ):
                if not isinstance(v, (dict, list)):
                    compact[k] = v

        print(json.dumps(compact, ensure_ascii=False, indent=2))

    if not candidates:
        print("\nNo listing-like dict detected automatically.")
        print("Showing first-level structure:")

        if isinstance(data, dict):
            for key, value in data.items():
                print(
                    key,
                    "->",
                    type(value).__name__,
                    f"len={len(value)}" if hasattr(value, "__len__") else ""
                )

