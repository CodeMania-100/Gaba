# Multi-city market research package — FROZEN

Research / hardening date: **2026-09-11**

This is the final hardened dataset for the three new demo locations. No further exploratory city research is required.

## Integration scope
- תל אביב-יפו — יד אליהו
- נתניה — קריית השרון
- אשקלון — ברנע (documented Tier-2 Barnea-family broadening where required)

**Petah Tikva is reference-only.** Its old checkpoint rows have been removed from the integration-facing cross-city files and placed under `reference_only/`. They must never overwrite current Petah Tikva application data.

## Frozen application engine regression
Repository: `CodeMania-100/Gaba`  
Branch: `demo-online-v1`  
Commit: `17b12526a139c30941aacffb4ce871de21a38fa7`  
`pricing_core/market_range.py` Git blob: `97b55065dc533369f93c5731cf58bcda240d1d7a`  
Repository methodology label: `market-range-v2-program-regime`

The prior research artifact called the semantics `market-range-v1`; the pinned repository file now identifies itself as `market-range-v2-program-regime`. This package uses the repository source as authoritative and executed that exact file for the final regression. No premium, source weight or new formula was introduced.

## Final cross-city outputs (new cities only)
| Location | Family | Status | Supported range | Neutral comparison point | Confidence |
|---|---:|---|---:|---:|---|
| תל אביב-יפו / יד אליהו | 3R | consensus | ₪2,560,000 – ₪2,748,000 | ₪2,654,000 | medium |
| תל אביב-יפו / יד אליהו | 5R | consensus | ₪3.921M–₪3.988M | ₪3.954M | medium |
| נתניה / קריית השרון | 3R | consensus | ₪1.958M–₪2.162M | ₪2.060M | medium |
| נתניה / קריית השרון | 5R | consensus | ₪2.490M–₪2.683M | ₪2.586M | medium |
| אשקלון / ברנע | 3R | consensus | ₪1.271M–₪1.339M | ₪1.305M | medium |
| אשקלון / ברנע | 5R | consensus | ₪1.631M–₪1.805M | ₪1.718M | medium |

### Final hardening effects
- **Tel Aviv 3R is `consensus` after the final semantic correction.** GALIPOLIS ₪3.215M was removed from the quantitative lane because it is starting-price context; the pinned-engine rerun yields ₪2.560M–₪2.748M, medium confidence.
- **Netanya 3R deepened:** one exact-submarket 74 m² ask at שפיגלמן 12 was added.
- **Barnea 3R deepened:** one 70 m² Tier-2 Barnea-family ask at מונטיפיורי 18 was added. The former 1,000-ILS boundary overlap does **not** remain; the final overlap widened naturally from new evidence, not from averaging or a changed formula.
- Balcony, floor, orientation, parking, storage and city premiums remain unmonetized.

## Provenance and map readiness
Every evidence row now carries stable provenance fields where recoverable plus `record_uid`. Opaque search-turn references are retained only as legacy audit fields. Every accepted sold/asking row and every competitor has latitude/longitude; approximate centroid coordinates are explicitly marked rather than presented as exact.

## Files
- `cross_city_comparison.csv/json` — integration-facing new-city comparison only
- `calculation_audit.json` — final contributor/lane audit including q1/median/q3
- `engine_regression/regression_table.csv` — research vs actual frozen engine
- `engine_regression/regression_validation.json` — engine identity and exact-match assertion
- `hardening_changes.json` — final changes/rejections
- `reference_only/` — Petah checkpoint and pre-hardening comparison
- per-city `location.json`, sold/asking CSVs, `competitors.json`, `market_summary.json`, `research_notes.md`


## Final semantic reconciliation — 2026-09-12
- GALIPOLIS 3R / 73 m² / ₪3.215M is STARTING_PRICE context, not a verified model price.
- Quantitative new-development contributors for Tel Aviv 3R are now TIDHAR and RAYK only.
- Actual pinned-engine rerun: sold ₪2.560M–₪3.251M; current asking ₪2.514M–₪2.748M; new development ₪3.347M–₪3.596M; final consensus ₪2.560M–₪2.748M; point ₪2.654M; confidence MEDIUM.
- Pricing methodology was not changed.
