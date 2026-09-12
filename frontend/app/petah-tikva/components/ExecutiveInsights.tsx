"use client";

import { ExecutiveInsight } from "@/lib/executiveVisuals";

const STATUS_STYLES: Record<ExecutiveInsight["status"], { border: string; bg: string; badge: string; label: string }> = {
  attention: { border: "border-warning/40", bg: "bg-warning/5", badge: "bg-warning/15 text-warning", label: "לתשומת לב" },
  opportunity: { border: "border-accent/40", bg: "bg-accent/5", badge: "bg-accent/15 text-accent", label: "הזדמנות" },
  info: { border: "border-hairline", bg: "bg-canvas", badge: "bg-hairline/60 text-ink-muted", label: "מידע" },
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
          <div key={i} className={`rounded-md border ${style.border} ${style.bg} p-3`}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink">{insight.title}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${style.badge}`}>{style.label}</span>
            </div>
            {insight.subject && <div className="mb-0.5 text-xs font-medium text-ink">{insight.subject}</div>}
            {insight.lines.map((l, j) => (
              <p key={j} className="text-xs text-ink-muted">
                {l}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}
