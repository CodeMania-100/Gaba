"use client";

import { useState } from "react";
import { PtkPriceListRow } from "@/lib/api";
import {
  clampTargetSellThroughPct,
  computeRevenueSummary,
  MarketingStrategyState,
  projectTargetSellThroughPctFor,
  PROJECT_ADJUSTMENT_LABEL,
  SALES_PROGRESS_ADJUSTMENT_LABEL,
  sellThroughGapPoints,
  sellThroughStatus,
  SELL_THROUGH_STATUS_LABELS,
} from "@/lib/marketingStrategy";
import { num } from "@/lib/format";
import { AdjustmentEditor } from "./AdjustmentEditor";
import InternalProjectSales from "./InternalProjectSales";

interface Props {
  rows: PtkPriceListRow[];
  state: MarketingStrategyState;
  onChange: (updater: (prev: MarketingStrategyState) => MarketingStrategyState) => void;
}

/** Explicit, company-wide commercial decisions that are legitimate but no
 * longer the visual center of the tab -- the project-wide sales-pace
 * adjustment and the general/manual project adjustment. Collapsed by
 * default; opening it never changes any price by itself, only the controls
 * inside do, exactly as before. Kept entirely separate from per-product-
 * group decisions (Section C) -- this section never reads or writes
 * productGroupSales. */
export default function GeneralProjectAdjustments({ rows, state, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const revenue = computeRevenueSummary(rows, state);
  // Resolved for the currently selected project phase only -- switching
  // phase loads that phase's own target, never carries another phase's
  // value across (see projectTargetSellThroughPctFor's own contract).
  const currentPhaseTarget = projectTargetSellThroughPctFor(state);
  const projectStatus = sellThroughStatus(state.actualSellThroughPct, currentPhaseTarget);
  const gap = sellThroughGapPoints(state.actualSellThroughPct, currentPhaseTarget);

  const anyActive = state.salesProgressAdjustment.adjustment_pct !== 0 || state.projectAdjustment.adjustment_pct !== 0;

  return (
    <section className="rounded-md border border-hairline bg-surface p-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 text-start">
        <span className="text-sm font-semibold text-ink">התאמות כלליות לפרויקט</span>
        <span className="flex items-center gap-2">
          {anyActive && <span className="text-xs font-medium text-accent">פעיל</span>}
          <span className="text-xs text-ink-muted/70 underline">{open ? "הסתרה" : "הצגה"}</span>
        </span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-4 border-t border-hairline pt-3">
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <label className="flex items-center gap-1">
                <span className="text-ink-muted">קצב מכירות בפועל (כלל הפרויקט)</span>
                <input
                  type="number"
                  step={1}
                  min={0}
                  max={100}
                  value={state.actualSellThroughPct}
                  onChange={(e) => onChange((prev) => ({ ...prev, actualSellThroughPct: Number(e.target.value) || 0 }))}
                  className="w-14 rounded-md border border-hairline px-1.5 py-1"
                />
                <span className="text-ink-muted">%</span>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-ink-muted">יעד מכירות מצטבר עד שלב זה</span>
                <input
                  type="number"
                  step={1}
                  min={0}
                  max={100}
                  value={currentPhaseTarget ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const value = raw.trim() === "" ? null : clampTargetSellThroughPct(Number(raw));
                    // Writes only the CURRENTLY selected phase's entry --
                    // every other phase's stored target is untouched.
                    onChange((prev) => ({
                      ...prev,
                      targetSellThroughPctByPhase: { ...prev.targetSellThroughPctByPhase, [prev.projectPhase]: value },
                    }));
                  }}
                  placeholder="—"
                  className="w-14 rounded-md border border-hairline px-1.5 py-1"
                />
                <span className="text-ink-muted">%</span>
              </label>
              {gap != null && (
                <span className="text-ink-muted">
                  פער:{" "}
                  <span className={`font-semibold tabular-nums ${gap > 0 ? "text-supported" : gap < 0 ? "text-conflict" : "text-ink-muted"}`}>
                    {gap > 0 ? "+" : ""}
                    {num(gap, 1)} נק׳
                  </span>
                </span>
              )}
              <span className="text-ink-muted">{SELL_THROUGH_STATUS_LABELS[projectStatus]}</span>
            </div>
            <AdjustmentEditor
              title={SALES_PROGRESS_ADJUSTMENT_LABEL}
              value={state.salesProgressAdjustment}
              onChange={(next) => onChange((prev) => ({ ...prev, salesProgressAdjustment: next }))}
              effectIls={revenue.salesProgressEffectRevenueIls}
            />
          </div>

          <AdjustmentEditor
            title={PROJECT_ADJUSTMENT_LABEL}
            value={state.projectAdjustment}
            onChange={(next) => onChange((prev) => ({ ...prev, projectAdjustment: next }))}
            effectIls={revenue.manualEffectRevenueIls}
          />

          <InternalProjectSales records={state.internalProjectSales} />
        </div>
      )}
    </section>
  );
}
