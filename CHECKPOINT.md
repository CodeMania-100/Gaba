# Core Engine Checkpoint — Evidence + Strategy/Scenario v1

## Scope

This checkpoint validates the pricing core against the real assignment workbook and the real market-source snapshots collected during development. It is intentionally UI/database independent.

**Important demo constraint:** the assignment supplied no project address. `עיר היין, אשקלון` is a candidate-selected demo market, not a claim that the supplied apartment mix belongs to a Gabay project there.

## Milestone 1 — Sold transaction QA

### 3-room local-area run

- raw records: 60
- primary usable: 32
- low confidence: 21
- ambiguous: 7
- rejected: 0
- possible companion records flagged: 14
- same registered unit + same day conflicts: 7

Consecutive-day companion-like records are flagged rather than silently deleted because the source does not prove they are duplicates.

### 5-room target + adjacent local-area run

Query scope: `עיר היין`, `רמות אשקלון`, `רמת כרמים`.

- raw records: 100 (actor cap for this development run)
- primary usable: 49
- low confidence: 41
- ambiguous: 10
- rejected: 0
- address missing but geographic locator available: 37
- possible companion records flagged: 24
- same registered unit + same day conflicts: 10

The source returned incomplete/inconsistent neighborhood labels (including `אזור תעשיה צפוני`) even though the records are geographically concentrated around the targeted local area. The engine therefore keeps source labels visible, uses coordinates for geographic ranking, and caps sold-lane confidence when exact target-neighborhood attribution is not verified.

Missing human-readable address is no longer an automatic rejection when coordinates or cadastral identifiers preserve geographic traceability.

### Broader Ashkelon QA control

- raw records: 377
- far price-per-sqm anomalies are conservative review flags, not automatic deletion
- the ₪15.3M / 82 m² anomaly is flagged
- coherent high-price same-location activity is preserved rather than automatically treated as invalid

## Milestone 2 — Comparable engine

Three pricing-evidence lanes remain separate:

1. completed sales
2. current asking
3. explicitly priced new-development unit offers

Key controls:

- exact room count + compatible property type are eligibility gates
- geography is explicit and traceable
- completed-sale recency is considered before structural tie-breakers after geography
- no weighted relevance score
- no project-level price is assigned to an unpriced unit type
- repeated sales at one building/location contribute as one independent location signal
- if address is missing, repeated exact geocoded coordinates are used as the location-group fallback rather than treating every transaction as an independent building

The uploaded 5-room run produces **49 primary sold candidates across 9 independent geocoded/address clusters** for a standard 5-room target.

## Milestone 3 — Market range engine

`market-range-v1` is deterministic and separates market evidence from company strategy.

It does not invent monetary premiums for:

- floor
- balcony
- orientation
- parking
- storage

Current methodology controls (recency windows and minimum evidence counts) are **versioned engineering settings**, not claimed Gabay policy. They must be visible/configurable in a production implementation rather than hidden constants.

A supported interval is created only when at least two eligible evidence lanes overlap. If lanes materially disagree, the result is `no_consensus` rather than a forced blended midpoint.

### Apartment 17 — standard 3-room checkpoint

Target:

- apartment 17
- floor 4
- 3 rooms
- 69 m² internal
- 12 m² balcony
- east

Market evidence checkpoint:

- sold lane: ₪1.295M–₪1.507M
- current asking: ₪1.200M–₪1.376M
- new-development normalized indication: ₪1.491M from one exact-neighborhood explicitly priced offer with known area; other priced offers with missing area remain reference evidence
- supported overlap: **₪1.295M–₪1.376M**
- overall confidence: **LOW** because both supporting lanes require size extrapolation to the smaller 69 m² target; balcony has no verified monetary adjustment

This is evidence only, not a Gabay list-price recommendation.

### Standard 5-room family checkpoint

Target family: 111.1 m² standard 5-room units.

Using the new local-area completed-sale run plus exact-neighborhood current asking:

- primary sold candidates: 49
- independent sold clusters: 9
- sold lane confidence: MEDIUM because query scope included the target + adjacent areas and returned labels do not verify exact neighborhood attribution
- exact-neighborhood current asking contributors: 10
- supported overlap: **₪1.479M–₪2.040M**
- overall confidence: **MEDIUM**

