# Frozen engine execution note

The final six city/family regressions were executed on 2026-09-11 using the exact repository `pricing_core/market_range.py` blob pinned below. The source file was fetched from GitHub and its local Git blob SHA was recomputed before execution.

- Repository: `CodeMania-100/Gaba`
- Branch: `demo-online-v1`
- Commit: `17b12526a139c30941aacffb4ce871de21a38fa7`
- Path: `gabay_pricing_core/pricing_core/market_range.py`
- Git blob SHA: `97b55065dc533369f93c5731cf58bcda240d1d7a`
- Repository methodology label: `market-range-v2-program-regime`

The local harness only supplies the dataset structures needed by the repository engine. It does not replace or edit the engine's range, confidence, normalization, overlap, rounding, area-tolerance or feature-premium logic.

For Ashkelon, the documented Tier-2 Barnea-family geographic broadening is applied before the engine boundary. Raw neighborhood and `geography_tier` remain in the evidence files; `pricing_scope_neighborhood=ברנע` is an explicit adapter field so the frozen engine's exact-neighborhood lane interface can consume the already-approved geographic scope.
