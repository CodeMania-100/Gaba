from __future__ import annotations

import argparse
import json
from datetime import date
from statistics import median
from pathlib import Path

from pricing_core import ProjectLocation, Unit, build_comparable_set, run_sold_qa


def main() -> None:
    parser = argparse.ArgumentParser(description="Build ranked real-market comparable lanes for demo Apartment 17.")
    parser.add_argument("--sold", type=Path, required=True)
    parser.add_argument("--listings", type=Path, required=True)
    parser.add_argument("--projects", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--lat", type=float)
    parser.add_argument("--lng", type=float)
    args = parser.parse_args()

    sold_raw = json.loads(args.sold.read_text(encoding="utf-8"))
    listings = json.loads(args.listings.read_text(encoding="utf-8"))
    projects = json.loads(args.projects.read_text(encoding="utf-8"))

    if (args.lat is None) != (args.lng is None):
        raise SystemExit("Provide both --lat and --lng, or neither.")

    if args.lat is None:
        points = []
        for row in listings:
            if row.get("neighbourhood") != "עיר היין":
                continue
            lat, lng = _valid_israel_point(row.get("latitude"), row.get("longitude"))
            if lat is not None:
                points.append((lat, lng))
        if not points:
            raise SystemExit("Could not derive a demo neighborhood anchor from current City Wine listings")
        anchor_lat = median(p[0] for p in points)
        anchor_lng = median(p[1] for p in points)
        anchor_source = "candidate_demo_neighborhood_centroid_from_current_listings"
    else:
        anchor_lat, anchor_lng = args.lat, args.lng
        anchor_source = "candidate_demo_assumption"

    unit = Unit(
        unit_number="17",
        floor=4,
        rooms=3,
        internal_area=69,
        balcony_area=12,
        orientation="מזרח",
        unit_type="standard_apartment",
    )
    location = ProjectLocation(
        city="אשקלון",
        neighborhood="עיר היין",
        latitude=anchor_lat,
        longitude=anchor_lng,
        source=anchor_source,
    )

    qa = run_sold_qa(sold_raw)
    comp = build_comparable_set(
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

    payload = comp.public_dict()
    payload["demo_disclaimer"] = "The assignment supplied no project address. The demo anchor is a neighborhood-level reference derived from current City Wine listings unless explicit coordinates are supplied."
    payload["counts"] = {
        "sold_primary_candidates": len(comp.sold),
        "current_asking_candidates": len(comp.current_asking),
        "new_development_explicitly_priced_candidates": len(comp.new_development),
    }
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(payload["counts"], ensure_ascii=False, indent=2))
    print("\nSold building clusters:")
    for c in comp.sold_building_clusters[:8]:
        print(c.address, c.record_count, c.newest_sale_date, c.median_price, c.median_price_per_sqm, c.distance_m)

    print("\nTop sold:")
    for c in comp.sold[:8]:
        print(c.event_date, c.address, c.area, c.floor, c.price, c.distance_m)
    print("\nTop current asking:")
    for c in comp.current_asking[:8]:
        print(c.address, c.area, c.floor, c.price, c.distance_m)
    print("\nExplicitly priced new development:")
    for c in comp.new_development:
        print(c.project_name, c.area, c.price, c.distance_m)


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
