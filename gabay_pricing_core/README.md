# Project Pricing Core

Deterministic evidence, pricing-strategy and scenario core for a corporate real-estate project pricing workspace.

The core is intentionally separated from UI/database concerns so business logic is validated on real market evidence before application infrastructure is added.

## Implemented

### Sold transaction QA

- canonical transaction model and provenance
- exact duplicate handling
- same registered unit/date conflict detection
- conservative possible-companion flagging
- unknown property type preserved
- conservative statistical anomaly review flags
- missing address accepted only when geographic/cadastral traceability remains
- machine-readable quality reasons

### Comparable engine

- separate completed-sale / current-asking / new-development lanes
- standard-apartment eligibility gates
- deterministic geography/recency/structural ranking
- one independent location contribution per sold building/geocoded location
- no inference from project-level price ranges into unpriced unit types

### Market range engine (`market-range-v1`)

- evidence lanes remain separate
- no numerical source weights
- no invented floor/balcony/orientation/parking/storage premium
- target-equivalent indication uses source price-per-sqm × target internal area and explicitly surfaces size extrapolation risk
- supported interval requires overlap from independent eligible evidence lanes
- disagreement returns no-consensus rather than a fabricated middle price
- special units are routed to individual review
- local-area source-scope ambiguity is surfaced and can cap confidence

Methodology controls such as evidence lookback and minimum independent observations are versioned engineering settings, not claimed company policy. They should be visible/configurable in the final product.

### Strategy engine

Market evidence and company commercial decisions are separate stages.

Supported explicit inputs:

- position inside supported market range
- selected competitor evidence + provenance
- explicit competitor delta
- negotiation buffer
- optional company floor rule
- optional min/max commercial constraints

No active input = no effect.

### Whole-project scenario engine

Calculates before/after effects across the full inventory:

- changed units
- proposed project list value
- per-family averages
- units outside market-supported range
- manual/unpriced units
- per-unit deltas and review-state changes

## Real assignment dry run

Demo geography: `עיר היין, אשקלון`, explicitly candidate-selected because the assignment supplies no project address.

Workbook normalization:

- 39 total apartments
- 24 standard 3-room
- 8 standard 5-room
- 3 garden apartments
- 2 duplexes
- 2 triplexes

Current evidence result:

- 32 standard units have market consensus
- 7 special units remain individual/manual pricing cases

The 5-room local-area sold run contains 100 records: 49 primary usable, 41 low-confidence, 10 ambiguous, 0 rejected. Missing/misaligned neighborhood labels are not silently treated as exact City Wine attribution; coordinates remain visible and sold-lane confidence is capped where necessary.

## Tests

```bash
python -m pytest -q
```

Current checkpoint: **65 targeted tests passing**.

## Useful development commands

Sold QA:

```bash
PYTHONPATH=. python scripts/run_sold_qa.py /path/to/sold.json --out-dir qa_output
```

Full evidence dry run with local 3-room and 5-room snapshots:

```bash
PYTHONPATH=. python scripts/run_project_dry_run.py \
  --inventory-rows inventory_source_rows.json \
  --sold-3-local /path/to/wine_city_sold_raw.json \
  --sold-5-local /path/to/wine_city_sold_5room_raw.json \
  --sold-citywide /path/to/sold_deals_raw.json \
  --listings /path/to/madlan_apify_200.json \
  --projects /path/to/madlan_projects_only.json \
  --output project_dry_run.json
```

Engineering strategy/scenario validation (the numeric positions are explicit test inputs, not product defaults):

```bash
PYTHONPATH=. python scripts/run_strategy_scenario_demo.py \
  --inventory-rows inventory_source_rows.json \
  --sold-3-local /path/to/wine_city_sold_raw.json \
  --sold-5-local /path/to/wine_city_sold_5room_raw.json \
  --sold-citywide /path/to/sold_deals_raw.json \
  --listings /path/to/madlan_apify_200.json \
  --projects /path/to/madlan_projects_only.json \
  --baseline-position 50 \
  --scenario-position 75 \
  --output strategy_scenario_engineering_demo.json
```

### Override / lock governance

- mandatory reason for manual overrides
- original recommendation preserved for audit
- out-of-range manual decisions are flagged rather than blocked or hidden
- locked decisions survive subsequent repricing
- unlocked working edits do not silently survive a new pricing run
- project metrics are recalculated after overrides

### Consistency engine

- inventory/pricing cardinality and range-integrity blockers
- market-range breaches surfaced as review issues
- explicit min/max company constraints checked after overrides
- explicit floor-rule adjustment trace verified
- optional relative-unit rules are enforced only when the company supplies them
- no floor ordering, orientation premium, balcony premium, parking premium or storage premium is invented

The real 39-unit engineering run passes consistency with **0 blockers and 0 review issues** when no company relationship rules are supplied. The report explicitly lists the checks that were *not* applied because no such company rules exist.

### Application contract

`APPLICATION_CONTRACT.md` freezes the persistence/versioning/API boundary before application code: immutable market snapshots, immutable approved price lists, background refresh jobs, audit events, scenario branches, explicit overrides, and conflict-safe writes.

### Persistence/API shell

A working FastAPI + SQLAlchemy shell now persists:

- projects
- immutable/idempotent inventory imports
- normalized units with unknown values preserved
- inventory derivation metadata

The default local database is SQLite for zero-friction development; `DATABASE_URL` can point to PostgreSQL without changing the service contract. Identical inventory imports are idempotent rather than silently creating duplicate versions.

Run locally:

```bash
PYTHONPATH=. uvicorn app_api.main:app --reload
```

Current implemented endpoints:

- `GET /health`
- `POST /api/v1/projects`
- `GET /api/v1/projects/{project_id}`
- `POST /api/v1/projects/{project_id}/inventory/import`
- `GET /api/v1/inventory/{inventory_version_id}`

## Family-level pricing decision engine

The core now requires explicit strategy per repeated standard apartment family. Missing family strategy is surfaced as `strategy_required`; it is never borrowed silently from another family. Named competitor-reference strategies are validated against the actual new-development evidence record and scenario output reports family-level as well as project-level impact.

See `PRICING_DECISION_METHOD.md` and `family_decision_engineering_demo.json`.

## Next milestone

Freeze the evidence research for the take-home and move back to product execution: persist market snapshots + pricing decision sessions, then build the operational price-list / scenario / review UI. Detailed named competitor evidence will be exposed in the UI from the existing evidence records rather than becoming a separate BI dashboard.

## Historical validation checkpoint

Before continuing the application shell, the project now includes walk-forward historical validation of the completed-sale comparable component. See `HISTORICAL_VALIDATION.md` and `HISTORICAL_VALIDATION_DIAGNOSTICS.md`.

Historical validation remains an internal sanity check rather than the product objective. The targeted stress check exposed real public-data limitations, but further research is frozen for the take-home unless a concrete blocker appears. `market-range-v1` remains explicitly versioned and caveated; the product focus is now the evidence → strategy → whole-price-list decision workflow.

## Tax Authority enrichment diagnostic

`TAX_ENRICHMENT_DIAGNOSTICS.md` documents the current enriched nadlan.gov / Tax Authority investigation. The enriched actor is treated as a secondary QA/segmentation source; no first-hand, future-build, floor, or other premium is inferred from it. The current production pricing method remains unchanged pending validation.
#   G a b a  
 