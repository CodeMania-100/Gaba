"use client";

import { PtkLaneRange } from "@/lib/api";
import { CONFIDENCE_COLORS, CONFIDENCE_LABELS, LANE_LABELS, translateWarning } from "@/lib/family";
import { ils } from "@/lib/format";

interface Props {
  lane: "sold" | "current_asking" | "new_development";
  data: PtkLaneRange;
  onClick: () => void;
  // Display-only override for the lane title -- lib/family.ts's shared
  // LANE_LABELS constant stays untouched (it's also read by the unrelated
  // /w/[projectId]/... route); a caller that needs the exact spec wording
  // for "current_asking"/"new_development" passes it here instead.
  titleOverride?: string;
}

export default function EvidenceCard({ lane, data, onClick, titleOverride }: Props) {
  const info = LANE_LABELS[lane];
  const hasRange = data.range.lower != null;
  const referenceCount = data.reference_records?.length ?? 0;

  return (
    <button
      onClick={onClick}
      className="flex h-full flex-col items-start gap-2 rounded-md border border-hairline bg-surface p-4 text-start transition hover:border-accent/50 hover:shadow-sm"
    >
      <div className="flex w-full items-center justify-between">
        <div>
          <div className="font-semibold text-ink">{titleOverride ?? info.title}</div>
          <div className="text-xs text-ink-muted/70">{info.subtitle}</div>
        </div>
        <span className={`rounded px-2 py-1 text-xs font-medium ${CONFIDENCE_COLORS[data.confidence] ?? "bg-canvas text-ink-muted"}`}>
          {CONFIDENCE_LABELS[data.confidence] ?? data.confidence}
        </span>
      </div>

      {hasRange ? (
        <div className="text-lg font-bold text-ink">
          {ils(data.range.lower)} – {ils(data.range.upper)}
        </div>
      ) : (
        <div className="text-sm font-semibold text-ink-muted">אין מספיק מידע כדי לתמוך בטווח מחיר עצמאי</div>
      )}

      {hasRange && data.range.center != null && <div className="text-xs text-ink-muted">חציון: {ils(data.range.center)}</div>}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span>
          {lane === "new_development"
            ? `${data.primary_contributor_count} פרויקטים עצמאיים השפיעו על הטווח`
            : `${data.primary_contributor_count} מקורות עצמאיים`}
        </span>
        <span className={data.can_enter_consensus ? "text-supported" : "text-ink-muted"}>
          {data.can_enter_consensus ? "✓ תומך בטווח המחיר" : "אינו תומך בטווח המחיר לבדו"}
        </span>
      </div>

      {referenceCount > 0 && (
        <div className="rounded bg-warning/10 px-2 py-1 text-xs text-warning">
          {hasRange
            ? `נאספו גם ${referenceCount} רשומות נוספות ששימשו כהקשר בלבד`
            : `יש מידע נוסף הזמין להשוואה בלבד (${referenceCount})`}
        </div>
      )}

      {data.warnings?.length > 0 && (
        <div className="w-full truncate text-xs text-warning" title={translateWarning(data.warnings[0])}>
          ⚠ {translateWarning(data.warnings[0])}
        </div>
      )}

      <div className="mt-auto w-full border-t border-hairline pt-1.5 text-[11px] text-ink-muted/70">{info.helper}</div>
    </button>
  );
}
