"use client";

import { CONFIDENCE_LABELS } from "@/lib/family";
import { MARKETING_SIGNAL_LABELS, MarketingSignalKind, PRICE_POSITION_LABELS, ProductGroupDecisionRow } from "@/lib/marketingStrategy";
import { num } from "@/lib/format";

interface Props {
  groups: ProductGroupDecisionRow[];
  selectedKey: string | null;
  onSelectGroup: (key: string) => void;
}

const SIGNAL_COLORS: Record<MarketingSignalKind, string> = {
  insufficient_data: "text-ink-muted",
  review_price: "text-conflict",
  review: "text-warning",
  opportunity: "text-supported",
  strong_sales: "text-supported",
  no_exception: "text-ink-muted",
};

/** Section B -- "איפה נדרשת החלטת שיווק?", the core of the redesigned
 * Strategy tab: one compact row per real product group (never hardcoded to
 * 3R/5R), each showing sales performance, target, price position vs. the
 * group's own supported range, confidence, the current explicit decision,
 * and a deterministic decision signal. Clicking a row selects it for
 * Section C -- this table itself never edits anything. */
export default function MarketingDecisionTable({ groups, selectedKey, onSelectGroup }: Props) {
  return (
    <section className="rounded-md border border-hairline bg-surface p-4">
      <h3 className="mb-2 text-sm font-semibold text-ink">ב. איפה נדרשת החלטת שיווק?</h3>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-start text-sm">
          <thead>
            <tr className="border-b border-hairline text-[11px] text-ink-muted">
              <th className="px-2 py-1.5 text-start font-medium">סוג דירה</th>
              <th className="px-2 py-1.5 text-start font-medium">ביצועי מכירות</th>
              <th className="px-2 py-1.5 text-start font-medium">יעד</th>
              <th className="px-2 py-1.5 text-start font-medium">מיקום המחיר</th>
              <th className="px-2 py-1.5 text-start font-medium">ביטחון</th>
              <th className="px-2 py-1.5 text-start font-medium">החלטה נוכחית</th>
              <th className="px-2 py-1.5 text-start font-medium">מצב</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const selected = g.key === selectedKey;
              const adj = g.adjustment.adjustment_pct;
              return (
                <tr
                  key={g.key}
                  onClick={() => onSelectGroup(g.key)}
                  className={`cursor-pointer border-b border-hairline/60 transition-colors last:border-0 ${
                    selected ? "bg-accent/10" : "hover:bg-canvas"
                  }`}
                >
                  <td className="px-2 py-2 font-medium text-ink">{g.label}</td>
                  <td className="px-2 py-2 tabular-nums text-ink">{g.sellThroughPct != null ? `${num(g.sellThroughPct, 1)}%` : "לא הוזן"}</td>
                  <td className="px-2 py-2 tabular-nums text-ink-muted">{g.targetSellThroughPct != null ? `${num(g.targetSellThroughPct, 0)}%` : "—"}</td>
                  <td className="px-2 py-2 text-ink-muted">{PRICE_POSITION_LABELS[g.market.aggregatePosition]}</td>
                  <td className="px-2 py-2 text-ink-muted">{g.market.worstConfidence ? CONFIDENCE_LABELS[g.market.worstConfidence] ?? g.market.worstConfidence : "—"}</td>
                  <td className={`px-2 py-2 font-medium tabular-nums ${adj > 0 ? "text-supported" : adj < 0 ? "text-conflict" : "text-ink-muted/60"}`}>
                    {adj !== 0 ? `${adj > 0 ? "+" : ""}${adj}%` : "0%"}
                  </td>
                  <td className={`px-2 py-2 font-medium ${SIGNAL_COLORS[g.signal.kind]}`}>{MARKETING_SIGNAL_LABELS[g.signal.kind]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
