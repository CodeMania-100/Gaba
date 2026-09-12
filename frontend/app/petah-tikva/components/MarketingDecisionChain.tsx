"use client";

import { useState } from "react";
import { PtkPriceListRow } from "@/lib/api";
import { CONFIDENCE_LABELS, roomsOf, unitTypeLabel } from "@/lib/family";
import { ils, num, rangeOrPoint } from "@/lib/format";
import { ConsistencyFinding } from "@/lib/priceListConsistency";
import {
  computePriceBreakdown,
  EMPTY_ADJUSTMENT,
  familyBucketOf,
  FAMILY_BUCKET_LABELS,
  GROUP_ADJUSTMENT_HELPER,
  GROUP_ADJUSTMENT_LABEL,
  MarketingStrategyState,
  PROJECT_ADJUSTMENT_HELPER,
  PROJECT_ADJUSTMENT_LABEL,
  StrategyAdjustment,
  UNIT_ADJUSTMENT_HELPER,
  UNIT_ADJUSTMENT_LABEL,
} from "@/lib/marketingStrategy";
import StepHeading from "./StepHeading";
import PricingWaterfall from "./PricingWaterfall";
import { deriveWaterfallSteps } from "@/lib/executiveVisuals";
import { buildMondayApprovalPayload, MondaySendResult, sendPricingApprovalToMonday } from "@/lib/mondayIntegration";

interface Props {
  row: PtkPriceListRow;
  state: MarketingStrategyState;
  onChange: (updater: (prev: MarketingStrategyState) => MarketingStrategyState) => void;
  confidence: string | null;
  isSpecial: boolean;
  marketRange: { lower: number | null; upper: number | null } | null;
  consistencyFinding: ConsistencyFinding | null;
}

/** Drawer block 4 -- "החלטת התמחור לדירה <unit>", built around one
 * question: how do we get from אינדיקציית שוק to מחיר שיווק מוצע? A single
 * unified רמה/התאמה/השפעה table lists every adjustment that actually
 * applies to this apartment. Shared identically by standard and special
 * units -- both already expose the same row.proposed_list_price_ils as
 * their "market indication" input, so this component never needs to know
 * which pricing route produced it. Uses computePriceBreakdown exactly as
 * before -- no new adjustment layer, no formula change, only display. */
