"use client";

import { useState } from "react";
import { PtkPriceListRow } from "@/lib/api";
import {
  computeRevenueSummary,
  computeSalesProgress,
  FAMILY_BUCKET_LABELS,
  FamilyBucket,
  MarketingStrategyState,
  PROJECT_PHASE_LABELS,
  PROJECT_PHASES,
  SELL_THROUGH_STATUS_LABELS,
  sellThroughStatus,
  StrategyAdjustment,
} from "@/lib/marketingStrategy";
import { ils, ilsCompact, num } from "@/lib/format";

interface Props {
  rows: PtkPriceListRow[];
  state: MarketingStrategyState;
  onChange: (updater: (prev: MarketingStrategyState) => MarketingStrategyState) => void;
}

const NO_SALES_DATA_MESSAGE = "לא סופקו נתוני מכירות בפועל במטלה.";

/** Marketing-strategy section as one clear business flow: מצב הפרויקט ->
 * מצב המכירות -> השפעה על המחיר. Each cause (phase, sales pace) carries its
 * own adjustment control right where it's explained, inline rather than
 * behind an accordion, so the causal link is obvious without opening help
 * text; card 3 is the resulting-impact summary (recapping the first two,
 * hosting the one adjustment with no other natural home -- the manual
 * override -- and the grand total). Same underlying state/formula as
 * before -- this is a pure layout/copy reorganization, no new calculation. */
