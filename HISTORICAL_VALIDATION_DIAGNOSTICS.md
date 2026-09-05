# Historical Validation Failure Diagnostics

This file intentionally investigates the weaker targeted local validation before any pricing-method change is promoted.
No threshold below is used as an automatic exclusion or price adjustment.

## Worst targeted local holdout predictions

| Date | Rooms | Area | Floor | Actual | Predicted | Abs. % error | Target group |
|---|---:|---:|---|---:|---:|---:|---|
| 2026-04-16 | 5 | 128 | 6 | ₪1,441,000 | ₪1,973,000 | 36.9% | coord:31.672200,34.596754 |
| 2026-04-19 | 5 | 128 | 2 | ₪1,418,000 | ₪1,920,000 | 35.4% | coord:31.672200,34.596754 |
| 2026-02-15 | 5 | 124 | 2 | ₪1,566,000 | ₪2,114,000 | 35.0% | coord:31.673739,34.591308 |
| 2026-02-22 | 5 | 124 | 2 | ₪1,533,000 | ₪2,012,000 | 31.3% | coord:31.673739,34.591308 |
| 2026-02-22 | 5 | 124 | 1 | ₪1,577,000 | ₪2,012,000 | 27.6% | coord:31.672573,34.593047 |
| 2026-04-28 | 5 | 124 | 1 | ₪1,533,000 | ₪1,911,000 | 24.7% | coord:31.673739,34.591308 |
| 2026-07-13 | 5 | 128 | — | ₪2,606,000 | ₪1,973,000 | 24.3% | coord:31.673739,34.591308 |
| 2026-05-07 | 5 | 124 | 2 | ₪1,577,000 | ₪1,911,000 | 21.2% | coord:31.672573,34.593047 |
| 2025-03-17 | 5 | 120 | 15 | ₪2,420,000 | ₪1,955,000 | 19.2% | נחלה 7 |
| 2026-03-09 | 5 | 124 | 3 | ₪1,611,000 | ₪1,911,000 | 18.6% | coord:31.672573,34.593047 |

## Highest observed within-location/year dispersion

This tests whether treating a geocoded building/location as a homogeneous comparable contributor is too coarse.

| Location/year | Rooms | Records | Min ₪/m² | Median ₪/m² | Max ₪/m² | Max/min | Known floors |
|---|---:|---:|---:|---:|---:|---:|---|
| נחלה 1 / 2022 | 3 | 2 | ₪9,553 | ₪14,419 | ₪19,286 | 2.02x | 1, 6 |
| נחלה 1 / 2024 | 3 | 4 | ₪10,619 | ₪18,581 | ₪19,048 | 1.79x | 2, 8 |
| coord:31.673739,34.591308 / 2026 | 5 | 5 | ₪12,363 | ₪12,629 | ₪20,359 | 1.65x | 1, 2, 7 |
| coord:31.672200,34.596754 / 2026 | 5 | 3 | ₪11,081 | ₪11,258 | ₪17,031 | 1.54x | 2, 6, 7 |
| נחלה 32 / 2021 | 3 | 2 | ₪7,761 | ₪9,449 | ₪11,136 | 1.43x | 2, 3 |
| נחלה 20 / 2024 | 5 | 3 | ₪12,500 | ₪16,000 | ₪16,159 | 1.29x | 11, 12, 14 |
| נחלה 1 / 2024 | 5 | 6 | ₪13,562 | ₪13,664 | ₪16,349 | 1.21x | 1, 2, 5, 8 |
| נחלה 22 / 2025 | 5 | 3 | ₪14,196 | ₪15,538 | ₪17,109 | 1.21x | 10, 3, 5 |
| נחלה 32 / 2023 | 5 | 4 | ₪15,968 | ₪16,048 | ₪17,857 | 1.12x | 14, 7, 8 |
| נחלה 16 / 2022 | 5 | 9 | ₪14,355 | ₪14,516 | ₪15,484 | 1.08x | 10, 11, 12, 13, 8 |

## What this means

The local error is not evidence that we should add a hidden statistical weight. The data first needs better segmentation.
The immediate next step is to test transparent segmentation/time-normalization hypotheses on calibration data, then re-run the untouched holdout.
