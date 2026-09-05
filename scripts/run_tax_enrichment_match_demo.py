from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
DATA = ROOT.parent

from pricing_core.enrichment import match_tax_enrichment


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    base = load(DATA / "wine_city_sold_5room_raw.json")
    enriched = load(DATA / "tax_enriched_ashkelon_5room_36m.json")
    matches = match_tax_enrichment(base, enriched)
    payload = {
        "version": "tax-enrichment-match-v1",
        "warning": "Enrichment is provenance-preserving. Only unique direct matches may expose enriched attributes; diagnostic near matches never alter the base transaction or pricing eligibility.",
        "status_counts": dict(Counter(m.status for m in matches)),
        "direct_matches": [m.as_dict() for m in matches if m.status == "matched_direct"],
        "diagnostic_matches": [m.as_dict() for m in matches if m.status != "matched_direct" and m.status != "unmatched"],
    }
    out = ROOT / "tax_enrichment_match_demo.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload["status_counts"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
