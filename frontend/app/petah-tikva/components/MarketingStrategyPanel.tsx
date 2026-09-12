"use client";

import { useState } from "react";
import { PtkPriceListRow } from "@/lib/api";
import {
  computeRevenueSummary,
  computeSalesProgress,
  deriveStrategyImpactSummary,
  FAMILY_BUCKET_LABELS,
  FamilyBucket,
  MarketingStrategyState,
  PROJECT_ADJUSTMENT_LABEL,
  PROJECT_PHASE_LABELS,
  PROJECT_PHASES,
  RANGE_POSITION_LABELS,
  SELL_THROUGH_STATUS_LABELS,
  sellThroughGapPoints,
  sellThroughStatus,
  StrategyAdjustment,
  StrategyImpactUnit,
} from "@/lib/marketingStrategy";
import { ils, ilsCompact, num } from "@/lib/format";

interface Props {
  rows: PtkPriceListRow[];
  state: MarketingStrategyState;
  onChange: (updater: (prev: MarketingStrategyState) => MarketingStrategyState) => void;
  onOpenUnit?: (row: PtkPriceListRow) => void;
  onBackToPriceList?: () => void;
}

const NO_SALES_DATA_MESSAGE = "לא סופקו נתוני מכירות בפועל במטלה.";

/** Marketing-strategy section as one clear business flow: מצב הפרויקט ->
 * מצב המכירות -> השפעה על המחיר. Each cause (phase, sales pace) carries its
 * own adjustment control right where it's explained, inline rather than
 * behind an accordion, so the causal link is obvious without opening help
 * text; card 3 is the resulting-impact summary (recapping the first two,
 * hosting the one adjustment with no other natural home -- the manual
 * override -- and the grand total), followed by the baseline-vs-strategy
 * distinction: what the market alone supports vs. what the company chose.
 * Same underlying state/formula as before -- this is a pure layout/copy
 * reorganization plus one small additive comparative summary, no pricing
 * formula change. */
