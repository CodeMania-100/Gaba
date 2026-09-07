"use client";

import { PtkLaneRange } from "@/lib/api";
import { CONFIDENCE_COLORS, CONFIDENCE_LABELS, LANE_LABELS, translateWarning } from "@/lib/family";
import { ils } from "@/lib/format";

interface Props {
  lane: "sold" | "current_asking" | "new_development";
  data: PtkLaneRange;
  onClick: () => void;
}

export default function EvidenceCard({ lane, data, onClick }: Props) {
  const info = LANE_LABELS[lane];
  const hasRange = data.range.lower != null;
  const referenceCount = data.reference_records?.length ?? 0;

  return (
    <button
      onClick={onClick}
      className="flex h-full flex-col items-start gap-2 rounded-lg border border-slate-300 bg-white p-4 text-start transition hover:border-slate-400 hover:shadow-sm"
    >
      <div className="flex w-full items-center justify-between">
        <div>
          <div className="font-semibold text-slate-900">{info.title}</div>
          <div className="text-xs text-slate-400">{info.subtitle}</div>
        </div>
        <span className={`rounded px-2 py-1 text-xs font-medium ${CONFIDENCE_COLORS[data.confidence] ?? "bg-slate-100 text-slate-700"}`}>
          {CONFIDENCE_LABELS[data.confidence] ?? data.confidence}
        </span>
      </div>

      {hasRange ? (
        <div className="text-lg font-bold text-slate-900">
          {ils(data.range.lower)} – {ils(data.range.upper)}
        </div>
      ) : (
        <div className="text-sm font-semibold text-slate-500">אין מספיק מידע כדי לתמוך בטווח מחיר עצמאי</div>
      )}

      {hasRange && data.range.center != null && <div className="text-xs text-slate-500">חציון: {ils(data.range.center)}</div>}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span>
          {lane === "new_development"
            ? `${data.primary_contributor_count} פרויקטים עצמאיים השפיעו על הטווח`
            : `${data.primary_contributor_count} מקורות עצמאיים`}
        </span>
        <span className={data.can_enter_consensus ? "text-emerald-700" : "text-slate-500"}>
          {data.can_enter_consensus ? "✓ תומך בטווח המחיר" : "אינו תומך בטווח המחיר לבדו"}
        </span>
      </div>

      {referenceCount > 0 && (
        <div className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
          {hasRange
            ? `נאספו גם ${referenceCount} רשומות נוספות ששימשו כהקשר בלבד`
            : `יש מידע נוסף הזמין להשוואה בלבד (${referenceCount})`}
        </div>
      )}

      {data.warnings?.length > 0 && (
        <div className="w-full truncate text-xs text-amber-700" title={translateWarning(data.warnings[0])}>
          ⚠ {translateWarning(data.warnings[0])}
        </div>
      )}

      <div className="mt-auto w-full border-t border-slate-100 pt-1.5 text-[11px] text-slate-400">{info.helper}</div>
    </button>
  );
}
