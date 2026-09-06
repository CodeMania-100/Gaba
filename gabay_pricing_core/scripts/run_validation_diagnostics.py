from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
DATA = ROOT.parent

from pricing_core import HistoricalValidationPolicy, QualityStatus, run_sold_qa, validate_policy


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def group_key(result):
    tx = result.transaction
    if result.normalized_address:
        return result.normalized_address
    if tx.latitude is not None and tx.longitude is not None:
        return f"coord:{tx.latitude:.6f},{tx.longitude:.6f}"
    return f"asset:{tx.asset_id}" if tx.asset_id else f"source-index:{tx.source_index}"


def pct(v):
    return f"{v * 100:.1f}%"


def main():
    raw = load(DATA / "wine_city_sold_raw.json") + load(DATA / "wine_city_sold_5room_raw.json")
    qa = run_sold_qa(raw)
    policy = HistoricalValidationPolicy(name="nearest_8_area15", max_clusters=8, area_band_pct=0.15)
    result = validate_policy(qa.records, policy, target_start=date(2025, 1, 1))

    by_index = {r.transaction.source_index: r for r in qa.records}
    worst = []
    for p in sorted(result.predictions, key=lambda x: x.absolute_percentage_error, reverse=True)[:15]:
        r = by_index[p.target_source_index]
        tx = r.transaction
        worst.append({
            "target_date": p.target_date.isoformat(),
            "rooms": p.rooms,
            "target_area": p.target_area,
            "target_floor": tx.floor,
            "target_group": p.target_group_key,
            "target_neighborhood_label": tx.neighborhood,
            "actual_price": p.actual_price,
            "predicted_price": p.predicted_price,
            "absolute_percentage_error": p.absolute_percentage_error,
            "signed_percentage_error": p.signed_percentage_error,
            "selected_cluster_count": p.selected_cluster_count,
            "selected_cluster_keys": p.selected_cluster_keys,
            "is_first_hand": tx.is_first_hand,
        })

    # Diagnostic only: no spread threshold is used to reject evidence. We expose
    # building/year dispersion to see whether "one building = one homogeneous
    # product" is an unsafe assumption.
    eligible = [
        r for r in qa.records
        if r.status is QualityStatus.USABLE
        and r.normalized_property_type == "standard_apartment"
        and r.transaction.deal_date is not None
        and r.transaction.deal_amount
        and r.transaction.area
    ]
    grouped = defaultdict(list)
    for r in eligible:
        grouped[(group_key(r), r.transaction.deal_date.year, r.transaction.rooms)].append(r)

    dispersion = []
    for (key, year, rooms), rows in grouped.items():
        if len(rows) < 2:
            continue
        pps = [r.transaction.deal_amount / r.transaction.area for r in rows]
        floors = sorted({r.transaction.floor for r in rows if r.transaction.floor is not None})
        dispersion.append({
            "group_key": key,
            "year": year,
            "rooms": rooms,
            "record_count": len(rows),
            "min_price_per_sqm": round(min(pps)),
            "median_price_per_sqm": round(median(pps)),
            "max_price_per_sqm": round(max(pps)),
            "max_to_min_ratio": max(pps) / min(pps),
            "known_floors": floors,
            "first_hand_values": sorted({str(r.transaction.is_first_hand) for r in rows}),
        })
    dispersion.sort(key=lambda x: x["max_to_min_ratio"], reverse=True)

    report = {
        "diagnostic_version": "historical-validation-diagnostics-v1",
        "policy": policy.name,
        "holdout_start": "2025-01-01",
        "warning": "Diagnostics only. No dispersion threshold is used as a pricing coefficient or automatic exclusion rule.",
        "worst_local_holdout_predictions": worst,
        "highest_within_location_year_price_per_sqm_dispersion": dispersion[:15],
        "questions_before_method_change": [
            "Are high/low price tiers at the same geocoded location different product/building phases rather than comparable units?",
            "Does missing first-hand/resale classification explain part of the dispersion?",
            "Does floor/other missing unit detail explain residual variation without inventing a premium?",
            "Would explicit time normalization using an official repeatable index improve older comparable relevance?",
            "Should building clustering preserve independence while choosing the structurally closest record inside each cluster rather than the cluster-wide median?",
        ],
    }
    (ROOT / "historical_validation_diagnostics.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Historical Validation Failure Diagnostics",
        "",
        "This file intentionally investigates the weaker targeted local validation before any pricing-method change is promoted.",
        "No threshold below is used as an automatic exclusion or price adjustment.",
        "",
        "## Worst targeted local holdout predictions",
        "",
        "| Date | Rooms | Area | Floor | Actual | Predicted | Abs. % error | Target group |",
        "|---|---:|---:|---|---:|---:|---:|---|",
    ]
    for row in worst[:10]:
        lines.append(
            f"| {row['target_date']} | {row['rooms']:.0f} | {row['target_area']:.0f} | {row['target_floor'] or '—'} | "
            f"₪{row['actual_price']:,.0f} | ₪{row['predicted_price']:,.0f} | {pct(row['absolute_percentage_error'])} | {row['target_group']} |"
        )
    lines += [
        "",
        "## Highest observed within-location/year dispersion",
        "",
        "This tests whether treating a geocoded building/location as a homogeneous comparable contributor is too coarse.",
        "",
        "| Location/year | Rooms | Records | Min ₪/m² | Median ₪/m² | Max ₪/m² | Max/min | Known floors |",
        "|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for row in dispersion[:10]:
        lines.append(
            f"| {row['group_key']} / {row['year']} | {row['rooms']:.0f} | {row['record_count']} | "
            f"₪{row['min_price_per_sqm']:,.0f} | ₪{row['median_price_per_sqm']:,.0f} | ₪{row['max_price_per_sqm']:,.0f} | "
            f"{row['max_to_min_ratio']:.2f}x | {', '.join(row['known_floors']) or '—'} |"
        )
    lines += [
        "",
        "## What this means",
        "",
        "The local error is not evidence that we should add a hidden statistical weight. The data first needs better segmentation.",
        "The immediate next step is to test transparent segmentation/time-normalization hypotheses on calibration data, then re-run the untouched holdout.",
    ]
    (ROOT / "HISTORICAL_VALIDATION_DIAGNOSTICS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(json.dumps({
        "worst_count": len(worst),
        "dispersion_groups": len(dispersion),
        "top_dispersion": dispersion[:5],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
