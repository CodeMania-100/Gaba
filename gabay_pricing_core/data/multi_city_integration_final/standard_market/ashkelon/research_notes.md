# אשקלון / ברנע — research notes

Research as of: 2026-09-11

## Geographic scope
- Tier 1: ברנע exact label
- Tier 2: Barnea-family subdivisions: גני ברנע and מצפה ברנע
- Tier 3: broader Ashkelon context, competitor/reference only unless explicitly required
- 3R broadening: yes — Tier 2 Barnea-family subdivisions used because strict ברנע exact-label 3R evidence is sparse
- 5R broadening: yes — Tier 2 Barnea-family subdivisions used for a stable comparable set

## Methodology
- Same `market-range-v1` mechanics as the existing Petah Tikva demo.
- Each independent building/listing/project contributes once using the median observed ₪/m² within its group.
- Area-normalized indication = representative observed ₪/m² × target internal area.
- Lane interval = minimum / median / maximum normalized contributor indications.
- A final range requires one connected overlap supported by at least two eligible lanes.
- No weighted average. Balcony, floor, orientation, parking and storage are not monetized.

## QA / limitations
- The quantitative scope was broadened only within the Barnea family (ברנע + גני ברנע + מצפה ברנע), not to generic Ashkelon.
- Montefiore 18/20 carry a documented minor 59/60 m² display discrepancy across mirrors. WizBid's 59 m² value is retained because one mirror's displayed ₪/m² is consistent with 59 m²; the conflict is not silently erased.
- The 3R supported overlap is extremely narrow and should be presented as a boundary overlap, not as a broad stable band.
- No Barnea new-development model with a defensible same-unit/model price+area join was found; new-development projects remain context-only.

## 3R
- status: consensus
- confidence: medium
- supported range: 1338000.0 – 1339000.0
- neutral comparison point: 1338000.0
- sold independent contributors: 3
- asking independent contributors: 2
- quantitative new-development contributors: 0
- warnings: extremely_narrow_boundary_overlap, target_balcony_present_without_verified_monetary_adjustment

## 5R
- status: consensus
- confidence: medium
- supported range: 1631000.0 – 1805000.0
- neutral comparison point: 1718000.0
- sold independent contributors: 6
- asking independent contributors: 4
- quantitative new-development contributors: 0
- warnings: target_is_smaller_or_larger_than_observed_primary_comparable_areas, target_balcony_present_without_verified_monetary_adjustment

## Final hardening — 2026-09-11
Added one Tier-2 Barnea-family current ask: מונטיפיורי 18, 3R, 70 m², ₪1.10M. The previous `extremely_narrow_boundary_overlap` no longer remains: the exact frozen engine now returns ₪1.271M–₪1.339M because the asking evidence was deepened. This was not an artificial widening or average. Raw neighborhood/tier remain preserved and the canonical Barnea pricing scope mapping is explicit in `location.json`.
