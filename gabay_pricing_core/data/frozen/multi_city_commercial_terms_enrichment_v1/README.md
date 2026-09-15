# Multi-city commercial terms enrichment v1

Generated: 2026-09-14

## Purpose
Commercial-intelligence enrichment only. This dataset records published prices, payment structures,
financing, indexation treatment, promotions, included benefits and delivery/status for a focused set
of high-relevance competitors. It does **not** change the pricing engine or calculate an effective price.

## Scope
- Petah Tikva: THE SPOT, רוטשילד 163-165, זאב ברנדה 22, שבזי 3-5
- Tel Aviv / Yad Eliyahu: TIDHAR בין השדרות, RAYK EAST SIDE, GALIPOLIS
- Netanya / Kiryat Hasharon: בראשית פמלי — קריית השרון, גבאי על הפארק, THE STRIP נתניה
- Ashkelon / Barnea: חלומות ברנע הירוקה, פרץ בוני הנגב בעיר היין, JADE אשקלון

## Key current commercial findings
- TIDHAR בין השדרות: 20% initial / 80% near occupancy; contractor-loan framing; 10-year TIDHAR warranty context.
- RAYK EAST SIDE: advertised 1.99% fixed unlinked mortgage campaign; construction-index treatment remains UNKNOWN.
- THE STRIP נתניה: 20/80 + published index exemption + price-protection/cancellation campaign context.
- זאב ברנדה 22: 80/20 option plus 2.99% fixed unlinked mortgage campaign and bridge-financing language.
- רוטשילד 163-165: 20% at signing / 80% at occupancy.
- גבאי על הפארק: 20/80 shown with current 5R offer; exact later-payment timing is not stated in the retained source.
- בראשית פמלי: official trade-in campaign applies to selected participating units, not automatically to every apartment.
- פרץ בעיר היין: official page says attractive financing terms, but no exact schedule/rate was found; structured fields stay UNKNOWN.
- חלומות ברנע: official source says occupied; legacy portal prices are retained only as historical context.
- JADE: model starting-price ladder is retained, but exact financing terms remain unresolved.

## Semantic safeguards
- `STARTING_PRICE` never becomes an exact unit price.
- Mortgage “unlinked” wording is not treated as a construction-input-index exemption.
- Vague “convenient financing” language is not converted to 20/80 or to a loan subsidy.
- Historical and stale offers are kept separate from current offers.
- Project-wide benefits are not silently attached to a specific room family.
- No discount is inferred from two prices observed at different dates.
- `UNKNOWN` is not converted to `NONE`.

## Files
- `multi_city_commercial_terms_enrichment_v1.json` — canonical structured dataset.
- `coverage_table.csv` — ✓ verified / ? unknown / H historical-recent / C conflict.
- `newly_discovered_current_terms.csv` — current verified commercial terms/promotions.
- `historical_expired_findings.csv` — historical/legacy offers separated from current.
- `conflicts.csv` — retained conflicts and resolution notes.
- `unresolved_fields.csv` — genuine unresolved fields.
- `validation.json` — QA result.

Validation status: **PASS**
