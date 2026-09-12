# Final multi-city data-hardening report

Date: 2026-09-11
Status: **FROZEN — cleared at data-package level for application integration testing**

## Closure checklist

1. **Petah Tikva checkpoint — reference only:** complete. Petah rows are absent from integration-facing `cross_city_comparison.*`; the historical checkpoint is under `reference_only/` with write protection flags.
2. **Stable provenance:** complete to the extent recoverable. Stable URL/title/date/durable ID are primary fields where available. Opaque `turn...` references remain only in legacy audit fields. Records without a recoverable public URL use a durable transaction ID or deterministic `record_uid` and are explicitly marked.
3. **Map coordinates:** complete. Selected submarket centers, every accepted sold/asking row and every competitor project contain latitude/longitude. Source-exact coordinates are preferred; centroid fallback is explicitly labeled.
4. **Netanya 3R deepening:** complete. Added exact-submarket ask at אברהם שפיגלמן 12 — 3R / 74 m² / ₪2.10M.
5. **Barnea 3R deepening:** complete. Added Tier-2 Barnea-family ask at מונטיפיורי 18 — 3R / 70 m² / ₪1.10M. The previous one-thousand-shekel boundary overlap no longer remains because the final evidence naturally widened the asking lane.
6. **Tel Aviv 3R:** final semantic reconciliation corrected GALIPOLIS from a purported verified model price to STARTING_PRICE context. The pinned-engine rerun now returns consensus ₪2.560M–₪2.748M, medium confidence; methodology unchanged.
7. **Actual frozen engine regression:** complete. All six new city/family outputs exactly match the pinned repository engine.
8. **Feature/city premiums:** none introduced. Balcony, floor, parking, storage, orientation and city premiums remain unmonetized.

## Frozen engine identity

- Repository: `CodeMania-100/Gaba`
- Branch: `demo-online-v1`
- Commit: `17b12526a139c30941aacffb4ce871de21a38fa7`
- File: `gabay_pricing_core/pricing_core/market_range.py`
- Git blob SHA: `97b55065dc533369f93c5731cf58bcda240d1d7a`
- Methodology label in the pinned file: `market-range-v2-program-regime`

The earlier research package called the replicated semantics `market-range-v1`. This was a label mismatch, not an intentional methodology change. The final regression executes the exact pinned repository file and treats it as authoritative.

## Final results

| Location | Family | Status | Supported range | Neutral point | Confidence |
|---|---|---|---:|---:|---|
| תל אביב-יפו / יד אליהו | 3R | consensus | ₪2,560,000 – ₪2,748,000 | ₪2,654,000 | medium |
| תל אביב-יפו / יד אליהו | 5R | consensus | ₪3.921M–₪3.988M | ₪3.954M | medium |
| נתניה / קריית השרון | 3R | consensus | ₪1.958M–₪2.162M | ₪2.060M | medium |
| נתניה / קריית השרון | 5R | consensus | ₪2.490M–₪2.683M | ₪2.586M | medium |
| אשקלון / ברנע | 3R | consensus | ₪1.271M–₪1.339M | ₪1.305M | medium |
| אשקלון / ברנע | 5R | consensus | ₪1.631M–₪1.805M | ₪1.718M | medium |

## Integration note for Barnea

The task specification permits documented Tier-2 geographic broadening before changing apartment specifications. The frozen engine's asking/new-development interface expects an exact normalized neighborhood. Therefore accepted Barnea-family Tier-2 rows retain their raw neighborhood and `geography_tier`, while a separate `pricing_scope_neighborhood=ברנע` adapter field is used at the engine boundary. No price, area, lane logic, overlap rule or premium is altered.

## Freeze rule

This dataset is frozen. No additional exploratory city research is required. Any future changes should be treated as a new dataset version rather than silently modifying this one.


## Final semantic reconciliation — 2026-09-12
- GALIPOLIS 3R / 73 m² / ₪3.215M is STARTING_PRICE context, not a verified model price.
- Quantitative new-development contributors for Tel Aviv 3R are now TIDHAR and RAYK only.
- Actual pinned-engine rerun: sold ₪2.560M–₪3.251M; current asking ₪2.514M–₪2.748M; new development ₪3.347M–₪3.596M; final consensus ₪2.560M–₪2.748M; point ₪2.654M; confidence MEDIUM.
- Pricing methodology was not changed.
