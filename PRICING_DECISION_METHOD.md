# Pricing Decision Method — Assignment-Focused Version

## Product question

The system is not trying to discover one mathematically "true" apartment price.

It answers:

> Given this project's apartment mix, real completed transactions, current asking alternatives, named competing projects, and the company's explicit commercial strategy, what draft price list should Marketing review — and what changes across the project if a strategic decision changes?

## Decision chain

```text
SUPPLIED APARTMENT MIX
        ↓
APARTMENT FAMILIES
        ↓
REAL MARKET EVIDENCE
  completed sales
  current asking
  new-development competitors
        ↓
MARKET-SUPPORTED RANGE
        ↓
EXPLICIT FAMILY / PROJECT STRATEGY
        ↓
DRAFT PRICE LIST
        ↓
SCENARIO IMPACT / REVIEW
```

Market evidence and company strategy are intentionally separate.

## 1. Apartment families

Repeated standard plans are treated as pricing families. The supplied workbook currently contains two repeated standard families:

- 24 × standard 3-room / 69 m² units
- 8 × standard 5-room / 111.1 m² units

Garden apartments, duplexes and triplexes are kept on an individual-review path until separately relevant evidence or a company methodology exists.

## 2. Market evidence

The engine preserves three evidence lanes:

1. completed transactions — what buyers actually paid;
2. current asking — what alternatives are asking now;
3. explicitly priced new-development offers — what competing new projects are offering.

The lanes are not collapsed with secret weights. A market-supported interval is created only when independent evidence lanes form a defensible overlap. Limitations such as area extrapolation remain visible.

## 3. Company strategy

A standard family is **not** priced automatically merely because a market range exists.

Marketing must make an explicit decision for that family. Supported decision mechanisms currently include:

- position inside the supported market interval;
- positioning against a selected named competitor offer;
- explicit amount above/below that selected competitor;
- explicit list-price negotiation buffer;
- explicit company floor rule;
- explicit minimum/maximum commercial constraints.

There are no default monetary premiums for floor, orientation, balcony, parking or storage.

## 4. Competitor-reference integrity

If Marketing chooses a named competitor as the pricing anchor, the application cannot accept an arbitrary typed number and label it "competitor evidence".

The selected reference must point to an evidence record already present in the market snapshot. The reference value must equal either:

- the observed competitor unit offer price; or
- the transparent target-area indication generated from an explicitly priced competitor offer with known area.

The project name, source id and evidence role remain attached to the decision.

## 5. Missing strategy is visible

If market evidence exists but no company decision has been supplied for a standard family, the status is:

`strategy_required`

The engine does not silently apply another family's strategy or a global default.

This is important because a developer may intentionally position 3-room and 5-room inventory differently.

## 6. Unit pricing

Once a family strategy exists, each eligible standard unit receives a proposed list price using its own market-supported interval plus only the explicit company rules configured for that project.

If a commercial decision moves the price outside the current supported market interval, the price is retained — because the company is allowed to make that decision — but it is flagged for review.

## 7. Scenario impact

A scenario is another explicit set of family/project decisions.

The engine reports:

- which apartment families changed;
- exactly which units changed;
- price before / after per unit;
- family average before / after;
- family list-value change;
- total project draft list-value change;
- units moved outside the market-supported interval;
- review-state changes.

This is the main decision-support function: a Marketing decision becomes a visible project-wide consequence.

## 8. No magic rebalance

Changing or locking one price does not permit the engine to move unrelated apartment prices through hidden logic.

Future adjustment suggestions may only use an explicit company relationship rule. The application must show:

- the rule;
- the affected units;
- the arithmetic;
- the proposed changes;

before Marketing chooses whether to apply them.

## Real-data engineering proof

A controlled engineering scenario uses the real collected competitor evidence for `אפי בעיר היין, אשקלון`:

- observed 3-room offer: ₪1.772M;
- observed area: 82 m²;
- transparent indication for the 69 m² demo family: ₪1.491M;
- the observed competitor is approximately 683 m from the candidate City Wine demo anchor.

The **decision to use this competitor as a strategic anchor is an engineering demonstration only**, not Gabay policy. The evidence record itself is real.

Relative to the engineering baseline, this isolated 3-room decision changes 24 units and increases the draft project list value by ₪3.732M, while the 5-room family remains unchanged. The resulting 3-room prices sit above their current supported interval, so the system explicitly raises a review consequence.

That is the intended workflow: the tool does not tell Marketing that a strategy is "correct". It tells Marketing exactly what that strategy means in money, market position and affected inventory.
