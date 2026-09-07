"use client";

import { useState } from "react";
import { JsonRecord } from "@/lib/api";
import { ils, num } from "@/lib/format";

interface Props {
  records: JsonRecord[];
}

const CONTEXT_TYPE_LABELS: Record<string, string> = {
  garden_context: "הקשר גינות",
  triplex_context: "הקשר טריפלקס",
  duplex_context: "הקשר דופלקס",
  new_development_updates: "עדכון פרויקט חדש",
  qa_and_linkage: "בדיקת התאמה / איכות נתונים",
};

const CONTEXT_TYPE_COLORS: Record<string, string> = {
  garden_context: "bg-emerald-50 text-emerald-800",
  triplex_context: "bg-sky-50 text-sky-800",
  duplex_context: "bg-indigo-50 text-indigo-800",
  new_development_updates: "bg-amber-50 text-amber-900",
  qa_and_linkage: "bg-slate-200 text-slate-700",
};

/** Second badge: what kind of evidence this is, derived from the record's
 * own evidence_class / classification -- never an invented score. */
function kindBadge(record: JsonRecord): string | null {
  const tag = (record.evidence_class as string) ?? (record.classification as string) ?? "";
  if (tag.includes("HIGH_CONFIDENCE_UNIT_LINK")) return "קישור טיפולוגי בביטחון גבוה";
  if (tag === "SAME_ADDRESS_AMBIGUOUS" || record.metadata_conflict || record.property_form_conflict) return "התנגשות נתונים";
  if (tag === "NO_MATCH" || tag === "NOT_FOUND" || record.status === "searched_no_defensible_match") return "פער מחקר מאומת";
  if (tag.includes("STARTING") || tag.includes("DEVELOPER_PRODUCT")) return "מחיר פתיחה בפרויקט חדש";
  if (record.source_type === "archived_asking" || tag.includes("ARCHIVED_ASKING")) return "מודעת ארכיון";
  if (record.tax_record || record.normalized?.tax_deal_id) return "עסקה רשומה";
  return "השוואה תצפיתית";
}

/** Reads either R1's flat schema or R2's nested `normalized` schema (and R2's
 * linkage-attempt schema with tax_record/listing_record) into one common set
 * of display fields. Never guesses a value that isn't explicitly present. */
