"use client";

import { useState } from "react";
import { JsonRecord, StandardAttributeEnrichmentFamily } from "@/lib/api";
import { ils, num } from "@/lib/format";
import { ObservationalPairQuality, pairQualityLabel, sortFloorPairsByQuality } from "@/lib/standardEnrichment";

interface Props {
  family: StandardAttributeEnrichmentFamily;
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  orientation: "כיוון",
  balcony_size: "גודל מרפסת",
  parking: "חניה",
  storage: "מחסן",
};

const QUALITY_COLORS: Record<string, string> = {
  STRONGEST_OBSERVATIONAL_PAIR: "bg-emerald-100 text-emerald-800",
  STRONG_OBSERVATIONAL_PAIR: "bg-sky-100 text-sky-800",
  MEDIUM_OBSERVATIONAL_PAIR: "bg-slate-200 text-slate-700",
};

/** Standard-family floor and product-attribute observational panel. All
 * data here is the pre-existing canonical data/frozen/standard_unit_
 * attribute_enrichment_v1.json (floor_observations / matched_observations)
 * -- item 9's "four registered floor observations" and the Rothschild/
 * Brandeis attribute comparisons predate both researcher packages; nothing
 * here was added by this integration pass, only surfaced in the UI for the
 * first time. No floor/orientation/balcony premium is ever calculated. */
export default function FloorAndAttributeContext({ family }: Props) {
  const [open, setOpen] = useState(false);
  // Quarantined candidates (status: "quarantine") have no observations
  // array at all -- they are excluded pairs, not weak-but-valid ones, so
  // they are shown separately rather than as a fake "MEDIUM" pair with no
  // data.
  const validPairs = family.floor_observations.filter((p) => p.status !== "quarantine");
  const quarantinedPairs = family.floor_observations.filter((p) => p.status === "quarantine");
  const floorPairs = sortFloorPairsByQuality(validPairs);
  const attributeCategories = Object.entries(family.matched_observations);

  if (floorPairs.length === 0 && attributeCategories.length === 0 && quarantinedPairs.length === 0) return null;

  return (
    <section className="rounded-md border border-dashed border-slate-300 p-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-start">
        <div>
          <div className="text-sm font-semibold text-slate-800">תצפיות קומה ומאפייני מוצר (רשומות רשומות/דגמים)</div>
          <p className="text-xs text-slate-500">
            {floorPairs.length} תצפיות קומה נצפו · {attributeCategories.length} השוואות דגם — הצגה בלבד, ללא כלל כספי.
          </p>
        </div>
        <span className="text-xs text-slate-400 underline">{open ? "הסתרה" : "הצגה"}</span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-3">
          {floorPairs.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-600">תצפיות קומה — עסקאות רשומות</div>
              <div className="flex flex-col gap-1">
                {floorPairs.map(({ pair, quality }, i) => (
                  <FloorPairRow key={i} pair={pair} quality={quality} />
                ))}
              </div>
              <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                נצפו עסקאות דומות באותו בניין ובשטח זהה בקומות שונות. ההשוואה היא תצפיתית בלבד ולא מאפשרת לייחס את
                מלוא פער המחיר לקומה. אין כלל כספי מאומת.
              </p>
            </div>
          )}

          {quarantinedPairs.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-600">מועמדים שנפסלו (התנגשות נתונים)</div>
              {quarantinedPairs.map((p, i) => (
                <div key={i} className="rounded border border-slate-200 p-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{p.address as string}</span>: {p.reason as string}
                </div>
              ))}
            </div>
          )}

          {attributeCategories.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-600">השוואות דגם — מאפייני מוצר</div>
              <div className="flex flex-col gap-2">
                {attributeCategories.map(([category, entries]) => (
                  <div key={category}>
                    {(entries as JsonRecord[]).map((entry, i) => (
                      <AttributeObservationRow key={i} category={category} entry={entry} />
                    ))}
                  </div>
                ))}
              </div>
              <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                נצפו עסקאות/דגמים דומים עם הבדלים במאפיין. אין כלל כספי מקומי מאומת שמבודד את השפעת המאפיין.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function FloorPairRow({ pair, quality }: { pair: JsonRecord; quality: ObservationalPairQuality }) {
  const observations = (pair.observations as JsonRecord[]) ?? [];
  return (
    <div className="rounded border border-slate-200 p-2 text-xs">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
        <span className="font-medium text-slate-800">{pair.address as string}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${QUALITY_COLORS[quality]}`}>{pairQualityLabel(quality)}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-600">
        {observations.map((o, i) => (
          <span key={i}>
            קומה {String(o.floor)}: <span className="font-medium text-slate-800">{ils(o.price as number)}</span> ({String(o.date)})
          </span>
        ))}
      </div>
      {pair.match_basis != null && <p className="mt-1 text-slate-500">{String(pair.match_basis)}</p>}
    </div>
  );
}

function AttributeObservationRow({ category, entry }: { category: string; entry: JsonRecord }) {
  // Two shapes exist in the source: orientation/balcony_size carry a
  // `comparison` array of variants; parking/storage carry a single plain
  // `observation` sentence with price_effect_observable -- both render here.
  const comparison = (entry.comparison as JsonRecord[]) ?? [];
  const observation = entry.observation as string | undefined;
  return (
    <div className="rounded border border-slate-200 p-2 text-xs">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
        <span className="font-medium text-slate-800">{entry.project as string}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
          {ATTRIBUTE_LABELS[category] ?? category}
        </span>
      </div>
      {observation != null && <p className="text-slate-600">{observation}</p>}
      <div className="flex flex-col gap-0.5 text-slate-600">
        {comparison.map((v, i) => (
          <span key={i}>
            {v.variant as string}: {v.internal_area != null && `${num(v.internal_area as number)} מ״ר`}
            {v.balcony_area != null && ` · מרפסת ${num(v.balcony_area as number)} מ״ר`}
            {v.orientation != null && ` · כיוון ${Array.isArray(v.orientation) ? (v.orientation as string[]).join("/") : v.orientation}`}
            {v.parking != null && ` · חניה ${num(v.parking as number)}`}
            {v.price != null && ` · ${ils(v.price as number)}`}
          </span>
        ))}
      </div>
      {entry.note != null && <p className="mt-1 text-slate-500">{String(entry.note)}</p>}
    </div>
  );
}
