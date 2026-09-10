import csv
import json
from pathlib import Path

SRC = Path("yad2_petah_special/details")
OUT = Path("yad2_petah_special/yad2_asking_normalized.csv")

def get(obj, *path, default=None):
    cur = obj
    for key in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
        if cur is None:
            return default
    return cur

rows = []

for path in sorted(SRC.glob("*.json")):
    raw = json.loads(path.read_text(encoding="utf-8"))
    d = raw.get("data", {})

    additional = d.get("additionalDetails", {})
    address = d.get("address", {})
    house = address.get("house", {})
    coords = address.get("coords", {})
    metadata = d.get("metaData", {})
    dates = d.get("dates", {})
    inp = d.get("inProperty", {})
    packages = d.get("packages", {})

    row = {
        "source": "happyendpoint_yad2",
        "underlying_source": "Yad2",
        "access_method": "third_party_api",

        "source_file": path.name,
        "token": d.get("token"),

        "price": d.get("price"),

        "property_id":
            get(additional, "property", "id"),

        "property_type":
            get(additional, "property", "text"),

        "property_type_eng":
            get(additional, "property", "textEng"),

        "rooms":
            additional.get("roomsCount"),

        # Keep these separate.
        "advertised_area":
            additional.get("squareMeter"),

        "built_area":
            additional.get("squareMeterBuild"),

        "garden_area":
            additional.get("squareMeterGarden"),

        "parking_count":
            additional.get("parkingSpacesCount"),

        "floor":
            house.get("floor"),

        "building_top_floor":
            additional.get("buildingTopFloor"),

        "property_condition_id":
            get(additional, "propertyCondition", "id"),

        "property_condition":
            get(additional, "propertyCondition", "text"),

        "city_id":
            get(address, "city", "id"),

        "city":
            get(address, "city", "text"),

        "neighborhood_id":
            get(address, "neighborhood", "id"),

        "neighborhood":
            get(address, "neighborhood", "text"),

        "street_id":
            get(address, "street", "id"),

        "street":
            get(address, "street", "text"),

        "house_number":
            house.get("number"),

        "latitude":
            coords.get("lat"),

        "longitude":
            coords.get("lon"),

        "has_parking":
            inp.get("includeParking"),

        "has_balcony":
            inp.get("includeBalcony"),

        "has_elevator":
            inp.get("includeElevator"),

        "has_mamad":
            inp.get("includeSecurityRoom"),

        "is_renovated":
            inp.get("isRenovated"),

        "is_accessible":
            inp.get("isHandicapped"),

        "new_from_contractor":
            packages.get("isNewFromContractor"),

        "created_at":
            dates.get("createdAt"),

        "updated_at":
            dates.get("updatedAt"),

        "description":
            metadata.get("description"),

        "qa_status": "raw_normalized",
    }

    rows.append(row)

fields = list(rows[0].keys())

with OUT.open(
    "w",
    newline="",
    encoding="utf-8-sig",
) as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)

print(f"\nSaved {len(rows)} records:")
print(OUT)

print("\n" + "=" * 130)

for r in rows:
    print(
        r["source_file"],
        "|",
        r["property_type"],
        "| rooms:", r["rooms"],
        "| built:", r["built_area"],
        "| garden:", r["garden_area"],
        "| advertised:", r["advertised_area"],
        "| parking:", r["parking_count"],
        "| price:", r["price"],
    )
