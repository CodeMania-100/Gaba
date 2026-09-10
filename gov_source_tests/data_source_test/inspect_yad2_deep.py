import json
from pathlib import Path

BASE = Path("yad2_petah_special")

FILES = [
    "10_apt36_37_6r_premium.json",
    "20_apt38_39_duplex.json",
    "30_apt1_2_3_garden.json",
]

WORDS = (
    "token",
    "price",
    "room",
    "sqm",
    "square",
    "area",
    "property",
    "asset",
    "floor",
    "address",
    "street",
    "city",
    "hood",
    "neighborhood",
    "balcony",
    "garden",
    "parking",
    "storage",
    "elevator",
    "contractor",
    "new",
    "date",
    "created",
    "updated",
    "title",
    "description",
    "coordinate",
    "latitude",
    "longitude",
)

def flatten(obj, prefix=""):
    out = {}

    if isinstance(obj, dict):
        for k, v in obj.items():
            path = f"{prefix}.{k}" if prefix else k

            if isinstance(v, (dict, list)):
                out.update(flatten(v, path))
            else:
                out[path] = v

    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            path = f"{prefix}[{i}]"
            if isinstance(v, (dict, list)):
                out.update(flatten(v, path))
            else:
                out[path] = v

    return out


def find_token_objects(obj, path="root"):
    found = []

    if isinstance(obj, dict):
        if "token" in obj:
            found.append((path, obj))

        for k, v in obj.items():
            found.extend(find_token_objects(v, f"{path}.{k}"))

    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            found.extend(find_token_objects(v, f"{path}[{i}]"))

    return found


for filename in FILES:
    data = json.loads((BASE / filename).read_text(encoding="utf-8"))

    print("\n" + "=" * 120)
    print(filename)
    print("=" * 120)

    if isinstance(data, dict) and isinstance(data.get("data"), dict):
        print("\nDATA SECTIONS:")
        for key, value in data["data"].items():
            if isinstance(value, list):
                print(f"  {key}: list[{len(value)}]")
            elif isinstance(value, dict):
                print(f"  {key}: dict keys={list(value.keys())}")
            else:
                print(f"  {key}: {type(value).__name__} = {value!r}")

    token_objects = find_token_objects(data)

    # Deduplicate the same listing appearing in agency/platinum/etc.
    unique = {}
    locations = {}

    for path, obj in token_objects:
        token = str(obj.get("token"))
        if not token or token == "None":
            continue

        locations.setdefault(token, []).append(path)

        # Keep whichever representation contains more data.
        flat = flatten(obj)
        if token not in unique or len(flat) > len(flatten(unique[token])):
            unique[token] = obj

    print(f"\nObjects containing token: {len(token_objects)}")
    print(f"Unique listing tokens: {len(unique)}")

    for i, (token, obj) in enumerate(unique.items(), 1):
        flat = flatten(obj)

        print("\n" + "-" * 100)
        print(f"LISTING {i}")
        print("TOKEN:", token)
        print("SEEN AT:", ", ".join(locations[token]))
        print("-" * 100)

        relevant = []

        for path, value in flat.items():
            p = path.lower()

            if any(word in p for word in WORDS):
                relevant.append((path, value))

        for path, value in relevant:
            text = str(value)

            if len(text) > 500:
                text = text[:500] + "..."

            print(f"{path}: {text}")

        print("\nALL TOP-LEVEL KEYS:")
        print(list(obj.keys()))