This range is deliberately wide. The system preserves that uncertainty instead of manufacturing precision.

## Milestone 4 — Full 39-unit evidence dry run

Workbook normalization:

- 39 apartments
- 24 standard 3-room
- 8 standard 5-room
- 3 garden apartments
- 2 duplexes
- 2 triplexes

After integrating the targeted 5-room run:

- **32 standard units:** market consensus available
- **7 special units:** manual/individual pricing path
- **0 standard units:** silently priced from citywide-only sold evidence

Special units remain unpriced automatically until separately relevant evidence or explicit company methodology exists.

## Milestone 5 — Explicit company strategy engine

Implemented separately from market evidence.

Supported strategy mechanisms:

- explicit position inside the supported market interval (`0%=lower bound`, `100%=upper bound`)
- explicit selected-competitor reference with source provenance
- explicit competitor delta in ILS
- explicit negotiation buffer in ILS
- optional explicit company floor rule
- optional explicit minimum / maximum price constraints

There are **no hidden monetary adjustments**. If a rule is not configured, it has no pricing effect.

A proposed price that strategy moves outside the market-supported interval is retained as a commercial decision but flagged for review.

Special/manual-review units are not automatically priced by the strategy engine.

## Milestone 6 — Whole-project scenario impact

Implemented project-level pricing and scenario comparison.

Impact output includes:

- number of units whose proposed price changed
- project total proposed list value before / after
- total value delta
- average price by unit family
- units outside supported market range
- manual / unpriced count
- per-unit before / after / delta
- review-state changes

Engineering validation was run with two explicitly candidate-selected range-position inputs (50% baseline vs 75% scenario). These values are **test controls only, not Gabay strategy or recommendations**.

The validation changed all 32 standard units and propagated the effect into project-level metrics while keeping the 7 special units on manual review.

## Tests

**47 targeted tests passing.**

They cover only business-critical corruption risks, including:

- unknown stays unknown
- duplicate / ambiguity handling
- address-missing but geolocated transaction handling
- same-location grouping when address is missing
- wrong property-type exclusion
- geography / recency ranking
- no invented project-unit price
- one independent contribution per sold location
- neighborhood-scope confidence handling
- evidence-lane separation and overlap
- no invented balcony/floor premium
- special-unit manual path
- explicit strategy arithmetic
- no secret floor adjustment
- explicit floor rule effect
- competitor provenance requirement
- strategy-induced out-of-range review
- scenario impact propagation

## Milestone 7 — Override / lock governance

Implemented explicit manual pricing governance:

- override price must be positive
- override reason is mandatory
- original engine recommendation is preserved in an audit entry
- manual override never changes the underlying market-supported range
- out-of-range override is retained but flagged for review
- `locked=True` means preserve the decision through a later reprice
- unlocked working edits are intentionally discarded when a new strategy reprices the project
- project total and family-average metrics are recalculated after overrides

A real-data engineering validation locked Apartment 17 at its existing baseline engine price, then applied the scenario strategy. The unlocked scenario changed 32 standard units; with Apartment 17 locked, **31** changed and Apartment 17 remained fixed. The lock test did not invent an override amount.

## Milestone 8 — Deterministic consistency control

Implemented `consistency-v1` with no invented unit hierarchy.

Checks that are always valid:

- inventory/pricing cardinality
- duplicate unit/result integrity
- supported-range integrity
- positive proposed-price integrity
- final price outside market-supported range
- explicit min/max company constraint breaches

Checks that exist only when the company supplies the rule:

- explicit floor-rule adjustment integrity
- explicit relative-unit pricing rules

The engine deliberately does **not** assume that a higher floor, orientation, balcony, parking or storage should add money unless that relationship is explicitly configured.

Real 39-unit engineering validation using the existing evidence snapshots and no invented company relationship rules:

- 32 standard units priced
- 7 special/manual units
- consistency status: **PASS**
- blockers: **0**
- review issues: **0**

The report explicitly records which checks were not applied because no company rules were supplied.

