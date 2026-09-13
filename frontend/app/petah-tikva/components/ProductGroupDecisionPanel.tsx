"use client";

import { useState } from "react";
import { PtkPriceListRow } from "@/lib/api";
import { CONFIDENCE_LABELS } from "@/lib/family";
import { productGroupKeyOf } from "@/lib/comparisonSubject";
import {
  clampSoldUnits,
  clampTargetSellThroughPct,
  computePriceBreakdown,
  derivePriceRangePosition,
  deriveProductGroupStrategyImpact,
  emptyProductGroupSalesInput,
  MarketingStrategyState,
  PRICE_POSITION_LABELS,
  PricePositionKind,
  ProductGroupDecisionRow,
  StrategyAdjustment,
} from "@/lib/marketingStrategy";
import { ils, ilsCompact, num } from "@/lib/format";
import { AdjustmentEditor } from "./AdjustmentEditor";

interface Props {
  rows: PtkPriceListRow[];
  state: MarketingStrategyState;
  group: ProductGroupDecisionRow;
  onChange: (updater: (prev: MarketingStrategyState) => MarketingStrategyState) => void;
  onOpenUnit?: (row: PtkPriceListRow) => void;
}

const POSITION_ORDER: PricePositionKind[] = ["above_range", "within_range", "below_range", "no_range"];

/** Formats a group's price-position counts as one or more "N מתוך M X"
 * facts (task item 8) -- never a single synthetic verdict when the group's
 * units genuinely disagree. Omits buckets with zero units. */
function formatPositionBreakdown(positionCounts: Record<PricePositionKind, number>, totalRows: number): string {
  if (totalRows === 0) return "אין נתונים";
  const parts = POSITION_ORDER.filter((k) => positionCounts[k] > 0).map((k) => `${positionCounts[k]} מתוך ${totalRows} ${PRICE_POSITION_LABELS[k]}`);
  return parts.join(" · ");
}

/** Section C -- "החלטה לקבוצה שנבחרה": everything Marketing needs to
 * decide on ONE selected product group, in one compact panel -- market
 * context, sales state (with inline sold/target editing), price position,
 * why the group was flagged, the explicit adjustment control (never
 * prefilled from the signal), and a live before/after preview. */
