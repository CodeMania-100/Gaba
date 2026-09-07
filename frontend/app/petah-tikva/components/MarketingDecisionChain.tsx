"use client";

import { PtkPriceListRow } from "@/lib/api";
import { ils } from "@/lib/format";
import {
  computePriceBreakdown,
  EMPTY_ADJUSTMENT,
  familyBucketFromString,
  familyBucketOf,
  FAMILY_BUCKET_LABELS,
  MarketingStrategyState,
  PROJECT_PHASE_LABELS,
} from "@/lib/marketingStrategy";
import { AdjustmentEditor } from "./MarketingStrategyPanel";

interface Props {
  row: PtkPriceListRow;
  state: MarketingStrategyState;
  onChange: (updater: (prev: MarketingStrategyState) => MarketingStrategyState) => void;
}

/** Item 5's per-apartment chain: אינדיקציית שוק -> מצב הפרויקט ומכירות
 * שבוצעו -> החלטה אסטרטגית של השיווק -> מחיר שיווק מוצע. Shared identically
 * by standard and special units -- both already expose the same
 * row.proposed_list_price_ils as their "market indication" input, so this
 * component never needs to know which pricing route produced it. */
export default function MarketingDecisionChain({ row, state, onChange }: Props) {
  const bucket = familyBucketOf(row);
  const isSold = state.soldUnitNumbers.has(row.unit_number);
  const familyAdjustment = state.familyAdjustments[bucket] ?? EMPTY_ADJUSTMENT;
  const unitAdjustment = state.unitAdjustments[row.unit_number] ?? EMPTY_ADJUSTMENT;
  const breakdown = computePriceBreakdown(state, row);
  const { marketIndicationIls: marketIndication, proposedIls: proposed, totalPct: total } = breakdown;

  const relevantSales = state.internalProjectSales.filter((s) => familyBucketFromString(s.family) === bucket);

  return (
    <section className="rounded-md border border-slate-300 p-3">
      <h3 className="mb-2 text-sm font-semibold text-slate-900">שרשרת ההחלטה השיווקית</h3>

      <div className="flex flex-col gap-2 text-sm">
        <ChainStep label="1. אינדיקציית שוק" value={ils(marketIndication)} />

        <ChainStep
          label="2. מצב הפרויקט ומכירות שבוצעו"
          value={`${PROJECT_PHASE_LABELS[state.projectPhase]} · ${isSold ? "נמכרה" : "לא נמכרה"}`}
        >
          {relevantSales.length === 0 ? (
            <p className="text-xs text-slate-400">לא סופקו נתוני מכירות שבוצעו בפרויקט במסגרת המטלה.</p>
          ) : (
            <p className="text-xs text-slate-500">
              {relevantSales.length} עסקאות דומות בפרויקט · חציון{" "}
              {ils([...relevantSales].sort((a, b) => a.sale_price_ils - b.sale_price_ils)[Math.floor(relevantSales.length / 2)].sale_price_ils)}
              {" "}(ראייה נפרדת — לא ממוזגת באינדיקציית השוק)
            </p>
          )}
        </ChainStep>

        <div>
          <div className="mb-1 text-xs font-semibold text-slate-500">3. החלטה אסטרטגית של השיווק</div>
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

        <div className="rounded-md bg-slate-50 p-2">
          <div className="text-xs text-slate-500">4. מחיר שיווק מוצע</div>
          <div className="text-xl font-bold text-slate-900">{ils(proposed)}</div>
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

function ChainStep({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-medium text-slate-800">{value}</div>
      {children}
    </div>
  );
}