## Milestone 9 — Persistence/API contract freeze

`APPLICATION_CONTRACT.md` now freezes the application boundary:

- immutable inventory versions
- immutable completed market snapshots
- source-run status distinct from zero results
- pricing sessions bound to one inventory version + one market snapshot
- scenario branches
- override/lock audit records
- consistency report persistence
- immutable approved price-list versions
- append-only audit events
- durable background jobs
- asynchronous market refresh API
- conflict-safe writes / no silent overwrite

No microservices, Kafka or Kubernetes are introduced; the target remains a modular monolith with one API/database and background workers.

## Next

1. Build the persistence/API application shell around this frozen contract.
2. Wire the validated pricing core into project/session/scenario endpoints.
3. Build the operational UI.
4. Add background live-source refresh and Excel/PDF approval exports.

## Milestone 10 — Persistence/API shell

Started the actual application layer rather than jumping directly to UI.

Implemented with FastAPI + SQLAlchemy:

- project create/read persistence
- inventory-version persistence
- unit persistence with unknowns preserved
- normalized inventory derivation metadata retained
- source-content SHA-256 for idempotent identical imports
- unique project/version and project/source-hash constraints
- SQLite development default with `DATABASE_URL` compatibility for PostgreSQL

Implemented endpoints:

- `GET /health`
- `POST /api/v1/projects`
- `GET /api/v1/projects/{project_id}`
- `POST /api/v1/projects/{project_id}/inventory/import`
- `GET /api/v1/inventory/{inventory_version_id}`

Two API/persistence tests were added because these are high-value failure points: unknown values survive persistence, and identical imports are idempotent.

## Next

1. Persist market snapshots/source runs/jobs and implement non-blocking refresh state.
2. Persist strategy/pricing sessions/scenarios and wire the validated core.
3. Add consistency/approval state to the API.
4. Build the operational UI.
5. Add real background source refresh + Excel/PDF export.

## Milestone 11 — Historical sold-comparable validation

Paused further application/UI work to validate the real-estate pricing logic before adding more wrapper architecture.

Implemented a walk-forward historical validation harness for the **completed-sale comparable component**:

- target sale can only use sales dated strictly before the target date
- standard apartment + exact room count only
- one independent address/exact-coordinate location contribution per cluster
- no learned relevance weights
- explicit 24-month primary / 60-month evidence fallback
- optional explicit area-similarity band with recorded widening fallback
- point error, bias, interval hit rate, interval width, and room-family metrics
- strict robustness mode that excludes the target building entirely

Seven small transparent policies were compared on pre-2025 Ashkelon calibration data. The calibration candidate with the lowest median absolute percentage error was `nearest_8_area15`.

For that candidate on the 2025+ broad-Ashkelon evaluation slice:

- predictions: 104 / 104 eligible targets
- median absolute error: ₪115K
- median absolute percentage error: 7.0%
- mean absolute percentage error: 9.1%
- 90th percentile absolute percentage error: 18.1%
- interval hit rate: 80.8%
- median selected-comparable interval width: 35.8% of actual price

Strictly excluding the target building produced similar results (MdAPE 6.9%), so the broad result is not explained simply by reusing prior sales from the same building.

However, the same policy was then stress-tested **without retuning** on the targeted City Wine + adjacent 3-room/5-room data and was materially weaker:

- 33 / 33 eligible 2025+ targets predicted
- MdAPE 12.9%
- mean APE 15.0%
- interval hit 63.6%
- median interval width 46.7%
- 3-room MdAPE 12.2%
- 5-room MdAPE 15.3%

This means the pricing math is **not frozen yet**.

Failure diagnostics show substantial within-location/year price-per-sqm dispersion in some real clusters, including same geocoded 5-room locations in 2026. This suggests that location + rooms + area alone do not fully segment the observed product and that missing first-hand/resale/project-phase/unit attributes may matter. No arbitrary dispersion threshold was introduced.

Files:

- `HISTORICAL_VALIDATION.md`
- `historical_validation_report.json`
- `HISTORICAL_VALIDATION_DIAGNOSTICS.md`
- `historical_validation_diagnostics.json`
- `pricing_core/validation.py`

