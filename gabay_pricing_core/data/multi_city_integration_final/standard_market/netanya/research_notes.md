# נתניה / קריית השרון — research notes

Research as of: 2026-09-11

## Geographic scope
- Tier 1: קריית השרון only
- Tier 2: immediately adjacent east-Netanya neighborhoods, only if Tier 1 is insufficient
- Tier 3: broader Netanya context
- 3R broadening: none for quantitative sold/asking lanes
- 5R broadening: none for quantitative sold/asking lanes

## Methodology
- Same `market-range-v1` mechanics as the existing Petah Tikva demo.
- Each independent building/listing/project contributes once using the median observed ₪/m² within its group.
- Area-normalized indication = representative observed ₪/m² × target internal area.
- Lane interval = minimum / median / maximum normalized contributor indications.
- A final range requires one connected overlap supported by at least two eligible lanes.
- No weighted average. Balcony, floor, orientation, parking and storage are not monetized.

## QA / limitations
- Strict-size 3R supply is much thinner than the neighborhood's aggregate 3R count, but three independent exact-neighborhood sold buildings were found inside the 58.65–79.35 m² band.
- No new-development project had a sufficiently verified same-model standard-unit price+area pair for the requested targets, so the competitor lane remains context-only.
- 5R current asking contributors are larger than the 111.1 m² target, so that lane carries an area-envelope warning; the sold lane includes 100–126 m² and directly brackets the target.

## 3R
- status: consensus
- confidence: medium
- supported range: 2128000.0 – 2162000.0
- neutral comparison point: 2145000.0
- sold independent contributors: 3
- asking independent contributors: 2
- quantitative new-development contributors: 0
- warnings: target_is_smaller_or_larger_than_observed_primary_comparable_areas, target_balcony_present_without_verified_monetary_adjustment

## 5R
- status: consensus
- confidence: medium
- supported range: 2490000.0 – 2683000.0
- neutral comparison point: 2586000.0
- sold independent contributors: 7
- asking independent contributors: 4
- quantitative new-development contributors: 0
- warnings: target_is_smaller_or_larger_than_observed_primary_comparable_areas, target_balcony_present_without_verified_monetary_adjustment

## Final hardening — 2026-09-11
Added one exact-submarket current ask: אברהם שפיגלמן 12, 3R, 74 m², ₪2.10M. Frozen-engine 3R support is now ₪1.958M–₪2.162M. No new-development numeric lane was invented.
