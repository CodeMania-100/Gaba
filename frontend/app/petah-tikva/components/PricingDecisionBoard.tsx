"use client";

import { useMemo, useState } from "react";
import { pricingRouteOf, PtkPriceListRow } from "@/lib/api";
import { CONFIDENCE_COLORS, CONFIDENCE_LABELS, roomsOf, outdoorKind, STATUS_LABELS, unitTypeLabel } from "@/lib/family";
import { ils, ilsCompact, isPointValue, num, rangeOrPoint } from "@/lib/format";
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

/** The primary screen: a first-time viewer should read project status, the
 * 39 apartments, market price, strategy effect, and proposed price within a
 * few seconds -- everything below is either this summary or this table. No
 * new pricing logic lives here -- every number is read from the row's
 * already-computed market indication (row.proposed_list_price_ils) and the
 * already-approved marketing-strategy layer (lib/marketingStrategy). */
export default function PricingDecisionBoard({ rows, state, onSelectUnit, activeScenarioPct }: Props) {
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [search, setSearch] = useState("");

  const progress = useMemo(() => computeSalesProgress(rows, state.soldUnitNumbers), [rows, state.soldUnitNumbers]);
  const revenue = useMemo(() => computeRevenueSummary(rows, state), [rows, state]);
  const effectPct = revenue.marketIndicationRevenueIls > 0 ? (revenue.differenceIls / revenue.marketIndicationRevenueIls) * 100 : 0;
  const salesDataSupplied = progress.unitsSold > 0;

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
    <section className="flex flex-col gap-4 rounded-lg border border-slate-300 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-slate-900">
          לוח החלטת תמחור — 39 דירות בפרויקט
          {activeScenarioPct != null && <span className="ms-2 text-sm font-normal text-amber-700">(מציג תרחיש: {activeScenarioPct}%)</span>}
        </h2>
        <p className="text-xs text-slate-500">אינדיקציית שוק, מצב מכירות, והתאמה אסטרטגית — לפי יחידה פיזית אחת בכל שורה.</p>
      </div>

      {/* project status summary -- the 4 questions the first screen must answer */}
      <div className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryStat label="39 דירות" value={String(progress.unitsTotal)} />
        <SummaryStat label="שלב הפרויקט" value={PROJECT_PHASE_LABELS[state.projectPhase]} />
        <SummaryStat
          label="נמכרו / נותרו"
          value={salesDataSupplied ? `${progress.unitsSold} / ${progress.unitsRemaining}` : "לא סופקו נתוני מכירות בפועל"}
          small={!salesDataSupplied}
        />
        <SummaryStat label="שווי לפי שוק" value={ilsCompact(revenue.marketIndicationRevenueIls)} />
        <SummaryStat label="הכנסה מוצעת" value={ilsCompact(revenue.proposedRevenueIls)} />
        <SummaryStat
          label="השפעת אסטרטגיה"
          value={`${effectPct >= 0 ? "+" : ""}${num(effectPct, 1)}% · ${revenue.differenceIls >= 0 ? "+" : ""}${ilsCompact(revenue.differenceIls)}`}
          emphasize={revenue.differenceIls !== 0}
        />
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
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

      {/* main table -- one row per physical apartment */}
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-300">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600 shadow-sm">
            <tr>
              <Th primary>דירה</Th>
              <Th primary>סוג</Th>
              <Th muted>חדרים</Th>
              <Th muted>שטח פנימי</Th>
              <Th muted>שטח חוץ</Th>
              <Th muted>קומה</Th>
              <Th muted>כיוון</Th>
              <Th>סטטוס</Th>
              <Th primary>אינדיקציית שוק</Th>
              <Th>ביטחון</Th>
              <Th primary>התאמה אסטרטגית</Th>
              <Th primary>מחיר שיווק מוצע</Th>
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
  const isSpecial = route !== "standard_family";
  const isSold = state.soldUnitNumbers.has(row.unit_number);
  const saleRecord = internalSaleForUnit(state, row.unit_number);
  const hasIndication = row.proposed_list_price_ils != null;
  const breakdown = computePriceBreakdown(state, row);
  const rooms = roomsOf(row);

  return (
    <tr
      onClick={() => onSelectUnit(row)}
      title="לחצו לפרטי היחידה המלאים"
      className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50 active:bg-slate-100"
    >
      <Td className="font-semibold text-slate-900">{row.unit_number}</Td>
      <Td className="whitespace-nowrap">
        <span
          className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
            isSpecial ? "bg-violet-100 text-violet-900" : "bg-sky-100 text-sky-900"
          }`}
        >
          {unitTypeLabel(row.family)}
        </span>
      </Td>
      <Td muted>{rooms ?? "—"}</Td>
      <Td muted className="tabular-nums">
        {num(row.internal_area_sqm)}
      </Td>
      <Td muted className="tabular-nums">
        {num(row.balcony_area_sqm)} <span className="text-[10px] text-slate-400">({outdoorKind(row.family)})</span>
      </Td>
      <Td muted>{row.floor ?? "—"}</Td>
      <Td muted>{row.orientation ?? "—"}</Td>
      <Td>
        {isSold ? (
          <span className="w-fit rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">נמכרה</span>
        ) : (
          <span className="w-fit rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
            {STATUS_LABELS[row.status] ?? row.status}
          </span>
        )}
      </Td>
      <Td className="font-semibold text-slate-900 tabular-nums">
        {hasIndication ? (
          <>
            {ilsCompact(row.proposed_list_price_ils)}
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
          <span className="text-slate-300">—</span>
        )}
      </Td>
      <Td className="tabular-nums">
        {hasIndication && breakdown.totalPct !== 0 ? (
          <>
            <div className={breakdown.totalPct > 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
              {breakdown.totalPct > 0 ? "+" : ""}
              {num(breakdown.totalPct, 1)}%
            </div>
            <div className="text-[10px] text-slate-400">
              {(breakdown.proposedIls ?? 0) - (breakdown.marketIndicationIls ?? 0) >= 0 ? "+" : ""}
              {ils((breakdown.proposedIls ?? 0) - (breakdown.marketIndicationIls ?? 0))}
            </div>
          </>
        ) : (
          <span className="text-slate-300">0%</span>
        )}
      </Td>
      <Td className="font-semibold text-slate-900 tabular-nums">
        {isSold && saleRecord ? (
          <>
            <div className="text-emerald-700">{ilsCompact(saleRecord.sale_price_ils)}</div>
            {hasIndication && <div className="text-[10px] font-normal text-slate-400 line-through">{ilsCompact(breakdown.proposedIls)}</div>}
          </>
        ) : (
          ilsCompact(breakdown.proposedIls)
        )}
      </Td>
    </tr>
  );
}

function SummaryStat({ label, value, emphasize, small }: { label: string; value: string; emphasize?: boolean; small?: boolean }) {
  return (
    <div>
      <div className={`font-bold text-slate-900 ${small ? "text-sm font-medium text-slate-500" : ""} ${emphasize ? "text-emerald-700" : ""}`}>
        {value}
      </div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function Th({ children, primary, muted }: { children: React.ReactNode; primary?: boolean; muted?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2.5 text-start font-semibold ${primary ? "text-slate-900" : muted ? "font-normal text-slate-400" : "text-slate-600"}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className, muted }: { children: React.ReactNode; className?: string; muted?: boolean }) {
  return <td className={`whitespace-nowrap px-3 py-3 align-middle ${muted ? "text-slate-400" : ""} ${className ?? ""}`}>{children}</td>;
}
