"use client";

import { ils, num } from "@/lib/format";
import { HighConfidenceListingLink, HistoricalDuplexContext, TriplexContextCard } from "@/lib/researchContext";

/** "טריפלקסים שנמצאו בשוק" -- Apt36/37 (task item 7). Collapsed by default;
 * every card is explicitly marked context-only, never a participating
 * comparable, and no price/area/typology here ever feeds the chart or the
 * calculation (see lib/researchContext.ts's address-matched extraction). */
export function TriplexContextSection({ cards }: { cards: TriplexContextCard[] }) {
  if (cards.length === 0) return null;
  return (
    <details className="rounded-md border border-slate-200">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        טריפלקסים שנמצאו בשוק
      </summary>
      <div className="flex flex-col gap-2 border-t border-slate-100 px-3 py-3">
        {cards.map((c, i) => (
          <div key={i} className="rounded border border-slate-200 p-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-slate-800">{c.address}</span>
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{c.propertyType}</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {c.rooms != null && `${typeof c.rooms === "number" ? num(c.rooms) : c.rooms} חדרים`}
              {c.areaSqm != null && ` · כ-${num(c.areaSqm)} מ״ר`}
            </p>
            <span className="mt-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              הקשר לסוג הנכס · לא השתתף בחישוב המחיר
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

/** "הקשר היסטורי לסוג הנכס" -- Apt38 (task item 12): the old, unlinked 7R
 * duplex press report. Shown only as physical-product context -- no price,
 * matching the task's own example (only rooms/area/type are given). */
export function HistoricalDuplexContextSection({ context }: { context: HistoricalDuplexContext | null }) {
  if (!context) return null;
  return (
    <details className="rounded-md border border-slate-200">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        הקשר היסטורי לסוג הנכס
      </summary>
      <div className="border-t border-slate-100 px-3 py-3 text-sm">
        <div className="font-medium text-slate-800">{context.address}</div>
        <p className="mt-0.5 text-xs text-slate-500">
          {context.rooms != null && `${num(context.rooms)} חדרים`}
          {context.internalAreaSqm != null && ` · כ-${num(context.internalAreaSqm)} מ״ר`}
          {context.outdoorAreaSqm != null && ` · כ-${num(context.outdoorAreaSqm)} מ״ר מרפסת/שטח חוץ`}
          {` · ${context.propertyType}`}
        </p>
        <span className="mt-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          עסקה היסטורית מדווחת · הקשר בלבד
        </span>
        {context.reason && <p className="mt-1.5 text-[11px] text-slate-400">{context.reason}</p>}
      </div>
    </details>
  );
}

/** Mivtza Dekel 14 enriched card -- Apt39 (task items 10-11). Two explicitly
 * separate columns: the real Tax transaction vs. the high-confidence-linked
 * historical listing. The listing's attributes (balcony/storage/parking/
 * elevator) are never merged into the Tax column -- attribute_transfer_
 * allowed=false in the source research, so they render only on their own
 * side, purely as candidate context. */
export function HighConfidenceLinkCard({ link }: { link: HighConfidenceListingLink | null }) {
  if (!link) return null;
  const t = link.taxRecord;
  const l = link.linkedListing;
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">{link.address}</span>
        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">קישור בסבירות גבוהה למודעה היסטורית</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded bg-slate-50 p-2">
          <div className="mb-1 text-[11px] font-semibold text-slate-500">עסקת רשות המסים</div>
          <dl className="flex flex-col gap-0.5 text-xs text-slate-700">
            {t.rooms != null && <Row k="חדרים" v={num(t.rooms)} />}
            {t.areaSqm != null && <Row k="שטח" v={`${num(t.areaSqm)} מ״ר`} />}
            {t.floorConfiguration != null && <Row k="קומות" v={t.floorConfiguration} />}
            {t.priceIls != null && <Row k="מחיר" v={ils(t.priceIls)} />}
          </dl>
        </div>
        <div className="rounded bg-slate-50 p-2">
          <div className="mb-1 text-[11px] font-semibold text-slate-500">מודעה היסטורית מקושרת</div>
          <dl className="flex flex-col gap-0.5 text-xs text-slate-700">
            {l.floorConfiguration != null && <Row k="קומות" v={l.floorConfiguration} />}
            {l.balconyAreaSqm != null && <Row k="מרפסת" v={`${num(l.balconyAreaSqm)} מ״ר`} />}
            {l.storageAreaSqm != null && <Row k="מחסן" v={`${num(l.storageAreaSqm)} מ״ר`} />}
            {l.hasParking != null && <Row k="חניה" v={l.hasParking ? "קיימת" : "אין"} />}
            {l.hasElevator != null && <Row k="מעלית" v={l.hasElevator ? "קיימת" : "אין"} />}
          </dl>
        </div>
      </div>

      <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
        הקישור חזק, אך לא קיים מזהה יחידה משותף שמוכיח בוודאות שמדובר באותה דירה. פרטי המודעה (מרפסת, מחסן, חניה,
        מעלית) אינם מיוחסים באופן אוטומטי לעסקת רשות המסים.
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-medium text-slate-900">{v}</dd>
    </div>
  );
}
