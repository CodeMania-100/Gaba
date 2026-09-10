"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { QuarterlyTrendSeries } from "@/lib/executiveVisuals";
import { ils } from "@/lib/format";

interface Props {
  series: QuarterlyTrendSeries[];
}

const FAMILY_COLORS: Record<string, string> = { "3R": "#1e3a5f", "5R": "#7ba098" };

interface ChartRow {
  quarterKey: string;
  quarterLabel: string;
  "3R"?: number;
  "3R_count"?: number;
  "5R"?: number;
  "5R_count"?: number;
  [key: string]: string | number | undefined;
}

/** Real 2-year quarterly median price/sqm trend from frozen completed-sale
 * evidence only -- no synthetic points, no forecasting (see
 * lib/executiveVisuals.ts deriveQuarterlySoldTrend, which already omits any
 * quarter with too few usable transactions rather than inventing one). */
export default function MarketTrendChart({ series }: Props) {
  const quarterOrder = [...new Set(series.flatMap((s) => s.points.map((p) => p.quarterKey)))].sort();
  const rows: ChartRow[] = quarterOrder.map((quarterKey) => {
    const row: ChartRow = { quarterKey, quarterLabel: quarterKey.replace("-", " ") };
    for (const s of series) {
      const point = s.points.find((p) => p.quarterKey === quarterKey);
      if (point) {
        row[s.family] = point.medianPricePerSqm;
        row[`${s.family}_count`] = point.transactionCount;
      }
    }
    return row;
  });

  const hasAnyData = rows.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold text-slate-900">מגמת מחיר למ״ר – עסקאות שבוצעו</h3>
        <p className="text-xs text-slate-500">חציון רבעוני מתוך עסקאות שנכללו במאגר השוק</p>
      </div>

      {hasAnyData ? (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="quarterLabel" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={{ stroke: "#cbd5e1" }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `₪${Math.round(v / 1000)}K`}
                width={45}
              />
              <Tooltip content={<TrendTooltip />} />
              {series.map((s) => (
                <Line
                  key={s.family}
                  type="monotone"
                  dataKey={s.family}
                  name={s.familyLabel}
                  stroke={FAMILY_COLORS[s.family]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-1 flex items-center gap-4 text-xs text-slate-500">
            {series.map((s) => (
              <span key={s.family} className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: FAMILY_COLORS[s.family] }} />
                {s.familyLabel}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-md bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">
          אין מספיק עסקאות רבעוניות עקביות להצגת מגמה כרגע.
        </p>
      )}
    </div>
  );
}

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; payload: ChartRow }[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-slate-900">{label}</div>
      {payload.map((p) => {
        const familyLabel = p.dataKey === "3R" ? "3 חדרים" : "5 חדרים";
        const count = p.payload[`${p.dataKey}_count`];
        return (
          <div key={p.dataKey} className="text-slate-600">
            <span className="font-medium text-slate-800">{familyLabel}</span> · חציון: {ils(p.value)} למ״ר
            {count != null && <> · עסקאות: {count}</>}
          </div>
        );
      })}
    </div>
  );
}
