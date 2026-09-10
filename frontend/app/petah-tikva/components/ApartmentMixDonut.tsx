"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ApartmentMixSlice } from "@/lib/executiveVisuals";
import { num } from "@/lib/format";

interface Props {
  mix: ApartmentMixSlice[];
  total: number;
}

// Restrained, professional palette -- deliberately not a rainbow (task item 4).
const SLICE_COLORS: Record<string, string> = {
  "3R": "#1e3a5f",
  "5R": "#4a6fa5",
  garden: "#7ba098",
  duplex: "#c9a875",
  triplex: "#9b8fa8",
};

export default function ApartmentMixDonut({ mix, total }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold text-slate-900">תמהיל הדירות בפרויקט</h3>
      </div>
      <div className="relative flex items-center gap-4">
        <div className="relative h-56 w-56 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={mix}
                dataKey="count"
                nameKey="label"
                innerRadius="62%"
                outerRadius="95%"
                paddingAngle={1.5}
                stroke="none"
              >
                {mix.map((slice) => (
                  <Cell key={slice.key} fill={SLICE_COLORS[slice.key] ?? "#94a3b8"} />
                ))}
              </Pie>
              <Tooltip content={<MixTooltip total={total} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold tabular-nums text-slate-900">{total}</span>
            <span className="text-xs text-slate-500">דירות</span>
          </div>
        </div>
        <ul className="flex flex-1 flex-col gap-1.5 text-sm">
          {mix.map((slice) => (
            <li key={slice.key} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-slate-700">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: SLICE_COLORS[slice.key] ?? "#94a3b8" }} />
                {slice.label}
              </span>
              <span className="font-semibold tabular-nums text-slate-900">{slice.count}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <span className="font-medium text-slate-600">נתוני מכירות בפרויקט:</span> לא סופקו במסגרת המטלה.
      </div>
    </div>
  );
}

function MixTooltip({ active, payload, total }: { active?: boolean; payload?: { payload: ApartmentMixSlice }[]; total: number }) {
  if (!active || !payload || payload.length === 0) return null;
  const slice = payload[0].payload;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="font-semibold text-slate-900">{slice.label}</div>
      <div className="text-slate-600">{slice.count} דירות</div>
      <div className="text-slate-500">{num(slice.pct, 1)}% מהפרויקט (מתוך {total})</div>
    </div>
  );
}
