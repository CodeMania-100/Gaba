"use client";

import { useState } from "react";
import { PtkPriceListRow } from "@/lib/api";
import { ils } from "@/lib/format";
import {
  computePriceBreakdown,
  EMPTY_ADJUSTMENT,
  familyBucketOf,
  FAMILY_BUCKET_LABELS,
  MarketingStrategyState,
  StrategyAdjustment,
} from "@/lib/marketingStrategy";
import StepHeading from "./StepHeading";
import PricingWaterfall from "./PricingWaterfall";
import { deriveWaterfallSteps } from "@/lib/executiveVisuals";

interface Props {
  row: PtkPriceListRow;
  state: MarketingStrategyState;
  onChange: (updater: (prev: MarketingStrategyState) => MarketingStrategyState) => void;
}

/** Drawer block 4 (see UnitDrawer.tsx) -- "החלטת התמחור לדירה <unit>", built
 * around one question: how do we get from אינדיקציית שוק to מחיר שיווק
 * מוצע? A single unified רמה/התאמה/השפעה table lists every adjustment that
 * actually applies to this apartment -- the two project-wide recap rows
 * (phase, sales-progress; edited in MarketingStrategyPanel, not here) plus
 * the three editable commercial-adjustment levels (project/family/unit) --
 * so nothing from the existing strategy hierarchy is lost, just presented
 * as one readable list instead of scattered cards. The literal formula is
 * demoted to a small "פירוט חישוב" toggle; the primary result is the plain-
 * Hebrew "אינדיקציית שוק + התאמות = מחיר מוצע" line. Shared identically by
 * standard and special units -- both already expose the same
 * row.proposed_list_price_ils as their "market indication" input, so this
 * component never needs to know which pricing route produced it. Uses
 * computePriceBreakdown exactly as before -- no new adjustment layer, no
 * formula change, only display. */
