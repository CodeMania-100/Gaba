import json
from pathlib import Path

for family in ["3r", "5r"]:
    path = Path(f"yad2_standard_probe/petah_tikva_{family}_page1.json")
    data = json.loads(path.read_text(encoding="utf-8"))["data"]

    seen = set()
    rows = []

    for bucket in ["private", "agency", "platinum", "booster"]:
        for r in data.get(bucket, []):
            token = r.get("token")
            order_id = r.get("orderId")

            key = token or order_id
            if key in seen:
                continue
            seen.add(key)

            addr = r.get("address") or {}
            details = r.get("additionalDetails") or {}
            packages = r.get("packages") or {}
            prop = details.get("property") or {}

            neighborhood = (addr.get("neighborhood") or {}).get("text")
            street = (addr.get("street") or {}).get("text")
            house = addr.get("house") or {}

            is_new = bool(packages.get("isNewFromContractor"))
            tags = [t.get("name") for t in r.get("tags", [])]

            if not is_new and "חדש מקבלן" not in tags:
                continue

            rows.append({
                "bucket": bucket,
                "token": token,
                "orderId": order_id,
                "neighborhood": neighborhood,
                "street": street,
                "house": house.get("number"),
                "floor": house.get("floor"),
                "property": prop.get("text"),
                "rooms": details.get("roomsCount"),
                "sqm": details.get("squareMeter"),
                "price": r.get("price"),
                "agency": (r.get("customer") or {}).get("agencyName"),
                "isNewFromContractor": is_new,
                "tags": tags,
            })

    print("\n" + "=" * 90)
    print(f"{family.upper()} UNIQUE NEW-CONTRACTOR RECORDS: {len(rows)}")
    print("=" * 90)

    for x in rows:
        print(
            f"{x['neighborhood']} | "
            f"{x['street']} {x['house'] or ''} | "
            f"{x['rooms']}R | "
            f"{x['sqm']} m² | "
            f"₪{x['price']:,} | "
            f"{x['property']} | "
            f"{x['agency']} | "
            f"token={x['token']}"
        )

print("\nDONE")
