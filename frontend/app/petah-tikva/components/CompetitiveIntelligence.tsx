"use client";

import { PetahTikvaWorkspace, PtkPriceListRow } from "@/lib/api";
import {
  averageProposedMarketingPriceForFamily,
  buildFactSheet,
  CompetitorAlert,
  CompetitorFactSheet,
  CompetitorIndicators,
  computeIndicators,
  computePriceComparison,
  DEMO_COMPETITOR_HISTORY,
  DemoHistoryEvent,
  evaluatePriceGapAlert,
  evaluateSlowSalesAlert,
  PriceComparison,
} from "@/lib/competitorIntelligence";
import { ils } from "@/lib/format";
import { MarketingStrategyState } from "@/lib/marketingStrategy";
import MarketPositionSection from "./MarketPositionSection";

interface CompetitorConfig {
  displayName: string;
  // The name to look up in the underlying datasets -- NAVE PARK is stored
  // with its Hebrew suffix there (see lib/competitorIntelligence.ts).
  matchName: string;
  preferredFamily?: "3R" | "5R";
}

// Task item 2's three named competitors. Adding a fourth later means adding
// one entry here -- everything else (fact lookup, demo history, indicators,
// alerts) is driven off this list plus DEMO_COMPETITOR_HISTORY.
const SELECTED_COMPETITORS: CompetitorConfig[] = [
  { displayName: "זאב ברנדה 22", matchName: "זאב ברנדה 22", preferredFamily: "3R" },
  { displayName: "THE SPOT", matchName: "THE SPOT", preferredFamily: "3R" },
  { displayName: "NAVE PARK", matchName: "NAVE PARK נווה פארק" },
];

const DEMO_BADGE = (
  <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">תרחיש הדגמה</span>
);

/** Demo competitive-intelligence section: מצב המתחרה היום -> היסטוריית
 * מחיר/מבצעים/קצב מכירות -> אינדיקטורים מחושבים -> התראה לשיווק. Every
 * number here is either (a) read straight from data already collected
 * elsewhere in this workspace, or (b) derived from the explicitly-simulated
 * DEMO_COMPETITOR_HISTORY -- the two are never mixed without a visible
 * label, and neither ever reaches pricing_core (see lib/competitorIntelligence.ts). */
