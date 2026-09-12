# special_unit_addon_enriched_v2

Status: **ENRICHED_VALIDATED_CANDIDATE**  
Research/enrichment date: 2026-09-12

This dataset is a separate enrichment layer over immutable `special_unit_addon_frozen_v1`. The v1 files were not mutated. The standard 3R/5R dataset, Petah Tikva data, and pricing methodology were not changed.

## Before → after

- Competitor projects: 31 → 32
- Special asking rows: 35 → 42
- Sold/context rows: 7 → 8
- Competitor unit variants: 16 → 29

### Competitor coverage after enrichment

| City | Projects | Developer known | Any price | Explicit price+area (any semantics) | Quantitative price+area | Garden product/variant | Genuine duplex/triplex project variant |
|---|---:|---:|---:|---:|---:|---:|---:|
| תל אביב-יפו | 10 | 10 | 4 | 4 | 2 | 5 | 2 |
| נתניה | 9 | 9 | 6 | 2 | 0 | 2 | 0 |
| אשקלון | 13 | 12 | 9 | 2 | 0 | 7 | 0 |

`STARTING_PRICE` is never treated as a quantitative unit price, even where an area is separately visible. `HISTORICAL_MARKETING_PRICE` and `CONTEXT_ONLY` remain context.

## Material v2 additions

- Tel Aviv: two direct Anglo-Saxon duplex observations with explicit 150/170 m² internal area and 70/80 m² terrace area; RAYK and GALIPOLIS garden-duplex product existence recorded without fabricating model dimensions/prices; Family Groove garden model deepened.
- Netanya: additional current Dekel 6R/163 m² duplex observation; Bnei Reich 21 repost/conflict chain preserved including direct historical Homeless listing ID 245117; one completed 5R/159 m² transaction retained only as `PRODUCT_TYPE_UNVERIFIED`; no direct special sale claimed.
- Ashkelon: direct 3R/90 m² penthouse context row; historical Inbar 5 duplex context; active Project K added after missed-project audit; several project starting-price/model gaps reduced.

## Remaining high-value gaps

- Direct special-unit completed sales remain zero. The dedicated sale pass found geometry-matched transactions but not defensible product-type proof; none was promoted.
- Exact 2–3R small garden resale evidence remains absent in Kiryat Hasharon and Barnea after targeted searches. Project-level garden products are kept separate.
- Genuine project-level duplex/triplex variants remain sparse: Tel Aviv has explicit garden-duplex product context; Netanya/Ashkelon did not yield a defensible current project multi-level model and ordinary penthouses were not relabeled.
- Exact project/building coordinates remain incomplete. Centroids are explicitly labeled and are never presented as exact.

## Integrity / semantics

Allowed price types: `VERIFIED_UNIT_PRICE`, `DEVELOPER_UNIT_OFFER`, `CURRENT_ASKING`, `STARTING_PRICE`, `HISTORICAL_MARKETING_PRICE`, `CONTEXT_ONLY`.

Likely reposts and conflicting price observations are preserved rather than collapsed to a convenient price.

See `enrichment_validation.json`, `completeness_before_after.csv`, `field_provenance.csv`, and `missed_competitor_audit.csv` for audit detail.


## Final semantic reconciliation — 2026-09-12
- Yiftach 4 archived listing is HISTORICAL_MARKETING_PRICE and is excluded from CURRENT_ASKING coverage counts; observed_date is null, retrieved_at retained.
- GALIPOLIS ₪3.215M is STARTING_PRICE/non-quantitative because no retained durable evidence ties it to the exact 73 m² model.
- Full V2 evidence remains the integration base; V3 is display/precision overlay only.
