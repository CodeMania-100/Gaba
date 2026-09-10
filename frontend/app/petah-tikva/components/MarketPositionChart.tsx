"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MarketPositionCategory } from "@/lib/executiveVisuals";
import { ils } from "@/lib/format";

interface Props {
  categories: MarketPositionCategory[];
}

/** Where our (frozen, strategy-independent) market indication sits relative
 * to the same evidence-lane reference prices already computed for this
 * family (lib/executiveVisuals.ts deriveMarketPosition) -- no independent
 * calculation, no mismatched comparison. */
export default function MarketPositionChart({ categories }: Props) {
  if (categories.length === 0) {
    return <p className="rounded-md bg-slate-50 px-3 py-4 text-center text-sm text-slate-400">אין נתוני שוק זמינים להשוואה עבור משפחה זו.</p>;
  }

  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={categories} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={{ stroke: "#cbd5e1" }} tickLine={false} tickFormatter={(v: number) => `₪${Math.round(v / 1000)}K`} />
          <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 12, fill: "#334155" }} axisLine={false} tickLine={false} />
          <Tooltip content={<PositionTooltip />} cursor={{ fill: "#f1f5f9" }} />
          <Bar dataKey="priceIls" radius={[0, 4, 4, 0]} maxBarSize={22}>
            {categories.map((c) => (
              <Cell key={c.key} fill={c.isOurs ? "#1e3a5f" : "#94a3b8"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PositionTooltip({ active, payload }: { active?: boolean; payload?: { payload: MarketPositionCategory }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const c = payload[0].payload;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="font-semibold text-slate-900">{c.label}</div>
      <div className="text-slate-600">{ils(c.priceIls)}</div>
      <div className="text-slate-400">{c.sourceNote}</div>
      {c.sampleSize != null && <div className="text-slate-400">מקורות: {c.sampleSize}</div>}
    </div>
  );
}
