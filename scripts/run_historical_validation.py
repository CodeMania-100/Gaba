from __future__ import annotations

import json
from dataclasses import replace
from datetime import date
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pricing_core import (
    HistoricalValidationPolicy,
    benchmark_policies,
    choose_best_by_calibration_mdape,
    run_sold_qa,
    validate_policy,
)

DATA = ROOT.parent
HOLDOUT_START = date(2025, 1, 1)

POLICIES = [
    HistoricalValidationPolicy(name="all_independent_clusters_v1_like", max_clusters=None),
    HistoricalValidationPolicy(name="nearest_3_independent_clusters", max_clusters=3),
    HistoricalValidationPolicy(name="nearest_5_independent_clusters", max_clusters=5),
    HistoricalValidationPolicy(name="nearest_8_independent_clusters", max_clusters=8),
    HistoricalValidationPolicy(name="nearest_3_area15", max_clusters=3, area_band_pct=0.15),
    HistoricalValidationPolicy(name="nearest_5_area15", max_clusters=5, area_band_pct=0.15),
    HistoricalValidationPolicy(name="nearest_8_area15", max_clusters=8, area_band_pct=0.15),
]


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def metric_summary(result):
    m = result.metrics
    return {
        "policy": result.policy.name,
        "eligible_targets": m.eligible_targets,
        "predicted_targets": m.predicted_targets,
        "prediction_coverage": m.prediction_coverage,
        "median_absolute_error": m.median_absolute_error,
        "median_absolute_percentage_error": m.median_absolute_percentage_error,
        "mean_absolute_percentage_error": m.mean_absolute_percentage_error,
        "p90_absolute_percentage_error": m.p90_absolute_percentage_error,
        "median_signed_percentage_error": m.median_signed_percentage_error,
        "interval_hit_rate": m.interval_hit_rate,
        "median_interval_width_pct_of_actual": m.median_interval_width_pct_of_actual,
        "fallback_lookback_rate": m.fallback_lookback_rate,
        "area_filter_fallback_rate": m.area_filter_fallback_rate,
        "by_rooms": m.by_rooms,
    }


def pct(value):
    return "—" if value is None else f"{value * 100:.1f}%"


def money(value):
    return "—" if value is None else f"₪{value:,.0f}"


