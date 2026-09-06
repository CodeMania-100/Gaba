import json
from pathlib import Path
from collections import Counter

ROOT = Path(r"C:\Users\vpine\Desktop\RealEstate")

TARGET_NAMES = {
    "madlan_apify_200.json",
    "yad2_apify_enriched_100.json",
}

GARDEN_TERMS = (
    "דירת גן",
    "דירה גן",
    "גינה",
    "garden",
    "yard",
    "חצר",
)

ROOM_KEYS = (
    "rooms",
    "roomCount",
    "roomsCount",
    "numRooms",
    "numberOfRooms",
)


def locate_files():
    found = []
    for name in TARGET_NAMES:
        matches = list(ROOT.rglob(name))
        if not matches:
            print("MISSING:", name)
        else:
            found.extend(matches)
    return sorted(set(found))


def extract_rows(data):
    if isinstance(data, list):
        return data

    if isinstance(data, dict):
        for key in (
            "results",
            "records",
            "items",
            "data",
            "ads",
            "listings",
        ):
            if isinstance(data.get(key), list):
                return data[key]

    return []


def all_text(obj):
    parts = []

    def walk(x):
        if isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
        elif x is not None:
            parts.append(str(x))

    walk(obj)
    return " | ".join(parts).lower()


def get_rooms(r):
    for key in ROOM_KEYS:
        value = r.get(key)

        if value is None:
            continue

        try:
            return float(value)
        except Exception:
            pass

    return None


def interesting_keys(r):
    wanted = []

    for key in r.keys():
        k = key.lower()

        if any(
            term in k
            for term in (
                "garden",
                "yard",
                "balcon",
                "terrace",
                "area",
                "size",
                "floor",
                "room",
                "price",
                "type",
                "address",
                "neigh",
                "parking",
                "storage",
            )
        ):
            wanted.append(key)

    return sorted(wanted)


files = locate_files()

print("=" * 120)
print("FILES")
print("=" * 120)

for p in files:
    print(p)

all_matches = []

for path in files:
    with open(path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)

    rows = extract_rows(data)

    print("\n" + "=" * 120)
    print(path)
    print("rows:", len(rows))

    key_counts = Counter()

    for r in rows:
        if isinstance(r, dict):
            key_counts.update(interesting_keys(r))

    print("interesting fields:")
    print(sorted(key_counts))

    for idx, r in enumerate(rows):
        if not isinstance(r, dict):
            continue

        text = all_text(r)

        explicit = any(term.lower() in text for term in GARDEN_TERMS)

        if not explicit:
            continue

        rooms = get_rooms(r)

        all_matches.append(
            {
                "file": str(path),
                "index": idx,
                "rooms": rooms,
                "record": r,
            }
        )


print("\n" + "#" * 120)
print("ALL EXPLICIT GARDEN-LIKE LISTINGS")
print("#" * 120)

print("count:", len(all_matches))

for item in all_matches:
    r = item["record"]

    print("\n" + "-" * 120)
    print(
        f"FILE={Path(item['file']).name} "
        f"IDX={item['index']} "
        f"ROOMS={item['rooms']}"
    )

    print("INTERESTING FIELDS:")

    for key in interesting_keys(r):
        print(f"  {key}: {r.get(key)}")

    print("FULL RECORD:")
    print(json.dumps(r, ensure_ascii=False, indent=2))


print("\n" + "#" * 120)
print("2R / 3R GARDEN LISTINGS ONLY")
print("#" * 120)

small = [
    x for x in all_matches
    if x["rooms"] in (2.0, 3.0)
]

print("count:", len(small))

for item in small:
    r = item["record"]

    print("\n" + "-" * 120)
    print(
        f"{Path(item['file']).name} "
        f"idx={item['index']} "
        f"rooms={item['rooms']}"
    )

    for key in interesting_keys(r):
        print(f"{key}: {r.get(key)}")


print("\nDONE")