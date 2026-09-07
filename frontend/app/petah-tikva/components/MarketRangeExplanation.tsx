"use client";

import { useState } from "react";
import { JsonRecord, PtkFamily } from "@/lib/api";
import { CONFIDENCE_LABELS, LANE_LABELS, confidenceExplanation } from "@/lib/family";
import { ils, num } from "@/lib/format";

interface Props {
  family: PtkFamily;
}

/** "How was this calculated?" drilldown for the standard market range.
 * Every number shown here is read straight from the family payload the
 * (unchanged) market-range engine already produced -- this component
 * performs no calculation of its own beyond picking one real normalization
 * example to display, and explains the formula without altering it. */
export default function MarketRangeExplanation({ family }: Props) {
  const [open, setOpen] = useState(false);

  const example = findNormalizationExample(family);

  return (
    <div className="mt-2">
      <button onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-blue-700 underline hover:text-blue-900">
        {open ? "הסתרת ההסבר" : "איך הגענו לטווח הזה?"}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div>
            <div className="text-xs font-semibold text-slate-500">א. אילו ערוצי ראיות שימשו</div>
            <p className="mt-0.5">
              {family.market.support_lanes.length > 0
                ? family.market.support_lanes.map((l) => LANE_LABELS[l]?.title ?? l).join(" · ")
                : "אין כרגע ערוץ נתמך."}
            </p>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500">ב. מה מכשיר רשומה להיכנס לחישוב</div>
            <p className="mt-0.5">
              עסקה/הצעה/פרויקט נכנס לחישוב רק אם הוא בגיאוגרפיית היעד המדויקת (או מסומן במפורש כהרחבה), תואם את מספר
              החדרים והשטח של המשפחה, ומקורו עצמאי (לא כפילות של אותה קבוצה/כתובת).
            </p>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500">ג. קיבוץ לעצמאות (Independence grouping)</div>
            <p className="mt-0.5">
              רשומות מאותו פרויקט/כתובת מקובצות ונספרות כתורם עצמאי אחד, כדי שריבוי מודעות/יחידות מאותו בניין לא יכביד
              יתר על המידה על הטווח.
            </p>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500">ד. נירמול שטח</div>
            <p className="mt-0.5">
              כאשר רשומת השוואה נמצאת בשטח שונה מיחידת היעד, המחיר מנורמל לפי הנוסחה:
            </p>
            <p className="mt-1 rounded bg-white px-2 py-1 font-mono text-xs">
              מחיר מנורמל = (מחיר משווה ÷ שטח משווה) × שטח יחידת היעד
            </p>
            {example && (
              <p className="mt-1 text-xs text-slate-600">
                דוגמה אמיתית מהראיות: {example.group_key} — {ils(example.representative_observed_price)} ÷{" "}
                {num(example.representative_observed_area)} מ״ר × {num(family.target.internal_area)} מ״ר ={" "}
                {ils(example.target_equivalent_indication)}
              </p>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500">ה. איך כל ערוץ הפיק טווח משלו</div>
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {(["sold", "current_asking", "new_development"] as const).map((lane) => {
                const l = family.evidence_lanes[lane];
                if (l.range.lower == null) return null;
                return (
                  <li key={lane}>
                    {LANE_LABELS[lane]?.title ?? lane}: {ils(l.range.lower)} – {ils(l.range.upper)} (
                    {l.primary_contributor_count} תורמים עצמאיים)
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500">ו. איך נוצר הטווח הנתמך מהחפיפה בין הערוצים</div>
            <p className="mt-0.5">
              הטווח הנתמך הוא אזור החפיפה בין ערוצי הראיות שנכנסו לקונצנזוס:{" "}
              {family.market.supported_lower != null ? (
                <>
                  {ils(family.market.supported_lower)} – {ils(family.market.supported_upper)}
                </>
              ) : (
                "אין כרגע חפיפה מספקת."
              )}
            </p>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500">ז. מדוע רמת הביטחון {CONFIDENCE_LABELS[family.market.confidence] ?? family.market.confidence}</div>
            <p className="mt-0.5">{confidenceExplanation(family.market.confidence, family.market.support_lanes.length)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function findNormalizationExample(family: PtkFamily): JsonRecord | null {
  for (const lane of ["sold", "new_development", "current_asking"] as const) {
    const contributors = family.evidence_lanes[lane].primary_contributors ?? [];
    const withExample = contributors.find(
      (c: JsonRecord) =>
        (c.reasons as string[] | undefined)?.includes("area_normalized_using_observed_price_per_sqm") &&
        c.target_equivalent_indication != null
    );
    if (withExample) return withExample;
  }
  return null;
}
