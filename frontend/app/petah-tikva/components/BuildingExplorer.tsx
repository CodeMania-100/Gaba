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
 * architectural floor plan: floor grouping comes straight from each row's
 * real inventory `floor` value (lib/executiveVisuals.ts deriveBuildingFloors),
 * never an assumed physical layout. Clicking a tile opens the existing
 * UnitDrawer via onSelectUnit -- no drawer functionality is duplicated
 * here. */
export default function BuildingExplorer({ rows, marketingStrategy, onSelectUnit }: Props) {
  const [mode, setMode] = useState<ViewMode>("market");
  const floors = useMemo(() => deriveBuildingFloors(rows), [rows]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-bold text-ink">מפת דירות לפי קומה</h2>
          <p className="text-xs text-ink-muted">בחירת דירה לפי קומה לקבלת אינדיקציית מחיר וניתוח מלא.</p>
        </div>
        <div className="flex overflow-hidden rounded-md border border-hairline">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === m.key ? "bg-ink text-surface" : "bg-surface text-ink-muted hover:bg-canvas"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted">
        <LegendDot className="bg-accent" label="יחידה מיוחדת" />
        <LegendDot className="bg-warning" label="ביטחון נמוך / לבדיקה" />
      </div>

      <div className="flex flex-col gap-3">
        {floors.map((group) => (
          <div key={group.floorKey} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
            <div className="w-24 shrink-0 pt-1.5 text-xs font-semibold text-ink-muted">{group.floorLabel}</div>
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

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${className}`} />
      {label}
    </span>
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
  const isSpecial = row.family_key == null;
  const needsAttention = row.requires_review || confidence === "low";
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

  const borderClass = needsAttention ? "border-warning" : isSpecial ? "border-accent/60" : "border-hairline";

  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={`flex w-28 flex-col items-start gap-0.5 rounded-md border bg-surface px-2.5 py-2 text-start transition-all hover:-translate-y-0.5 hover:shadow-sm ${borderClass}`}
    >
      <div className="flex w-full items-center justify-between gap-1">
        <span className="text-xs font-semibold text-ink">דירה {row.unit_number}</span>
        <span className="flex items-center gap-1">
          {needsAttention && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />}
          {isSpecial && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
        </span>
      </div>
      <span className="text-[11px] text-ink-muted">{rooms != null ? `${rooms} חד׳` : unitTypeLabel(row.family)}</span>
      {row.internal_area_sqm != null && <span className="text-[11px] text-ink-muted">{num(row.internal_area_sqm)} מ״ר</span>}
      {mode === "confidence" ? (
        <span className={`mt-0.5 w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${CONFIDENCE_COLORS[confidence ?? ""] ?? "bg-canvas text-ink-muted"}`}>
          {headline}
        </span>
      ) : (
        <span className="mt-0.5 text-sm font-bold tabular-nums text-ink">{headline}</span>
      )}
    </button>
  );
}