The 2025+ slice has now been used to assess v1. It must not be repeatedly tuned against and then described as an untouched final test. Any materially changed pricing method should either use an earlier development split and be described honestly, or be checked against a fresh external validation dataset/snapshot.

Targeted tests: **52 passing**.

## Revised next step

1. Diagnose local price dispersion before changing the production method.
2. Test only transparent segmentation/time-normalization hypotheses; do not add hidden weights.
3. Preserve explicit rule-based adjustment suggestions instead of automatic magic "rebalance".
4. Once the pricing method is defensible, resume market-snapshot/background-job persistence and UI work.

## Milestone 12 — Tax Authority enriched-source diagnostic

Added the enriched `swerve/nadlan-gov-deals` source as a **secondary diagnostic/enrichment lane only**. No production pricing rule was changed.

The capped Ashkelon run returned:

- 250 rows total
- 227 exact 5-room rows
- observed dates 2026-04-28 → 2026-08-11
- 160 / 227 exact 5-room rows with `yearBuilt`
- 97 / 227 with `buildingFloors`
- 57 / 227 with known `isFirstHand`
- 25 / 227 with `prevDeals`

Because `maxItems=250`, this is a recent citywide slice, not a complete 36-month history.

A conservative cross-source join against the targeted local GovMap 5-room file matched 11 rows using same rooms + gush + helka + area, date gap <= 1 day and amount gap <= 0.1%. The join is diagnostic and does not overwrite the GovMap base record.

Important findings:

- parcel `1197-82` contains two very different 5-room / ~124 m² price regimes within May 2026: roughly ₪11.7K–₪11.9K/m² early in the month and roughly ₪20.6K–₪21.4K/m² later in the month;
- `isFirstHand=true` appears in **both** regimes, so a simple first-hand/resale split does not explain the dispersion;
- planned/future `yearBuilt` appears in several high and low/new-build contexts and is therefore a segmentation field, not a monotonic price premium;
- parcel `1197-93` is comparatively coherent, with a large group around roughly ₪11.2K–₪11.9K/m² and several planned-completion-year 2030 records;
- 46 near-twin exact-5-room record pairs were found under a conservative <=1-day / <=0.1%-amount / same-parcel-shape diagnostic;
- 29 of 56 exact-5-room `isFirstHand=true` rows have a richer near-twin in the same capped dataset, reinforcing the need to avoid one-row-one-independent-sale assumptions;
- 7 exact-5-room rows contain `prevDeals` entries on the same date as the current transaction. This is treated as a registry-complexity signal, not as a clean repeat-sale observation.

Conclusion: keep GovMap as the geocoded base sold-evidence source and use the enriched Tax Authority actor for provenance-preserving QA/segmentation fields. Do not automatically merge near twins, transfer flags between rows, or invent first-hand/future-build/floor premiums.

Files:

- `TAX_ENRICHMENT_DIAGNOSTICS.md`
- `tax_enrichment_diagnostics.json`
- `scripts/run_tax_enrichment_diagnostics.py`

### Revised next controlled experiment

1. Build a conservative cross-source enrichment matcher that never overwrites the base GovMap record.
2. Expose only explicit diagnostic fields first: directly matched `isFirstHand`, future-completion context, same-day `prevDeals` complexity and source conflicts.
3. Test each diagnostic independently in development validation.
4. Do not modify the production comparable/range method unless validation improves for a defensible reason.
5. A materially revised method still requires a fresh final holdout before any accuracy claim.

### Conservative enrichment matcher implemented

Added `pricing_core/enrichment.py` and `scripts/run_tax_enrichment_match_demo.py`.

Rules:

- base GovMap record is never overwritten;
- direct attribute use requires exact date + amount + rooms + area + compatible floor and either the same non-null deal/asset id or the same full registered unit (`gush/helka/tatHelka`);
- same-parcel rows within one day and 0.1% amount difference are diagnostic-only near matches;
- multiple/reverse matches disable enrichment rather than choosing a winner;
- source disagreements (for example `tatHelka` or `assetId`) are preserved as explicit conflicts;
- `yearBuilt > transaction year` creates only `future_completion_context`; it never synthesizes `isFirstHand`;
- same-day entries inside `prevDeals` create only a registry-complexity flag.

