"""One-off, narrow pricing-policy cleanup: excludes 3 specific sold-basket
records from numeric participation based on verified typology/property-form
evidence (see task: "Special-unit sold-basket cleanup").

Does NOT touch pricing_core/special_market_indication.py. The pure engine's
classify_sold_eligibility() already excludes any record whose numeric_status
is not "usable" or "usable_with_public_mirror_conflict_flag" -- this script
only changes that one field (plus adds a human-readable exclusion_reason) on
the specific records below. Price, date, rooms, area, deal_id, address, and
every other field are left untouched; no record is deleted, so each stays
visible as excluded/context evidence.

Principle applied (per task): missing proof of typology keeps a record as
Tier-B/type-relaxed evidence (unchanged); positive evidence of an
incompatible property form/type excludes it from voting. Nothing else in
either basket is touched.
"""

from __future__ import annotations

import json
from pathlib import Path

MASTER_PATH = Path(__file__).resolve().parent / "data" / "frozen" / "special_unit_master_data_v1.json"

# (basket_key, deal_id) -> (new numeric_status, exclusion_reason)
EXCLUSIONS: dict[tuple[str, str], tuple[str, str]] = {
    ("APT38", "3606035885"): (
        "excluded_property_form_conflict",
        "Verified property_form_conflict: same-address archive evidence shows a private-house/cottage product "
        "form, not an apartment duplex -- excluded from the numeric sold median. Kept visible as context/QA.",
    ),
    ("APT39", "3605029846"): (
        "excluded_property_form_conflict",
        "Verified property_form_conflict: same-address archive evidence shows a private-house/cottage product "
        "form, not an apartment duplex -- excluded from the numeric sold median. Kept visible as context/QA.",
    ),
    ("APT39", "3655065895"): (
        "excluded_triplex_type_mismatch",
        "High-confidence second-researcher typology evidence (TRIPLEX_93_3_ARCHIVE_TAX_CROSSMATCH) identifies "
        "this transaction as triplex; the APT39 subject is duplex -- excluded from the numeric sold median. "
        "Kept visible as high-confidence triplex typology context (relevant to APT36/APT37 research, not as an "
        "APT39 sold comparable).",
    ),
}


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    master = _load(MASTER_PATH)
    baskets = master["curated_special_review"]["baskets"]

    changed = []
    for (basket_key, deal_id), (new_status, reason) in EXCLUSIONS.items():
        basket = baskets[basket_key]
        record = next(r for r in basket["selected_sold"] if r["deal_id"] == deal_id)
        old_status = record["numeric_status"]
        record["numeric_status"] = new_status
        record["exclusion_reason"] = reason
        changed.append(f"{basket_key}/{record['address']} ({deal_id}): numeric_status {old_status!r} -> {new_status!r}")

    MASTER_PATH.write_text(json.dumps(master, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("Applied exclusions:")
    for c in changed:
        print(f"  - {c}")


if __name__ == "__main__":
    main()