export default function ProductGroupDecisionPanel({ rows, state, group, onChange, onOpenUnit }: Props) {
  const [showUnits, setShowUnits] = useState(false);
  const groupRows = rows.filter((r) => productGroupKeyOf(r) === group.key);
  const impact = deriveProductGroupStrategyImpact(rows, state, group.key);
  const hasAnyInput = group.soldUnits != null || group.targetSellThroughPct != null || group.adjustment.adjustment_pct !== 0;

  function updateGroup(patch: Partial<{ soldUnits: number | null; targetSellThroughPct: number | null; adjustment: StrategyAdjustment }>) {
    onChange((prev) => {
      const current = prev.productGroupSales[group.key] ?? emptyProductGroupSalesInput();
      return { ...prev, productGroupSales: { ...prev.productGroupSales, [group.key]: { ...current, ...patch } } };
    });
  }

  function clearGroup() {
    onChange((prev) => {
      const next = { ...prev.productGroupSales };
      delete next[group.key];
      return { ...prev, productGroupSales: next };
    });
  }

  return (
    <section className="rounded-lg border-2 border-ink/80 bg-gradient-to-b from-canvas to-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-sm font-bold text-ink">ג. החלטה לקבוצה שנבחרה — {group.label}</h3>
        {hasAnyInput && (
          <button onClick={clearGroup} className="text-[11px] font-medium text-ink-muted underline hover:text-conflict">
            נקה נתוני קבוצה
          </button>
        )}
      </div>

      {/* מה השוק אומר */}
      <div className="mb-3 rounded-md bg-surface p-3">
        <div className="mb-1 text-xs font-semibold text-ink-muted">מה השוק אומר</div>
        {group.market.isUniform ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-xl font-bold text-ink">{ils(group.market.representativeIls)}</span>
            {group.market.representativeRange && (group.market.representativeRange.lower != null || group.market.representativeRange.upper != null) && (
              <span className="text-xs text-ink-muted">
                טווח נתמך: {ils(group.market.representativeRange.lower)} – {ils(group.market.representativeRange.upper)}
              </span>
            )}
            {group.market.representativeConfidence && (
              <span className="text-xs text-ink-muted">רמת ביטחון: {CONFIDENCE_LABELS[group.market.representativeConfidence] ?? group.market.representativeConfidence}</span>
            )}
          </div>
        ) : (
          <div>
            <p className="text-sm text-ink-muted">אין טווח משותף לקבוצה — לכל יחידה אינדיקציית שוק וטווח משלה.</p>
            <button onClick={() => setShowUnits((v) => !v)} className="mt-1 text-xs font-medium text-accent underline hover:text-accent/80">
              {showUnits ? "הסתרת יחידות" : "הצג יחידות"}
            </button>
            {showUnits && (
              <ul className="mt-2 flex flex-col gap-1 text-xs">
                {groupRows.map((row) => {
                  const b = computePriceBreakdown(state, row);
                  const position = derivePriceRangePosition(b.proposedIls, row.market_range);
                  return (
                    <li key={row.unit_number} className="flex items-center justify-between gap-2 rounded-md bg-canvas px-2 py-1.5">
                      <button onClick={() => onOpenUnit?.(row)} className="font-medium text-ink hover:text-accent">
                        דירה {row.unit_number}
                      </button>
                      <span className="text-ink-muted">אינדיקציה: {ils(row.proposed_list_price_ils)}</span>
                      <span className="text-ink-muted">מוצע: {ils(b.proposedIls)}</span>
                      <span className="text-ink-muted">{PRICE_POSITION_LABELS[position]}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* מה קורה בפרויקט -- ביצועי המכירות של הקבוצה: כמה נמכר מול היעד,
          לגמרי נפרד משלב הפרויקט (מעל) ומהתאמת המחיר (מתחת) -- אף אחד
          מהשלושה אינו קובע את האחר אוטומטית. */}
      <div className="mb-3 rounded-md bg-surface p-3">
        <div className="mb-1.5 text-xs font-semibold text-ink-muted">מה קורה בפרויקט</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="text-ink-muted">
            מלאי: <span className="font-semibold text-ink">{group.inventoryCount}</span>
          </span>
          <label className="flex items-center gap-1.5">
            <span className="text-ink-muted">נמכר</span>
            <input
              type="number"
              step={1}
              min={0}
              max={group.inventoryCount}
              value={group.soldUnits ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                updateGroup({ soldUnits: raw.trim() === "" ? null : clampSoldUnits(Number(raw), group.inventoryCount) });
              }}
              placeholder="—"
              className="w-14 rounded-md border border-hairline px-1.5 py-1"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-ink-muted">יעד מכירות לשלב הנוכחי (%)</span>
            <input
              type="number"
              step={1}
              min={0}
              max={100}
              value={group.targetSellThroughPct ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                updateGroup({ targetSellThroughPct: raw.trim() === "" ? null : clampTargetSellThroughPct(Number(raw)) });
              }}
              placeholder="—"
              className="w-14 rounded-md border border-hairline px-1.5 py-1"
            />
          </label>
        </div>
        <p className="mt-1 text-[11px] text-ink-muted/70">איזה אחוז מהדירות מסוג זה ציפינו למכור עד שלב זה.</p>

        {/* Human-readable recap -- only once real data exists; never a
            fabricated sentence over missing data (task item 5). */}
        {group.soldUnits != null && (
          <p className="mt-2 text-sm text-ink">
            נמכרו <span className="font-semibold">{group.soldUnits}</span> מתוך <span className="font-semibold">{group.inventoryCount}</span> דירות ·{" "}
            <span className="font-semibold">{num(group.sellThroughPct ?? 0, 1)}%</span>
            {group.targetSellThroughPct != null && (
              <>
                {" "}
                · יעד לשלב הנוכחי <span className="font-semibold">{num(group.targetSellThroughPct, 0)}%</span>
              </>
            )}
          </p>
        )}
        {group.soldUnits == null && <p className="mt-2 text-sm text-ink-muted/60">לא הוזן</p>}

        {group.targetSellThroughPct != null && (
          <p className="mt-1 text-xs text-ink-muted">
            {num(group.targetSellThroughPct, 0)}% = {Math.round((group.targetSellThroughPct / 100) * group.inventoryCount)} מתוך {group.inventoryCount} דירות
          </p>
        )}
      </div>

      {/* איפה המחיר נמצא */}
      <div className="mb-3 rounded-md bg-surface p-3">
        <div className="mb-1 text-xs font-semibold text-ink-muted">איפה המחיר נמצא</div>
        <p className="text-sm text-ink">{formatPositionBreakdown(group.market.positionCounts, group.market.totalRows)}</p>
      </div>

      {/* למה הקבוצה סומנה -- signal בלבד, אף פעם לא נשמר כהחלטת תמחור */}
      {group.signal.reasons.length > 0 && (
        <div className="mb-3 rounded-md border border-dashed border-hairline p-3">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-muted">
            <span>למה הקבוצה סומנה</span>
            <span className="rounded-full bg-canvas px-2 py-0.5 font-medium text-ink">{group.signal.label}</span>
          </div>
          <ul className="flex flex-col gap-0.5 text-sm text-ink-muted">
            {group.signal.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* החלטת השיווק */}
      <div className="mb-3">
        <div className="mb-1.5 text-sm font-semibold text-ink">החלטת השיווק</div>
        <AdjustmentEditor title="התאמת מחיר לקבוצה" value={group.adjustment} onChange={(next) => updateGroup({ adjustment: next })} effectIls={group.effectIls} />
      </div>

      {/* Before/after preview */}
      <div className="rounded-md bg-surface p-3">
        <div className="mb-1.5 text-xs font-semibold text-ink-muted">השפעת ההחלטה</div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-ink-muted">לפני</div>
            <div className="font-semibold text-ink">{formatIlsRange(impact.beforeIlsRange, impact.isUniform)}</div>
          </div>
          <div>
            <div className="text-xs text-ink-muted">אחרי</div>
            <div className="font-semibold text-ink">{formatIlsRange(impact.afterIlsRange, impact.isUniform)}</div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-ink-muted">
          <div>מיקום לפני: {formatPositionBreakdown(impact.beforePositionCounts, group.inventoryCount)}</div>
          <div>מיקום לאחר: {formatPositionBreakdown(impact.afterPositionCounts, group.inventoryCount)}</div>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          יחידות מושפעות: <span className="font-semibold text-ink">{impact.affectedUnitsCount}</span>
        </p>
      </div>
    </section>
  );
}

function formatIlsRange(range: { min: number; max: number } | null, isUniform: boolean): string {
  if (range == null) return "—";
  if (isUniform || range.min === range.max) return ilsCompact(range.min);
  return `${ilsCompact(range.min)} – ${ilsCompact(range.max)}`;
}
