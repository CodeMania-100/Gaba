"""One-time, targeted addition to the existing frozen geocode file: resolves
coordinates for the three newly-researched triplex-product addresses that
are context-only for Apt36/37 (see data/research/first_researcher/
special_gap_research_v2(2).json's B_triplex track and task "Focused Batch —
Integrate New Research Evidence" item 9). Reuses build_map_geocodes_v1.py's
own geocode_batch (same Nominatim call, same Petah Tikva bounding-box/city
validation, same rate limit) -- this is not a new geocoding approach, just a
small targeted run of the existing one for three addresses that were never
part of any prior basket. Merges into data/frozen/map_geocodes_v1.json under
a new "special_typology_context" key; every other key is left untouched.

Run with: python add_special_typology_context_geocodes_v1.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from build_map_geocodes_v1 import geocode_batch

ADDRESSES = [
    ("special_typology_context:ארתור רופין 8", "ארתור רופין 8"),
    ("special_typology_context:מנחם אוסישקין 22", "מנחם אוסישקין 22"),
    ("special_typology_context:מונטיפיורי 14", "מונטיפיורי 14"),
]


def main() -> None:
    root = Path(__file__).resolve().parent
    out_path = root / "data" / "frozen" / "map_geocodes_v1.json"
    data = json.loads(out_path.read_text(encoding="utf-8"))

    print(f"Geocoding {len(ADDRESSES)} special-typology-context addresses ...")
    resolved, unresolved = geocode_batch(ADDRESSES)

    data["special_typology_context"] = {
        "resolved": resolved,
        "unresolved": unresolved,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"resolved={len(resolved)} unresolved={len(unresolved)} -- wrote {out_path}")


if __name__ == "__main__":
    main()