export default function MarketingStrategyPanel({ rows, state, onChange, onOpenUnit, onBackToPriceList }: Props) {
  const progress = computeSalesProgress(rows, state.soldUnitNumbers);
  const revenue = computeRevenueSummary(rows, state);
  const projectStatus = sellThroughStatus(state.actualSellThroughPct, state.targetSellThroughPct);
  const salesDataSupplied = progress.unitsSold > 0;
  const totalEffectPct = revenue.marketIndicationRevenueIls > 0 ? (revenue.differenceIls / revenue.marketIndicationRevenueIls) * 100 : 0;
  const impact = deriveStrategyImpactSummary(rows, state);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-hairline bg-surface p-5">
      <div>
        <h2 className="font-heading text-lg font-bold text-ink">אסטרטגיית שיווק</h2>
        <p className="text-xs text-ink-muted">מצב הפרויקט ← מצב המכירות ← השפעה על המחיר.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 1. מצב הפרויקט */}
        <div className="rounded-md border border-hairline p-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">1. מצב הפרויקט</h3>

          <div className="mb-1 text-xs font-semibold text-ink-muted">שלב הפרויקט</div>
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
          <p className="mt-1.5 text-xs text-ink-muted">שלב הפרויקט הוא נתון עסקי. שינוי השלב אינו משנה את המחיר אוטומטית.</p>

          <div className="mt-3 border-t border-hairline pt-3">
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
        <div className="rounded-md border border-hairline p-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">2. מצב המכירות</h3>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-1 text-xs">
              <span className="text-ink-muted">קצב מכירות בפועל</span>
              <input
                type="number"
                step={1}
                min={0}
                max={100}
                value={state.actualSellThroughPct}
                onChange={(e) => onChange((prev) => ({ ...prev, actualSellThroughPct: Number(e.target.value) || 0 }))}
                className="w-14 rounded-md border border-hairline px-1.5 py-1 text-sm"
              />
              <span className="text-ink-muted">%</span>
            </label>
            <label className="flex items-center gap-1 text-xs">
              <span className="text-ink-muted">יעד קצב מכירות</span>
              <input
                type="number"
                step={1}
                min={0}
                max={100}
                value={state.targetSellThroughPct}
                onChange={(e) => onChange((prev) => ({ ...prev, targetSellThroughPct: Number(e.target.value) || 0 }))}
                className="w-14 rounded-md border border-hairline px-1.5 py-1 text-sm"
              />
              <span className="text-ink-muted">%</span>
            </label>
            <StatusBadge status={projectStatus} />
            {(() => {
              const gap = sellThroughGapPoints(state.actualSellThroughPct, state.targetSellThroughPct);
              return gap != null ? (
                <span className="text-xs text-ink-muted">
                  פער מול היעד:{" "}
                  <span className={`font-semibold tabular-nums ${gap > 0 ? "text-supported" : gap < 0 ? "text-conflict" : "text-ink-muted"}`}>
                    {gap > 0 ? "+" : ""}
                    {num(gap, 1)} נקודות אחוז
                  </span>
                </span>
              ) : (
                <span className="text-xs text-ink-muted/60">הזינו יעד כדי לחשב פער</span>
              );
            })()}
          </div>
          <p className="mt-1 text-[11px] text-ink-muted/70">
            שינוי שלב הפרויקט, קצב המכירות בפועל או היעד אינו משנה את מחיר השיווק המוצע — רק שדות ההשפעה למטה משנים מחיר.
          </p>

          <div className="mt-3 border-t border-hairline pt-3">
            <div className="mb-1 text-xs font-semibold text-ink-muted">מה אנחנו יודעים מעסקאות פנימיות שנרשמו</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniStat label="סה״כ דירות" value={String(progress.unitsTotal)} />
              {salesDataSupplied ? (
                <>
                  <MiniStat label="דירות שנמכרו" value={String(progress.unitsSold)} />
                  <MiniStat label="דירות שנותרו" value={String(progress.unitsRemaining)} />
                  <MiniStat label="שיעור מכירה לפי עסקאות שנרשמו" value={`${num(progress.sellThroughPct, 0)}%`} />
                </>
              ) : (
                <div className="col-span-3 flex items-end">
                  <span className="text-sm text-ink-muted/60">{NO_SALES_DATA_MESSAGE}</span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-1 text-xs text-ink-muted">
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
              <span className="text-ink-muted/60">
                {FAMILY_BUCKET_LABELS["3R"]} / {FAMILY_BUCKET_LABELS["5R"]} / {FAMILY_BUCKET_LABELS.special}: {NO_SALES_DATA_MESSAGE}
              </span>
            )}
          </div>

          <div className="mt-3 border-t border-hairline pt-3">
            <div className="mb-1 text-xs font-semibold text-ink-muted">מה השיווק מחליט</div>
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
      <div className="rounded-lg border-2 border-ink/80 bg-gradient-to-b from-canvas to-surface p-4">
        <h3 className="font-heading mb-3 text-sm font-bold text-ink">3. השפעה על המחיר</h3>

        <div className="flex flex-col gap-2">
          <EffectRecapRow label="השפעת שלב הפרויקט על המחיר" adjustment={state.phaseAdjustment} effectIls={revenue.phaseEffectRevenueIls} />
          <EffectRecapRow label="השפעת קצב המכירות על המחיר" adjustment={state.salesProgressAdjustment} effectIls={revenue.salesProgressEffectRevenueIls} />
          <AdjustmentEditor
            title={PROJECT_ADJUSTMENT_LABEL}
            value={state.projectAdjustment}
            onChange={(next) => onChange((prev) => ({ ...prev, projectAdjustment: next }))}
            effectIls={revenue.manualEffectRevenueIls}
          />
        </div>

        <div className="mt-3 rounded-md bg-surface p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div>
              <div className="text-xs text-ink-muted">השפעה כוללת על המחיר</div>
              <span className={`text-xl font-bold ${revenue.differenceIls > 0 ? "text-supported" : revenue.differenceIls < 0 ? "text-conflict" : "text-ink"}`}>
                {totalEffectPct >= 0 ? "+" : ""}
                {num(totalEffectPct, 1)}%
              </span>
            </div>
            <div>
              <div className="text-xs text-ink-muted">השפעה כוללת</div>
              <span className={`text-xl font-bold ${revenue.differenceIls > 0 ? "text-supported" : revenue.differenceIls < 0 ? "text-conflict" : "text-ink"}`}>
                {revenue.differenceIls >= 0 ? "+" : ""}
                {ilsCompact(revenue.differenceIls)}
              </span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 border-t border-hairline pt-2 text-[11px] text-ink-muted/70">
            <span>שווי לפי שוק: {ilsCompact(revenue.marketIndicationRevenueIls)}</span>
            <span>הכנסה מוצעת: {ilsCompact(revenue.proposedRevenueIls)}</span>
          </div>
        </div>

        <p className="mt-2 text-[11px] text-ink-muted/70">כל אחוז מוזן ידנית ע״י השיווק — המערכת אינה מייצרת אחוז באופן אוטומטי.</p>
      </div>

      {/* baseline (מה השוק תומך) vs. strategy (מה החברה בחרה) */}
      <StrategyImpactSection impact={impact} onOpenUnit={onOpenUnit} />

      {onBackToPriceList && (
        <button onClick={onBackToPriceList} className="w-fit text-sm font-medium text-accent underline hover:text-accent/80">
          חזרה למחירון הפרויקט
        </button>
      )}

      <InternalProjectSales records={state.internalProjectSales} />
    </section>
  );
}