export default function MarketingStrategyPanel({ rows, state, onChange }: Props) {
  const progress = computeSalesProgress(rows, state.soldUnitNumbers);
  const revenue = computeRevenueSummary(rows, state);
  const projectStatus = sellThroughStatus(progress.sellThroughPct, state.targetSellThroughPct);
  const salesDataSupplied = progress.unitsSold > 0;
  const totalEffectPct = revenue.marketIndicationRevenueIls > 0 ? (revenue.differenceIls / revenue.marketIndicationRevenueIls) * 100 : 0;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-300 bg-white p-5">
      <div>
        <h2 className="text-lg font-bold text-slate-900">אסטרטגיית שיווק</h2>
        <p className="text-xs text-slate-500">מצב הפרויקט ← מצב המכירות ← השפעה על המחיר.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 1. מצב הפרויקט */}
        <div className="rounded-md border border-slate-200 p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">1. מצב הפרויקט</h3>

          <div className="mb-1 text-xs font-semibold text-slate-500">שלב הפרויקט</div>
          <div className="flex flex-wrap overflow-hidden rounded-md border border-slate-300 w-fit">
            {PROJECT_PHASES.map((phase) => (
              <button
                key={phase}
                onClick={() => onChange((prev) => ({ ...prev, projectPhase: phase }))}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  state.projectPhase === phase ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {PROJECT_PHASE_LABELS[phase]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">שלב הפרויקט הוא נתון עסקי. שינוי השלב אינו משנה את המחיר אוטומטית.</p>

          <div className="mt-3 border-t border-slate-100 pt-3">
            <InlineAdjustmentEditor
              title="השפעת שלב הפרויקט על המחיר"
              value={state.phaseAdjustment}
              onChange={(next) => onChange((prev) => ({ ...prev, phaseAdjustment: next }))}
              effectIls={revenue.phaseEffectRevenueIls}
              helperText="אם החברה רוצה לתמחר אחרת בשלב זה, ניתן להגדיר כאן התאמה מפורשת."
            />
          </div>
        </div>

        {/* 2. מצב המכירות */}
        <div className="rounded-md border border-slate-200 p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">2. מצב המכירות</h3>

          {/* מה אנחנו יודעים */}
          <div className="mb-1 text-xs font-semibold text-slate-500">מה אנחנו יודעים</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="סה״כ דירות" value={String(progress.unitsTotal)} />
            {salesDataSupplied ? (
              <>
                <MiniStat label="דירות שנמכרו" value={String(progress.unitsSold)} />
                <MiniStat label="דירות שנותרו" value={String(progress.unitsRemaining)} />
                <MiniStat label="שיעור מכירה בפועל" value={`${num(progress.sellThroughPct, 0)}%`} />
              </>
            ) : (
              <div className="col-span-3 flex items-end">
                <span className="text-sm text-slate-400">{NO_SALES_DATA_MESSAGE}</span>
              </div>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs">
              <span className="text-slate-500">יעד שיעור מכירה</span>
              <input
                type="number"
                step={1}
                min={0}
                max={100}
                value={state.targetSellThroughPct}
                onChange={(e) => onChange((prev) => ({ ...prev, targetSellThroughPct: Number(e.target.value) || 0 }))}
                className="w-14 rounded-md border border-slate-300 px-1.5 py-1 text-sm"
              />
              <span className="text-slate-500">%</span>
            </label>
            {salesDataSupplied && <StatusBadge status={projectStatus} />}
          </div>

          <div className="mt-2 flex flex-col gap-1 text-xs text-slate-600">
            {salesDataSupplied ? (
              (Object.keys(progress.byFamily) as FamilyBucket[]).map((bucket) => {
                const fam = progress.byFamily[bucket];
                const famStatus = sellThroughStatus(fam.sellThroughPct, state.targetSellThroughPct);
                return (
                  <div key={bucket} className="flex flex-wrap items-center gap-2">
                    <span>
                      {FAMILY_BUCKET_LABELS[bucket]}: {fam.sold} / {fam.total} · {num(fam.sellThroughPct, 0)}%
                    </span>
                    <StatusBadge status={famStatus} small />
                  </div>
                );
              })
            ) : (
              <span className="text-slate-400">
                {FAMILY_BUCKET_LABELS["3R"]} / {FAMILY_BUCKET_LABELS["5R"]} / {FAMILY_BUCKET_LABELS.special}: {NO_SALES_DATA_MESSAGE}
              </span>
            )}
          </div>

          {/* מה השיווק מחליט */}
          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="mb-1 text-xs font-semibold text-slate-500">מה השיווק מחליט</div>
            <InlineAdjustmentEditor
              title="השפעת קצב המכירות על המחיר"
              value={state.salesProgressAdjustment}
              onChange={(next) => onChange((prev) => ({ ...prev, salesProgressAdjustment: next }))}
              effectIls={revenue.salesProgressEffectRevenueIls}
              helperText={
                salesDataSupplied
                  ? "המערכת אינה הופכת את מצב היעד (מעל/בהתאם/מתחת) להתאמת מחיר אוטומטית — האחוז מוזן ידנית."
                  : "ניתן להשתמש בהתאמה זו כאשר מוזנים נתוני מכירות בפועל."
              }
            />
          </div>
        </div>
      </div>

      {/* 3. השפעה על המחיר -- the resulting-impact summary, strongest visual block */}
      <div className="rounded-lg border-2 border-slate-900 bg-gradient-to-b from-slate-50 to-white p-4">
        <h3 className="mb-3 text-sm font-bold text-slate-900">3. השפעה על המחיר</h3>

        <div className="flex flex-col gap-2">
          <EffectRecapRow label="התאמת שלב הפרויקט" adjustment={state.phaseAdjustment} effectIls={revenue.phaseEffectRevenueIls} />
          <EffectRecapRow label="התאמת קצב המכירות" adjustment={state.salesProgressAdjustment} effectIls={revenue.salesProgressEffectRevenueIls} />
          <AdjustmentEditor
            title="התאמה ידנית"
            value={state.projectAdjustment}
            onChange={(next) => onChange((prev) => ({ ...prev, projectAdjustment: next }))}
            effectIls={revenue.manualEffectRevenueIls}
          />
        </div>

        <div className="mt-3 rounded-md bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div>
              <div className="text-xs text-slate-500">השפעה כוללת על המחיר</div>
              <span className={`text-xl font-bold ${revenue.differenceIls > 0 ? "text-emerald-700" : revenue.differenceIls < 0 ? "text-red-700" : "text-slate-900"}`}>
                {totalEffectPct >= 0 ? "+" : ""}
                {num(totalEffectPct, 1)}%
              </span>
            </div>
            <div>
              <div className="text-xs text-slate-500">השפעה כוללת</div>
              <span className={`text-xl font-bold ${revenue.differenceIls > 0 ? "text-emerald-700" : revenue.differenceIls < 0 ? "text-red-700" : "text-slate-900"}`}>
                {revenue.differenceIls >= 0 ? "+" : ""}
                {ilsCompact(revenue.differenceIls)}
              </span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
            <span>שווי לפי שוק: {ilsCompact(revenue.marketIndicationRevenueIls)}</span>
            <span>הכנסה מוצעת: {ilsCompact(revenue.proposedRevenueIls)}</span>
          </div>
        </div>

        <p className="mt-2 text-[11px] text-slate-400">כל אחוז מוזן ידנית ע״י השיווק — המערכת אינה מייצרת אחוז באופן אוטומטי.</p>
      </div>

      {/* internal project sales -- secondary, collapsed */}
      <InternalProjectSales records={state.internalProjectSales} />
    </section>
  );
}

function EffectRecapRow({ label, adjustment, effectIls }: { label: string; adjustment: StrategyAdjustment; effectIls: number }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
      <span className="text-slate-600">{label}</span>
      {adjustment.adjustment_pct !== 0 ? (
        <span className={`font-semibold tabular-nums ${effectIls >= 0 ? "text-emerald-700" : "text-red-700"}`}>
          {adjustment.adjustment_pct > 0 ? "+" : ""}
          {adjustment.adjustment_pct}% · {effectIls >= 0 ? "+" : ""}
          {ils(effectIls)}
        </span>
      ) : (
        <span className="text-slate-300">0%</span>
      )}
    </div>
  );
}

function StatusBadge({ status, small }: { status: ReturnType<typeof sellThroughStatus>; small?: boolean }) {
  const colors: Record<string, string> = {
    no_target: "bg-slate-100 text-slate-500",
    ahead: "bg-emerald-100 text-emerald-700",
    on_target: "bg-slate-100 text-slate-600",
    behind: "bg-amber-100 text-amber-700",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 font-medium ${small ? "text-[11px]" : "text-xs"} ${colors[status]}`}>
      {SELL_THROUGH_STATUS_LABELS[status]}
    </span>
  );
}

function InternalProjectSales({ records }: { records: { unit: string; sale_price_ils: number; sale_date: string; family: string }[] }) {
  return (
    <details className="rounded-md border border-slate-200 p-3 text-sm">
      <summary className="cursor-pointer text-xs font-semibold text-slate-500">עסקאות שבוצעו בפרויקט</summary>
      <div className="mt-2">
        {records.length === 0 ? (
          <p className="text-sm text-slate-400">לא סופקו עסקאות מכירה שבוצעו בפרויקט במסגרת המטלה.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1 text-sm text-slate-700">
              {records.map((r, i) => (
                <li key={i}>
                  דירה {r.unit} ({r.family}): {ils(r.sale_price_ils)} — {r.sale_date}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-slate-400">
              ראייה נפרדת מעסקאות רשומות חיצוניות (מיסוי) — אינה ממוזגת עם אינדיקציית השוק החיצונית.
            </p>
          </>
        )}
      </div>
    </details>
  );
}

/** Always-open adjustment control (no accordion) for the one adjustment that
 * conceptually belongs to this card -- phase adjustment in card 1, sales-
 * progress adjustment in card 2. Layout matches the task spec exactly:
 * effect-on-price input, rationale input, then a short always-visible
 * helper line. */
function InlineAdjustmentEditor({
  title,
  value,
  onChange,
  effectIls,
  helperText,
}: {
  title: string;
  value: StrategyAdjustment;
  onChange: (next: StrategyAdjustment) => void;
  effectIls: number;
  helperText: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-800">{title}</span>
        {value.adjustment_pct !== 0 && (
          <span className={`text-xs font-semibold tabular-nums ${effectIls >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {effectIls >= 0 ? "+" : ""}
            {ils(effectIls)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="w-28 shrink-0 text-slate-600">השפעה על המחיר</span>
          <input
            type="number"
            step={0.5}
            value={value.adjustment_pct}
            onChange={(e) => onChange({ ...value, adjustment_pct: Number(e.target.value) || 0 })}
            className="w-24 rounded-md border border-slate-300 px-2 py-1"
          />
          <span className="text-slate-500">%</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <span className="w-28 shrink-0 pt-1 text-slate-600">נימוק</span>
          <input
            type="text"
            value={value.rationale}
            onChange={(e) => onChange({ ...value, rationale: e.target.value })}
            placeholder='לדוגמה: "קצב מכירת דירות 3 חדרים גבוה מהיעד"'
            className="flex-1 rounded-md border border-slate-300 px-2 py-1"
          />
        </label>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">{helperText}</p>
    </div>
  );
}

export function AdjustmentEditor({
  title,
  value,
  onChange,
  effectIls,
}: {
  title: string;
  value: StrategyAdjustment;
  onChange: (next: StrategyAdjustment) => void;
  // Optional: when provided, shown next to the title so the ₪ effect is
  // visible without opening the editor. Omitted call sites (e.g. the per-unit
  // family/unit editors in the drawer) render exactly as before.
  effectIls?: number | null;
}) {
  const [open, setOpen] = useState(value.adjustment_pct !== 0 || value.rationale !== "");

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 text-start">
        <span className="text-sm font-medium text-slate-800">{title}</span>
        <span className="flex items-center gap-2">
          {effectIls != null && value.adjustment_pct !== 0 && (
            <span className={`text-xs font-semibold tabular-nums ${effectIls >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {value.adjustment_pct > 0 ? "+" : ""}
              {value.adjustment_pct}% · {effectIls >= 0 ? "+" : ""}
              {ils(effectIls)}
            </span>
          )}
          <span className="text-xs text-slate-400 underline">{open ? "הסתרה" : "הגדרה"}</span>
        </span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0 text-slate-600">אחוז התאמה</span>
            <input
              type="number"
              step={0.5}
              value={value.adjustment_pct}
              onChange={(e) => onChange({ ...value, adjustment_pct: Number(e.target.value) || 0 })}
              className="w-24 rounded-md border border-slate-300 px-2 py-1"
            />
            <span className="text-slate-500">%</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <span className="w-24 shrink-0 pt-1 text-slate-600">נימוק</span>
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
