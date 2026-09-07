"use client";

import { useState } from "react";
import { SpecialUnitComparable, SpecialUnitIndication, SpecialUnitLaneResult } from "@/lib/api";
import { CONFIDENCE_COLORS, CONFIDENCE_LABELS } from "@/lib/family";
import { ils, isPointValue, num, rangeOrPoint } from "@/lib/format";

interface Props {
  indication: SpecialUnitIndication;
}

const LANE_TITLES: Record<string, string> = {
  sold: "עסקאות שבוצעו (רב-מפלסיות)",
  current_asking: "הצעות קיימות",
  new_development: "פרויקטים חדשים",
};

const TIER_LABELS: Record<string, string> = {
  tier_a_direct: "השוואה ישירה",
  tier_b_size_relaxed: "השוואה ישירה — הרחבת גודל/סוג לא מאומת",
  tier_c_broadened: "השוואת הקשר — טיפוס שונה",
};

/** Headline suggested-price card + full "איך חושב המחיר?" drilldown for one
 * special unit -- every number here is read straight from pricing_core.
 * special_market_indication's output; nothing is recomputed in the
 * frontend beyond simple display formatting and the area-diff percentage
 * (a plain subtraction, not a re-derivation of the price itself). */
export default function SpecialUnitCalculation({ indication }: Props) {
  const [open, setOpen] = useState(false);

  if (indication.suggested_price_ils == null) {
    return (
      <section className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        אין כרגע מספיק ראיות נומריות ליחידה זו כדי לחשב אינדיקציית מחיר.
      </section>
    );
  }

  return (
    <section className="rounded-md border border-slate-300 p-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-xs text-slate-500">מחיר מוצע (אינדיקציית שוק ליחידה)</div>
          <div className="text-2xl font-bold text-slate-900">{ils(indication.suggested_price_ils)}</div>
          {isPointValue(indication.indicative_lower_ils, indication.indicative_upper_ils) ? (
            <div className="mt-0.5 text-xs text-amber-700">אינדיקציה נקודתית — ערוץ ראיות מצביע יחיד, לא טווח</div>
          ) : (
            <div className="mt-0.5 text-xs text-slate-500">
              טווח אינדיקטיבי ליחידה: {rangeOrPoint(indication.indicative_lower_ils, indication.indicative_upper_ils)}
            </div>
          )}
        </div>
        <span className={`rounded px-2 py-1 text-xs font-medium ${CONFIDENCE_COLORS[indication.confidence] ?? ""}`}>
          {CONFIDENCE_LABELS[indication.confidence] ?? indication.confidence}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        זהו טווח אינדיקטיבי ליחידה מיוחדת בודדת, מבוסס על ראיות ייעודיות ליחידות מיוחדות בלבד — אינו זהה ואינו
        מתודולוגית זהה ל&quot;טווח שוק נתמך&quot; הסטנדרטי של משפחות 3R/5R.
      </p>

      <button onClick={() => setOpen((v) => !v)} className="mt-2 text-xs font-medium text-blue-700 underline hover:text-blue-900">
        {open ? "הסתרת ההסבר" : "איך חושב המחיר?"}
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-4 text-sm text-slate-700">
          <div>
            <div className="text-xs font-semibold text-slate-500">ערוצים שהצביעו בחישוב הסופי</div>
            <p className="mt-0.5">{indication.voting_lane_names.map((l) => LANE_TITLES[l] ?? l).join(" · ") || "—"}</p>
          </div>

          {(["sold", "current_asking", "new_development"] as const).map((laneName) => {
            const lane = indication.lanes[laneName];
            if (!lane) return null;
            const votes = indication.voting_lane_names.includes(laneName);
            return <LaneBlock key={laneName} title={LANE_TITLES[laneName]} lane={lane} votes={votes} />;
          })}

          <div className="rounded-md bg-slate-50 p-3">
            <div className="text-xs font-semibold text-slate-500">חישוב סופי</div>
            <p className="mt-1 font-mono text-xs">
              מחיר מוצע = חציון(
              {indication.voting_lane_names
                .map((name) => {
                  const lane = (indication.lanes as Record<string, SpecialUnitLaneResult | undefined>)[name];
                  return ils(lane?.reference_ils ?? null);
                })
                .join(", ")}
              ) = {ils(indication.suggested_price_ils)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {isPointValue(indication.indicative_lower_ils, indication.indicative_upper_ils)
                ? `ערוץ מצביע יחיד — אין טווח מינימום/מקסימום להציג, האינדיקציה היא נקודה בודדת: ${ils(
                    indication.indicative_lower_ils
                  )}`
                : `טווח אינדיקטיבי = [מינימום, מקסימום] של ערכי הערוצים המצביעים = [${ils(
                    indication.indicative_lower_ils
                  )}, ${ils(indication.indicative_upper_ils)}]`}
            </p>
          </div>

          {indication.excluded.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500">רשומות שהוחרגו לחלוטין מהחישוב ({indication.excluded.length})</div>
              <ul className="mt-1 flex flex-col gap-1">
                {indication.excluded.map((e, i) => (
                  <li key={i} className="rounded border border-slate-200 px-2 py-1 text-xs">
                    <span className="font-medium text-slate-800">[{e.lane}] {e.label}:</span> {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-500">
            הפרמטרים חצר/מרפסת, קומה, כיוון, חניה, מחסן, מצב הנכס ותנאי תשלום מוצגים כהבדלי מוצר בלבד — לא הוגדר
            עבורם כלל כספי מאומת, ולכן הם אינם משפיעים על החישוב הנומרי לעיל.
          </p>
        </div>
      )}
    </section>
  );
}

function LaneBlock({ title, lane, votes }: { title: string; lane: SpecialUnitLaneResult; votes: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 p-2">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <div className="text-sm font-semibold text-slate-800">{title}</div>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${votes ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
          {votes ? "משתתף בחישוב" : "לא משתתף בחישוב — הקשר בלבד"}
        </span>
      </div>
      <p className="text-xs text-slate-500">
        {lane.label} · {lane.calculation_method === "raw_price_median" ? "חציון מחירים גולמיים (ללא נירמול שטח)" : "חציון ערכים מנורמלים לשטח"}
      </p>

      <div className="mt-1 flex flex-col gap-1">
        {lane.comps_used.map((c, i) => (
          <ComparableLine key={i} c={c} method={lane.calculation_method} used />
        ))}
        {lane.comps_context_only.map((c, i) => (
          <ComparableLine key={`ctx-${i}`} c={c} method={lane.calculation_method} used={false} />
        ))}
      </div>

      <p className="mt-1 font-mono text-xs">
        חציון = {ils(lane.reference_ils)} (מתוך {lane.comps_used.length} רשומות שהצביעו)
      </p>
    </div>
  );
}

function ComparableLine({ c, method, used }: { c: SpecialUnitComparable; method: string; used: boolean }) {
  const areaDiffPct = (c.comparable_area_sqm - c.subject_area_sqm) / c.subject_area_sqm;
  return (
    <div className={`text-xs ${used ? "text-slate-700" : "text-slate-400"}`}>
      <span className="font-medium">{c.label}</span> · {TIER_LABELS[c.tier] ?? c.tier} · {ils(c.comparable_price_ils)} @{" "}
      {num(c.comparable_area_sqm)} מ״ר (הפרש שטח {(areaDiffPct * 100).toFixed(1)}%)
      {method === "area_normalized_median" && (
        <>
          {" "}
          → <span className="font-mono">{ils(c.comparable_price_ils)} × {num(c.subject_area_sqm)} ÷ {num(c.comparable_area_sqm)} = {ils(c.normalized_value_ils)}</span>
          {used && <span className="ms-1 text-slate-400">(התאמת שטח פנימי בלבד)</span>}
        </>
      )}
      {!used && <span className="ms-1">— הקשר בלבד, לא נכלל בחישוב</span>}
    </div>
  );
}
