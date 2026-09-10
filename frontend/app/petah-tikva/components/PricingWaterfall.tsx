"use client";

import { WaterfallStep } from "@/lib/executiveVisuals";
import { ils } from "@/lib/format";

/** "איך נבנה מחיר השיווק?" -- a pure re-display of computePriceBreakdown's
 * existing output (see lib/executiveVisuals.ts deriveWaterfallSteps); no
 * recalculation happens in this component. Categories are strictly the
 * evidence/strategy chain (market indication -> phase -> sales-progress ->
 * project/family/unit commercial adjustments -> proposed price) -- never
 * apartment physical attributes (task item 21). Zero-effect rows stay
 * present but visually minimized so real movement isn't drowned out (item 24). */
export default function PricingWaterfall({ steps }: { steps: WaterfallStep[] }) {
  const maxAbs = Math.max(...steps.map((s) => Math.abs(s.valueIls ?? 0)), 1);

  return (
    <div className="flex flex-col gap-1.5">
      {steps.map((step) => (
        <WaterfallRow key={step.key} step={step} maxAbs={maxAbs} />
      ))}
    </div>
  );
}

function WaterfallRow({ step, maxAbs }: { step: WaterfallStep; maxAbs: number }) {
  const isEmphasized = step.kind !== "adjustment";
  const value = step.valueIls ?? 0;
  const widthPct = step.isZero ? 2 : Math.max(4, (Math.abs(value) / maxAbs) * 100);
  const barColor = isEmphasized ? "bg-slate-600" : value > 0 ? "bg-emerald-500/70" : value < 0 ? "bg-amber-600/70" : "bg-slate-200";
  const textColor = isEmphasized ? "font-bold text-slate-900" : value > 0 ? "text-emerald-700" : value < 0 ? "text-amber-700" : "text-slate-400";

  return (
    <div className={`flex items-center gap-2 ${step.isZero ? "opacity-60" : ""}`}>
      <span className={`w-40 shrink-0 text-xs ${isEmphasized ? "font-semibold text-slate-800" : "text-slate-600"}`}>{step.label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-slate-100">
        <div className={`h-full rounded-sm ${barColor}`} style={{ width: `${widthPct}%` }} />
      </div>
      <span className={`w-24 shrink-0 text-end text-xs tabular-nums ${textColor}`}>
        {step.valueIls == null ? "—" : isEmphasized ? ils(step.valueIls) : `${value >= 0 ? "+" : ""}${ils(value)}`}
      </span>
    </div>
  );
}
