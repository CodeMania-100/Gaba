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
} from "@/lib/marketingStrategy";
import { ils, ilsCompact, num } from "@/lib/format";

interface Props {
  rows: PtkPriceListRow[];
  state: MarketingStrategyState;
  onChange: (updater: (prev: MarketingStrategyState) => MarketingStrategyState) => void;
}

/** Project-level marketing-strategy section: sales phase (descriptive only,
 * no automatic pricing effect), sales progress with a Marketing-entered
 * sell-through target and a purely descriptive ahead/behind indicator,
 * internal-project-sales evidence (honestly empty in this demo -- see task
 * item 3/6), three explicit adjustments (phase, sales-progress, manual), and
 * the resulting revenue summary with each adjustment's ₪ effect shown
 * separately. Family- and unit-level manual adjustments live in each unit's
 * drawer (UnitDrawer) and roll up into the same revenue summary shown here. */
export default function MarketingStrategyPanel({ rows, state, onChange }: Props) {
  const progress = computeSalesProgress(rows, state.soldUnitNumbers);
  const revenue = computeRevenueSummary(rows, state);
  const projectStatus = sellThroughStatus(progress.sellThroughPct, state.targetSellThroughPct);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-300 bg-white p-5">
      <div>
        <h2 className="text-lg font-bold text-slate-900">אסטרטגיית שיווק</h2>
        <p className="text-xs text-slate-500">
          שכבה מינימלית: מצב הפרויקט, קצב מכירות, ושלוש התאמות מפורשות שמוזנות ע״י השיווק — לא מחשבון תמחור נוסף.
        </p>
      </div>

      {/* 1. project sales phase */}
      <div>
        <div className="mb-1 text-xs font-semibold text-slate-500">שלב הפרויקט</div>
        <div className="flex overflow-hidden rounded-md border border-slate-300 w-fit">
          {PROJECT_PHASES.map((phase) => (
            <button
              key={phase}
              onClick={() => onChange((prev) => ({ ...prev, projectPhase: phase }))}
              className={`px-4 py-1.5 text-sm font-medium transition ${
                state.projectPhase === phase ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {PROJECT_PHASE_LABELS[phase]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          מידע תיאורי בלבד — הבחירה בשלב אינה מייצרת אחוז מחיר אוטומטי. אחוז ההתאמה המשויך לשלב מוזן בנפרד למטה. ברירת מחדל בהדגמה: הנחת תצורה, לא נתון אמיתי של גבאי.
        </p>
        <AdjustmentEditor
          title="התאמה אסטרטגית משויכת לשלב הפרויקט"
          value={state.phaseAdjustment}
          onChange={(next) => onChange((prev) => ({ ...prev, phaseAdjustment: next }))}
        />
      </div>

      {/* 2. sales progress */}
      <div>
        <div className="mb-1 text-xs font-semibold text-slate-500">קצב מכירות</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="סה״כ יחידות" value={String(progress.unitsTotal)} />
          <MiniStat label="נמכרו" value={progress.unitsSold > 0 ? String(progress.unitsSold) : "לא סופק"} />
          <MiniStat label="נותרו" value={String(progress.unitsRemaining)} />
          <MiniStat label="אחוז מכירה (sell-through)" value={`${num(progress.sellThroughPct, 0)}%`} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-600">יעד sell-through</span>
            <input
              type="number"
              step={1}
              min={0}
              max={100}
              value={state.targetSellThroughPct}
              onChange={(e) => onChange((prev) => ({ ...prev, targetSellThroughPct: Number(e.target.value) || 0 }))}
              className="w-20 rounded-md border border-slate-300 px-2 py-1"
            />
            <span className="text-slate-500">%</span>
          </label>
          <StatusBadge status={projectStatus} />
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          היעד מוזן ידנית ע״י השיווק (0 = לא סופק). ההשוואה מוקדם/מפגר מוצגת לצורך מידע בלבד ואינה קובעת את אחוז התאמת קצב המכירות למטה — זה מוזן בנפרד.
        </p>

        <div className="mt-3 flex flex-col gap-1.5 text-xs text-slate-600">
          {(Object.keys(progress.byFamily) as FamilyBucket[]).map((bucket) => {
            const fam = progress.byFamily[bucket];
            const famStatus = sellThroughStatus(fam.sellThroughPct, state.targetSellThroughPct);
            return (
              <div key={bucket} className="flex flex-wrap items-center gap-2">
                <span>
                  {FAMILY_BUCKET_LABELS[bucket]}: נמכרו {fam.sold} / נותרו {fam.remaining} (מתוך {fam.total}) · {num(fam.sellThroughPct, 0)}%
                </span>
                <StatusBadge status={famStatus} small />
              </div>
            );
          })}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          לא סופקו נתוני מכירות שבוצעו בפרויקט במסגרת המטלה — כל היחידות מוצגות כברירת מחדל כלא נמכרו.
        </p>

        <AdjustmentEditor
          title="התאמה אסטרטגית משויכת לקצב המכירות"
          value={state.salesProgressAdjustment}
          onChange={(next) => onChange((prev) => ({ ...prev, salesProgressAdjustment: next }))}
        />
      </div>

      {/* 3. internal project sales */}
      <InternalProjectSales records={state.internalProjectSales} />

      {/* 4. manual project-wide adjustment */}
      <AdjustmentEditor
        title="התאמה ידנית ברמת הפרויקט"
        value={state.projectAdjustment}
        onChange={(next) => onChange((prev) => ({ ...prev, projectAdjustment: next }))}
      />

      {/* revenue chain with per-component ₪ effect */}
      <div className="rounded-md bg-slate-50 p-3">
        <div className="mb-1 text-xs font-semibold text-slate-500">39 יחידות — סיכום הכנסות</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MiniStat label="הכנסה לפי אינדיקציית שוק" value={ilsCompact(revenue.marketIndicationRevenueIls)} />
          <MiniStat label="הכנסה מוצעת (לאחר כל ההתאמות)" value={ilsCompact(revenue.proposedRevenueIls)} />
          <MiniStat
            label="הפרש כולל"
            value={`${revenue.differenceIls >= 0 ? "+" : ""}${ilsCompact(revenue.differenceIls)}`}
            emphasize={revenue.differenceIls !== 0}
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 border-t border-slate-200 pt-2 sm:grid-cols-3">
          <MiniStat label="אפקט התאמת שלב (₪)" value={effectLabel(revenue.phaseEffectRevenueIls)} />
          <MiniStat label="אפקט התאמת קצב מכירות (₪)" value={effectLabel(revenue.salesProgressEffectRevenueIls)} />
          <MiniStat label="אפקט התאמה ידנית (₪)" value={effectLabel(revenue.manualEffectRevenueIls)} />
        </div>
      </div>
    </section>
  );
}

function effectLabel(v: number): string {
  if (!v) return "0";
  return `${v > 0 ? "+" : ""}${ils(v)}`;
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
    <div>
      <div className="mb-1 text-xs font-semibold text-slate-500">עסקאות שבוצעו בפרויקט</div>
      {records.length === 0 ? (
        <p className="rounded bg-slate-50 px-2 py-1.5 text-sm text-slate-500">
          לא סופקו נתוני מכירות שבוצעו בפרויקט במסגרת המטלה.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm text-slate-700">
          {records.map((r, i) => (
            <li key={i}>
              דירה {r.unit} ({r.family}): {ils(r.sale_price_ils)} — {r.sale_date}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[11px] text-slate-400">
        עסקאות שבוצעו בפרויקט הן סוג ראייה נפרד מעסקאות רשומות חיצוניות (מיסוי) — מוצגות כרפרנס לצד ההחלטה, אך אינן ממוזגות עם אינדיקציית השוק החיצונית.
      </p>
    </div>
  );
}

export function AdjustmentEditor({
  title,
  value,
  onChange,
}: {
  title: string;
  value: { adjustment_pct: number; rationale: string };
  onChange: (next: { adjustment_pct: number; rationale: string }) => void;
}) {
  const [open, setOpen] = useState(value.adjustment_pct !== 0 || value.rationale !== "");

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-start">
        <span className="text-xs font-semibold text-slate-500">{title}</span>
        <span className="text-xs text-slate-400 underline">{open ? "הסתרה" : "הגדרה"}</span>
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

function MiniStat({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div>
      <div className={`font-bold text-slate-900 ${emphasize ? "text-emerald-700" : ""}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
