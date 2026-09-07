"use client";

import { PtkPriceListRow } from "@/lib/api";
import { ils } from "@/lib/format";
import {
  computePriceBreakdown,
  EMPTY_ADJUSTMENT,
  familyBucketOf,
  FAMILY_BUCKET_LABELS,
  MarketingStrategyState,
} from "@/lib/marketingStrategy";
import { AdjustmentEditor } from "./MarketingStrategyPanel";
import StepHeading from "./StepHeading";

interface Props {
  row: PtkPriceListRow;
  state: MarketingStrategyState;
  onChange: (updater: (prev: MarketingStrategyState) => MarketingStrategyState) => void;
}

/** Drawer block 4 (see UnitDrawer.tsx) -- the strongest visual element in
 * the whole drawer: אינדיקציית שוק -> התאמות -> מחיר שיווק מוצע. Project
 * phase / sell-through / internal sales are already shown once, in block 3
 * (מצב הפרויקט) -- this block only adds the three named ₪-effect
 * adjustments on top, never repeats that context. Shared identically by
 * standard and special units -- both already expose the same
 * row.proposed_list_price_ils as their "market indication" input, so this
 * component never needs to know which pricing route produced it. */
export default function MarketingDecisionChain({ row, state, onChange }: Props) {
  const bucket = familyBucketOf(row);
  const familyAdjustment = state.familyAdjustments[bucket] ?? EMPTY_ADJUSTMENT;
  const unitAdjustment = state.unitAdjustments[row.unit_number] ?? EMPTY_ADJUSTMENT;
  const breakdown = computePriceBreakdown(state, row);
  const { marketIndicationIls: marketIndication, proposedIls: proposed, totalPct: total } = breakdown;

  return (
    <section className="rounded-lg border-2 border-slate-900 bg-gradient-to-b from-slate-50 to-white p-4">
      <StepHeading n={4} title="החלטת שיווק" />
      <div className="mb-3 flex flex-wrap items-center gap-1 text-xs font-medium text-slate-500">
        <span>אינדיקציית שוק</span>
        <span className="text-slate-300">→</span>
        <span>התאמות</span>
        <span className="text-slate-300">→</span>
        <span className="font-semibold text-slate-900">מחיר שיווק מוצע</span>
      </div>

      <div className="flex flex-col gap-3 text-sm">
        <div>
          <div className="text-xs text-slate-500">אינדיקציית שוק</div>
          <div className="text-lg font-bold text-slate-900">{ils(marketIndication)}</div>
        </div>

        <div>
          <div className="mb-1 text-xs font-semibold text-slate-500">התאמות אסטרטגיות</div>
          <div className="flex flex-col gap-1.5">
            {breakdown.phasePct !== 0 && (
              <EffectLine label={`התאמת שלב פרויקט: ${signed(breakdown.phasePct)}%`} effectIls={breakdown.phaseEffectIls} />
            )}
            {breakdown.salesProgressPct !== 0 && (
              <EffectLine label={`התאמת קצב מכירות: ${signed(breakdown.salesProgressPct)}%`} effectIls={breakdown.salesProgressEffectIls} />
            )}
            {state.projectAdjustment.adjustment_pct !== 0 && (
              <p className="text-xs text-slate-500">
                התאמה ידנית — פרויקט: {signed(state.projectAdjustment.adjustment_pct)}% ({state.projectAdjustment.rationale || "ללא נימוק"})
              </p>
            )}
            <AdjustmentEditor
              title={`התאמה ידנית למשפחת ${FAMILY_BUCKET_LABELS[bucket]}`}
              value={familyAdjustment}
              onChange={(next) => onChange((prev) => ({ ...prev, familyAdjustments: { ...prev.familyAdjustments, [bucket]: next } }))}
            />
            <AdjustmentEditor
              title={`התאמה ידנית ליחידה ${row.unit_number} בלבד`}
              value={unitAdjustment}
              onChange={(next) => onChange((prev) => ({ ...prev, unitAdjustments: { ...prev.unitAdjustments, [row.unit_number]: next } }))}
            />
            {breakdown.manualPct !== 0 && <EffectLine label={`סה״כ אפקט התאמה ידנית: ${signed(breakdown.manualPct)}%`} effectIls={breakdown.manualEffectIls} />}
          </div>
        </div>

        <div className="rounded-md bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">מחיר שיווק מוצע</div>
          <div className="text-2xl font-bold text-slate-900">{ils(proposed)}</div>
          {total !== 0 && marketIndication != null && (
            <p className="mt-0.5 font-mono text-xs text-slate-500">
              {ils(marketIndication)} × (1 {total >= 0 ? "+" : "−"} {Math.abs(total)}%) = {ils(proposed)}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function signed(pct: number): string {
  return `${pct > 0 ? "+" : ""}${pct}`;
}

function EffectLine({ label, effectIls }: { label: string; effectIls: number | null }) {
  if (!effectIls) return <p className="text-xs text-slate-500">{label}</p>;
  return (
    <p className="text-xs text-slate-600">
      {label} <span className="font-medium">({effectIls > 0 ? "+" : ""}{ils(effectIls)})</span>
    </p>
  );
}