On the real 100-row targeted GovMap 5-room file + the capped enriched file:

- 6 unique direct matches eligible to expose enriched QA attributes
- 4 diagnostic near matches
- 1 ambiguous near match
- 89 unmatched because the capped enriched run covers only the most recent citywide slice

No enriched attribute is currently wired into price calculation or comparable exclusion.

Current targeted tests: **58 passing**.

## Milestone 13 — Family-level Pricing Decision Engine

Refocused the core back onto the assignment's actual decision problem: **market evidence + explicit project strategy → whole-project draft price list**. Historical prediction remains an internal sanity check; it is not the product objective.

Implemented `pricing_core/decision.py` with these controls:

- strategy is explicit **per repeated apartment family**, not silently shared across unrelated families;
- a standard family with usable market evidence but no supplied company decision is returned as `strategy_required` rather than auto-priced;
- special garden/duplex/triplex units remain on the individual-review path and do not require a fake family strategy;
- every family strategy requires a recorded rationale;
- competitor-reference strategies are validated against the actual new-development evidence already visible for that unit/family;
- a manually typed competitor number cannot masquerade as evidence: the value must equal the selected observed offer price or the engine's explicitly traceable target-area indication;
- family summaries expose unit count, pricing/review counts, market-confidence distribution, the envelope of member supported ranges, family average, family list value, and selected competitor provenance where relevant;
- scenario comparison now reports **family-level impact**, not only a project total.

### Real-data engineering scenario

Using the existing 39-unit assignment workbook and the real collected Ashkelon evidence snapshot:

- 24 standard 3-room units belong to one repeated pricing family;
- 8 standard 5-room units belong to one repeated pricing family;
- 7 special units remain individual-review cases;
- two explicit family strategies are enough to create a draft price path for all 32 standard units.

A controlled scenario was added to prove a high-value Marketing workflow. The baseline uses 50% of each supported range **only as an engineering test control**. The scenario changes only the 3-room family by explicitly anchoring it to the real `אפי בעיר היין, אשקלון` 3-room offer already present in the evidence snapshot. The 5-room family is intentionally held unchanged.

Real competitor evidence used by the scenario:

- project: `אפי בעיר היין, אשקלון`
- observed 3-room offer: ₪1.772M
- observed area: 82 m²
- target standard 3-room family: 69 m²
- transparent target-area indication from the existing evidence engine: ₪1.491M
- distance from the candidate demo-neighborhood anchor: ~683 m

The target-area indication is explicitly labeled as `observed ₪/m² × target internal area`; it is not represented as a perfect linear valuation or Gabay strategy.

Scenario impact:

- 24 units changed — exactly the 3-room family;
- 8 standard 5-room prices remained unchanged;
- 7 special units remained individual-review cases;
- project draft list value changed by ₪3.732M;
- all 24 changed 3-room units moved above their current market-supported interval, which is surfaced as a review consequence rather than hidden.

This is the intended product behavior: **Marketing makes an explicit commercial positioning decision; the system immediately shows the exact project-wide consequence and whether the decision remains supported by current evidence.**

Files:

- `pricing_core/decision.py`
- `tests/test_decision.py`
- `scripts/run_family_decision_demo.py`
- `family_decision_engineering_demo.json`
- `PRICING_DECISION_METHOD.md`

Current targeted tests: **65 passing**.

## Current scope decision

The evidence-research phase is now frozen for the take-home unless a concrete application blocker appears. Transaction QA, enrichment and historical validation remain under-the-hood evidence-quality controls, not the center of the product.

The remaining product emphasis is:

1. explicit family/project strategy;
2. named market/competitor evidence behind each decision;
3. whole-price-list generation;
4. scenario impact;
5. transparent adjustment suggestions only when a company rule exists;
6. review/approval/export workflow.

No automatic "magic rebalance" will be introduced. A later adjustment feature may propose consequences only from visible company rules and must show the arithmetic before Marketing applies it.
