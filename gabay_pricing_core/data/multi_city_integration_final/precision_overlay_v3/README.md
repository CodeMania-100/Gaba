# Precision enrichment v3

Research as of: 2026-09-12

Baseline: `special_unit_addon_enriched_v2` — **not mutated**.

This is the final targeted precision pass. It deliberately selects only UI-worthy records and active projects rather than expanding the market universe.

## Selection
- Comparables: 13 (4 Tel Aviv, 5 Netanya, 4 Ashkelon)
- Projects: 9 (3 Tel Aviv, 3 Netanya, 3 Ashkelon)

## Most useful precision gains
- Yiftach 4: 57 m² internal + 52 m² garden + 7 m² storage + underground parking + mamad.
- Yad Eliyahu Anglo duplexes: 150 + 70 m² terraces and 170 + 80 m² terraces; parking/mamad recovered; 3 air directions for the 170 m² unit.
- Derech HaPark 25 archive: 140 m² duplex + 18 m² balcony + storage + parking + mamad (historical asking context only).
- Barnea B Homeless penthouse: direct source refreshed to ₪3.44M; 170 m² on one level + 105 m² terraces + 2 parking + storage + mamad + 4 air directions.
- Derech HaYain 22: 160 m² + 40 m² balcony + 3 parking + storage + mamad, direct ad ID 16228309.
- Peretz Wine City: official historical model table provides exact balcony/storage/parking dimensions for model-level comparison.

## Important non-findings preserved
- Exact numeric outdoor geometry remains unavailable for most active new-development special models.
- Netanya’s live 158 m² triplex still lacks a direct listing ID, price and level breakdown.
- No exact lat/lng was guessed when only centroid coordinates were defensible.
- Arie Ben Eliezer remains a conflicting price series rather than a reconciled price.
- GALIPOLIS ₪3.215M campaign price is definitively classified as STARTING_PRICE context in the final semantic freeze; no retained durable exact 73 m² model-price join was found in the collected evidence.

## Completeness highlights
Comparables outdoor-area known: 5/13 → 6/13.
Comparables parking-presence known: 5/13 → 7/13.
Comparables mamad known: 4/13 → 6/13.

See `unresolved_fields.csv` for each null that received a targeted search attempt.

## Guardrails
- No broad research round.
- No new pricing rules or premiums.
- Standard 3R/5R dataset untouched.
- Baseline v2 remains immutable (SHA-256 `6d5ece0a268a8f51ce72774efef2b84eefff142bed9eb3911be51bca95e55d46`).
- `STARTING_PRICE` is never promoted to verified unit price.


## Final semantic reconciliation
- Yiftach 4 archived evidence is HISTORICAL_MARKETING_PRICE, never CURRENT_ASKING; observed_date remains null because the publication date is unknown.
- GALIPOLIS ₪3.215M is STARTING_PRICE/non-quantitative.
- This directory remains a curated display/precision overlay over the full V2 special-unit dataset.
