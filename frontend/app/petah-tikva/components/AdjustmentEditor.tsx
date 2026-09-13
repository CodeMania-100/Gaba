"use client";

import { useState } from "react";
import { StrategyAdjustment } from "@/lib/marketingStrategy";
import { ils } from "@/lib/format";

/** Collapsible %+rationale control -- the one restrained adjustment-input
 * style reused across every explicit Marketing decision in the Strategy
 * workspace (project-wide manual adjustment, sales-progress adjustment,
 * stage adjustment, per-product-group adjustment): closed by default
 * showing just the current %/₪ effect, opens on click to reveal the
 * numeric input and a rationale field. Never prefilled from anything other
 * than the value passed in -- callers control the starting %, and nothing
 * here ever infers a percentage on its own. */
export function AdjustmentEditor({
  title,
  value,
  onChange,
  effectIls,
}: {
  title: string;
  value: StrategyAdjustment;
  onChange: (next: StrategyAdjustment) => void;
  effectIls?: number | null;
}) {
  const [open, setOpen] = useState(value.adjustment_pct !== 0 || value.rationale !== "");

  return (
    <div className="rounded-md border border-hairline bg-surface p-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 text-start">
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="flex items-center gap-2">
          {effectIls != null && value.adjustment_pct !== 0 && (
            <span className={`text-xs font-semibold tabular-nums ${effectIls >= 0 ? "text-supported" : "text-conflict"}`}>
              {value.adjustment_pct > 0 ? "+" : ""}
              {value.adjustment_pct}% · {effectIls >= 0 ? "+" : ""}
              {ils(effectIls)}
            </span>
          )}
          <span className="text-xs text-ink-muted/70 underline">{open ? "הסתרה" : "הגדרה"}</span>
        </span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0 text-ink-muted">אחוז התאמה</span>
            <input
              type="number"
              step={0.5}
              value={value.adjustment_pct}
              onChange={(e) => onChange({ ...value, adjustment_pct: Number(e.target.value) || 0 })}
              className="w-24 rounded-md border border-hairline px-2 py-1"
            />
            <span className="text-ink-muted">%</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <span className="w-24 shrink-0 pt-1 text-ink-muted">נימוק</span>
            <input
              type="text"
              value={value.rationale}
              onChange={(e) => onChange({ ...value, rationale: e.target.value })}
              placeholder='לדוגמה: "קצב מכירת דירות 3 חדרים גבוה מהיעד"'
              className="flex-1 rounded-md border border-hairline px-2 py-1"
            />
          </label>
        </div>
      )}
    </div>
  );
}