/** "השוק מספק את נקודת הבסיס. אסטרטגיית החברה משנה את ההחלטה המסחרית לאחר
 * מכן." -- a comparative fact, never a new price input: for every row with
 * a usable market_range (standard AND special alike -- see
 * lib/marketingStrategy.ts deriveStrategyImpactSummary), compares the
 * current proposed price against that range. "Affected" uses the exact same
 * totalPct !== 0 definition used everywhere else in this product. */
function StrategyImpactSection({
  impact,
  onOpenUnit,
}: {
  impact: ReturnType<typeof deriveStrategyImpactSummary>;
  onOpenUnit?: (row: PtkPriceListRow) => void;
}) {
  const groups: { key: "standard" | "special"; label: string }[] = [
    { key: "standard", label: "יחידות סטנדרטיות" },
    { key: "special", label: "יחידות מיוחדות" },
  ];

  return (
    <div className="rounded-md border border-hairline p-4">
      <h3 className="text-sm font-semibold text-ink">מה השוק תומך מול מה החברה בחרה</h3>
      <p className="mt-0.5 text-xs text-ink-muted">השוק מספק את נקודת הבסיס. אסטרטגיית החברה משנה את ההחלטה המסחרית לאחר מכן.</p>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {groups.map(({ key, label }) => {
          const group = impact[key];
          if (group.totalWithRange === 0) return null;
          return (
            <div key={key} className="rounded-md bg-canvas p-3">
              <div className="text-xs font-semibold text-ink-muted">{label}</div>
              <p className="mt-1 text-sm text-ink">
                <span className="font-semibold">{group.affectedCount}</span> מתוך {group.totalWithRange} מושפעות מהאסטרטגיה הנוכחית
              </p>
              {group.outsideRange.length === 0 ? (
                <p className="mt-1 text-xs text-supported">כל היחידות בטווח השוק הנתמך</p>
              ) : (
                <div className="mt-1.5 flex flex-col gap-1">
                  <p className="text-xs font-medium text-warning">{group.outsideRange.length} מחוץ לטווח השוק הנתמך</p>
                  <ul className="flex flex-col gap-0.5">
                    {group.outsideRange.slice(0, 6).map((u) => (
                      <OutsideRangeRow key={u.unitNumber} unit={u} onOpenUnit={onOpenUnit} />
                    ))}
                  </ul>
                  {group.outsideRange.length > 6 && (
                    <p className="text-[11px] text-ink-muted/70">ועוד {group.outsideRange.length - 6} יחידות</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OutsideRangeRow({ unit, onOpenUnit }: { unit: StrategyImpactUnit; onOpenUnit?: (row: PtkPriceListRow) => void }) {
  const color = unit.position === "above_range" ? "text-conflict" : "text-warning";
  return (
    <li className="flex items-center justify-between gap-2 text-xs">
      <span className="text-ink-muted">דירה {unit.unitNumber}</span>
      <span className={`font-medium ${color}`}>{RANGE_POSITION_LABELS[unit.position]}</span>
    </li>
  );
}

function EffectRecapRow({ label, adjustment, effectIls }: { label: string; adjustment: StrategyAdjustment; effectIls: number }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-hairline bg-surface px-3 py-2 text-sm">
      <span className="text-ink-muted">{label}</span>
      {adjustment.adjustment_pct !== 0 ? (
        <span className={`font-semibold tabular-nums ${effectIls >= 0 ? "text-supported" : "text-conflict"}`}>
          {adjustment.adjustment_pct > 0 ? "+" : ""}
          {adjustment.adjustment_pct}% · {effectIls >= 0 ? "+" : ""}
          {ils(effectIls)}
        </span>
      ) : (
        <span className="text-ink-muted/50">0%</span>
      )}
    </div>
  );
}

function StatusBadge({ status, small }: { status: ReturnType<typeof sellThroughStatus>; small?: boolean }) {
  const colors: Record<string, string> = {
    no_target: "bg-hairline/50 text-ink-muted",
    ahead: "bg-supported/15 text-supported",
    on_target: "bg-hairline/50 text-ink-muted",
    behind: "bg-warning/15 text-warning",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 font-medium ${small ? "text-[11px]" : "text-xs"} ${colors[status]}`}>
      {SELL_THROUGH_STATUS_LABELS[status]}
    </span>
  );
}

function InternalProjectSales({ records }: { records: { unit: string; sale_price_ils: number; sale_date: string; family: string }[] }) {
  return (
    <details className="rounded-md border border-hairline p-3 text-sm">
      <summary className="cursor-pointer text-xs font-semibold text-ink-muted">עסקאות שבוצעו בפרויקט</summary>
      <div className="mt-2">
        {records.length === 0 ? (
          <p className="text-sm text-ink-muted/60">לא סופקו עסקאות מכירה שבוצעו בפרויקט במסגרת המטלה.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1 text-sm text-ink">
              {records.map((r, i) => (
                <li key={i}>
                  דירה {r.unit} ({r.family}): {ils(r.sale_price_ils)} — {r.sale_date}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-ink-muted/70">
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
 * progress adjustment in card 2. */
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
        <span className="text-sm font-medium text-ink">{title}</span>
        {value.adjustment_pct !== 0 && (
          <span className={`text-xs font-semibold tabular-nums ${effectIls >= 0 ? "text-supported" : "text-conflict"}`}>
            {effectIls >= 0 ? "+" : ""}
            {ils(effectIls)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="w-28 shrink-0 text-ink-muted">השפעה על המחיר</span>
          <input
            type="number"
            step={0.5}
            value={value.adjustment_pct}
            onChange={(e) => onChange({ ...value, adjustment_pct: Number(e.target.value) || 0 })}
            className="w-24 rounded-md border border-hairline px-2 py-1"
          />
          <span className="text-ink-muted">%</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <span className="w-28 shrink-0 pt-1 text-ink-muted">נימוק</span>
          <input
            type="text"
            value={value.rationale}
            onChange={(e) => onChange({ ...value, rationale: e.target.value })}
            placeholder='לדוגמה: "קצב מכירת דירות 3 חדרים גבוה מהיעד"'
            className="flex-1 rounded-md border border-hairline px-2 py-1"
          />
        </label>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-muted/70">{helperText}</p>
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
  effectIls?: number | null;
}) {
  const [open, setOpen] = useState(value.adjustment_pct !== 0 || value.rationale !== "");

  return (
    <div className="rounded-md border border-hairline bg-surface p-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 text-start">
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="flex items-center gap-2">
          {effectIls != null && value.adjustment_pct !== 0 && (
            <span className={`text-xs font-semibold tabular-nums ${effectIls >= 0 ? "text-supported" : "text-conflict"}`}>
              {value.adjustment_pct > 0 ? "+" : ""}
              {value.adjustment_pct}% · {effectIls >= 0 ? "+" : ""}
              {ils(effectIls)}
            </span>
          )}
          <span className="text-xs text-ink-muted/70 underline">{open ? "הסתרה" : "הגדרה"}</span>
        </span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0 text-ink-muted">אחוז התאמה</span>
            <input
              type="number"
              step={0.5}
              value={value.adjustment_pct}
              onChange={(e) => onChange({ ...value, adjustment_pct: Number(e.target.value) || 0 })}
              className="w-24 rounded-md border border-hairline px-2 py-1"
            />
            <span className="text-ink-muted">%</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <span className="w-24 shrink-0 pt-1 text-ink-muted">נימוק</span>
            <input
              type="text"
              value={value.rationale}
              onChange={(e) => onChange({ ...value, rationale: e.target.value })}
              placeholder='לדוגמה: "קצב מכירת דירות 3 חדרים גבוה מהיעד"'
              className="flex-1 rounded-md border border-hairline px-2 py-1"
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
      <div className="font-bold text-ink">{value}</div>
      <div className="text-xs text-ink-muted">{label}</div>
    </div>
  );
}
