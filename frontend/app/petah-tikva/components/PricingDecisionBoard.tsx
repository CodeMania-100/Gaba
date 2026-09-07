"use client";

import { useMemo, useState } from "react";
import { pricingRouteOf, PtkPriceListRow } from "@/lib/api";
import { CONFIDENCE_COLORS, CONFIDENCE_LABELS, roomsOf, outdoorKind, STATUS_LABELS, unitTypeLabel } from "@/lib/family";
import { ils, isPointValue, num, rangeOrPoint } from "@/lib/format";
import {
  computePriceBreakdown,
  computeRevenueSummary,
  computeSalesProgress,
  internalSaleForUnit,
  MarketingStrategyState,
  PROJECT_PHASE_LABELS,
} from "@/lib/marketingStrategy";

interface Props {
  rows: PtkPriceListRow[];
  state: MarketingStrategyState;
  onSelectUnit: (row: PtkPriceListRow) => void;
  // Non-null only while an active (non-baseline) range-position scenario is
  // selected in StrategyPanel -- purely a display note, the board never
  // computes a scenario itself.
  activeScenarioPct?: number | null;
}

type BoardFilter = "all" | "3R" | "5R" | "special" | "sold" | "available";

const FILTER_OPTIONS: { key: BoardFilter; label: string }[] = [
  { key: "all", label: "הכל" },
  { key: "3R", label: "3 חדרים" },
  { key: "5R", label: "5 חדרים" },
  { key: "special", label: "דירות מיוחדות" },
  { key: "sold", label: "נמכרו" },
  { key: "available", label: "זמינות" },
];

/** Phase 3B main business-facing board: project summary + one row per
 * physical apartment (exactly 39) + a compact per-row strategy effect. No
 * new pricing logic lives here -- every number is read from the row's
 * already-computed market indication (row.proposed_list_price_ils) and the
 * already-approved marketing-strategy layer (lib/marketingStrategy). */
