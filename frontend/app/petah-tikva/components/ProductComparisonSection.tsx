"use client";

import { useState } from "react";
import { JsonRecord, PtkFamily, StandardAttributeEnrichment, StandardAttributeEnrichmentFamily } from "@/lib/api";
import { CLASSIFICATION_COLORS, CLASSIFICATION_LABELS } from "@/lib/competitorRegister";
import {
  ComparableItem,
  buildProductComparisonRows,
  comparableName,
  factScopeLabel,
  INSUFFICIENT_FLOOR_DATA_MESSAGE,
  NO_FLOOR_RULE_MESSAGE,
  noVerifiedRuleMessage,
  pickStrongestComparables,
  projectStatusLabel,
} from "@/lib/standardEnrichment";
import { ils } from "@/lib/format";
import FloorAndAttributeContext from "./FloorAndAttributeContext";

interface Props {
  family: PtkFamily;
  familyKey: "standard_3r" | "standard_5r";
  enrichment: StandardAttributeEnrichment;
  activePrice: number | null;
  priceLabel: string;
}

const PRIMARY_ROW_COUNT = 6;

export default function ProductComparisonSection({ family, familyKey, enrichment, activePrice, priceLabel }: Props) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [sourcesIndex, setSourcesIndex] = useState<number | null>(null);

  const fam = enrichment.families[familyKey];
  const rooms = family.family === "3R" ? 3 : 5;
  const comparables = pickStrongestComparables(fam, rooms, family.target.internal_area, 3);

  const subject = {
    price: activePrice,
    rooms,
    internalArea: family.target.internal_area,
    balconyArea: family.target.balcony_area,
    floor: null,
    orientation: null,
  };

  return (
    <section className="rounded-lg border border-slate-300 bg-white p-5">
      <div className="mb-1">
        <h2 className="text-lg font-bold text-slate-900">השוואת מאפייני המוצר</h2>
        <p className="text-xs text-slate-500">
          כיצד הדירה שלנו שונה מחלופות אמיתיות בשוק — ללא המצאת מקדמי מחיר. מחיר {priceLabel} מוצג לצורך התמצאות בלבד.
        </p>
      </div>

      {comparables.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">אין כרגע נתוני השוואת מוצר עשירים עבור משפחה זו.</p>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {comparables.map((item, i) => {
            const rows = buildProductComparisonRows(subject, item);
            const expanded = expandedIndex === i;
            const visibleRows = expanded ? rows : rows.slice(0, PRIMARY_ROW_COUNT);
            const classification =
              item.kind === "new_development" ? (item.competitor.register_classification as string | null) : null;
            const status =
              item.kind === "new_development" ? projectStatusLabel((item.competitor.project_level as JsonRecord)?.status as string) : null;

            return (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-slate-900">{comparableName(item)}</div>
                  {classification && (
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${CLASSIFICATION_COLORS[classification as "direct" | "relevant" | "context"]}`}>
                      {CLASSIFICATION_LABELS[classification as "direct" | "relevant" | "context"]}
                    </span>
                  )}
                  {item.kind === "current_asking" && (
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">הצעה קיימת</span>
                  )}
                </div>

                {status && <div className="text-xs text-slate-500">סטטוס: {status}</div>}

                {rows.length === 0 ? (
                  <p className="text-sm text-slate-400">אין נתוני מוצר ידועים להשוואה.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {visibleRows.map((row) => (
                        <tr key={row.label} className="border-t border-slate-100">
                          <td className="py-1 text-slate-500">{row.label}</td>
                          <td className="py-1 font-medium text-slate-900">{row.subjectValue}</td>
                          <td className="py-1 font-medium text-slate-900">
                            {row.competitorValue}
                            {row.scope && <span className="ms-1 text-[10px] font-normal text-slate-400">({factScopeLabel(row.scope)})</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {rows.length > PRIMARY_ROW_COUNT && (
                  <button
                    onClick={() => setExpandedIndex(expanded ? null : i)}
                    className="w-fit text-xs text-slate-500 underline hover:text-slate-800"
                  >
                    {expanded ? "הצג פחות" : "הצג השוואה מלאה"}
                  </button>
                )}

                <button
                  onClick={() => setSourcesIndex(sourcesIndex === i ? null : i)}
                  className="w-fit text-xs text-slate-400 underline hover:text-slate-600"
                >
                  {sourcesIndex === i ? "הסתרת מקורות" : "מקורות ופרטים טכניים"}
                </button>

                {sourcesIndex === i && <SourcesPanel item={item} />}
              </div>
            );
          })}
        </div>
      )}

      <NoAutomaticRuleNotes familyKey={familyKey} enrichment={enrichment} />

      <div className="mt-3">
        <FloorAndAttributeContext family={enrichment.families[familyKey]} />
      </div>
    </section>
  );
}

function SourcesPanel({ item }: { item: ComparableItem }) {
  if (item.kind === "current_asking") {
    const r = item.record;
    const provenance = (r.field_provenance as JsonRecord[] | undefined) ?? [];
    const qaNotes = (r.qa_notes as string[] | undefined) ?? [];
    return (
      <div className="rounded border border-dashed border-slate-300 p-2 text-xs text-slate-500">
        {provenance.map((p, i) => (
          <div key={i} className="mb-1">
            <div>
              מקור: <span className="font-medium text-slate-700">{String(p.source)}</span>
              {p.retrieved_at != null && <> · נבדק: {String(p.retrieved_at)}</>}
              {p.scope != null && <> · {factScopeLabel(p.scope as string)}</>}
            </div>
            {p.source_url != null && (
              <a href={String(p.source_url)} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                {String(p.source_url)}
              </a>
            )}
          </div>
        ))}
        {qaNotes.length > 0 && (
          <div className="mt-1">
            <div className="font-semibold text-slate-600">הערות QA:</div>
            <ul className="list-inside list-disc">
              {qaNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const competitor = item.competitor;
  const projectProvenance = ((competitor.project_level as JsonRecord)?.provenance as JsonRecord[] | undefined) ?? [];
  const variantProvenance = (item.variant?.provenance as JsonRecord[] | undefined) ?? [];
  const qaNotes = (competitor.qa_notes as string[] | undefined) ?? [];

  return (
    <div className="rounded border border-dashed border-slate-300 p-2 text-xs text-slate-500">
      {[...variantProvenance, ...projectProvenance].map((p, i) => (
        <div key={i} className="mb-1">
          <div>
            מקור: <span className="font-medium text-slate-700">{String(p.source)}</span>
            {p.retrieved_at != null && <> · נבדק: {String(p.retrieved_at)}</>}
            {p.scope != null && <> · {factScopeLabel(p.scope as string)}</>}
          </div>
          {p.source_url != null && (
            <a href={String(p.source_url)} target="_blank" rel="noreferrer" className="text-blue-700 underline">
              {String(p.source_url)}
            </a>
          )}
        </div>
      ))}
      {qaNotes.length > 0 && (
        <div className="mt-1">
          <div className="font-semibold text-slate-600">הערות QA:</div>
          <ul className="list-inside list-disc">
            {qaNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Items 13/14/27: floor/orientation/balcony/parking/storage have rich
 * observed evidence but no defensible price effect was found -- shown as
 * honest research-gap messages, never as an invented coefficient. */
function NoAutomaticRuleNotes({
  familyKey,
  enrichment,
}: {
  familyKey: "standard_3r" | "standard_5r";
  enrichment: StandardAttributeEnrichment;
}) {
  const fam = enrichment.families[familyKey];
  const hasMatchedObservations = Object.keys(fam.matched_observations).length > 0;

  return (
    <div className="mt-4 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
      <div className="mb-1 font-semibold text-slate-700">{NO_FLOOR_RULE_MESSAGE}</div>
      <p>{enrichment.new_development_floor_pair_search?.note ?? INSUFFICIENT_FLOOR_DATA_MESSAGE}</p>

      {hasMatchedObservations && (
        <div className="mt-2">
          {Object.entries(fam.matched_observations).map(([category, entries]) => (
            <p key={category} className="mt-1">
              {noVerifiedRuleMessage(MATCHED_OBSERVATION_LABELS[category] ?? category)} ({entries.length} תצפיות מוצר תואמות)
            </p>
          ))}
        </div>
      )}

      {fam.research_gaps.length > 0 && (
        <ul className="mt-2 list-inside list-disc">
          {fam.research_gaps.map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const MATCHED_OBSERVATION_LABELS: Record<string, string> = {
  orientation: "כיוון",
  balcony_size: "גודל מרפסת",
  parking: "חניה",
  storage: "מחסן",
};