export default function MarketingDecisionChain({ row, state, onChange, confidence, isSpecial, marketRange, consistencyFinding }: Props) {
  const [showFormula, setShowFormula] = useState(false);
  const bucket = familyBucketOf(row);
  const familyAdjustment = state.familyAdjustments[bucket] ?? EMPTY_ADJUSTMENT;
  const unitAdjustment = state.unitAdjustments[row.unit_number] ?? EMPTY_ADJUSTMENT;
  const breakdown = computePriceBreakdown(state, row);
  const { marketIndicationIls, proposedIls, totalPct } = breakdown;

  const pctEffect = (v: number) => (marketIndicationIls != null ? marketIndicationIls * (v / 100) : 0);
  const projectEffectIls = pctEffect(state.projectAdjustment.adjustment_pct);
  const familyEffectIls = pctEffect(familyAdjustment.adjustment_pct);
  const unitEffectIls = pctEffect(unitAdjustment.adjustment_pct);
  const totalEffectIls = proposedIls != null && marketIndicationIls != null ? proposedIls - marketIndicationIls : 0;

  return (
    <section className="rounded-lg border-2 border-ink/80 bg-gradient-to-b from-canvas to-surface p-4">
      <StepHeading n={4} title={`החלטת התמחור לדירה ${row.unit_number}`} />

      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-ink-muted">
        <span>מה השוק אומר</span>
        <span>←</span>
        <span>מה מאפיין את הדירה</span>
        <span>←</span>
        <span>מה החברה החליטה</span>
        <span>←</span>
        <span className="text-ink">מחיר מוצע</span>
      </div>

      <div className="mb-3">
        <div className="text-xs font-semibold text-ink-muted">מה השוק אומר — אינדיקציית שוק</div>
        <div className="text-2xl font-bold text-ink">{ils(marketIndicationIls)}</div>
        <p className="mt-0.5 text-[11px] text-ink-muted/70">
          אינדיקציית השוק קבועה ואינה משתנה מהתאמות אסטרטגיות — רק מחיר השיווק המוצע משתנה.
        </p>
      </div>

      <div className="mb-3 rounded-md bg-canvas px-2.5 py-2 text-xs text-ink-muted">
        <span className="font-semibold text-ink-muted">מה מאפיין את הדירה: </span>
        {[unitTypeLabel(row.family), roomsOf(row) != null ? `${roomsOf(row)} חדרים` : null, row.internal_area_sqm != null ? `${num(row.internal_area_sqm)} מ״ר` : null, row.orientation]
          .filter(Boolean)
          .join(" · ")}
        <span className="mt-0.5 block text-[11px] text-ink-muted/70">מוצג לצורך השוואה בלבד — פירוט מלא בסעיף 1 למעלה. מאפייני הדירה אינם משנים את המחיר אוטומטית.</span>
      </div>

      {/* ₪0 attribute-adjustment bridge -- never worded as "these features
          are worth zero", only that no verified standalone monetary
          coefficient exists for them yet. */}
      <div className="mb-3 rounded-md border border-dashed border-hairline px-2.5 py-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-ink-muted">+ התאמות מאפייני דירה שכומתו בנפרד</span>
          <span className="font-medium tabular-nums text-ink-muted/70">{ils(0)}</span>
        </div>
        <p className="mt-1 text-[11px] text-ink-muted/70">
          אין כיום בסיס נתונים מספיק לכימות כספי נפרד; המאפיינים מוצגים כראיות תומכות.
          {isSpecial && " ייתכן שמאפייני הדירה כבר משוקללים בתוך אינדיקציית השוק הפרטנית לדירה זו — ₪0 כאן משמעו ללא התאמה כספית מפורשת נוספת מעבר לאינדיקציה, לא שאין למאפיינים ערך."}
        </p>
      </div>

      <div className="mb-3">
        <div className="mb-1 text-sm font-semibold text-ink">מה החברה החליטה — התאמות מסחריות</div>

        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-2.5 pb-1 text-[11px] text-ink-muted/70">
          <span>רמה</span>
          <span className="text-end">התאמה</span>
          <span className="text-end">השפעה</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <RecapRow label="השפעת שלב הפרויקט על המחיר" pct={breakdown.phasePct} effectIls={breakdown.phaseEffectIls} />
          <RecapRow label="השפעת קצב המכירות על המחיר" pct={breakdown.salesProgressPct} effectIls={breakdown.salesProgressEffectIls} />
          <EditableAdjustmentRow
            levelLabel={PROJECT_ADJUSTMENT_LABEL}
            helperText={PROJECT_ADJUSTMENT_HELPER}
            value={state.projectAdjustment}
            onChange={(next) => onChange((prev) => ({ ...prev, projectAdjustment: next }))}
            effectIls={projectEffectIls}
          />
          <EditableAdjustmentRow
            levelLabel={GROUP_ADJUSTMENT_LABEL}
            groupName={FAMILY_BUCKET_LABELS[bucket]}
            helperText={GROUP_ADJUSTMENT_HELPER}
            value={familyAdjustment}
            onChange={(next) => onChange((prev) => ({ ...prev, familyAdjustments: { ...prev.familyAdjustments, [bucket]: next } }))}
            effectIls={familyEffectIls}
          />
          <EditableAdjustmentRow
            levelLabel={UNIT_ADJUSTMENT_LABEL}
            helperText={UNIT_ADJUSTMENT_HELPER}
            value={unitAdjustment}
            onChange={(next) => onChange((prev) => ({ ...prev, unitAdjustments: { ...prev.unitAdjustments, [row.unit_number]: next } }))}
            effectIls={unitEffectIls}
          />
        </div>
      </div>

      {/* Compact live summary -- shown even when every input is 0%, so it's
          clear the fields are live/operational, not hidden because the demo
          starts at zero. */}
      <div className="mb-3 flex items-center justify-between rounded-md bg-canvas px-3 py-2 text-sm">
        <span className="text-ink-muted">השפעה אסטרטגית כוללת</span>
        <span className={`font-semibold tabular-nums ${totalPct > 0 ? "text-supported" : totalPct < 0 ? "text-conflict" : "text-ink-muted"}`}>
          {totalPct > 0 ? "+" : ""}
          {totalPct}% · {totalEffectIls >= 0 ? "+" : ""}
          {ils(totalEffectIls)}
        </span>
      </div>

      <div className="rounded-md bg-surface p-3 text-center shadow-sm">
        <div className="text-xs text-ink-muted">מחיר שיווק מוצע</div>
        <div className="text-2xl font-bold text-ink">{ils(proposedIls)}</div>
        {marketIndicationIls != null && (
          <p className="mt-2 text-sm text-ink-muted">
            אינדיקציית שוק {ils(marketIndicationIls)}
            <br />+ התאמות מסחריות כוללות {totalPct > 0 ? "+" : ""}
            {totalPct}%<br />= מחיר שיווק מוצע {ils(proposedIls)}
          </p>
        )}
        {marketIndicationIls != null && totalPct !== 0 && (
          <>
            <button onClick={() => setShowFormula((v) => !v)} className="mt-2 text-xs text-ink-muted/70 underline hover:text-ink-muted">
              {showFormula ? "הסתרת פירוט חישוב" : "איך נבנה מחיר השיווק?"}
            </button>
            {showFormula && (
              <div className="mt-3 text-start">
                <PricingWaterfall steps={deriveWaterfallSteps(state, row)} />
                <p className="mt-2 border-t border-hairline pt-2 text-center font-mono text-xs text-ink-muted">
                  {ils(marketIndicationIls)} × (1 {totalPct >= 0 ? "+" : "−"} {Math.abs(totalPct)}%) = {ils(proposedIls)}
                </p>
              </div>
            )}
          </>
        )}

        {marketRange && (marketRange.lower != null || marketRange.upper != null) && (
          <p className="mt-2 text-xs text-ink-muted">
            טווח מומלץ: {rangeOrPoint(marketRange.lower, marketRange.upper)}
            {confidence && (
              <>
                {" · "}רמת ביטחון: {CONFIDENCE_LABELS[confidence] ?? confidence}
              </>
            )}
          </p>
        )}

        {consistencyFinding && (
          <p className={`mt-1 text-xs ${consistencyFinding.status === "needs_review" ? "font-medium text-warning" : "text-ink-muted"}`}>
            {consistencyFinding.status === "explained" ? "פער מוסבר מול דירה דומה" : "פער לבדיקה מול דירה דומה"} — פירוט בבדיקת עקביות המחירון
          </p>
        )}
      </div>

      {marketIndicationIls != null && proposedIls != null && (
        <SendToMondayApprovalButton row={row} state={state} breakdown={breakdown} confidence={confidence} />
      )}
    </section>
  );
}

