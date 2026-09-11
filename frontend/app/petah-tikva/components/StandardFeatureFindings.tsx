"use client";

import { useState } from "react";
import { StandardAttributeEnrichmentFamily } from "@/lib/api";
import { ils } from "@/lib/format";
import { floorEvidenceForFamily, FloorPairSummary } from "@/lib/researchContext";

interface Props {
  family: StandardAttributeEnrichmentFamily;
  familyKey: "standard_3r" | "standard_5r";
}

const INSUFFICIENT_BASIS = "לא נמצא בסיס מספיק לכימות כספי";

/** "מה מצאנו לגבי מאפייני הדירה?" -- standard-drawer section (task
 * "Focused Batch — Integrate New Research Evidence" items 1-5). Reads the
 * already-frozen, already-canonical workspace.standard_attribute_enrichment
 * (see lib/researchContext.ts) -- no new backend data for this section, only
 * a compact drawer-specific presentation of what already existed. Floor
 * gets real matched observational pairs; every other attribute gets the
 * same honest "insufficient basis to quantify" line -- never "no effect"
 * (task item 4: that is not what the research establishes). */
export default function StandardFeatureFindings({ family, familyKey }: Props) {
  const { primary, secondary } = floorEvidenceForFamily(family, familyKey);
  const [showFloorEvidence, setShowFloorEvidence] = useState(false);

  return (
    <section className="rounded-md border border-slate-200 p-3">
      <div className="mb-2 text-sm font-semibold text-slate-800">מה מצאנו לגבי מאפייני הדירה?</div>

      {/* Distinction legend (task item 5) -- shown once, applies to every row below. */}
      <div className="mb-2 grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 rounded bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">
        <span></span>
        <span className="text-end">מאפיין ידוע</span>
        <span className="text-end">ראיה תצפיתית</span>
        <span className="text-end">כלל כספי מאומת</span>
        <span className="text-slate-700">קומה</span>
        <span className="text-end">כן</span>
        <span className="text-end">{primary ? "כן" : "לא"}</span>
        <span className="text-end">לא</span>
        <span className="text-slate-700">כיוון אוויר</span>
        <span className="text-end">לעיתים</span>
        <span className="text-end">לא</span>
        <span className="text-end">לא</span>
      </div>

      <div className="flex flex-col gap-1.5">
        {/* קומה */}
        <div className="rounded border border-slate-200 p-2">
          {primary ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-slate-800">קומה</div>
                  <p className="text-xs text-slate-500">נמצאו תצפיות השוואתיות</p>
                </div>
                <button onClick={() => setShowFloorEvidence((v) => !v)} className="text-xs text-slate-500 underline hover:text-slate-800">
                  {showFloorEvidence ? "הסתרת ראיות" : "הצג ראיות"}
                </button>
              </div>
              {showFloorEvidence && (
                <div className="mt-2 flex flex-col gap-3 border-t border-slate-100 pt-2">
                  <FloorPairCard pair={primary} />
                  {secondary.length > 0 && <SecondaryFloorObservations pairs={secondary} />}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-slate-800">קומה</div>
              <p className="text-xs text-slate-500">{INSUFFICIENT_BASIS}</p>
            </>
          )}
        </div>

        <FeatureRow label="כיוון אוויר" />
        <FeatureRow label="מרפסת" />
        <FeatureRow label="חניה" />
        <FeatureRow label="מחסן" />
      </div>
    </section>
  );
}

function FeatureRow({ label }: { label: string }) {
  return (
    <div className="rounded border border-slate-200 p-2">
      <div className="text-sm font-medium text-slate-800">{label}</div>
      <p className="text-xs text-slate-500">{INSUFFICIENT_BASIS}</p>
    </div>
  );
}

function FloorPairCard({ pair }: { pair: FloorPairSummary }) {
  const maxPrice = Math.max(...pair.observations.map((o) => o.priceIls), 1);
  return (
    <div>
      <div className="text-sm font-semibold text-slate-800">{pair.address}</div>
      {pair.matchBasis && <p className="mt-0.5 text-[11px] text-slate-400">{pair.matchBasis}</p>}

      {/* Compact bar visualization (task item 19) -- one row per floor,
          width proportional to price, no charting library. */}
      <div className="mt-2 flex flex-col gap-1.5">
        {pair.observations.map((o, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-14 shrink-0 text-slate-600">קומה {o.floor}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-sm bg-slate-100">
              <div className="h-full rounded-sm bg-slate-500" style={{ width: `${Math.max(8, (o.priceIls / maxPrice) * 100)}%` }} />
            </div>
            <span className="w-24 shrink-0 text-end font-medium tabular-nums text-slate-900">{ils(o.priceIls)}</span>
          </div>
        ))}
      </div>

      {pair.observedDifferenceIls != null && (
        <p className="mt-1.5 text-xs text-slate-600">
          פער נצפה: <span className="font-semibold tabular-nums">{pair.observedDifferenceIls >= 0 ? "+" : ""}{ils(pair.observedDifferenceIls)}</span>
          <span className="text-slate-400"> · לא מיוחס אוטומטית לקומה</span>
        </p>
      )}

      <div className="mt-2 rounded bg-slate-50 p-2 text-xs">
        <p className="text-slate-700">
          <span className="font-semibold">מה ניתן להסיק? </span>
          נמצא פער מחיר בין שתי עסקאות דומות מאוד.
        </p>
        <p className="mt-1 text-slate-700">
          <span className="font-semibold">מה לא ניתן להסיק? </span>
          לא ניתן לייחס את מלוא הפער לקומה בלבד, מכיוון שכיוון, מרפסת, חניה, מחסן, מצב הדירה והדגם המדויק אינם ידועים.
        </p>
      </div>

      {pair.qaNote && <p className="mt-1.5 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">{pair.qaNote}</p>}

      <span className="mt-2 inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
        ראיה תצפיתית · לא נגזר ממנה כלל כספי אוטומטי
      </span>
    </div>
  );
}

function SecondaryFloorObservations({ pairs }: { pairs: FloorPairSummary[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="text-xs text-slate-500 underline hover:text-slate-800">
        {open ? "הסתרת תצפיות נוספות" : "הצג תצפיות נוספות"}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-3">
          {pairs.map((p, i) => (
            <div key={i} className="rounded border border-slate-100 p-2">
              <div className="text-xs font-semibold text-slate-700">{p.address}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                {p.observations.map((o, j) => (
                  <span key={j}>
                    קומה {o.floor} → <span className="font-medium text-slate-800">{ils(o.priceIls)}</span>
                  </span>
                ))}
              </div>
              <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                ראיה תצפיתית · לא נגזר ממנה כלל כספי אוטומטי
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
