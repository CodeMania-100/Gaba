"use client";

import { useState } from "react";
import { PtkPriceListRow } from "@/lib/api";
import { roomsOf, unitTypeLabel } from "@/lib/family";
import { ils, num } from "@/lib/format";
import {
  computePriceBreakdown,
  EMPTY_ADJUSTMENT,
  familyBucketOf,
  FAMILY_BUCKET_LABELS,
  GROUP_ADJUSTMENT_HELPER,
  GROUP_ADJUSTMENT_LABEL,
  MarketingStrategyState,
  PROJECT_ADJUSTMENT_HELPER,
  PROJECT_ADJUSTMENT_LABEL,
  StrategyAdjustment,
  UNIT_ADJUSTMENT_HELPER,
  UNIT_ADJUSTMENT_LABEL,
} from "@/lib/marketingStrategy";
import StepHeading from "./StepHeading";
import PricingWaterfall from "./PricingWaterfall";
import { deriveWaterfallSteps } from "@/lib/executiveVisuals";
import { buildMondayApprovalPayload, MondaySendResult, sendPricingApprovalToMonday } from "@/lib/mondayIntegration";

interface Props {
  row: PtkPriceListRow;
  state: MarketingStrategyState;
  onChange: (updater: (prev: MarketingStrategyState) => MarketingStrategyState) => void;
  // Internal confidence code ("high"/"medium"/"low"/"insufficient") for this
  // unit's market indication -- standard route: row.market_range?.confidence;
  // special route: the special-unit indication's own confidence. Passed in
  // from UnitDrawer, which already has workspace context this component
  // does not (task item 5/10 -- backend owns the Hebrew mapping, this
  // component only forwards the code).
  confidence: string | null;
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
export default function MarketingDecisionChain({ row, state, onChange, confidence }: Props) {
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

      {/* Three sources of the final price, visually separated (task item
          12): מה השוק אומר -> מה מאפיין את הדירה (recap only, see block 1
          for the full table) -> מה החברה החליטה -> מחיר מוצע. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-slate-400">
        <span>מה השוק אומר</span>
        <span>←</span>
        <span>מה מאפיין את הדירה</span>
        <span>←</span>
        <span>מה החברה החליטה</span>
        <span>←</span>
        <span className="text-slate-600">מחיר מוצע</span>
      </div>

      <div className="mb-3">
        <div className="text-xs font-semibold text-slate-500">מה השוק אומר — אינדיקציית שוק</div>
        <div className="text-2xl font-bold text-slate-900">{ils(marketIndicationIls)}</div>
        <p className="mt-0.5 text-[11px] text-slate-400">
          אינדיקציית השוק קבועה ואינה משתנה מהתאמות אסטרטגיות — רק מחיר השיווק המוצע משתנה.
        </p>
      </div>

      <div className="mb-3 rounded-md bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-500">מה מאפיין את הדירה: </span>
        {[unitTypeLabel(row.family), roomsOf(row) != null ? `${roomsOf(row)} חדרים` : null, row.internal_area_sqm != null ? `${num(row.internal_area_sqm)} מ״ר` : null, row.orientation]
          .filter(Boolean)
          .join(" · ")}
        <span className="mt-0.5 block text-[11px] text-slate-400">מוצג לצורך השוואה בלבד — פירוט מלא בסעיף 1 למעלה. מאפייני הדירה אינם משנים את המחיר אוטומטית.</span>
      </div>

      <div className="mb-3">
        <div className="mb-1 text-sm font-semibold text-slate-800">מה החברה החליטה — התאמות מסחריות</div>

        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-2.5 pb-1 text-[11px] text-slate-400">
          <span>רמה</span>
          <span className="text-end">התאמה</span>
          <span className="text-end">השפעה</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <RecapRow label="השפעת שלב הפרויקט על המחיר" pct={breakdown.phasePct} effectIls={breakdown.phaseEffectIls} />
          <RecapRow label="השפעת קצב המכירות על המחיר" pct={breakdown.salesProgressPct} effectIls={breakdown.salesProgressEffectIls} />
          <EditableAdjustmentRow
            levelLabel={PROJECT_ADJUSTMENT_LABEL}
            helperText={PROJECT_ADJUSTMENT_HELPER}
            value={state.projectAdjustment}
            onChange={(next) => onChange((prev) => ({ ...prev, projectAdjustment: next }))}
            effectIls={projectEffectIls}
          />
          <EditableAdjustmentRow
            levelLabel={GROUP_ADJUSTMENT_LABEL}
            groupName={FAMILY_BUCKET_LABELS[bucket]}
            helperText={GROUP_ADJUSTMENT_HELPER}
            value={familyAdjustment}
            onChange={(next) => onChange((prev) => ({ ...prev, familyAdjustments: { ...prev.familyAdjustments, [bucket]: next } }))}
            effectIls={familyEffectIls}
          />
          <EditableAdjustmentRow
            levelLabel={UNIT_ADJUSTMENT_LABEL}
            helperText={UNIT_ADJUSTMENT_HELPER}
            value={unitAdjustment}
            onChange={(next) => onChange((prev) => ({ ...prev, unitAdjustments: { ...prev.unitAdjustments, [row.unit_number]: next } }))}
            effectIls={unitEffectIls}
          />
        </div>
      </div>

      {/* Compact live summary (task item 6) -- shown even when every input is
          0%, so it's clear the fields are live/operational, not hidden
          because the demo starts at zero. */}
      <div className="mb-3 flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
        <span className="text-slate-600">השפעה אסטרטגית כוללת</span>
        <span className={`font-semibold tabular-nums ${totalPct > 0 ? "text-emerald-700" : totalPct < 0 ? "text-red-700" : "text-slate-500"}`}>
          {totalPct > 0 ? "+" : ""}
          {totalPct}% · {totalEffectIls >= 0 ? "+" : ""}
          {ils(totalEffectIls)}
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
        {/* Strategy waterfall only when there is something to show (task item
            22) -- a flat, all-zero waterfall is never useful. */}
        {marketIndicationIls != null && totalPct !== 0 && (
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

      {/* שלח לאישור ב-Monday -- clearly downstream of מחיר מוצע above, never
          inside the research-methodology toggle (task item 12). */}
      {marketIndicationIls != null && proposedIls != null && (
        <SendToMondayApprovalButton row={row} state={state} breakdown={breakdown} confidence={confidence} />
      )}
    </section>
  );
}

/** States: idle -> "שלח לאישור ב-Monday", sending -> "שולח ל-Monday...",
 * sent -> "נשלח ל-Monday" + link to the board, error -> "לא ניתן היה לשלוח
 * ל-Monday" + retry (task item 13). Never shows the raw backend/GraphQL
 * error text. */
function SendToMondayApprovalButton({
  row,
  state,
  breakdown,
  confidence,
}: {
  row: PtkPriceListRow;
  state: MarketingStrategyState;
  breakdown: ReturnType<typeof computePriceBreakdown>;
  confidence: string | null;
}) {
  const [result, setResult] = useState<MondaySendResult | null>(null);
  const [sending, setSending] = useState(false);

  const send = async () => {
    const payload = buildMondayApprovalPayload(row, state, breakdown, confidence);
    if (!payload) return;
    setSending(true);
    setResult(null);
    const outcome = await sendPricingApprovalToMonday(payload);
    setSending(false);
    setResult(outcome);
  };

  return (
    <div className="mt-3 flex flex-col items-center gap-1.5 border-t border-slate-100 pt-3">
      <button
        onClick={send}
        disabled={sending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {sending ? "שולח ל-Monday..." : result?.ok ? "נשלח ל-Monday" : "שלח לאישור ב-Monday"}
      </button>
      {result?.ok && (
        <a href={result.boardUrl} target="_blank" rel="noreferrer" className="text-xs text-slate-500 underline hover:text-slate-800">
          פתח את לוח האישור
        </a>
      )}
      {result && !result.ok && (
        <div className="flex items-center gap-2 text-xs text-red-700">
          <span>{result.reason === "not_configured" ? "החיבור ל-Monday אינו מוגדר" : "לא ניתן היה לשלוח ל-Monday"}</span>
          {result.reason === "failed" && (
            <button onClick={send} className="underline hover:text-red-900">
              נסה שוב
            </button>
          )}
        </div>
      )}
    </div>
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
  groupName,
  helperText,
  value,
  onChange,
  effectIls,
}: {
  levelLabel: string;
  // Second line under the label naming the actual group (task item 3: "For
  // a 3R apartment: התאמה לקבוצת הדירות / 3 חדרים") -- omitted for the
  // project/unit levels, which have no group name to show.
  groupName?: string;
  // Explains scope in plain language (task item 4) -- always visible, not
  // hidden behind the expand toggle.
  helperText?: string;
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
        <span>
          <span className="block font-medium text-slate-800">{levelLabel}</span>
          {groupName && <span className="block text-[11px] text-slate-500">{groupName}</span>}
        </span>
        <span className={`text-end font-medium tabular-nums ${value.adjustment_pct > 0 ? "text-emerald-700" : value.adjustment_pct < 0 ? "text-red-700" : "text-slate-300"}`}>
          {value.adjustment_pct !== 0 ? `${value.adjustment_pct > 0 ? "+" : ""}${value.adjustment_pct}%` : "0%"}
        </span>
        <span className={`text-end font-medium tabular-nums ${effectIls > 0 ? "text-emerald-700" : effectIls < 0 ? "text-red-700" : "text-slate-300"}`}>
          {effectIls ? `${effectIls > 0 ? "+" : ""}${ils(effectIls)}` : ils(0)}
        </span>
      </button>
      {helperText && <p className="px-2.5 pb-1.5 text-[11px] text-slate-400">{helperText}</p>}
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
              placeholder='לדוגמה: "כיוון מערב ושטח חוץ גדול יותר"'
              className="flex-1 rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
        </div>
      )}
    </div>
  );
}
