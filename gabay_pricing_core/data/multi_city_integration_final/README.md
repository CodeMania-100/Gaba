# multi_city_integration_final

Status: **FROZEN** — final semantic reconciliation. No new market research was performed in this pass.

## Layering
- `standard_market/`: authoritative standard 3R/5R multi-city market evidence.
- `special_full_v2/`: complete special-unit evidence base.
- `precision_overlay_v3/`: curated UI/display precision overlay; it supplements and never replaces V2.

## Final semantic corrections
- Yiftach 4 archive: `HISTORICAL_MARKETING_PRICE`, not `CURRENT_ASKING`; `observed_date=null`, `retrieved_at` retained.
- GALIPOLIS 3R / 73 m² / ₪3.215M: `STARTING_PRICE`, `quantitative_unit_price_area=false`. No retained durable source proves the campaign price belongs to that exact 73 m² model.
- Tel Aviv 3R was rerun through the pinned repository engine with GALIPOLIS excluded from the quantitative new-development lane. Final result: consensus ₪2.560M–₪2.748M, point ₪2.654M, MEDIUM confidence.

## Engine
`CodeMania-100/Gaba` @ `17b12526a139c30941aacffb4ce871de21a38fa7`, `gabay_pricing_core/pricing_core/market_range.py`, blob `97b55065dc533369f93c5731cf58bcda240d1d7a`. Pricing methodology was not changed.

See `semantic_audit.json` and `final_validation.json`.
