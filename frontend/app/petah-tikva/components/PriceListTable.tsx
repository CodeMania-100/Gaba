"use client";

import { useMemo, useState } from "react";
import { pricingRouteOf, PtkPriceListRow } from "@/lib/api";
import { CONFIDENCE_COLORS, CONFIDENCE_LABELS, displayFamilyLabel, STATUS_LABELS } from "@/lib/family";
import { ils, isPointValue, num, rangeOrPoint } from "@/lib/format";

interface Props {
  rows: PtkPriceListRow[];
  onSelectUnit: (row: PtkPriceListRow) => void;
}

type FamilyFilter = "all" | "3R" | "5R" | "special";

export default function PriceListTable({ rows, onSelectUnit }: Props) {
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>("all");
  const [floorFilter, setFloorFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const floors = useMemo(
    () => Array.from(new Set(rows.map((r) => String(r.floor ?? "—")))).sort(),
    [rows]
  );
  const statuses = useMemo(() => Array.from(new Set(rows.map((r) => r.status))), [rows]);

  const filtered = rows.filter((r) => {
    const route = pricingRouteOf(r);
    if (familyFilter === "3R" && r.family !== "3R") return false;
    if (familyFilter === "5R" && r.family !== "5R") return false;
    if (familyFilter === "special" && route !== "special_review") return false;
    if (floorFilter !== "all" && String(r.floor ?? "—") !== floorFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterGroup
          options={[
            { key: "all", label: "הכל" },
            { key: "3R", label: "3 חדרים" },
            { key: "5R", label: "5 חדרים" },
            { key: "special", label: "בדיקה פרטנית" },
          ]}
          value={familyFilter}
          onChange={(v) => setFamilyFilter(v as FamilyFilter)}
        />

        <select
          value={floorFilter}
          onChange={(e) => setFloorFilter(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="all">כל הקומות</option>
          {floors.map((f) => (
            <option key={f} value={f}>
              קומה {f}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="all">כל הסטטוסים</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </select>

        <span className="text-xs text-slate-500">מציג {filtered.length} מתוך {rows.length} יחידות</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <Th>דירה</Th>
              <Th>סוג</Th>
              <Th>קומה</Th>
              <Th>שטח פנימי</Th>
              <Th>מרפסת / חצר</Th>
              <Th>כיוון</Th>
              <Th>טווח שוק</Th>
              <Th>מחיר מוצע</Th>
              <Th>רמת ביטחון / סטטוס</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const route = pricingRouteOf(row);
              const hasSpecialIndication = route !== "standard_family" && row.status === "special_indication_available";
              return (
                <tr
                  key={row.unit_number}
                  onClick={() => onSelectUnit(row)}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                >
                  <Td className="font-medium">{row.unit_number}</Td>
                  <Td className="whitespace-nowrap text-slate-600">{displayFamilyLabel(row.family)}</Td>
                  <Td>{row.floor ?? "—"}</Td>
                  <Td>{num(row.internal_area_sqm)}</Td>
                  <Td>{num(row.balcony_area_sqm)}</Td>
                  <Td>{row.orientation ?? "—"}</Td>
                  <Td>
                    {rangeOrPoint(row.market_range?.lower, row.market_range?.upper)}
                    {isPointValue(row.market_range?.lower, row.market_range?.upper) && (
                      <div className="text-[10px] font-normal text-slate-400">מקור נומרי בודד</div>
                    )}
                  </Td>
                  <Td className="font-semibold">
                    {route === "standard_family" ? (
                      <>
                        {ils(row.proposed_list_price_ils)}
                        {row.baseline_price_ils != null && row.baseline_price_ils !== row.proposed_list_price_ils && (
                          <span className="ms-1 font-normal text-slate-400 line-through">{ils(row.baseline_price_ils)}</span>
                        )}
                      </>
                    ) : hasSpecialIndication ? (
                      <span>{ils(row.proposed_list_price_ils)}</span>
                    ) : (
                      <span className="rounded bg-violet-100 px-2 py-1 text-xs font-medium text-violet-900">
                        תמחור פרטני בתהליך
                      </span>
                    )}
                  </Td>
                  <Td>
                    {route === "standard_family" || hasSpecialIndication ? (
                      <div className="flex flex-col gap-0.5">
                        <span
                          className={`w-fit rounded px-2 py-1 text-xs font-medium ${
                            CONFIDENCE_COLORS[row.market_range?.confidence ?? ""] ?? "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {CONFIDENCE_LABELS[row.market_range?.confidence ?? ""] ?? STATUS_LABELS[row.status] ?? row.status}
                        </span>
                        {row.status === "priced" && <span className="text-[11px] text-emerald-700">מחיר בסיס זמין</span>}
                        {hasSpecialIndication && <span className="text-[11px] text-violet-700">{STATUS_LABELS[row.status]}</span>}
                      </div>
                    ) : (
                      <span className="rounded bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700">נדרשת בדיקה פרטנית</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterGroup({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-slate-300">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`px-3 py-1.5 text-sm font-medium transition ${
            value === opt.key ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 text-start font-medium">{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-3 py-2 ${className ?? ""}`}>{children}</td>;
}
