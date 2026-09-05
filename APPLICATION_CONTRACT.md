# Application Contract v1 — Pricing Workspace

This contract freezes the application boundary around the validated pricing core. It is intentionally a modular monolith: one API, one database, background jobs for market refresh, and versioned immutable business records.

## Non-negotiable business rules

1. An approved price list never changes in place.
2. A completed market snapshot never changes in place.
3. A pricing session always references one inventory version and one market snapshot.
4. External source failure is different from a successful source run with zero results.
5. Market evidence and company strategy remain separate objects.
6. Manual overrides never erase the engine recommendation or supported market range.
7. No floor/orientation/balcony/parking/storage relationship is enforced unless explicitly configured.
8. Pricing can continue from the last successful snapshot while a refresh runs in the background.

## Persistent business objects

### projects
Long-lived project identity and location.

- id
- name
- city
- neighborhood
- address
- latitude / longitude
- location_source
- created_at / updated_at

### inventory_versions
Immutable after import succeeds.

- id
- project_id
- version_number
- source_filename
- imported_at
- import_status
- source_hash

### units
Belong to one inventory version.

- inventory_version_id
- unit_number
- floor
- rooms
- internal_area
- balcony_area
- orientation
- parking
- storage
- unit_type
- notes
- derivation metadata

Unique key: `(inventory_version_id, unit_number)`.

### market_snapshots
Immutable after status becomes `complete` or `partial`.

- id
- project_id
- status: queued / refreshing / complete / partial / failed
- requested_at
- completed_at
- location used for collection
- normalization_version
- quality_rules_version

### source_runs
One row per source attempt inside a snapshot.

- id
- market_snapshot_id
- source
- status: queued / running / success / partial / failed
- raw_count
- usable_count
- rejected_count
- started_at / completed_at
- error_code / safe_error_message

### evidence_records
Canonical evidence plus source provenance. Raw source payload is retained as JSON for audit/reprocessing.

- id
- market_snapshot_id
- source_run_id
- source_type
- source_record_id
- source_url
- quality_status
- quality_reasons
- canonical fields
- raw_payload JSON

### strategy_profiles
Versioned Marketing/Commercial inputs.

- id
- project_id
- name
- pricing_basis
- explicit parameters JSON
- source / note
- created_by / created_at

No field is allowed to have a hidden pricing effect.

### pricing_sessions
A decision workspace, not an approved output.

- id
- project_id
- inventory_version_id
- market_snapshot_id
- baseline_strategy_profile_id
- status: draft / under_review / superseded
- engine_version
- created_by / created_at

### scenarios
Branches from a pricing session.

- id
- pricing_session_id
- parent_scenario_id nullable
- strategy_profile_id
- name
- created_by / created_at

### unit_market_results
Frozen market-range result for each unit/scenario input snapshot.

- scenario_id
- unit_number
- supported_lower / supported_upper
- confidence
- evidence lane summaries JSON
- warnings / assumptions / decision trace JSON

### unit_price_results
Commercial result after explicit strategy.

- scenario_id
- unit_number
- engine_recommendation
- working_price
- requires_review
- adjustments JSON
- warnings JSON

### overrides
Explicit human decisions.

- id
- scenario_id
- unit_number
- override_price
- engine_price_before_override
- reason
- locked
- created_by / created_at

### consistency_reports
Persist the report used for review/approval.

- id
- scenario_id or price_list_version_id
- status
- blocker_count
- review_count
- report JSON
- created_at

### price_list_versions
Immutable when approved.

- id
- pricing_session_id
- scenario_id
- version_number
- status: draft / under_review / approved
- approved_by / approved_at
- inventory_version_id
- market_snapshot_id
- strategy_profile_id
- engine_version

Approval creates the decision record; later repricing creates a new version.

### audit_events
Append-only timeline.

- id
- project_id
- entity_type / entity_id
- event_type
- actor
- created_at
- payload JSON

### jobs
Durable background-work state.

- id
- job_type
- entity_id
- status: queued / running / succeeded / failed
- attempts
- started_at / completed_at
- safe_error_message

## Approval rules

A price list cannot be approved when:

- consistency status is `blocked`;
- the referenced inventory/snapshot/version does not exist;
- a market refresh is incorrectly represented as successful when it failed.

Review issues may be approved only as explicit human decisions; they remain visible in the approved committee record. Special/manual units are not silently converted into automatic recommendations.

## API v1

### Project + inventory

- `POST /api/v1/projects`
- `GET /api/v1/projects/{project_id}`
- `POST /api/v1/projects/{project_id}/inventory/import`
- `GET /api/v1/inventory/{inventory_version_id}`

### Market snapshots

- `POST /api/v1/projects/{project_id}/market-snapshots` → `202 Accepted` + job id
- `GET /api/v1/market-snapshots/{snapshot_id}`
- `GET /api/v1/market-snapshots/{snapshot_id}/sources`
- `GET /api/v1/jobs/{job_id}`

Refresh is asynchronous. Pricing never waits synchronously for Apify/Madlan/etc.

### Pricing

- `POST /api/v1/pricing-sessions`
- `GET /api/v1/pricing-sessions/{session_id}`
- `POST /api/v1/pricing-sessions/{session_id}/scenarios`
- `GET /api/v1/scenarios/{scenario_id}/price-list`
- `GET /api/v1/scenarios/{scenario_id}/units/{unit_number}/evidence`
- `GET /api/v1/scenarios/{scenario_id}/impact?against={baseline_scenario_id}`

### Decisions

- `POST /api/v1/scenarios/{scenario_id}/overrides`
- `DELETE /api/v1/scenarios/{scenario_id}/overrides/{unit_number}`
- `POST /api/v1/scenarios/{scenario_id}/reprice`
- `GET /api/v1/scenarios/{scenario_id}/consistency`
- `POST /api/v1/scenarios/{scenario_id}/submit-review`
- `POST /api/v1/price-lists/{price_list_id}/approve`

### Export

- `GET /api/v1/price-lists/{price_list_id}/export.xlsx`
- `GET /api/v1/price-lists/{price_list_id}/committee.pdf`

## Concurrency/version behavior

All write commands carry the current entity version. If another user changed the pricing session first, the API returns a conflict rather than overwriting their decision.

Approved versions and completed snapshots reject mutation requests.

## Demo/runtime behavior

The presentation opens an existing project using a previously completed snapshot of real source data. `Refresh Market` starts a background job and shows per-source progress. The existing price list remains usable throughout the refresh. A successful refresh offers `Create new pricing version`; it never silently rewrites the current decision.