export default function MarketingDecisionChain({ row, state, onChange }: Props) {
  const [showFormula, setShowFormula] = useState(false);
  const bucket = familyBucketOf(row);
  const familyAdjustment = state.familyAdjustments[bucket] ?? EMPTY_ADJUSTMENT;
  const unitAdjustment = state.unitAdjustments[row.unit_number] ?? EMPTY_ADJUSTMENT;
  const breakdown = computePriceBreakdown(state, row);
  const { marketIndicationIls, proposedIls, totalPct } = breakdown;

  // Each level's own ₪ effect is a plain re-derivation of the already-
  // computed market indication and that level's own already-stored percentage
  // -- the same linear math computePriceBreakdown already relies on (no
  // compounding, no cross-terms), never a new calculation. The three sum
  // exactly to breakdown.manualEffectIls.
  const pctEffect = (v: number) => (marketIndicationIls != null ? marketIndicationIls * (v / 100) : 0);
  const projectEffectIls = pctEffect(state.projectAdjustment.adjustment_pct);
  const familyEffectIls = pctEffect(familyAdjustment.adjustment_pct);
  const unitEffectIls = pctEffect(unitAdjustment.adjustment_pct);
  const totalEffectIls = proposedIls != null && marketIndicationIls != null ? proposedIls - marketIndicationIls : 0;

  return (
    <section className="rounded-lg border-2 border-slate-900 bg-gradient-to-b from-slate-50 to-white p-4">
      <StepHeading n={4} title={`החלטת התמחור לדירה ${row.unit_number}`} />

      <div className="mb-3">
        <div className="text-xs text-slate-500">אינדיקציית שוק</div>
        <div className="text-2xl font-bold text-slate-900">{ils(marketIndicationIls)}</div>
      </div>

      <div className="mb-3">
        <div className="mb-1 text-sm font-semibold text-slate-800">התאמות מסחריות</div>
        <p className="mb-2 text-[11px] text-slate-500">
          התאמת פרויקט חלה על כל הדירות. התאמת משפחה חלה על כל הדירות באותה משפחת תמחור. התאמת יחידה חלה רק על הדירה
          הנבחרת.
        </p>

        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-2.5 pb-1 text-[11px] text-slate-400">
          <span>רמה</span>
          <span className="text-end">התאמה</span>
          <span className="text-end">השפעה</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <RecapRow label="שלב הפרויקט" pct={breakdown.phasePct} effectIls={breakdown.phaseEffectIls} />
          <RecapRow label="קצב המכירות" pct={breakdown.salesProgressPct} effectIls={breakdown.salesProgressEffectIls} />
          <EditableAdjustmentRow
            levelLabel="התאמה מסחרית – כלל הפרויקט"
            value={state.projectAdjustment}
            onChange={(next) => onChange((prev) => ({ ...prev, projectAdjustment: next }))}
            effectIls={projectEffectIls}
          />
          <EditableAdjustmentRow
            levelLabel={`התאמה מסחרית – משפחת ${FAMILY_BUCKET_LABELS[bucket]}`}
            value={familyAdjustment}
            onChange={(next) => onChange((prev) => ({ ...prev, familyAdjustments: { ...prev.familyAdjustments, [bucket]: next } }))}
            effectIls={familyEffectIls}
          />
          <EditableAdjustmentRow
            levelLabel={`התאמה מסחרית – דירה ${row.unit_number} בלבד`}
            value={unitAdjustment}
            onChange={(next) => onChange((prev) => ({ ...prev, unitAdjustments: { ...prev.unitAdjustments, [row.unit_number]: next } }))}
            effectIls={unitEffectIls}
          />
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
        <span className="text-slate-600">השפעה כוללת</span>
        <span className={`font-semibold tabular-nums ${totalPct > 0 ? "text-emerald-700" : totalPct < 0 ? "text-red-700" : "text-slate-500"}`}>
          {totalPct !== 0
            ? `${totalPct > 0 ? "+" : ""}${totalPct}% / ${totalEffectIls >= 0 ? "+" : ""}${ils(totalEffectIls)}`
            : "0%"}
        </span>
      </div>

      <div className="rounded-md bg-white p-3 text-center shadow-sm">
        <div className="text-xs text-slate-500">מחיר שיווק מוצע</div>
        <div className="text-2xl font-bold text-slate-900">{ils(proposedIls)}</div>
        {marketIndicationIls != null && (
          <p className="mt-2 text-sm text-slate-600">
            אינדיקציית שוק {ils(marketIndicationIls)}
            <br />+ התאמות מסחריות כוללות {totalPct > 0 ? "+" : ""}
            {totalPct}%<br />= מחיר שיווק מוצע {ils(proposedIls)}
          </p>
        )}
        {marketIndicationIls != null && (
          <>
            <button onClick={() => setShowFormula((v) => !v)} className="mt-2 text-xs text-slate-400 underline hover:text-slate-600">
              {showFormula ? "הסתרת פירוט חישוב" : "איך נבנה מחיר השיווק?"}
            </button>
            {showFormula && (
              <div className="mt-3 text-start">
                <PricingWaterfall steps={deriveWaterfallSteps(state, row)} />
                <p className="mt-2 border-t border-slate-100 pt-2 text-center font-mono text-xs text-slate-500">
                  {ils(marketIndicationIls)} × (1 {totalPct >= 0 ? "+" : "−"} {Math.abs(totalPct)}%) = {ils(proposedIls)}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Read-only recap of a project-wide adjustment that is edited elsewhere
 * (phase/sales-progress adjustments live in MarketingStrategyPanel, not
 * per-unit) -- still discoverable here, quieter when 0% (see task item 10). */
function RecapRow({ label, pct, effectIls }: { label: string; pct: number; effectIls: number | null }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md px-2.5 py-2 text-sm">
      <span className={pct !== 0 ? "text-slate-700" : "text-slate-400"}>{label}</span>
      <span className={`text-end font-medium tabular-nums ${pct > 0 ? "text-emerald-700" : pct < 0 ? "text-red-700" : "text-slate-300"}`}>
        {pct !== 0 ? `${pct > 0 ? "+" : ""}${pct}%` : "0%"}
      </span>
      <span className={`text-end font-medium tabular-nums ${effectIls != null && effectIls > 0 ? "text-emerald-700" : effectIls != null && effectIls < 0 ? "text-red-700" : "text-slate-300"}`}>
        {effectIls ? `${effectIls > 0 ? "+" : ""}${ils(effectIls)}` : ils(0)}
      </span>
    </div>
  );
}

/** One editable commercial-adjustment level (project/family/unit). The row
 * itself always shows the level's current % and ₪ effect (item 8); clicking
 * it expands the % input and a rationale input visually tied to this same
 * row (item 9) -- never a floating, ambiguous rationale field. */
function EditableAdjustmentRow({
  levelLabel,
  value,
  onChange,
  effectIls,
}: {
  levelLabel: string;
  value: StrategyAdjustment;
  onChange: (next: StrategyAdjustment) => void;
  effectIls: number;
}) {
  const [open, setOpen] = useState(value.adjustment_pct !== 0 || value.rationale !== "");

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-2.5 py-2 text-start text-sm hover:bg-slate-50"
      >
        <span className="font-medium text-slate-800">{levelLabel}</span>
        <span className={`text-end font-medium tabular-nums ${value.adjustment_pct > 0 ? "text-emerald-700" : value.adjustment_pct < 0 ? "text-red-700" : "text-slate-300"}`}>
          {value.adjustment_pct !== 0 ? `${value.adjustment_pct > 0 ? "+" : ""}${value.adjustment_pct}%` : "0%"}
        </span>
        <span className={`text-end font-medium tabular-nums ${effectIls > 0 ? "text-emerald-700" : effectIls < 0 ? "text-red-700" : "text-slate-300"}`}>
          {effectIls ? `${effectIls > 0 ? "+" : ""}${ils(effectIls)}` : ils(0)}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-slate-100 px-2.5 py-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-slate-600">התאמה</span>
            <input
              type="number"
              step={0.5}
              value={value.adjustment_pct}
              onChange={(e) => onChange({ ...value, adjustment_pct: Number(e.target.value) || 0 })}
              className="w-20 rounded-md border border-slate-300 px-2 py-1"
            />
            <span className="text-slate-500">%</span>
          </label>
          <label className="flex items-start gap-2">
            <span className="w-14 shrink-0 pt-1 text-slate-600">נימוק</span>
            <input
              type="text"
              value={value.rationale}
              onChange={(e) => onChange({ ...value, rationale: e.target.value })}
              placeholder='לדוגמה: "קצב מכירת דירות 3 חדרים גבוה מהיעד"'
              className="flex-1 rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
        </div>
      )}
    </div>
  );
}
