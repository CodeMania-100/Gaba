"use client";

import { PtkPriceListRow } from "@/lib/api";
import { ilsCompact, num } from "@/lib/format";
import { computeRevenueSummary, computeSalesProgress, MarketingStrategyState, PROJECT_PHASE_LABELS } from "@/lib/marketingStrategy";

interface Props {
  rows: PtkPriceListRow[];
  state: MarketingStrategyState;
}

/** The page's headline KPI row -- project status, market value, proposed
 * revenue, and total strategy effect, answered within a few seconds (see
 * page-architecture mission). Same computeSalesProgress/computeRevenueSummary
 * used by PricingDecisionBoard and MarketingStrategyPanel -- kept in perfect
 * sync since it's the same calculation, just displayed once at the top too. */
export default function ProjectKpiSummary({ rows, state }: Props) {
  const progress = computeSalesProgress(rows, state.soldUnitNumbers);
  const revenue = computeRevenueSummary(rows, state);
  const effectPct = revenue.marketIndicationRevenueIls > 0 ? (revenue.differenceIls / revenue.marketIndicationRevenueIls) * 100 : 0;
  const salesDataSupplied = progress.unitsSold > 0;

  return (
    <section className="grid grid-cols-2 gap-3 rounded-lg border border-slate-300 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="39 דירות" value={String(progress.unitsTotal)} />
      <Stat label="שלב הפרויקט" value={PROJECT_PHASE_LABELS[state.projectPhase]} />
      <Stat
        label="נמכרו / נותרו"
        value={salesDataSupplied ? `${progress.unitsSold} / ${progress.unitsRemaining}` : "לא סופקו נתוני מכירות בפועל במטלה."}
        small={!salesDataSupplied}
      />
      <Stat label="שווי לפי שוק" value={ilsCompact(revenue.marketIndicationRevenueIls)} />
      <Stat label="הכנסה מוצעת" value={ilsCompact(revenue.proposedRevenueIls)} />
      <Stat
        label="השפעת אסטרטגיה"
        value={`${effectPct >= 0 ? "+" : ""}${num(effectPct, 1)}% · ${revenue.differenceIls >= 0 ? "+" : ""}${ilsCompact(revenue.differenceIls)}`}
        emphasize={revenue.differenceIls !== 0}
      />
    </section>
  );
}

function Stat({ label, value, emphasize, small }: { label: string; value: string; emphasize?: boolean; small?: boolean }) {
  return (
    <div>
      <div className={`font-bold text-slate-900 ${small ? "text-sm font-medium text-slate-500" : "text-lg"} ${emphasize ? "text-emerald-700" : ""}`}>
        {value}
      </div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
