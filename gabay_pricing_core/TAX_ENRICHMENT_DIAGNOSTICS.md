# Tax Authority Enrichment Diagnostics

**Diagnostic only. No production pricing rule was changed.**

## What the 250-row run actually contains

- rows: **250**
- exact 5-room rows: **227**
- observed dates: **2026-04-28 → 2026-08-11**
- because the run was capped at 250 rows, this is a recent citywide slice, **not** a complete 36-month history.

### Enriched-field coverage on the 227 exact 5-room rows

| Field | Known | Coverage |
|---|---:|---:|
| address | 169 | 74.4% |
| neighborhoodName | 178 | 78.4% |
| floor | 131 | 57.7% |
| buildingFloors | 97 | 42.7% |
| yearBuilt | 160 | 70.5% |
| propertyType | 171 | 75.3% |
| isFirstHand | 57 | 25.1% |
| assetId | 152 | 67.0% |
| prevDeals | 25 | 11.0% |
| trend | 17 | 7.5% |

## Cross-source match against the targeted GovMap 5-room run

A conservative fuzzy join matched **11 / 100** targeted GovMap rows in this capped recent slice.
The join requires same rooms, gush, helka and area; date within one day; amount within 0.1%.
It is intentionally not used to overwrite the base transaction.

## Main finding: first-hand status does not solve the price-regime problem

Parcel `1197-82` contains 5-room units around 124–125 m² in two radically different price regimes during May 2026:

- early-May rows around **₪11.7K–₪11.9K/m²**, including rows marked `isFirstHand=true`;
- later-May rows around **₪20.6K–₪21.4K/m²**, also including `isFirstHand=true` and planned-completion year 2029.

Therefore `isFirstHand` is useful context, but **cannot be used as a simple new-vs-resale split that explains the dispersion**.

Parcel `1197-93` is the opposite pattern: a large group of developer/new-build-context 5-room deals is internally coherent around roughly **₪11.2K–₪11.9K/m²**, with several rows carrying planned completion year 2030.

This supports **project/parcel-level regime segmentation** as an investigation, not an arbitrary global premium.

## Source-complexity finding

There are **46** near-twin 5-room record pairs under the conservative diagnostic rule.
Of **56** exact 5-room rows marked `isFirstHand=true`, **29** have a richer near-twin record in the same capped dataset.

There are also **7** exact 5-room records whose `prevDeals` contains a transaction on the **same date** as the current sale. That is not a clean repeat-sale history and should be treated as a transaction-complexity/review signal.

## What we can safely conclude

1. Keep GovMap as the geocoded base evidence source.
2. Use the enriched Tax Authority actor as a **secondary enrichment and QA lane**.
3. Do not transfer or merge fields across near-twin rows automatically.
4. Do not create a generic `first-hand premium`, `future-build premium`, or floor premium.
5. Add only provenance-preserving diagnostic flags first, then measure whether they improve historical validation.

## Next controlled experiment

- conservative cross-source matching with explicit match confidence;
- flag direct `isFirstHand=true` only when the exact enriched row matches strongly;
- flag future/planned completion context from `yearBuilt`;
- flag same-day `prevDeals` / same-subparcel conflicts as transaction complexity;
- test each flag independently in development validation;
- only then modify comparable eligibility/ranking, followed by a fresh holdout.
