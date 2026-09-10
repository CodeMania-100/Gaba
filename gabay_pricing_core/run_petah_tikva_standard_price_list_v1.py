import json
from pathlib import Path
from datetime import datetime

from petah_tikva_pricing import (
    MARKET_RANGES_RELATIVE_PATH,
    price_standard_units_baseline,
    standard_unit_market_pairs,
)

ROOT = Path.cwd()

OUT = (
    ROOT / "data" / "frozen"
    / "petah_tikva_standard_price_list_v1.json"
)

pairs = standard_unit_market_pairs(ROOT)
plan, result = price_standard_units_baseline(pairs)

if len(result.units) != 32:
    raise SystemExit(f"Expected 32 standard units, got {len(result.units)}")

units_by_number = {u.unit_number: u for u, _ in pairs}


def family_label(unit) -> str:
    return "3R" if unit.rooms == 3 else "5R"


price_list = []
for unit_result in sorted(result.units, key=lambda r: (r.family_key, r.unit_number)):
    unit = units_by_number[unit_result.unit_number]
    price_list.append({
        "unit_number": unit_result.unit_number,
        "family": family_label(unit),
        "family_key": unit_result.family_key,
        "floor": unit.floor,
        "internal_area_sqm": unit.internal_area,
        "balcony_area_sqm": unit.balcony_area,
        "orientation": unit.orientation,
        "market_range": {
            "lower": unit_result.supported_lower,
            "upper": unit_result.supported_upper,
            "confidence": unit_result.market_confidence.value,
        },
        "strategy_basis": plan.by_family()[unit_result.family_key].strategy.basis.value,
        "commercial_base_price_ils": unit_result.commercial_base_price_ils,
        "adjustments": [
            {
                "kind": a.kind,
                "amount_ils": a.amount_ils,
                "source": a.source,
                "explanation": a.explanation,
            }
            for a in unit_result.adjustments
        ],
        "proposed_list_price_ils": unit_result.proposed_list_price_ils,
        "status": unit_result.status.value,
        "requires_review": unit_result.requires_review,
        "warnings": unit_result.warnings,
        "explanation": unit_result.decision_trace,
    })

total_standard_revenue_ils = result.project_metrics["total_proposed_list_value_ils"]

payload = {
    "version": "petah_tikva_standard_price_list_v1",
    "generated_at": datetime.now().isoformat(),
    "disclaimer": (
        "Standard-unit pricing only (24 standard 3-room + 8 standard 5-room units). "
        "The 7 special units (garden/duplex/triplex) are out of scope for this list "
        "and remain on the individual-review path. The 50% range-position baseline is "
        "an engineering control, not a Gabay commercial decision. No floor, orientation, "
        "balcony, parking or storage premium is applied because no verified company rule "
        "for Petah Tikva was supplied."
    ),
    "market_basis_file": Path(MARKET_RANGES_RELATIVE_PATH).name,
    "plan": {
        "name": plan.name,
        "note": plan.note,
        "family_decisions": [
            {
                "family_key": d.family_key,
                "rationale": d.rationale,
                "strategy": {
                    "name": d.strategy.name,
                    "basis": d.strategy.basis.value,
                    "range_position_pct": d.strategy.range_position_pct,
                },
            }
            for d in plan.family_decisions
        ],
    },
    "unit_count": len(price_list),
    "total_standard_unit_revenue_ils": total_standard_revenue_ils,
    "project_metrics": result.project_metrics,
    "family_summaries": [s.public_dict() for s in result.family_summaries],
    "price_list": price_list,
    "full_decision_result": result.public_dict(),
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(
    json.dumps(payload, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

print("STANDARD UNITS PRICED:", len(price_list))
print("TOTAL STANDARD-UNIT REVENUE (ILS):", total_standard_revenue_ils)
print("PROJECT METRICS:", json.dumps(result.project_metrics, ensure_ascii=False))
print()
for s in result.family_summaries:
    print(
        s.family_key,
        "| unit_count:", s.unit_count,
        "| priced:", s.priced_unit_count,
        "| review:", s.review_unit_count,
        "| avg_price:", s.average_proposed_price_ils,
        "| total_value:", s.total_proposed_list_value_ils,
    )
print()
print("SAVED:", OUT)
