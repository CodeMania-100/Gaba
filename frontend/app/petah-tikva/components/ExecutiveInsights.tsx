"use client";

import { ExecutiveInsight } from "@/lib/executiveVisuals";

const STATUS_STYLES: Record<ExecutiveInsight["status"], { border: string; bg: string; badge: string; label: string }> = {
  attention: { border: "border-amber-200", bg: "bg-amber-50", badge: "bg-amber-100 text-amber-800", label: "לתשומת לב" },
  opportunity: { border: "border-sky-200", bg: "bg-sky-50", badge: "bg-sky-100 text-sky-800", label: "הזדמנות" },
  info: { border: "border-slate-200", bg: "bg-slate-50", badge: "bg-slate-100 text-slate-600", label: "מידע" },
};

/** Up to 3 concise, dynamically-derived insight cards (see
 * lib/executiveVisuals.ts deriveExecutiveInsights) -- never a sensational
 * warning, never a static/hardcoded claim. */
export default function ExecutiveInsights({ insights }: { insights: ExecutiveInsight[] }) {
  if (insights.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {insights.map((insight, i) => {
        const style = STATUS_STYLES[insight.status];
        return (
          <div key={i} className={`rounded-lg border ${style.border} ${style.bg} p-3`}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-900">{insight.title}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${style.badge}`}>{style.label}</span>
            </div>
            {insight.subject && <div className="mb-0.5 text-xs font-medium text-slate-700">{insight.subject}</div>}
            {insight.lines.map((l, j) => (
              <p key={j} className="text-xs text-slate-600">
                {l}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}