function extractFields(record: JsonRecord) {
  const n = (record.normalized as JsonRecord) ?? {};
  const tax = (record.tax_record as JsonRecord) ?? {};
  const listing = (record.listing_record as JsonRecord) ?? {};

  const rooms = record.rooms ?? n.rooms ?? n.tax_rooms ?? n.archive_rooms ?? tax.rooms ?? listing.garden_listing_rooms;
  const roomsValue = typeof rooms === "number" && Number.isFinite(rooms) ? num(rooms) : rooms;

  const propertyType = record.property_type ?? n.property_type ?? n.archive_property_type ?? record.address ?? n.address;

  const internalArea =
    record.internal_area_sqm ??
    n.built_internal_area_m2 ??
    n.internal_area_m2 ??
    n.structured_area_m2 ??
    n.tax_registered_area_m2 ??
    tax.registered_area_m2 ??
    listing.garden_listing_area_m2;
  const internalAreaDisplay = typeof internalArea === "number" ? `${num(internalArea)} מ״ר` : record.internal_area_note ?? null;

  const outdoorArea = record.outdoor_area_sqm ?? n.roof_area_m2 ?? n.roof_terrace_area_m2 ?? n.garden_area_m2 ?? n.balcony_area_m2;
  const outdoorAreaDisplay =
    typeof outdoorArea === "number"
      ? `${num(outdoorArea)} מ״ר`
      : record.outdoor_area_note ?? (Array.isArray(n.outdoor_area_range_m2) ? `${n.outdoor_area_range_m2[0]}–${n.outdoor_area_range_m2[1]} מ״ר` : null);

  const priceRaw =
    record.price_ils ??
    n.asking_price_ils ??
    n.tax_price_ils ??
    n.starting_price_ils ??
    n.special_variant?.starting_price_ils ??
    tax.price_ils ??
    tax.local_price_ils;
  const priceObservations = n.asking_price_observations_ils as number[] | undefined;
  let priceDisplay: string | null = null;
  if (typeof priceRaw === "number") {
    priceDisplay = ils(priceRaw);
  } else if (priceObservations && priceObservations.length > 0) {
    const min = Math.min(...priceObservations);
    const max = Math.max(...priceObservations);
    priceDisplay = min === max ? ils(min) : `${ils(min)}–${ils(max)}`;
  } else if (typeof record.price_note === "string") {
    priceDisplay = record.price_note;
  }

  const location = record.submarket ?? record.project ?? n.submarket ?? n.address ?? record.address ?? tax.address;
  const dateInfo = [
    record.listing_date ?? n.date_listed ?? tax.date ?? n.tax_date,
    (record.retrieved_date ?? n.retrieved_at) && `נאסף: ${record.retrieved_date ?? n.retrieved_at}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const whyRelevant = record.why_relevant ?? record.reasoning ?? record.note ?? record.matching_basis;
  const whyNotNumeric = record.why_not_numeric ?? record.action ?? record.issue ?? record.reason;

  return { roomsValue, propertyType, internalAreaDisplay, outdoorAreaDisplay, priceDisplay, location, dateInfo, whyRelevant, whyNotNumeric };
}

/** "השוואות נוספות והקשר שוק" -- one coherent supplemental-context section
 * fed by both the first- and second-researcher packages (see app_api/
 * first_researcher_context.py), kept visually and structurally separate
 * from "ראיות שהשתתפו בחישוב" (the market_indication lanes above). Every
 * record here is display-only: numeric_eligibility is always false on the
 * payload, enforced at merge time, never re-checked here. Demonstrates
 * evidence that was collected but deliberately excluded when comparability
 * was insufficient. */
export default function FirstResearcherContext({ records }: Props) {
  const [open, setOpen] = useState(false);
  if (records.length === 0) return null;

  return (
    <section className="rounded-md border border-dashed border-slate-300 p-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-start">
        <div>
          <div className="text-sm font-semibold text-slate-800">6. השוואות נוספות והקשר שוק</div>
          <p className="text-xs text-slate-500">
            {records.length} רשומות מחקר נוספות — נאספו אך לא השתתפו בחישוב האינדיקציה בשלב זה.
          </p>
        </div>
        <span className="text-xs text-slate-400 underline">{open ? "הסתרה" : "הצגה"}</span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {records.map((r, i) => (
            <ContextRecordCard key={(r.id as string) ?? i} record={r} />
          ))}
        </div>
      )}
    </section>
  );
}

function ContextRecordCard({ record }: { record: JsonRecord }) {
  const [showSource, setShowSource] = useState(false);
  const contextType = record.context_type as string;
  const fields = extractFields(record);

  const rows: { label: string; value: string }[] = [];
  const push = (label: string, value: unknown) => {
    if (value == null || value === "") return;
    rows.push({ label, value: String(value) });
  };

  push("סוג נכס", fields.propertyType);
  push("חדרים", fields.roomsValue);
  push("שטח פנימי", fields.internalAreaDisplay);
  push("שטח חוץ/גינה/גג", fields.outdoorAreaDisplay);
  push("מחיר", fields.priceDisplay);
  push("סאב-שוק/מיקום", fields.location);
  push("סטטוס פרויקט", record.status);

  const kind = kindBadge(record);

  return (
    <div className="rounded-md border border-slate-200 p-2 text-sm">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
        <span className="font-medium text-slate-800">{(record.id as string) ?? "רשומה"}</span>
        <div className="flex gap-1">
          {kind && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{kind}</span>}
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CONTEXT_TYPE_COLORS[contextType] ?? "bg-slate-100 text-slate-600"}`}>
            {CONTEXT_TYPE_LABELS[contextType] ?? contextType}
          </span>
        </div>
      </div>

      {fields.dateInfo && <div className="mb-1 text-[11px] text-slate-400">{fields.dateInfo}</div>}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {rows.map((r) => (
          <span key={r.label}>
            {r.label}: <span className="font-medium text-slate-800">{r.value}</span>
          </span>
        ))}
      </div>

      {fields.whyRelevant != null && <p className="mt-1 text-xs text-slate-600">למה רלוונטי: {String(fields.whyRelevant)}</p>}

      <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
        השתתף בחישוב: לא
        {fields.whyNotNumeric != null && <> — {String(fields.whyNotNumeric)}</>}
      </div>

      {(record.source_url != null || record.source != null) && (
        <button onClick={() => setShowSource((v) => !v)} className="mt-1 text-[11px] text-slate-400 underline hover:text-slate-600">
          {showSource ? "הסתרת מקור" : "מקור"}
        </button>
      )}
      {showSource && (
        <div className="mt-1 text-[11px] text-slate-500">
          {record.source != null && <div>מקור: {String(record.source)}</div>}
          {record.source_url != null && (
            <a href={String(record.source_url)} target="_blank" rel="noreferrer" className="block break-all text-blue-700 underline">
              {String(record.source_url)}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
