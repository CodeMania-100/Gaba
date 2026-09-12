# תל אביב-יפו / יד אליהו — research notes

Research as of: 2026-09-11

## Geographic scope
- Tier 1: יד אליהו only
- Tier 2: immediately adjacent eastern/southeastern Tel Aviv submarkets, only if Tier 1 is insufficient
- Tier 3: broader Tel Aviv-Yafo context, reference only unless explicitly documented
- 3R broadening: none
- 5R broadening: none

## Methodology
- Same `market-range-v1` mechanics as the existing Petah Tikva demo.
- Each independent building/listing/project contributes once using the median observed ₪/m² within its group.
- Area-normalized indication = representative observed ₪/m² × target internal area.
- Lane interval = minimum / median / maximum normalized contributor indications.
- A final range requires one connected overlap supported by at least two eligible lanes.
- No weighted average. Balcony, floor, orientation, parking and storage are not monetized.

## QA / limitations
- La Guardia 65/67 sold records were quarantined because source snapshots materially disagree on unit area (79 m² vs 61 m²).
- Galipoli 42/46 3R record was quarantined because sources disagree on the building number.
- The Tel Aviv 3R lanes are individually usable but do not form one connected maximum-support consensus region: sold overlaps asking at a lower band and new development at a higher disconnected band.
- RAYK EAST SIDE 5R is excluded from the quantitative lane because the same ₪4.89M offer is associated with 111 m² in a fresh result and 151 m² in an older project crawl.

## 3R
- status: consensus
- confidence: low
- supported range: None – None
- neutral comparison point: None
- sold independent contributors: 6
- asking independent contributors: 6
- quantitative new-development contributors: 3
- warnings: independent_evidence_lanes_do_not_form_one_consensus_interval, target_balcony_present_without_verified_monetary_adjustment

## 5R
- status: consensus
- confidence: medium
- supported range: 3921000.0 – 3988000.0
- neutral comparison point: 3954000.0
- sold independent contributors: 4
- asking independent contributors: 4
- quantitative new-development contributors: 1
- warnings: target_balcony_present_without_verified_monetary_adjustment

## Final hardening — 2026-09-11
Final semantic reconciliation downgraded GALIPOLIS ₪3.215M to STARTING_PRICE/non-quantitative. The pinned-engine rerun changes Tel Aviv 3R to consensus at ₪2.560M–₪2.748M (point ₪2.654M), medium confidence. Methodology is unchanged.


## Final semantic reconciliation — 2026-09-12
- GALIPOLIS 3R / 73 m² / ₪3.215M is STARTING_PRICE context, not a verified model price.
- Quantitative new-development contributors for Tel Aviv 3R are now TIDHAR and RAYK only.
- Actual pinned-engine rerun: sold ₪2.560M–₪3.251M; current asking ₪2.514M–₪2.748M; new development ₪3.347M–₪3.596M; final consensus ₪2.560M–₪2.748M; point ₪2.654M; confidence MEDIUM.
- Pricing methodology was not changed.
