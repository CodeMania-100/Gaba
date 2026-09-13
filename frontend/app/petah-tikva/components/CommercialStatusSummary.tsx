"use client";

import { useState } from "react";
import { PtkPriceListRow } from "@/lib/api";
import {
  computeRevenueSummary,
  MarketingStrategyState,
  PHASE_ADJUSTMENT_LABEL,
  PHASE_ADJUSTMENT_RECAP_LABEL,
  phaseAdjustmentFor,
  ProductGroupDecisionRow,
  PROJECT_PHASE_LABELS,
  PROJECT_PHASES,
  StrategyImpactSummary as StrategyImpactSummaryType,
} from "@/lib/marketingStrategy";
import { ils } from "@/lib/format";
import { AdjustmentEditor } from "./AdjustmentEditor";

interface Props {
  rows: PtkPriceListRow[];
  state: MarketingStrategyState;
  groups: ProductGroupDecisionRow[];
  impact: StrategyImpactSummaryType;
  onChange: (updater: (prev: MarketingStrategyState) => MarketingStrategyState) => void;
}

/** Section A -- "מצב מסחרי של הפרויקט": a compact summary of only what's
 * actually derivable from real current state, never a fake zero. Three
 * separate concepts are kept visually distinct here on purpose: שלב
 * הפרויקט (where the project commercially stands -- a plain fact),
 * ביצועי מכירות (how groups are actually selling -- surfaced in Section B/C,
 * not duplicated here), and התאמת מחיר (an explicit Marketing pricing
 * decision, shown only as its own labeled line, never implied by the stage
 * itself). The project stage stays a compact line + "ערוך" toggle -- picking
 * a stage and setting that stage's own PRICING adjustment live together
 * here, but neither dominates the screen the way the old always-open stage
 * card did. */
export default function CommercialStatusSummary({ rows, state, groups, impact, onChange }: Props) {
  const [stageOpen, setStageOpen] = useState(false);
  const revenue = computeRevenueSummary(rows, state);

  const anySalesDataEntered = groups.some((g) => g.soldUnits != null);
  const aboveTargetCount = groups.filter((g) => g.status === "above_target").length;
  const belowTargetCount = groups.filter((g) => g.status === "below_target").length;
  const unitsAboveRange =
    impact.standard.outsideRange.filter((u) => u.position === "above_range").length +
    impact.special.outsideRange.filter((u) => u.position === "above_range").length;

  const currentPhaseAdjustment = phaseAdjustmentFor(state);
  // The stage adjustment applies the same percentage to every priced row's
  // own totalPct -- so its ₪ effect (computeRevenueSummary, summed over the
  // whole price list) is a genuine portfolio-wide aggregate, never a single
  // apartment's price change. Labeled and counted explicitly as such so it
  // can never be misread as one unit's proposed-price movement.
  const pricedUnitCount = rows.filter((r) => r.proposed_list_price_ils != null).length;

  return (
    <section className="rounded-md border border-hairline bg-surface p-4">
      <h3 className="mb-2 text-sm font-semibold text-ink">א. מצב מסחרי של הפרויקט</h3>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm">
        <button onClick={() => setStageOpen((v) => !v)} className="flex items-center gap-1.5 text-ink hover:text-accent">
          <span className="text-ink-muted">שלב הפרויקט:</span>
          <span className="font-semibold">{PROJECT_PHASE_LABELS[state.projectPhase]}</span>
          <span className="text-xs text-accent underline">ערוך</span>
        </button>

        {currentPhaseAdjustment.adjustment_pct !== 0 && (
          <span className="text-ink-muted">
            {PHASE_ADJUSTMENT_RECAP_LABEL}:{" "}
            <span className={`font-semibold tabular-nums ${currentPhaseAdjustment.adjustment_pct > 0 ? "text-supported" : "text-conflict"}`}>
              {currentPhaseAdjustment.adjustment_pct > 0 ? "+" : ""}
              {currentPhaseAdjustment.adjustment_pct}%
            </span>
          </span>
        )}

        <span className="text-ink-muted">
          נתוני מכירות: <span className="font-semibold text-ink">{anySalesDataEntered ? "הוזנו" : "לא סופקו"}</span>
        </span>

        {anySalesDataEntered && (
          <>
            <span className="text-ink-muted">
              קבוצות מעל היעד: <span className="font-semibold text-supported">{aboveTargetCount}</span>
            </span>
            <span className="text-ink-muted">
              קבוצות מתחת ליעד: <span className="font-semibold text-warning">{belowTargetCount}</span>
            </span>
          </>
        )}

        <span className="text-ink-muted">
          יחידות שמחיר השיווק שלהן מעל טווח השוק: <span className="font-semibold text-conflict">{unitsAboveRange}</span>
        </span>
      </div>

      {currentPhaseAdjustment.adjustment_pct !== 0 && (
        <p className="mt-1 text-[11px] text-ink-muted/70">
          השפעה מצטברת על המחירון: {revenue.phaseEffectRevenueIls >= 0 ? "+" : ""}
          {ils(revenue.phaseEffectRevenueIls)} ({pricedUnitCount} דירות מושפעות)
        </p>
      )}

      {!anySalesDataEntered && <p className="mt-1.5 text-xs text-ink-muted/60">לא סופקו נתוני מכירות לפרויקט</p>}

      {stageOpen && (
        <div className="mt-3 flex flex-col gap-2 border-t border-hairline pt-3">
          <div className="flex flex-wrap overflow-hidden rounded-md border border-hairline w-fit">
            {PROJECT_PHASES.map((phase) => (
              <button
                key={phase}
                onClick={() => onChange((prev) => ({ ...prev, projectPhase: phase }))}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  state.projectPhase === phase ? "bg-ink text-surface" : "bg-surface text-ink-muted hover:bg-canvas"
                }`}
              >
                {PROJECT_PHASE_LABELS[phase]}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-ink-muted/70">
            שלב הפרויקט הוא נתון עסקי -- עצם בחירת השלב אינה משנה את המחיר. שינוי מחיר בשל שלב הפרויקט הוא החלטת תמחור מפורשת של השיווק, בנפרד מקצב המכירות בפועל.
          </p>
          <AdjustmentEditor
            title={PHASE_ADJUSTMENT_LABEL}
            value={currentPhaseAdjustment}
            onChange={(next) => onChange((prev) => ({ ...prev, phaseAdjustments: { ...prev.phaseAdjustments, [prev.projectPhase]: next } }))}
            effectIls={revenue.phaseEffectRevenueIls}
          />
          <p className="text-[11px] text-ink-muted/70">ההתאמה נשמרת בנפרד לכל שלב — מעבר לשלב אחר אינו מעביר אליו אחוז שהוזן בשלב קודם.</p>
        </div>
      )}
    </section>
  );
}
