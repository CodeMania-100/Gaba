import json
from pathlib import Path

FILES = [
    "10_apt36_37_6r_premium.json",
    "11_apt36_37_6r_premium_page2.json",
    "20_apt38_39_duplex.json",
    "21_apt38_39_duplex_page2.json",
]

BASE = Path("yad2_petah_special")

seen = set()

for filename in FILES:
    p = BASE / filename

    if not p.exists():
        continue

    data = json.loads(p.read_text(encoding="utf-8"))

    print("\n" + "=" * 100)
    print(filename)
    print("=" * 100)

    for section in ("private", "agency", "platinum", "booster"):
        for item in data.get("data", {}).get(section, []):
            token = item.get("token")

            if not token or token in seen:
                continue

            seen.add(token)

            d = item.get("additionalDetails", {})
            m = item.get("metaData", {})
            addr = item.get("address", {})

            print(
                token,
                "| property:", d.get("property", {}).get("textEng")
                    or d.get("property", {}).get("text"),
                "| rooms:", d.get("roomsCount"),
                "| advertised:", d.get("squareMeter"),
                "| built:", d.get("squareMeterBuild")
                    or m.get("squareMeterBuild"),
                "| price:", item.get("price"),
                "| floor:", addr.get("house", {}).get("floor"),
            )