export default function PricingDecisionBoard({ rows, state, onSelectUnit, activeScenarioPct }: Props) {
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [search, setSearch] = useState("");

  const progress = useMemo(() => computeSalesProgress(rows, state.soldUnitNumbers), [rows, state.soldUnitNumbers]);
  const revenue = useMemo(() => computeRevenueSummary(rows, state), [rows, state]);
  const effectPct = revenue.marketIndicationRevenueIls > 0 ? (revenue.differenceIls / revenue.marketIndicationRevenueIls) * 100 : 0;

  const filtered = rows.filter((r) => {
    const route = pricingRouteOf(r);
    const isSold = state.soldUnitNumbers.has(r.unit_number);
    if (filter === "3R" && r.family !== "3R") return false;
    if (filter === "5R" && r.family !== "5R") return false;
    if (filter === "special" && route !== "special_review") return false;
    if (filter === "sold" && !isSold) return false;
    if (filter === "available" && isSold) return false;
    if (search.trim() && !r.unit_number.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-300 bg-white p-5">
      <div>
        <h2 className="text-lg font-bold text-slate-900">
          לוח החלטת תמחור — 39 דירות בפרויקט
          {activeScenarioPct != null && <span className="ms-2 text-sm font-normal text-amber-700">(מציג תרחיש: {activeScenarioPct}%)</span>}
        </h2>
        <p className="text-xs text-slate-500">אינדיקציית שוק, מצב מכירות, והתאמה אסטרטגית — לפי יחידה פיזית אחת בכל שורה.</p>
      </div>

      {/* 1. top project summary */}
      <div className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryStat label="39 דירות בפרויקט" value={String(progress.unitsTotal)} />
        <SummaryStat label="שלב מכירות" value={PROJECT_PHASE_LABELS[state.projectPhase]} />
        <SummaryStat label="נמכרו / נותרו" value={`${progress.unitsSold} / ${progress.unitsRemaining}`} />
        <SummaryStat label="שווי לפי אינדיקציית שוק" value={ils(revenue.marketIndicationRevenueIls)} />
        <SummaryStat label="הכנסה לפי מחיר שיווק מוצע" value={ils(revenue.proposedRevenueIls)} />
        <SummaryStat
          label="השפעת האסטרטגיה"
          value={`${effectPct >= 0 ? "+" : ""}${num(effectPct, 1)}% · ${revenue.differenceIls >= 0 ? "+" : ""}${ils(revenue.differenceIls)}`}
          emphasize={revenue.differenceIls !== 0}
        />
      </div>
      {progress.unitsSold === 0 && <p className="text-xs text-slate-400">נתוני מכירות בפועל לא סופקו — כל 39 היחידות מוצגות כברירת מחדל כזמינות.</p>}

      {/* 3. filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              className={`px-3 py-1.5 text-sm font-medium transition ${
                filter === opt.key ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי מספר דירה"
          className="w-40 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <span className="text-xs text-slate-500">
          מציג {filtered.length} מתוך {rows.length} יחידות
        </span>
      </div>

      {/* 2. main table -- one row per physical apartment */}
      <div className="overflow-x-auto rounded-lg border border-slate-300">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <Th>דירה</Th>
              <Th>סוג</Th>
              <Th>חדרים</Th>
              <Th>שטח פנימי</Th>
              <Th>שטח חוץ</Th>
              <Th>קומה</Th>
              <Th>כיוון</Th>
              <Th>סטטוס</Th>
              <Th>אינדיקציית שוק</Th>
              <Th>ביטחון</Th>
              <Th>התאמה אסטרטגית</Th>
              <Th>מחיר שיווק מוצע</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <BoardRow key={row.unit_number} row={row} state={state} onSelectUnit={onSelectUnit} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BoardRow({ row, state, onSelectUnit }: { row: PtkPriceListRow; state: MarketingStrategyState; onSelectUnit: (row: PtkPriceListRow) => void }) {
  const route = pricingRouteOf(row);
  const isSold = state.soldUnitNumbers.has(row.unit_number);
  const saleRecord = internalSaleForUnit(state, row.unit_number);
  const hasIndication = row.proposed_list_price_ils != null;
  const breakdown = computePriceBreakdown(state, row);
  const rooms = roomsOf(row);

  return (
    <tr onClick={() => onSelectUnit(row)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
      <Td className="font-medium">{row.unit_number}</Td>
      <Td className="whitespace-nowrap text-slate-600">{unitTypeLabel(row.family)}</Td>
      <Td>{rooms ?? "—"}</Td>
      <Td>{num(row.internal_area_sqm)}</Td>
      <Td>
        {num(row.balcony_area_sqm)} <span className="text-[10px] text-slate-400">({outdoorKind(row.family)})</span>
      </Td>
      <Td>{row.floor ?? "—"}</Td>
      <Td>{row.orientation ?? "—"}</Td>
      <Td>
        {isSold ? (
          <span className="w-fit rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">נמכרה</span>
        ) : (
          <span className="w-fit rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
            {STATUS_LABELS[row.status] ?? row.status}
          </span>
        )}
      </Td>
      <Td className="font-semibold">
        {hasIndication ? (
          <>
            {ils(row.proposed_list_price_ils)}
            {row.market_range?.lower != null && !isPointValue(row.market_range.lower, row.market_range.upper) && (
              <div className="text-[10px] font-normal text-slate-400">{rangeOrPoint(row.market_range.lower, row.market_range.upper)}</div>
            )}
            {row.market_range?.lower != null && isPointValue(row.market_range.lower, row.market_range.upper) && route !== "standard_family" && (
              <div className="text-[10px] font-normal text-slate-400">מקור נומרי בודד</div>
            )}
          </>
        ) : (
          <span className="rounded bg-violet-100 px-2 py-1 text-xs font-medium text-violet-900">תמחור פרטני בתהליך</span>
        )}
      </Td>
      <Td>
        {row.market_range?.confidence ? (
          <span className={`rounded px-2 py-1 text-xs font-medium ${CONFIDENCE_COLORS[row.market_range.confidence] ?? "bg-slate-100 text-slate-700"}`}>
            {CONFIDENCE_LABELS[row.market_range.confidence] ?? row.market_range.confidence}
          </span>
        ) : (
          "—"
        )}
      </Td>
      <Td>
        {hasIndication && breakdown.totalPct !== 0 ? (
          <>
            <div className={breakdown.totalPct > 0 ? "font-medium text-emerald-700" : "font-medium text-red-700"}>
              {breakdown.totalPct > 0 ? "+" : ""}
              {num(breakdown.totalPct, 1)}%
            </div>
            <div className="text-[10px] text-slate-400">
              {(breakdown.proposedIls ?? 0) - (breakdown.marketIndicationIls ?? 0) >= 0 ? "+" : ""}
              {ils((breakdown.proposedIls ?? 0) - (breakdown.marketIndicationIls ?? 0))}
            </div>
          </>
        ) : (
          <span className="text-slate-400">0%</span>
        )}
      </Td>
      <Td className="font-semibold">
        {isSold && saleRecord ? (
          <>
            <div className="text-emerald-700">{ils(saleRecord.sale_price_ils)}</div>
            {hasIndication && <div className="text-[10px] font-normal text-slate-400 line-through">{ils(breakdown.proposedIls)}</div>}
          </>
        ) : (
          ils(breakdown.proposedIls)
        )}
      </Td>
    </tr>
  );
}

function SummaryStat({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div>
      <div className={`font-bold text-slate-900 ${emphasize ? "text-emerald-700" : ""}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 text-start font-medium">{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-3 py-2 ${className ?? ""}`}>{children}</td>;
}
