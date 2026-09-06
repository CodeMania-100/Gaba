"use client";

import { useEffect, useState } from "react";
import { api, JsonRecord } from "@/lib/api";
import { CONFIDENCE_LABELS } from "@/lib/family";
import { ils, num, dateIL } from "@/lib/format";

interface Props {
  scenarioId: string;
  unitNumber: string;
  onClose: () => void;
}

const LANE_LABELS: Record<string, { title: string; subtitle: string }> = {
  sold: { title: "עסקאות שהושלמו", subtitle: "מה קונים שילמו בפועל" },
  current_asking: { title: "היצע נוכחי", subtitle: "מה מוצג לקונים היום" },
  new_development: { title: "פרויקטים חדשים מתחרים", subtitle: "חלופות ישירות מיזמים" },
};

export default function UnitEvidenceModal({ scenarioId, unitNumber, onClose }: Props) {
  const [data, setData] = useState<JsonRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getUnitEvidence(scenarioId, unitNumber)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [scenarioId, unitNumber]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div
        className="mt-8 w-full max-w-4xl rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">דירה {unitNumber} — ראיות ותמחור</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            סגירה ✕
          </button>
        </div>

        <div className="max-h-[80vh] overflow-y-auto px-6 py-4">
          {loading && <p className="text-slate-500">טוען...</p>}

          {!loading && (!data || data.status !== "priced") && (
            <p className="text-slate-500">אין עדיין נתוני תמחור עבור דירה זו בתרחיש הנוכחי. יש לבצע תמחור תחילה.</p>
          )}

          {!loading && data && data.status === "priced" && <EvidenceBody data={data} />}
        </div>
      </div>
    </div>
  );
}

function EvidenceBody({ data }: { data: JsonRecord }) {
  const market = data.market_range as JsonRecord;
  const pricing = data.pricing as JsonRecord | null;
  const candidates = (data.candidate_records as JsonRecord[]) ?? [];
  const reference = (data.secondary_reference_records as JsonRecord[]) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-md bg-slate-50 p-4">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="font-semibold">
            טווח שוק נתמך:{" "}
            {market.supported_range?.lower != null
              ? `${ils(market.supported_range.lower)} – ${ils(market.supported_range.upper)}`
              : "אין קונצנזוס"}
          </span>
          <span>ביטחון: {CONFIDENCE_LABELS[market.confidence] ?? market.confidence}</span>
          {pricing?.proposed_list_price_ils != null && (
            <span className="font-semibold text-slate-900">מחיר מוצע: {ils(pricing.proposed_list_price_ils)}</span>
          )}
        </div>
        {pricing?.decision_trace && (
          <ul className="mt-2 list-inside list-disc text-xs text-slate-600">
            {(pricing.decision_trace as string[]).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        )}
      </section>

      {(["sold", "current_asking", "new_development"] as const).map((lane) => (
        <LaneSection key={lane} lane={lane} candidates={candidates.filter((c) => c.lane === lane)} />
      ))}

      {reference.length > 0 && (
        <section>
          <h3 className="font-semibold text-slate-900">ראיות משניות — לא נכללות בחישוב הטווח</h3>
          <p className="mb-2 text-xs text-slate-500">יד2, XPLAN ורישום בנייה מוצגים כאן כהקשר תומך בלבד.</p>
          <div className="flex flex-col gap-2">
            {reference.slice(0, 12).map((r) => (
              <div key={r.id} className="rounded border border-slate-200 p-2 text-xs text-slate-600">
                <span className="font-medium">{r.source_type}</span>
                {r.address && <> · {r.address}</>}
                {r.price != null && <> · {ils(r.price)}</>}
                {r.project_name && <> · {r.project_name}</>}
              </div>
            ))}
            {reference.length > 12 && <p className="text-xs text-slate-400">ועוד {reference.length - 12} רשומות...</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function LaneSection({ lane, candidates }: { lane: keyof typeof LANE_LABELS; candidates: JsonRecord[] }) {
  const info = LANE_LABELS[lane];
  const included = candidates.filter((c) => c.included);
  const excluded = candidates.filter((c) => !c.included);

  return (
    <section>
      <h3 className="font-semibold text-slate-900">{info.title}</h3>
      <p className="mb-2 text-xs text-slate-500">{info.subtitle}</p>

      {included.length === 0 && <p className="text-sm text-slate-500">אין ראיה כלולה בקטגוריה זו עבור יחידה זו.</p>}

      <div className="flex flex-col gap-2">
        {included
          .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
          .map((c, i) => (
            <EvidenceRow key={i} candidate={c} included />
          ))}
      </div>

      {excluded.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-500">
            {excluded.length} רשומות נוספות נבדקו ולא נכללו
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {excluded.slice(0, 20).map((c, i) => (
              <EvidenceRow key={i} candidate={c} included={false} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function EvidenceRow({ candidate, included }: { candidate: JsonRecord; included: boolean }) {
  const ev = candidate.evidence as JsonRecord | null;
  return (
    <div
      className={`rounded-md border p-3 text-sm ${included ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${included ? "bg-emerald-600 text-white" : "bg-slate-400 text-white"}`}>
          {included ? "נכלל" : "לא נכלל"}
        </span>
        {candidate.rank && <span className="text-xs text-slate-500">דירוג #{candidate.rank}</span>}
        {ev?.address && <span className="font-medium">{ev.address}</span>}
        {ev?.project_name && <span className="font-medium">{ev.project_name}</span>}
      </div>
      {ev && (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
          {ev.price != null && <span>מחיר: {ils(ev.price)}</span>}
          {ev.rooms != null && <span>חדרים: {num(ev.rooms, 0)}</span>}
          {ev.area != null && <span>שטח: {num(ev.area)} מ״ר</span>}
          {ev.floor != null && <span>קומה: {ev.floor}</span>}
          {ev.event_date && <span>תאריך: {dateIL(ev.event_date)}</span>}
          {ev.distance_m != null && <span>מרחק: {num(ev.distance_m, 0)} מ׳</span>}
          {ev.quality_status && <span>איכות: {ev.quality_status}</span>}
        </div>
      )}
      <div className="mt-1 text-xs text-slate-500">{(candidate.reasons as string[]).join(" · ")}</div>
    </div>
  );
}