export default function CompetitiveIntelligence({
  workspace,
  rows,
  marketingStrategy,
  family,
  onFamilyChange,
}: {
  workspace: PetahTikvaWorkspace;
  rows: PtkPriceListRow[];
  marketingStrategy: MarketingStrategyState;
  family: "3R" | "5R";
  onFamilyChange: (f: "3R" | "5R") => void;
}) {
  const cards = SELECTED_COMPETITORS.map((cfg) => {
    const fact = buildFactSheet(workspace, cfg.displayName, cfg.matchName);
    const history = DEMO_COMPETITOR_HISTORY[cfg.displayName] ?? [];
    const indicators = computeIndicators(history);
    const comparison = cfg.preferredFamily
      ? computePriceComparison(
          workspace,
          fact,
          cfg.preferredFamily,
          averageProposedMarketingPriceForFamily(rows, marketingStrategy, cfg.preferredFamily)
        )
      : null;
    return { cfg, fact, history, indicators, comparison };
  });

  const alerts: CompetitorAlert[] = [];
  for (const { cfg, fact, indicators, history, comparison } of cards) {
    const slow = evaluateSlowSalesAlert(cfg.displayName, indicators, history);
    if (slow) {
      alerts.push(slow);
      continue;
    }
    if (comparison) {
      const gap = evaluatePriceGapAlert(
        cfg.displayName,
        comparison.competitorPriceIls,
        comparison.competitorIsStartingPriceOnly,
        comparison.ourMarketIndicationIls,
        comparison.ourFamilyLabel
      );
      if (gap) {
        alerts.push(gap);
        continue;
      }
    }
    // NAVE PARK: no 3R/5R comparison exists (it's a premium/special-unit
    // comparator), but its one known real price fact is still worth a
    // positioning note -- explicitly not a demo scenario, just a plain
    // restatement of an already-collected fact.
    if (fact.priceLabel && !comparison) {
      alerts.push({
        competitorDisplayName: cfg.displayName,
        title: "מיצוב מחיר בפרימיום",
        isDemoScenario: false,
        lines: [`${cfg.displayName} מציגה ${fact.priceLabel} — רלוונטי כהשוואת הקשר ליחידות הפרימיום שלנו (APT36–39).`],
      });
    }
  }

  return (
    <section className="rounded-lg border-2 border-slate-900 bg-gradient-to-b from-slate-50 to-white p-5">
      <div className="mb-1">
        <h2 className="text-lg font-bold text-slate-900">מודיעין תחרותי</h2>
        <p className="text-xs text-slate-500">מעקב אחר מחירים, קצב מכירות ומבצעים של פרויקטים מתחרים</p>
      </div>

      {alerts.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {alerts.slice(0, 3).map((a, i) => (
            <AlertCard key={i} alert={a} />
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {cards.map(({ cfg, fact, history, indicators, comparison }) => (
          <CompetitorCard key={cfg.displayName} fact={fact} history={history} indicators={indicators} comparison={comparison} />
        ))}
      </div>

      <div className="mt-5 border-t border-slate-200 pt-5">
        <MarketPositionSection
          workspace={workspace}
          projectPhase={marketingStrategy.projectPhase}
          family={family}
          onFamilyChange={onFamilyChange}
        />
      </div>
    </section>
  );
}

function AlertCard({ alert }: { alert: CompetitorAlert }) {
  return (
    <div className={`rounded-md border p-3 text-sm ${alert.isDemoScenario ? "border-amber-300 bg-amber-50" : "border-sky-300 bg-sky-50"}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-900">{alert.competitorDisplayName}</span>
        {alert.isDemoScenario && DEMO_BADGE}
      </div>
      {alert.lines.map((l, i) => (
        <p key={i} className="text-xs text-slate-700">
          {l}
        </p>
      ))}
    </div>
  );
}

function CompetitorCard({
  fact,
  history,
  indicators,
  comparison,
}: {
  fact: CompetitorFactSheet;
  history: DemoHistoryEvent[];
  indicators: CompetitorIndicators;
  comparison: PriceComparison | null;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div>
        <div className="font-semibold text-slate-900">{fact.displayName}</div>
        <div className="text-xs text-slate-500">יזם: {fact.developer ?? "לא פורסם"}</div>
      </div>

      {/* מצב המתחרה היום -- נתון שוק שנאסף */}
      <div>
        <div className="mb-1 text-[11px] font-semibold text-slate-400">נתוני שוק שנאספו</div>
        <dl className="flex flex-col gap-1 text-sm">
          <Row label="מחיר נוכחי" value={fact.priceLabel ?? "לא פורסם"} />
          <Row label="תנאי תשלום" value={fact.paymentTerms ?? "לא פורסם"} />
          <Row label="מועד מסירה" value={fact.delivery ?? "לא פורסם"} />
        </dl>
      </div>

      {/* אינדיקטורים מחושבים -- derived from the demo history */}
      {history.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
            <span>מדדים מחושבים (מבוססים על תרחיש הדגמה)</span>
            {DEMO_BADGE}
          </div>
          <dl className="flex flex-col gap-1 text-sm">
            <Row label="חודשים בשיווק" value={String(indicators.monthsOnMarket)} />
            <Row label="שיעור מכירה" value={indicators.sellThroughPct != null ? `${indicators.sellThroughPct}%` : "—"} />
            <Row label="מלאי נותר" value={indicators.remainingInventoryPct != null ? `${indicators.remainingInventoryPct}%` : "—"} />
            <Row
              label="שינוי מחיר מתחילת השיווק"
              value={indicators.priceChangePct !== 0 ? `${indicators.priceChangePct > 0 ? "+" : ""}${indicators.priceChangePct}%` : "0%"}
            />
          </dl>
        </div>
      )}

      {/* comparison to our project -- real computed gap against our *frozen*
          market indication (the evidence range, never the strategy-adjusted
          proposed price -- see lib/competitorIntelligence.ts), not simulated */}
      {comparison && (
        <div className="rounded-md bg-slate-50 p-2 text-xs">
          <div className="mb-1 font-semibold text-slate-500">מדד מחושב מנתוני שוק — השוואה לפרויקט שלנו</div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">אינדיקציית השוק שלנו — טווח נתמך קפוא ({comparison.ourFamilyLabel})</span>
            <span className="font-medium text-slate-800">
              {ils(comparison.ourMarketRangeLowerIls)}–{ils(comparison.ourMarketRangeUpperIls)}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">{comparison.competitorIsStartingPriceOnly ? "מחיר התחלתי בפרויקט המתחרה" : "מחיר בפרויקט המתחרה"}</span>
            <span className="font-medium text-slate-800">{ils(comparison.competitorPriceIls)}</span>
          </div>
          <div className="mt-1 flex justify-between gap-2 border-t border-slate-200 pt-1">
            <span className="text-slate-500">פער מול אמצע הטווח</span>
            <span className={`font-semibold ${comparison.gapIls >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {comparison.gapIls >= 0 ? "+" : ""}
              {ils(comparison.gapIls)} | {comparison.gapPct >= 0 ? "+" : ""}
              {comparison.gapPct.toFixed(1)}%
            </span>
          </div>
          {comparison.ourProposedMarketingPriceIls != null && (
            <div className="mt-1 flex justify-between gap-2 border-t border-slate-200 pt-1">
              <span className="text-slate-500">מחיר השיווק המוצע שלנו (לא אינדיקציית שוק — לאחר אסטרטגיה)</span>
              <span className="font-medium text-slate-800">{ils(comparison.ourProposedMarketingPriceIls)}</span>
            </div>
          )}
        </div>
      )}

      {/* timeline -- תרחיש הדגמה */}
      {history.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
            <span>היסטוריה</span>
            {DEMO_BADGE}
          </div>
          <ol className="flex flex-col gap-0.5 border-s-2 border-amber-200 ps-2 text-[11px] text-slate-500">
            {history.map((e, i) => (
              <li key={i}>
                חודש {e.monthNumber} — {e.description}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-end font-medium text-slate-800">{value}</dd>
    </div>
  );
}
