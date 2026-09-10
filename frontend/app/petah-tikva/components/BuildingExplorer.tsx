"use client";

import { useMemo, useState } from "react";
import { PtkPriceListRow } from "@/lib/api";
import { CONFIDENCE_COLORS, CONFIDENCE_LABELS, roomsOf, unitTypeLabel } from "@/lib/family";
import { deriveBuildingFloors } from "@/lib/executiveVisuals";
import { ilsCompact, num } from "@/lib/format";
import { computePriceBreakdown, MarketingStrategyState } from "@/lib/marketingStrategy";

interface Props {
  rows: PtkPriceListRow[];
  marketingStrategy: MarketingStrategyState;
  onSelectUnit: (row: PtkPriceListRow) => void;
}

type ViewMode = "market" | "proposed" | "confidence";

const MODES: { key: ViewMode; label: string }[] = [
  { key: "market", label: "אינדיקציית שוק" },
  { key: "proposed", label: "מחיר שיווק מוצע" },
  { key: "confidence", label: "רמת ביטחון" },
];

/** Visual floor-by-floor navigation layer -- "מפת דירות לפי קומה", not an
 * architectural floor plan (see task item 7): floor grouping comes straight
 * from each row's real inventory `floor` value (lib/executiveVisuals.ts
 * deriveBuildingFloors), never an assumed physical layout. Clicking a tile
 * opens the existing UnitDrawer via onSelectUnit -- no drawer functionality
 * is duplicated here. */
export default function BuildingExplorer({ rows, marketingStrategy, onSelectUnit }: Props) {
  const [mode, setMode] = useState<ViewMode>("market");
  const floors = useMemo(() => deriveBuildingFloors(rows), [rows]);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-300 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">מפת דירות לפי קומה</h2>
          <p className="text-xs text-slate-500">בחירת דירה לפי קומה לקבלת אינדיקציית מחיר וניתוח מלא.</p>
        </div>
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === m.key ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {floors.map((group) => (
          <div key={group.floorKey} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
            <div className="w-24 shrink-0 pt-1.5 text-xs font-semibold text-slate-500">{group.floorLabel}</div>
            <div className="flex flex-1 flex-wrap gap-2">
              {group.units.map((row) => (
                <UnitTile key={row.unit_number} row={row} state={marketingStrategy} mode={mode} onClick={() => onSelectUnit(row)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function UnitTile({
  row,
  state,
  mode,
  onClick,
}: {
  row: PtkPriceListRow;
  state: MarketingStrategyState;
  mode: ViewMode;
  onClick: () => void;
}) {
  const rooms = roomsOf(row);
  const confidence = row.market_range?.confidence ?? null;
  const breakdown = computePriceBreakdown(state, row);
  const marketIls = breakdown.marketIndicationIls;
  const proposedIls = breakdown.proposedIls;

  const headline =
    mode === "confidence"
      ? confidence
        ? CONFIDENCE_LABELS[confidence]
        : "—"
      : mode === "proposed"
        ? proposedIls != null
          ? ilsCompact(proposedIls)
          : "בבדיקה"
        : marketIls != null
          ? ilsCompact(marketIls)
          : "בבדיקה";

  const tooltip = [
    `דירה ${row.unit_number}`,
    rooms != null ? `${rooms} חדרים` : null,
    row.internal_area_sqm != null ? `${num(row.internal_area_sqm)} מ״ר${row.balcony_area_sqm != null ? ` + ${num(row.balcony_area_sqm)} מ״ר מרפסת` : ""}` : null,
    row.floor != null ? `קומה ${row.floor}` : null,
    marketIls != null ? `אינדיקציית שוק: ${ilsCompact(marketIls)}` : null,
    proposedIls != null ? `מחיר שיווק מוצע: ${ilsCompact(proposedIls)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <button
      onClick={onClick}
      title={tooltip}
      className="flex w-24 flex-col items-start gap-0.5 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-start shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md"
    >
      <div className="flex w-full items-center justify-between gap-1">
        <span className="text-xs font-semibold text-slate-900">דירה {row.unit_number}</span>
        {mode !== "confidence" && confidence && (
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CONFIDENCE_DOT[confidence] ?? "bg-slate-300"}`} />
        )}
      </div>
      <span className="text-[11px] text-slate-500">{rooms != null ? `${rooms} חד׳` : unitTypeLabel(row.family)}</span>
      {mode === "confidence" ? (
        <span className={`mt-0.5 w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${CONFIDENCE_COLORS[confidence ?? ""] ?? "bg-slate-100 text-slate-500"}`}>
          {headline}
        </span>
      ) : (
        <span className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">{headline}</span>
      )}
    </button>
  );
}

const CONFIDENCE_DOT: Record<string, string> = {
  high: "bg-emerald-500",
  medium: "bg-amber-500",
  low: "bg-orange-500",
  insufficient: "bg-slate-300",
};