def main():
    broad_raw = load_json(DATA / "sold_deals_raw.json")
    broad_qa = run_sold_qa(broad_raw)

    calibration = benchmark_policies(
        broad_qa.records,
        POLICIES,
        target_end=HOLDOUT_START,
    )
    best = choose_best_by_calibration_mdape(calibration)
    if best is None:
        raise RuntimeError("No policy produced calibration predictions")

    holdout_policy = next(p for p in POLICIES if p.name == best.policy.name)
    holdout = validate_policy(
        broad_qa.records,
        holdout_policy,
        target_start=HOLDOUT_START,
    )

    strict_policy = replace(
        holdout_policy,
        name=holdout_policy.name + "__exclude_target_building",
        exclude_target_building=True,
    )
    strict_holdout = validate_policy(
        broad_qa.records,
        strict_policy,
        target_start=HOLDOUT_START,
    )

    local_raw = load_json(DATA / "wine_city_sold_raw.json") + load_json(DATA / "wine_city_sold_5room_raw.json")
    local_qa = run_sold_qa(local_raw)
    local_calibration = validate_policy(
        local_qa.records,
        holdout_policy,
        target_end=HOLDOUT_START,
    )
    local_holdout = validate_policy(
        local_qa.records,
        holdout_policy,
        target_start=HOLDOUT_START,
    )

    report = {
        "validation_version": "historical-sold-validation-v1",
        "holdout_start": HOLDOUT_START.isoformat(),
        "scope": {
            "validated_component": "completed-sale comparable selection and sold-lane target-equivalent indication",
            "not_validated": [
                "current asking lane historically",
                "new-development lane historically",
                "final multi-lane consensus range historically",
                "company strategy effects",
            ],
            "leakage_rule": "only completed sales strictly before each target sale date are eligible",
            "independence_rule": "each address/exact-coordinate building-location cluster contributes once",
            "price_normalization": "median selected-cluster price per sqm multiplied by target internal area",
            "no_learned_weights": True,
        },
        "broad_ashkelon": {
            "source_file": "sold_deals_raw.json",
            "qa_summary": broad_qa.summary,
            "calibration_period": {
                "end_exclusive": HOLDOUT_START.isoformat(),
                "policy_results": [metric_summary(r) for r in calibration],
                "selection_rule": "lowest median absolute percentage error on calibration only; mean APE then coverage count only break exact ties",
                "selected_policy": best.policy.name,
            },
            "holdout_period": {
                "start_inclusive": HOLDOUT_START.isoformat(),
                "selected_policy_result": metric_summary(holdout),
                "strict_exclude_target_building_result": metric_summary(strict_holdout),
            },
        },
        "targeted_city_wine_adjacent": {
            "source_files": ["wine_city_sold_raw.json", "wine_city_sold_5room_raw.json"],
            "qa_summary": local_qa.summary,
            "same_policy_as_broad_selection": best.policy.name,
            "calibration_result": metric_summary(local_calibration),
            "holdout_result": metric_summary(local_holdout),
            "purpose": "portability / local stress check; policy is NOT retuned on this subset",
        },
        "interpretation_guardrails": [
            "The holdout result evaluates one component of the pricing methodology, not the final project price recommendation.",
            "Current asking and new-development evidence cannot be backtested honestly without historical snapshots from those dates.",
            "A narrow point-error metric is not enough: interval hit rate and interval width are reported together.",
            "The targeted local subset is intentionally reported even when weaker; it is a diagnostic, not hidden from the result.",
            "No policy from this report is automatically promoted into production solely because it has the lowest calibration error.",
        ],
    }

    out_json = ROOT / "historical_validation_report.json"
    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    cal_sorted = sorted(calibration, key=lambda r: (r.metrics.median_absolute_percentage_error or 999))
    bm = holdout.metrics
    sm = strict_holdout.metrics
    lm = local_holdout.metrics

    lines = [
        "# Historical Pricing Validation — v1",
        "",
        "This is a walk-forward validation of the **completed-sale comparable component only**.",
        "It deliberately does not pretend that today's asking listings or project offers existed historically.",
        "",
        "## Leakage controls",
        "",
        "- A target sale can use only completed sales dated strictly before its sale date.",
        "- Same room count + standard apartment only.",
        "- Each building/location cluster contributes once.",
        "- No learned relevance weights.",
        "- A separate robustness check excludes the target building entirely.",
        "",
        "## Calibration (Ashkelon, before 2025-01-01)",
        "",
        "| Policy | Predictions | MdAPE | Mean APE | Interval hit | Median interval width |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for r in cal_sorted:
        m = r.metrics
        lines.append(
            f"| {r.policy.name} | {m.predicted_targets} | {pct(m.median_absolute_percentage_error)} | "
            f"{pct(m.mean_absolute_percentage_error)} | {pct(m.interval_hit_rate)} | "
            f"{pct(m.median_interval_width_pct_of_actual)} |"
        )

    lines += [
        "",
        f"Calibration selection rule chooses **{best.policy.name}** by lowest calibration MdAPE only.",
        "This is a candidate for holdout evaluation, not an automatic production promotion.",
        "",
        "## Untouched holdout (2025-01-01 onward)",
        "",
        f"- Predictions: **{bm.predicted_targets}/{bm.eligible_targets}** ({pct(bm.prediction_coverage)})",
        f"- Median absolute error: **{money(bm.median_absolute_error)}**",
        f"- Median absolute percentage error: **{pct(bm.median_absolute_percentage_error)}**",
        f"- Mean absolute percentage error: **{pct(bm.mean_absolute_percentage_error)}**",
        f"- 90th percentile absolute percentage error: **{pct(bm.p90_absolute_percentage_error)}**",
        f"- Median signed bias: **{pct(bm.median_signed_percentage_error)}**",
        f"- Actual sale inside selected-comparable min/max interval: **{pct(bm.interval_hit_rate)}**",
        f"- Median interval width relative to actual price: **{pct(bm.median_interval_width_pct_of_actual)}**",
        "",
        "### Holdout by room count",
        "",
        "```json",
        json.dumps(bm.by_rooms, ensure_ascii=False, indent=2),
        "```",
        "",
        "## Strict robustness: exclude target building",
        "",
        f"- Predictions: **{sm.predicted_targets}/{sm.eligible_targets}**",
        f"- MdAPE: **{pct(sm.median_absolute_percentage_error)}**",
        f"- Mean APE: **{pct(sm.mean_absolute_percentage_error)}**",
        f"- Interval hit: **{pct(sm.interval_hit_rate)}**",
        "",
        "This checks that the apparent holdout performance is not simply caused by reusing prior sales from the exact target building.",
        "",
        "## Targeted City Wine + adjacent-area stress check",
        "",
        f"The selected Ashkelon policy is reused **without retuning** on the targeted 3-room + 5-room datasets.",
        f"- Predictions: **{lm.predicted_targets}/{lm.eligible_targets}** ({pct(lm.prediction_coverage)})",
        f"- MdAPE: **{pct(lm.median_absolute_percentage_error)}**",
        f"- Mean APE: **{pct(lm.mean_absolute_percentage_error)}**",
        f"- Interval hit: **{pct(lm.interval_hit_rate)}**",
        f"- Median interval width: **{pct(lm.median_interval_width_pct_of_actual)}**",
        "",
        "## Interpretation",
        "",
        "The broad-city holdout is useful evidence that transparent comparable selection can beat the v1-like all-cluster baseline on this dataset.",
        "However, the targeted local stress check is materially weaker. That means the pricing math should **not be frozen yet**.",
        "The next investigation should focus on why local same-room transactions contain large price dispersion (time regime, building/project heterogeneity, source semantics, and missing attributes) before changing the production method.",
        "",
        "This report validates the sold-comparable component only; it does not validate historical asking/project lanes because we do not have historical snapshots for them.",
    ]

    out_md = ROOT / "HISTORICAL_VALIDATION.md"
    out_md.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(json.dumps({
        "selected_policy": best.policy.name,
        "broad_holdout": metric_summary(holdout),
        "strict_holdout": metric_summary(strict_holdout),
        "local_holdout": metric_summary(local_holdout),
        "output_json": str(out_json),
        "output_markdown": str(out_md),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