/** States: idle -> "שלח לאישור ב-Monday", sending -> "שולח ל-Monday...",
 * sent -> "נשלח ל-Monday" + link to the board, error -> "לא ניתן היה לשלוח
 * ל-Monday" + retry. Never shows the raw backend/GraphQL error text. */
function SendToMondayApprovalButton({
  row,
  state,
  breakdown,
  confidence,
}: {
  row: PtkPriceListRow;
  state: MarketingStrategyState;
  breakdown: ReturnType<typeof computePriceBreakdown>;
  confidence: string | null;
}) {
  const [result, setResult] = useState<MondaySendResult | null>(null);
  const [sending, setSending] = useState(false);

  const send = async () => {
    const payload = buildMondayApprovalPayload(row, state, breakdown, confidence);
    if (!payload) return;
    setSending(true);
    setResult(null);
    const outcome = await sendPricingApprovalToMonday(payload);
    setSending(false);
    setResult(outcome);
  };

  return (
    <div className="mt-3 flex flex-col items-center gap-1.5 border-t border-hairline pt-3">
      <button
        onClick={send}
        disabled={sending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-surface hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {sending ? "שולח ל-Monday..." : result?.ok ? "נשלח ל-Monday" : "שלח לאישור ב-Monday"}
      </button>
      {result?.ok && (
        <a href={result.boardUrl} target="_blank" rel="noreferrer" className="text-xs text-ink-muted underline hover:text-ink">
          פתח את לוח האישור
        </a>
      )}
      {result && !result.ok && (
        <div className="flex items-center gap-2 text-xs text-conflict">
          <span>{result.reason === "not_configured" ? "החיבור ל-Monday אינו מוגדר" : "לא ניתן היה לשלוח ל-Monday"}</span>
          {result.reason === "failed" && (
            <button onClick={send} className="underline hover:opacity-80">
              נסה שוב
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Read-only recap of a project-wide adjustment that is edited elsewhere
 * (phase/sales-progress adjustments live in MarketingStrategyPanel, not
 * per-unit) -- still discoverable here, quieter when 0%. */
function RecapRow({ label, pct, effectIls }: { label: string; pct: number; effectIls: number | null }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md px-2.5 py-2 text-sm">
      <span className={pct !== 0 ? "text-ink" : "text-ink-muted/50"}>{label}</span>
      <span className={`text-end font-medium tabular-nums ${pct > 0 ? "text-supported" : pct < 0 ? "text-conflict" : "text-ink-muted/40"}`}>
        {pct !== 0 ? `${pct > 0 ? "+" : ""}${pct}%` : "0%"}
      </span>
      <span className={`text-end font-medium tabular-nums ${effectIls != null && effectIls > 0 ? "text-supported" : effectIls != null && effectIls < 0 ? "text-conflict" : "text-ink-muted/40"}`}>
        {effectIls ? `${effectIls > 0 ? "+" : ""}${ils(effectIls)}` : ils(0)}
      </span>
    </div>
  );
}

/** One editable commercial-adjustment level (project/family/unit). The row
 * itself always shows the level's current % and ₪ effect; clicking it
 * expands the % input and a rationale input visually tied to this same row
 * -- never a floating, ambiguous rationale field. */
function EditableAdjustmentRow({
  levelLabel,
  groupName,
  helperText,
  value,
  onChange,
  effectIls,
}: {
  levelLabel: string;
  groupName?: string;
  helperText?: string;
  value: StrategyAdjustment;
  onChange: (next: StrategyAdjustment) => void;
  effectIls: number;
}) {
  const [open, setOpen] = useState(value.adjustment_pct !== 0 || value.rationale !== "");

  return (
    <div className="rounded-md border border-hairline bg-surface">
      <button
        onClick={() => setOpen((v) => !v)}
        className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-2.5 py-2 text-start text-sm hover:bg-canvas"
      >
        <span>
          <span className="block font-medium text-ink">{levelLabel}</span>
          {groupName && <span className="block text-[11px] text-ink-muted">{groupName}</span>}
        </span>
        <span className={`text-end font-medium tabular-nums ${value.adjustment_pct > 0 ? "text-supported" : value.adjustment_pct < 0 ? "text-conflict" : "text-ink-muted/40"}`}>
          {value.adjustment_pct !== 0 ? `${value.adjustment_pct > 0 ? "+" : ""}${value.adjustment_pct}%` : "0%"}
        </span>
        <span className={`text-end font-medium tabular-nums ${effectIls > 0 ? "text-supported" : effectIls < 0 ? "text-conflict" : "text-ink-muted/40"}`}>
          {effectIls ? `${effectIls > 0 ? "+" : ""}${ils(effectIls)}` : ils(0)}
        </span>
      </button>
      {helperText && <p className="px-2.5 pb-1.5 text-[11px] text-ink-muted/70">{helperText}</p>}
      {open && (
        <div className="flex flex-col gap-2 border-t border-hairline px-2.5 py-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-ink-muted">התאמה</span>
            <input
              type="number"
              step={0.5}
              value={value.adjustment_pct}
              onChange={(e) => onChange({ ...value, adjustment_pct: Number(e.target.value) || 0 })}
              className="w-20 rounded-md border border-hairline px-2 py-1"
            />
            <span className="text-ink-muted">%</span>
          </label>
          <label className="flex items-start gap-2">
            <span className="w-14 shrink-0 pt-1 text-ink-muted">נימוק</span>
            <input
              type="text"
              value={value.rationale}
              onChange={(e) => onChange({ ...value, rationale: e.target.value })}
              placeholder='לדוגמה: "כיוון מערב ושטח חוץ גדול יותר"'
              className="flex-1 rounded-md border border-hairline px-2 py-1"
            />
          </label>
        </div>
      )}
    </div>
  );
}
