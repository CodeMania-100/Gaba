"""Audit script for the four market contexts (Petah Tikva + 3 frozen
multi-city contexts). Prints, per context: inventory/standard/special
counts, 3R/5R range/point/confidence, special asking/sold counts,
competitor count, precision comparable count, and a cross-city
contamination count -- computed by the exact same tier-aware structured
geography validator used by the frontend guard and the backend tests (see
app_api/geography_validation.py), never a free-text scan.

Run from gabay_pricing_core/:
    python scripts/audit_market_contexts.py

KNOWN LIMITATION: multi-city frozen evidence currently provides mostly
neighborhood/submarket-centroid coordinates rather than per-address
coordinates. Markers are therefore approximate and may overlap. No
coordinates are inferred or fabricated.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app_api.geography_validation import find_geography_records, validate_geography_records  # noqa: E402
from app_api.market_context_registry import MARKET_CONTEXTS  # noqa: E402
from app_api.market_context_workspace import build_market_context_workspace_payload  # noqa: E402
from app_api.multi_city_precision_overlay import load_selected_comparables  # noqa: E402


def _fmt_range(fam: dict) -> str:
    m = fam["market"]
    lo, hi = m["supported_lower"], m["supported_upper"]
    point = fam.get("proposed_family_price_ils")
    if lo is None or hi is None:
        return f"insufficient (confidence={m['confidence']})"
    return f"{lo:,.0f} - {hi:,.0f}  point={point:,.0f}  confidence={m['confidence']}  status={m['status']}"


def audit_context(slug: str) -> None:
    context = MARKET_CONTEXTS[slug]
    payload = build_market_context_workspace_payload(context)

    price_list = payload["price_list"]
    standard = [r for r in price_list if r["family_key"] is not None]
    special = [r for r in price_list if r["family_key"] is None]

    families = {f["family"]: f for f in payload["families"]}

    special_ctx = payload["special_unit_market_context"]["units"]
    asking_count = sum(len(u["direct_comparables"]) + len(u["broadened_comparables"]) for u in special_ctx.values())
    sold_count = sum(len(u["sold_selected"]) + len(u["sold_rejected"]) for u in special_ctx.values())

    competitor_count = payload["competitor_landscape"]["project_count"]

    if context.is_petah_tikva:
        precision_count = 0
    else:
        precision_count = len([r for r in load_selected_comparables(Path(__file__).resolve().parents[1]) if r.get("city") == context.city])

    geo_records = find_geography_records(payload)
    violations = validate_geography_records(geo_records, context.city_spellings, context.submarket)

    print(f"CONTEXT: {slug} ({context.display_name})")
    print(f"  inventory: {len(price_list)}")
    print(f"  standard:  {len(standard)}")
    print(f"  special:   {len(special)}")
    print(f"  3R: {_fmt_range(families['3R'])}")
    print(f"  5R: {_fmt_range(families['5R'])}")
    print(f"  special asking rows:  {asking_count}")
    print(f"  special sold/context rows: {sold_count}")
    print(f"  competitors: {competitor_count}")
    print(f"  precision comparables: {precision_count}")
    print(f"  cross-city contamination: {len(violations)}")
    for v in violations:
        print(f"    VIOLATION: {v.record_label} field={v.field} expected={v.expected!r} actual={v.actual!r}")
    print()


def main() -> None:
    for slug in MARKET_CONTEXTS:
        audit_context(slug)


if __name__ == "__main__":
    main()
