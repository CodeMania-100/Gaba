import json
from pathlib import Path

BASE = Path("yad2_petah_special/details")

FILES = sorted(BASE.glob("*.json"))

KEYWORDS = (
    "area",
    "sqm",
    "square",
    "meter",
    "garden",
    "balcony",
    "terrace",
    "parking",
    "storage",
    "warehouse",
    "room",
    "floor",
    "property",
    "condition",
    "description",
    "text",
    "date",
    "created",
    "updated",
    "publish",
    "address",
    "street",
    "neighborhood",
    "city",
    "price",
    "elevator",
    "contractor",
    "new",
    "token",
)

def walk(obj, path="root"):
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}"
            if isinstance(v, (dict, list)):
                yield from walk(v, p)
            else:
                yield p, v

    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk(v, f"{path}[{i}]")

for path in FILES:
    print("\n" + "=" * 120)
    print(path.name)
    print("=" * 120)

    data = json.loads(path.read_text(encoding="utf-8"))

    if isinstance(data, dict):
        print("TOP KEYS:", list(data.keys()))

    matches = []

    for field, value in walk(data):
        f = field.lower()

        if any(word in f for word in KEYWORDS):
            text = str(value)

            if len(text) > 1000:
                text = text[:1000] + "..."

            matches.append((field, text))

    for field, value in matches:
        print(f"{field}: {value}")

