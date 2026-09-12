"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, Scatter, ScatterChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { CompletedSaleObservation, CompletedSalesOverview } from "@/lib/executiveVisuals";
import { ils, num } from "@/lib/format";

interface Props {
  overview: CompletedSalesOverview;
}

const FAMILY_COLORS: Record<string, string> = { "3R": "#9c7a3c", "5R": "#6b7a4f" };
const FAMILY_LABELS: Record<string, string> = { "3R": "3 חדרים", "5R": "5 חדרים" };

interface ChartRow {
  quarterKey: string;
  quarterLabel: string;
  "3R"?: number;
  "3R_count"?: number;
  "5R"?: number;
  "5R_count"?: number;
  [key: string]: string | number | undefined;
}

const FALLBACK_TITLE = 'עסקאות שבוצעו — מחיר למ"ר';
const FALLBACK_SUBTITLE = "עסקאות 3 ו־5 חדרים ששימשו כראיות שוק";

/** Real completed-sale evidence only (workspace.evidence_provenance.sold.
 * {3R,5R}.records, quality_status "usable") -- no current asking, starting
 * prices, historical marketing, or context-only evidence, and no pricing
 * range is recomputed here (see lib/executiveVisuals.ts
 * deriveCompletedSalesOverview). "insufficient_for_trend != no_data": a
 * context with real but thin evidence renders individual observations or a
 * date scatter instead of the old "not enough data" message -- the true
 * empty state only fires when there are zero valid completed-sale records. */
export default function MarketTrendChart({ overview }: Props) {
  if (overview.mode === "empty") {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="font-heading text-base font-semibold text-ink">{FALLBACK_TITLE}</h3>
          <p className="text-xs text-ink-muted">{FALLBACK_SUBTITLE}</p>
        </div>
        <p className="rounded-md bg-canvas px-3 py-6 text-center text-sm text-ink-muted">
          לא נמצאו עסקאות שבוצעו המשמשות כראיות שוק עבור הקשר זה.
        </p>
      </div>
    );
  }

  if (overview.mode === "quarterly_trend") {
    return <QuarterlyTrendView overview={overview} />;
  }

  if (overview.mode === "single_quarter") {
    return <SingleQuarterView overview={overview} />;
  }

  return <ScatterView overview={overview} />;
}

