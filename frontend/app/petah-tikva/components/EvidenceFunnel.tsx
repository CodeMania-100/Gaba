"use client";

import { LaneFunnel } from "@/lib/specialUnitDecision";

/** Compact vertical evidence-flow visualization (task item 8) -- stages come
 * straight from lib/specialUnitDecision.ts's deriveLaneFunnel, which only
 * ever emits a stage backed by a real, distinct count from the unit's own
 * SpecialUnitContext/SpecialUnitIndication (task item 26): no unit is forced
 * into an identical shape, and a stage that would just repeat the previous
 * count is omitted rather than fabricated. Bar width is proportional to
 * count for a quick visual read, not a statistical chart. */
export default function EvidenceFunnel({ funnel }: { funnel: LaneFunnel }) {
  const maxCount = Math.max(...funnel.stages.map((s) => s.count), 1);

  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-slate-500">{funnel.laneLabel}</div>
      <div className="flex flex-col gap-1">
        {funnel.stages.map((stage, i) => (
          <div key={stage.label}>
            {i > 0 && <div className="ps-1 text-slate-300">↓</div>}
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-xs text-slate-600">{stage.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-sm bg-slate-100">
                <div className="h-full rounded-sm bg-slate-500" style={{ width: `${Math.max(6, (stage.count / maxCount) * 100)}%` }} />
              </div>
              <span className="w-6 shrink-0 text-end text-xs font-semibold tabular-nums text-slate-900">{stage.count}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Excluded records get their own short, grouped Hebrew reason here --
          never a raw code (task items 9/25). Participating vs excluded is
          already visually distinct (this list vs. the chart's solid dots),
          and this is the one place the exclusion reason itself is spelled
          out in the primary view. */}
      {funnel.excludedRecords.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5 border-t border-slate-100 pt-2">
          {funnel.excludedRecords.map((e, i) => (
            <div key={i} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="text-slate-500">
                {e.label} <span className="text-slate-400">— הוצא מסל ההשוואה, לא השתתף בחישוב</span>
              </span>
              <span className="shrink-0 font-medium text-slate-600">{e.groupedReason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
