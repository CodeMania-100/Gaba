"use client";

import { PetahTikvaWorkspace, PtkPriceListRow } from "@/lib/api";
import { roomsOf, unitTypeLabel } from "@/lib/family";
import { num } from "@/lib/format";
import { ChartPoint, chartMethodLabel, deriveChartPoints, deriveHighlightedComparable, primaryLaneName } from "@/lib/specialUnitDecision";
import { SPECIAL_UNIT_CATEGORY_LABELS } from "@/lib/marketMap";
import PriceAxisChart from "./PriceAxisChart";
import { HighlightedComparableCard, SiblingComparisonCompact } from "./SpecialUnitDecisionPanel";

interface Props {
  row: PtkPriceListRow;
  workspace: PetahTikvaWorkspace;
}

/** "במה המוצר שלנו שונה מהמתחרים?" for a currently-selected special unit --
 * the same canonical highlighted-comparable/chart derivation the apartment
 * drawer's own section B already uses (HighlightedComparableCard,
 * PriceAxisChart via lib/specialUnitDecision.ts), reused here rather than
 * recomputed, so the drawer and the market tab can never disagree about
 * this unit's comparison. There is no standard-family-style competitor
 * register for special units in this pipeline (no such dataset exists), so
 * this never falls back to a 3R/5R view -- it shows this unit's own real
 * evidence, or an honest "not enough data" message. */
export default function SpecialUnitProductComparison({ row, workspace }: Props) {
  const context = workspace.special_unit_market_context.units[row.unit_number];
  const indication = context?.market_indication;
  const categoryLabel = context ? (SPECIAL_UNIT_CATEGORY_LABELS[context.category] ?? context.category) : unitTypeLabel(row.family);
  const rooms = roomsOf(row);

  const primaryLane = indication ? primaryLaneName(indication) : null;
  const laneResult = primaryLane && indication ? indication.lanes[primaryLane] : null;
  const highlighted = laneResult ? deriveHighlightedComparable(laneResult, rooms) : null;
  const chartPoints: ChartPoint[] = laneResult ? deriveChartPoints(laneResult, highlighted?.comparable.label) : [];

  return (
    <section className="rounded-lg border border-hairline bg-surface p-5">
      <div className="mb-1">
        <h2 className="font-heading text-lg font-bold text-ink">במה המוצר שלנו שונה מהמתחרים?</h2>
        <p className="text-xs text-ink-muted">
          דירה {row.unit_number} · {categoryLabel}
          {rooms != null ? ` · ${rooms} חדרים` : ""} — יחידה מיוחדת, אינה נבדקת מול מרשם המתחרים הסטנדרטי.
        </p>
      </div>

      {chartPoints.length > 0 && laneResult && indication?.suggested_price_ils != null && (
        <div className="mt-3 border-t border-hairline pt-3">
          <PriceAxisChart points={chartPoints} marketIndicationIls={indication.suggested_price_ils} methodLabel={chartMethodLabel(laneResult)} />
        </div>
      )}

      {highlighted ? (
        <div className="mt-3 border-t border-hairline pt-3">
          <HighlightedComparableCard row={row} categoryLabel={categoryLabel} highlighted={highlighted} />
        </div>
      ) : (
        <p className="mt-3 border-t border-hairline pt-3 text-sm text-ink-muted">אין כרגע השוואה כמותית זמינה ליחידה זו.</p>
      )}

      <SiblingComparisonCompact row={row} workspace={workspace} />

      <p className="mt-3 text-[11px] text-ink-muted/70">
        פירוט מלא של ראיות והשוואות ליחידה זו זמין בכרטיס הדירה, בסעיף &quot;למה זה המחיר&quot;.
      </p>
    </section>
  );
}