function QuarterlyTrendView({ overview }: { overview: CompletedSalesOverview }) {
  const series = overview.quarterlySeries;
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

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-heading text-base font-semibold text-ink">מגמת מחיר למ״ר – עסקאות שבוצעו</h3>
        <p className="text-xs text-ink-muted">חציון רבעוני מתוך עסקאות ששימשו כראיות שוק</p>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e3ddcf" vertical={false} />
            <XAxis dataKey="quarterLabel" tick={{ fontSize: 11, fill: "#6b6459" }} axisLine={{ stroke: "#e3ddcf" }} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11, fill: "#6b6459" }}
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
        <div className="mt-1 flex items-center gap-4 text-xs text-ink-muted">
          {series.map((s) => (
            <span key={s.family} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: FAMILY_COLORS[s.family] }} />
              {s.familyLabel}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Exactly one distinct quarter of evidence -- never presented as a "trend"
 * (a single point can't show movement), just the real observations that
 * occurred, their combined median, and the count. */
function SingleQuarterView({ overview }: { overview: CompletedSalesOverview }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-heading text-base font-semibold text-ink">{FALLBACK_TITLE}</h3>
        <p className="text-xs text-ink-muted">{FALLBACK_SUBTITLE}</p>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-md bg-canvas px-3 py-2 text-sm">
        <span className="font-medium text-ink">{overview.quarterLabel}</span>
        <span className="text-ink-muted">
          חציון: <b className="text-ink">{ils(overview.medianPricePerSqm)}</b> למ״ר
        </span>
        <span className="text-ink-muted">
          עסקאות: <b className="text-ink">{overview.transactionCount}</b>
        </span>
      </div>

      <ObservationList observations={overview.observations} />
    </div>
  );
}

/** Valid completed-sale evidence exists but doesn't bucket cleanly into >=2
 * quarters (e.g. missing/unparsable dates) -- shown transaction-by-transaction
 * against real dates instead of being hidden. */
function ScatterView({ overview }: { overview: CompletedSalesOverview }) {
  const points = overview.observations
    .filter((o) => o.date != null)
    .map((o) => ({ ...o, t: new Date(o.date as string).getTime() }));
  const undated = overview.observations.filter((o) => o.date == null);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-heading text-base font-semibold text-ink">{FALLBACK_TITLE}</h3>
        <p className="text-xs text-ink-muted">{FALLBACK_SUBTITLE}</p>
      </div>

      {points.length > 0 && (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3ddcf" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v: number) => new Date(v).toLocaleDateString("he-IL", { year: "2-digit", month: "short" })}
                tick={{ fontSize: 11, fill: "#6b6459" }}
                axisLine={{ stroke: "#e3ddcf" }}
                tickLine={false}
              />
              <YAxis
                dataKey="pricePerSqm"
                tick={{ fontSize: 11, fill: "#6b6459" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `₪${Math.round(v / 1000)}K`}
                width={45}
              />
              <ZAxis range={[60, 60]} />
              <Tooltip content={<ScatterTooltip />} />
              {overview.medianPricePerSqm != null && (
                <ReferenceLine y={overview.medianPricePerSqm} stroke="#9c8f74" strokeDasharray="4 4" />
              )}
              {(["3R", "5R"] as const).map((fam) => (
                <Scatter key={fam} name={FAMILY_LABELS[fam]} data={points.filter((p) => p.family === fam)} fill={FAMILY_COLORS[fam]} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
          <div className="mt-1 flex items-center gap-4 text-xs text-ink-muted">
            {(["3R", "5R"] as const).map((fam) => (
              <span key={fam} className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: FAMILY_COLORS[fam] }} />
                {FAMILY_LABELS[fam]}
              </span>
            ))}
            {overview.medianPricePerSqm != null && <span>חציון כולל: {ils(overview.medianPricePerSqm)} למ״ר</span>}
          </div>
        </div>
      )}

      {undated.length > 0 && <ObservationList observations={undated} />}
    </div>
  );
}

function ObservationList({ observations }: { observations: CompletedSaleObservation[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {observations.map((o, i) => (
        <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-hairline px-3 py-1.5 text-xs">
          <span className="flex items-center gap-2">
            <span
              className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium text-surface"
              style={{ backgroundColor: FAMILY_COLORS[o.family] }}
            >
              {FAMILY_LABELS[o.family]}
            </span>
            <span className="text-ink-muted">{o.address ?? "כתובת לא צוינה"}</span>
          </span>
          <span className="flex items-center gap-3 text-ink-muted">
            {o.areaSqm != null && <span>{num(o.areaSqm)} מ״ר</span>}
            <span className="font-medium text-ink">{ils(o.pricePerSqm)} למ״ר</span>
            {o.priceIls != null && <span className="text-ink-muted/70">({ils(o.priceIls)})</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; payload: ChartRow }[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-semibold text-ink">{label}</div>
      {payload.map((p) => {
        const familyLabel = FAMILY_LABELS[p.dataKey] ?? p.dataKey;
        const count = p.payload[`${p.dataKey}_count`];
        return (
          <div key={p.dataKey} className="text-ink-muted">
            <span className="font-medium text-ink">{familyLabel}</span> · חציון: {ils(p.value)} למ״ר
            {count != null && <> · עסקאות: {count}</>}
          </div>
        );
      })}
    </div>
  );
}

function ScatterTooltip({ active, payload }: { active?: boolean; payload?: { payload: CompletedSaleObservation & { t: number } }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const o = payload[0].payload;
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-ink">{FAMILY_LABELS[o.family]}</div>
      <div className="text-ink-muted">{o.address ?? "כתובת לא צוינה"}</div>
      <div className="text-ink-muted">{ils(o.pricePerSqm)} למ״ר</div>
      {o.date && <div className="text-ink-muted/70">{o.date}</div>}
    </div>
  );
}
