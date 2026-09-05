import json
import sys
from datetime import date
import calendar

from pricing_core import run_sold_qa, QualityStatus
from pricing_core.comparables import sold_group_key

sold = json.load(open(r"C:\Users\vpine\Desktop\RealEstate\gov_source_tests\wine_city_sold_5room_raw.json", encoding="utf-8"))
qa = run_sold_qa(sold)
usable = [r for r in qa.records if r.status == QualityStatus.USABLE]

market_like_ids = {"11353057650", "11349124650", "11354752260", "11281236300", "11258406090"}
results = []
for r in usable:
    tx = r.transaction
    if tx.asset_id in market_like_ids:
        class FakeCand:
            pass
        fc = FakeCand()
        fc.address = r.normalized_address
        fc.latitude = tx.latitude
        fc.longitude = tx.longitude
        key = sold_group_key(fc)
        results.append({
            "asset_id": tx.asset_id,
            "address": r.normalized_address,
            "lat": tx.latitude,
            "lng": tx.longitude,
            "group_key": key,
            "gush": tx.gush,
            "helka": tx.helka,
        })

with open("scratch_group_check.json", "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2, default=str)
print("done")
