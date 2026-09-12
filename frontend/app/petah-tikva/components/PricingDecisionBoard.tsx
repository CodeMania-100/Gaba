"use client";

import { useState } from "react";
import { pricingRouteOf, PtkPriceListRow } from "@/lib/api";
import { CONFIDENCE_COLORS, CONFIDENCE_LABELS, roomsOf, outdoorKind, STATUS_LABELS, unitTypeLabel } from "@/lib/family";
import { ils, ilsCompact, isPointValue, num, rangeOrPoint } from "@/lib/format";
import { computePriceBreakdown, internalSaleForUnit, MarketingStrategyState } from "@/lib/marketingStrategy";

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

/** The full, filterable price list -- one row per physical apartment. No new
 * pricing logic lives here -- every number is read from the row's already-
 * computed market indication (row.proposed_list_price_ils) and the already-
 * approved marketing-strategy layer (lib/marketingStrategy). */
export default function PricingDecisionBoard({ rows, state, onSelectUnit, activeScenarioPct }: Props) {
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [search, setSearch] = useState("");

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
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-bold text-ink">
          מחירון תפעולי — {rows.length} דירות בפרויקט
          {activeScenarioPct != null && <span className="ms-2 text-sm font-normal text-warning">(מציג תרחיש: {activeScenarioPct}%)</span>}
        </h2>
        <p className="text-xs text-ink-muted">לוח מלא לצורך השוואה וסינון מדויק — לפי יחידה פיזית אחת בכל שורה.</p>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-hairline">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === opt.key ? "bg-ink text-surface" : "bg-surface text-ink-muted hover:bg-canvas"
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
          className="w-40 rounded-md border border-hairline px-2 py-1.5 text-sm"
        />
        <span className="text-xs text-ink-muted">
          מציג {filtered.length} מתוך {rows.length} יחידות
        </span>
      </div>

      {/* main table -- one row per physical apartment */}
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-hairline">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-canvas text-ink-muted">
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
      className="cursor-pointer border-t border-hairline transition-colors hover:bg-canvas active:bg-hairline/40"
    >
      <Td className="font-semibold text-ink">{row.unit_number}</Td>
      <Td className="whitespace-nowrap">
        <span
          className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
            isSpecial ? "bg-accent/15 text-accent" : "bg-supported/15 text-supported"
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
        {num(row.balcony_area_sqm)} <span className="text-[10px] text-ink-muted/70">({outdoorKind(row.family)})</span>
      </Td>
      <Td muted>{row.floor ?? "—"}</Td>
      <Td muted>{row.orientation ?? "—"}</Td>
      <Td>
        {isSold ? (
          <span className="w-fit rounded bg-supported/15 px-2 py-1 text-xs font-medium text-supported">נמכרה</span>
        ) : (
          <span className="w-fit rounded bg-canvas px-2 py-1 text-xs font-medium text-ink-muted">
            {STATUS_LABELS[row.status] ?? row.status}
          </span>
        )}
      </Td>
      <Td className="font-semibold text-ink tabular-nums">
        {hasIndication ? (
          <>
            {ilsCompact(row.proposed_list_price_ils)}
            {row.market_range?.lower != null && !isPointValue(row.market_range.lower, row.market_range.upper) && (
              <div className="text-[11px] font-normal text-ink-muted">{rangeOrPoint(row.market_range.lower, row.market_range.upper)}</div>
            )}
            {row.market_range?.lower != null && isPointValue(row.market_range.lower, row.market_range.upper) && route !== "standard_family" && (
              <div className="text-[10px] font-normal text-ink-muted/70">מקור נומרי בודד</div>
            )}
          </>
        ) : (
          <span className="rounded bg-accent/15 px-2 py-1 text-xs font-medium text-accent">תמחור פרטני בתהליך</span>
        )}
      </Td>
      <Td>
        {row.market_range?.confidence ? (
          <span className={`rounded px-2 py-1 text-xs font-medium ${CONFIDENCE_COLORS[row.market_range.confidence] ?? "bg-canvas text-ink-muted"}`}>
            {CONFIDENCE_LABELS[row.market_range.confidence] ?? row.market_range.confidence}
          </span>
        ) : (
          <span className="text-ink-muted/50">—</span>
        )}
      </Td>
      <Td className="tabular-nums">
        {hasIndication && breakdown.totalPct !== 0 ? (
          <>
            <div className={breakdown.totalPct > 0 ? "font-semibold text-supported" : "font-semibold text-conflict"}>
              {breakdown.totalPct > 0 ? "+" : ""}
              {num(breakdown.totalPct, 1)}%
            </div>
            <div className="text-[10px] text-ink-muted/70">
              {(breakdown.proposedIls ?? 0) - (breakdown.marketIndicationIls ?? 0) >= 0 ? "+" : ""}
              {ils((breakdown.proposedIls ?? 0) - (breakdown.marketIndicationIls ?? 0))}
            </div>
          </>
        ) : (
          <span className="text-ink-muted/50">0%</span>
        )}
      </Td>
      <Td className="font-semibold text-ink tabular-nums">
        {isSold && saleRecord ? (
          <>
            <div className="text-supported">{ilsCompact(saleRecord.sale_price_ils)}</div>
            {hasIndication && <div className="text-[10px] font-normal text-ink-muted/70 line-through">{ilsCompact(breakdown.proposedIls)}</div>}
          </>
        ) : (
          ilsCompact(breakdown.proposedIls)
        )}
      </Td>
    </tr>
  );
}

function Th({ children, primary, muted }: { children: React.ReactNode; primary?: boolean; muted?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2.5 text-start font-semibold ${primary ? "text-ink" : muted ? "font-normal text-ink-muted/70" : "text-ink-muted"}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className, muted }: { children: React.ReactNode; className?: string; muted?: boolean }) {
  return <td className={`whitespace-nowrap px-3 py-3 align-middle ${muted ? "text-ink-muted" : ""} ${className ?? ""}`}>{children}</td>;
}
