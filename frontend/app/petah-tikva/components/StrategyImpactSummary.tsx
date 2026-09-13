"use client";

import { PtkPriceListRow } from "@/lib/api";
import {
  computeRevenueSummary,
  deriveStrategyImpactSummary,
  MarketingStrategyState,
  PHASE_ADJUSTMENT_RECAP_LABEL,
  phaseAdjustmentFor,
  PROJECT_ADJUSTMENT_LABEL,
  ProductGroupDecisionRow,
  RANGE_POSITION_LABELS,
  SALES_PROGRESS_ADJUSTMENT_LABEL,
  StrategyImpactUnit,
} from "@/lib/marketingStrategy";
import { ilsCompact } from "@/lib/format";

interface Props {
  rows: PtkPriceListRow[];
  state: MarketingStrategyState;
  groups: ProductGroupDecisionRow[];
  onOpenUnit?: (row: PtkPriceListRow) => void;
  onBackToPriceList?: () => void;
}

/** Section D -- "השפעה על המחירון": summarizes only the decisions actually
 * made (never every possible control), each with its own % AND its own
 * affected-unit count (a project-wide decision and a group decision can
 * genuinely apply to different numbers of apartments, so they are never
 * collapsed into one blended percentage -- see decisions below), then one
 * explicitly-labeled aggregate ₪ figure ("השפעה מצטברת על המחירון", summed
 * across the whole price list by computeRevenueSummary -- never a single
 * apartment's own price change), then the resulting affected-unit/outside-
 * range facts already derived by deriveStrategyImpactSummary (unchanged),
 * then the one persistent reassurance line, then the return to the price
 * list -- signal -> decision -> impact -> price list, not form -> form ->
 * form. */
