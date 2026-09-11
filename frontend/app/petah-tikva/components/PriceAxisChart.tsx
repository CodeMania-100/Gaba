"use client";

import { ChartPoint } from "@/lib/specialUnitDecision";
import { ilsCompact } from "@/lib/format";

interface Props {
  points: ChartPoint[];
  marketIndicationIls: number;
  methodLabel: string | null;
}

/** Horizontal lollipop/dot plot (task item 5) -- the primary explanation of
 * "why this price," replacing the old wall of evidence cards as the first
 * thing Marketing sees. Every dot is a real participating or context-only
 * comparable's own comparable_price_ils; excluded records are never passed
 * in (see lib/specialUnitDecision.ts's deriveChartPoints) so they can never
 * render as if they were equivalent transactions. The market-indication
 * line is the single strongest visual element -- a full-height dark bar,
 * heavier than any dot; the highlighted/central comparable gets the only
 * other emphasis (a larger, colored dot); everything else stays small and
 * grey. Positions are a plain linear scale over real prices -- no
 * statistical curve, no fabricated axis. */
export default function PriceAxisChart({ points, marketIndicationIls, methodLabel }: Props) {
  if (points.length === 0) return null;

  const values = [...points.map((p) => p.priceIls), marketIndicationIls];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.15 || max * 0.08 || 1;
  const domainMin = Math.max(0, min - pad);
  const domainMax = max + pad;
  const toPct = (v: number) => ((v - domainMin) / (domainMax - domainMin)) * 100;
  const indicationPct = toPct(marketIndicationIls);

  return (
    <div>
      {/* A price axis is a numeric scale, not RTL prose -- forced dir="ltr"
          here so the physical `left: %` positions used for the dots below
          stay in sync with the min/max axis labels (plain flexbox
          justify-between would otherwise silently mirror the label row
          under the page's dir="rtl" while the absolutely-positioned dots
          stay physical, desyncing the two). */}
      <div dir="ltr">
        <div className="relative h-14 w-full">
          <div className="absolute inset-x-0 top-1/2 h-px bg-slate-200" />

          {/* Market-indication line -- strongest emphasis (task item 5). */}
          <div className="absolute top-0 bottom-2 w-[3px] rounded-full bg-slate-900" style={{ left: `${indicationPct}%` }} />
          <div
            className="absolute top-0 whitespace-nowrap text-[10px] font-semibold text-slate-900"
            style={{ left: `${indicationPct}%`, transform: "translateX(-50%)" }}
          >
            {ilsCompact(marketIndicationIls)}
          </div>

          {points.map((p, i) => {
            const left = toPct(p.priceIls);
            const dotClass = p.isHighlighted
              ? "h-3.5 w-3.5 bg-blue-600 ring-2 ring-blue-200"
              : p.participating
                ? "h-2.5 w-2.5 bg-slate-500"
                : "h-2 w-2 border border-slate-300 bg-white";
            return (
              <div
                key={`${p.label}-${i}`}
                className={`absolute bottom-2 -translate-x-1/2 translate-y-1/2 rounded-full ${dotClass}`}
                style={{ left: `${left}%` }}
                title={`${p.label} · ${ilsCompact(p.priceIls)}${p.participating ? " · השתתף בחישוב" : " · הקשר שוק בלבד"}`}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <span>{ilsCompact(domainMin)}</span>
          <span className="text-slate-600" dir="rtl">
            ↑ אינדיקציית שוק
          </span>
          <span>{ilsCompact(domainMax)}</span>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-500" /> השתתפו בחישוב
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full border border-slate-300 bg-white" /> הקשר שוק בלבד
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full bg-blue-600" /> עסקה מרכזית
        </span>
      </div>

      {methodLabel && <p className="mt-1 text-[11px] text-slate-400">{methodLabel}</p>}
    </div>
  );
}
