from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from statistics import median

from pricing_core import ProjectLocation, Unit, build_comparable_set, build_market_range, run_sold_qa


def main() -> None:
    parser = argparse.ArgumentParser(description="Run market-range v1 on real evidence for demo Apartment 17.")
    parser.add_argument("--sold", type=Path, required=True)
    parser.add_argument("--listings", type=Path, required=True)
    parser.add_argument("--projects", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    sold_raw = json.loads(args.sold.read_text(encoding="utf-8"))
    listings = json.loads(args.listings.read_text(encoding="utf-8"))
    projects = json.loads(args.projects.read_text(encoding="utf-8"))

    points: list[tuple[float, float]] = []
    for row in listings:
        if row.get("neighbourhood") != "עיר היין":
            continue
        lat, lng = _valid_israel_point(row.get("latitude"), row.get("longitude"))
        if lat is not None and lng is not None:
            points.append((lat, lng))
    if not points:
        raise SystemExit("Could not derive demo City Wine neighborhood anchor")

    location = ProjectLocation(
        city="אשקלון",
        neighborhood="עיר היין",
        latitude=median(p[0] for p in points),
        longitude=median(p[1] for p in points),
        source="candidate_demo_neighborhood_centroid_from_current_listings",
    )
    unit = Unit(
        unit_number="17",
        floor=4,
        rooms=3,
        internal_area=69,
        balcony_area=12,
        orientation="מזרח",
        unit_type="standard_apartment",
    )

    qa = run_sold_qa(sold_raw)
    comps = build_comparable_set(
        unit,
        location,
        qa.records,
        listings,
        projects,
        as_of=date(2026, 9, 4),
        source_context={
            "sold_query_scope": {
                "city": "אשקלון",
                "neighborhoods": ["עיר היין", "רמת כרמים"],
                "rooms": [3],
                "source_file": "wine_city_sold_raw.json",
            }
        },
    )
    market = build_market_range(comps, as_of=date(2026, 9, 4))

    payload = {
        "demo_disclaimer": "Assignment supplied no project location. City Wine, Ashkelon is a candidate-selected demo location; apartment mix is not represented as belonging to a real Gabay project.",
        "target": comps.public_dict()["target_unit"],
        "target_location": comps.public_dict()["target_location"],
        "market_range": market.public_dict(),
    }
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({
        "status": market.status.value,
        "confidence": market.confidence.value,
        "supported_range": [market.supported_lower, market.supported_upper],
        "support_lanes": market.support_lanes,
        "sold": market.sold.public_dict()["range"],
        "asking": market.current_asking.public_dict()["range"],
        "new_development": market.new_development.public_dict()["range"],
    }, ensure_ascii=False, indent=2))


def _valid_israel_point(lat_value, lng_value):
    try:
        lat, lng = float(lat_value), float(lng_value)
    except (TypeError, ValueError):
        return None, None
    if 29 <= lat <= 34.6 and 34 <= lng <= 36.6:
        return lat, lng
    if 29 <= lng <= 34.6 and 34 <= lat <= 36.6:
        return lng, lat
    return None, None


if __name__ == "__main__":
    main()