export default function StrategyImpactSummary({ rows, state, groups, onOpenUnit, onBackToPriceList }: Props) {
  const revenue = computeRevenueSummary(rows, state);
  const impact = deriveStrategyImpactSummary(rows, state);

  // Project-wide decisions (stage / sales-pace / general) add their own
  // percentage into literally every priced row's own totalPct -- so their
  // "affected" count is every row with a real price, never a hardcoded 39.
  // A per-group decision only ever affects that group's own inventory
  // (already derived, never hardcoded -- see ProductGroupDecisionRow).
  // These two kinds of decision are never collapsed into one blended
  // percentage here (see השפעה מצטברת below) precisely because they can
  // genuinely apply to different apartment counts.
  const pricedUnitCount = rows.filter((r) => r.proposed_list_price_ils != null).length;

  const phaseAdj = phaseAdjustmentFor(state);
  const decisions: { label: string; pct: number; count: number }[] = [
    ...(phaseAdj.adjustment_pct !== 0 ? [{ label: PHASE_ADJUSTMENT_RECAP_LABEL, pct: phaseAdj.adjustment_pct, count: pricedUnitCount }] : []),
    ...(state.salesProgressAdjustment.adjustment_pct !== 0
      ? [{ label: SALES_PROGRESS_ADJUSTMENT_LABEL, pct: state.salesProgressAdjustment.adjustment_pct, count: pricedUnitCount }]
      : []),
    ...(state.projectAdjustment.adjustment_pct !== 0
      ? [{ label: PROJECT_ADJUSTMENT_LABEL, pct: state.projectAdjustment.adjustment_pct, count: pricedUnitCount }]
      : []),
    ...groups.filter((g) => g.adjustment.adjustment_pct !== 0).map((g) => ({ label: g.label, pct: g.adjustment.adjustment_pct, count: g.inventoryCount })),
  ];

  const groupCount = [
    { key: "standard" as const, label: "יחידות סטנדרטיות" },
    { key: "special" as const, label: "יחידות מיוחדות" },
  ];

  return (
    <section className="rounded-lg border-2 border-ink/80 bg-gradient-to-b from-canvas to-surface p-4">
      <h3 className="font-heading mb-3 text-sm font-bold text-ink">ד. השפעה על המחירון</h3>

      {decisions.length === 0 ? (
        <p className="mb-3 text-sm text-ink-muted/60">טרם בוצעו התאמות מסחריות.</p>
      ) : (
        <>
          {/* Each active decision shown with its OWN percentage and its OWN
              affected-unit count -- never collapsed into a single blended
              percentage, since a project-wide decision (all priced units)
              and a group decision (that group's own inventory) can
              genuinely apply to different apartment counts. */}
          <ul className="mb-3 flex flex-col gap-1 text-sm">
            {decisions.map((d, i) => (
              <li key={i} className="flex items-center justify-between rounded-md border border-hairline bg-surface px-3 py-1.5">
                <span className="text-ink-muted">
                  {d.label} — {d.count} דירות
                </span>
                <span className={`font-semibold tabular-nums ${d.pct > 0 ? "text-supported" : "text-conflict"}`}>
                  {d.pct > 0 ? "+" : ""}
                  {d.pct}%
                </span>
              </li>
            ))}
          </ul>

          <div className="mb-3 rounded-md bg-surface p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div>
                <div className="text-xs text-ink-muted">השפעה מצטברת על המחירון</div>
                <span className={`text-xl font-bold ${revenue.differenceIls > 0 ? "text-supported" : revenue.differenceIls < 0 ? "text-conflict" : "text-ink"}`}>
                  {revenue.differenceIls >= 0 ? "+" : ""}
                  {ilsCompact(revenue.differenceIls)}
                </span>
                <p className="mt-0.5 text-[11px] text-ink-muted/70">סכום ההשפעה הכספית על כל דירות המחירון יחד — לא אחוז אחיד לכל דירה.</p>
              </div>
            </div>

            <div className="mt-2 grid gap-3 border-t border-hairline pt-2 sm:grid-cols-2">
              {groupCount.map(({ key, label }) => {
                const group = impact[key];
                if (group.totalWithRange === 0) return null;
                return (
                  <div key={key} className="text-xs text-ink-muted">
                    <span className="font-semibold text-ink">{group.affectedCount}</span> מתוך {group.totalWithRange} {label} מושפעות
                    {group.outsideRange.length > 0 && (
                      <span>
                        {" · "}
                        {group.outsideRange.length} מחוץ לטווח השוק
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {(impact.standard.outsideRange.length > 0 || impact.special.outsideRange.length > 0) && (
              <ul className="mt-2 flex flex-col gap-0.5 border-t border-hairline pt-2">
                {[...impact.standard.outsideRange, ...impact.special.outsideRange].slice(0, 6).map((u) => (
                  <OutsideRangeRow key={u.unitNumber} unit={u} row={rows.find((r) => r.unit_number === u.unitNumber)} onOpenUnit={onOpenUnit} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <p className="mb-3 text-[11px] font-medium text-ink-muted">אינדיקציות השוק לא השתנו — השינויים משקפים החלטות מסחריות של החברה.</p>

      {onBackToPriceList && (
        <button
          onClick={onBackToPriceList}
          className="w-full rounded-md bg-ink px-4 py-2.5 text-center text-sm font-medium text-surface hover:bg-ink/90"
        >
          חזרה למחירון הפרויקט
        </button>
      )}
    </section>
  );
}

function OutsideRangeRow({ unit, row, onOpenUnit }: { unit: StrategyImpactUnit; row: PtkPriceListRow | undefined; onOpenUnit?: (row: PtkPriceListRow) => void }) {
  const color = unit.position === "above_range" ? "text-conflict" : "text-warning";
  return (
    <li className="flex items-center justify-between gap-2 text-xs">
      {row && onOpenUnit ? (
        <button onClick={() => onOpenUnit(row)} className="text-ink-muted underline hover:text-accent">
          דירה {unit.unitNumber}
        </button>
      ) : (
        <span className="text-ink-muted">דירה {unit.unitNumber}</span>
      )}
      <span className={`font-medium ${color}`}>{RANGE_POSITION_LABELS[unit.position]}</span>
    </li>
  );
}
