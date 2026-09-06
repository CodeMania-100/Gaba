# Historical Pricing Validation — v1

This is a walk-forward validation of the **completed-sale comparable component only**.
It deliberately does not pretend that today's asking listings or project offers existed historically.

## Leakage controls

- A target sale can use only completed sales dated strictly before its sale date.
- Same room count + standard apartment only.
- Each building/location cluster contributes once.
- No learned relevance weights.
- A separate robustness check excludes the target building entirely.

## Calibration (Ashkelon, before 2025-01-01)

| Policy | Predictions | MdAPE | Mean APE | Interval hit | Median interval width |
|---|---:|---:|---:|---:|---:|
| nearest_8_area15 | 149 | 10.3% | 15.0% | 74.5% | 42.0% |
| nearest_3_area15 | 149 | 11.3% | 15.6% | 54.4% | 25.7% |
| all_independent_clusters_v1_like | 149 | 11.4% | 15.3% | 85.9% | 70.3% |
| nearest_5_area15 | 149 | 12.2% | 15.8% | 67.8% | 37.4% |
| nearest_8_independent_clusters | 149 | 12.4% | 15.5% | 80.5% | 49.2% |
| nearest_5_independent_clusters | 149 | 13.4% | 16.3% | 71.8% | 41.3% |
| nearest_3_independent_clusters | 149 | 13.7% | 16.8% | 53.0% | 28.8% |

Calibration selection rule chooses **nearest_8_area15** by lowest calibration MdAPE only.
This is a candidate for holdout evaluation, not an automatic production promotion.

## Untouched holdout (2025-01-01 onward)

- Predictions: **104/104** (100.0%)
- Median absolute error: **₪115,000**
- Median absolute percentage error: **7.0%**
- Mean absolute percentage error: **9.1%**
- 90th percentile absolute percentage error: **18.1%**
- Median signed bias: **-1.7%**
- Actual sale inside selected-comparable min/max interval: **80.8%**
- Median interval width relative to actual price: **35.8%**

### Holdout by room count

```json
{
  "3": {
    "predicted_targets": 18,
    "median_absolute_percentage_error": 0.11194380519354749,
    "mean_absolute_percentage_error": 0.11147350672923655,
    "median_signed_percentage_error": -0.062065242763772205,
    "interval_hit_rate": 0.8888888888888888
  },
  "4": {
    "predicted_targets": 70,
    "median_absolute_percentage_error": 0.06367096224247676,
    "mean_absolute_percentage_error": 0.08505920071803386,
    "median_signed_percentage_error": -0.014419948275260299,
    "interval_hit_rate": 0.8142857142857143
  },
  "5": {
    "predicted_targets": 16,
    "median_absolute_percentage_error": 0.08023365348276146,
    "mean_absolute_percentage_error": 0.09577393294227049,
    "median_signed_percentage_error": 0.0017679157985262626,
    "interval_hit_rate": 0.6875
  }
}
```

## Strict robustness: exclude target building

- Predictions: **104/104**
- MdAPE: **6.9%**
- Mean APE: **9.3%**
- Interval hit: **79.8%**

This checks that the apparent holdout performance is not simply caused by reusing prior sales from the exact target building.

## Targeted City Wine + adjacent-area stress check

The selected Ashkelon policy is reused **without retuning** on the targeted 3-room + 5-room datasets.
- Predictions: **33/33** (100.0%)
- MdAPE: **12.9%**
- Mean APE: **15.0%**
- Interval hit: **63.6%**
- Median interval width: **46.7%**

## Interpretation

The broad-city holdout is useful evidence that transparent comparable selection can beat the v1-like all-cluster baseline on this dataset.
However, the targeted local stress check is materially weaker. That means the pricing math should **not be frozen yet**.
The next investigation should focus on why local same-room transactions contain large price dispersion (time regime, building/project heterogeneity, source semantics, and missing attributes) before changing the production method.

This report validates the sold-comparable component only; it does not validate historical asking/project lanes because we do not have historical snapshots for them.
