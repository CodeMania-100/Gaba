"use client";

import { useState } from "react";
import { JsonRecord, PetahTikvaWorkspace, PtkFamily, StandardAttributeEnrichment, StandardAttributeEnrichmentFamily } from "@/lib/api";
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
import { deriveMatchStateRows, MATCH_STATE_COLORS, MATCH_STATE_LABELS } from "@/lib/competitorMatchStates";
import { ProjectPhase } from "@/lib/marketingStrategy";
import CompetitorComparisonMatrix from "./CompetitorComparisonMatrix";

interface Props {
  // Optional: only used to render the genuine product-attribute matrix rows
  // (area/floor/delivery/payment) below the per-competitor comparison
  // cards. Omitted by callers that don't have this context handy -- the
  // section still works without it, just without that extra matrix.
  workspace?: PetahTikvaWorkspace;
  projectPhase?: ProjectPhase;
  family: PtkFamily;
  familyKey: "standard_3r" | "standard_5r";
  enrichment: StandardAttributeEnrichment;
  activePrice: number | null;
  priceLabel: string;
}

const PRIMARY_ROW_COUNT = 6;

export default function ProductComparisonSection({ workspace, projectPhase, family, familyKey, enrichment, activePrice, priceLabel }: Props) {
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
        <h2 className="text-lg font-bold text-slate-900">במה המוצר שלנו שונה מהמתחרים?</h2>
        <p className="text-xs text-slate-500">
          השוואת מאפיינים אמיתיים — ללא המצאת מקדמי מחיר. מחיר {priceLabel} מוצג לצורך התמצאות בלבד.
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
            const developer = item.kind === "new_development" ? ((item.competitor.developer as string | null) ?? null) : null;
            const status =
              item.kind === "new_development" ? projectStatusLabel((item.competitor.project_level as JsonRecord)?.status as string) : null;

            return (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">{comparableName(item)}</div>
                    {item.kind === "new_development" && <div className="text-xs text-slate-500">יזם: {developer ?? "לא פורסם"}</div>}
                  </div>
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
                  <table className="w-full table-fixed text-sm">
                    <thead>
                      <tr className="text-[11px] font-normal text-slate-400">
                        <th className="w-[28%] text-start font-normal"></th>
                        <th className="w-[27%] text-end font-normal">שלנו</th>
                        <th className="w-[27%] text-end font-normal">המתחרה</th>
                        <th className="w-[18%] text-end font-normal"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {deriveMatchStateRows(visibleRows).map((row) => (
                        <tr key={row.label} className="border-t border-slate-100">
                          <td className="py-1 text-slate-500">{row.label}</td>
                          <td className="py-1 text-end font-medium text-slate-900">{row.subjectValue}</td>
                          <td className="py-1 text-end font-medium text-slate-900">
                            {row.competitorValue}
                            {row.scope && <span className="ms-1 text-[10px] font-normal text-slate-400">({factScopeLabel(row.scope)})</span>}
                          </td>
                          <td className="py-1 text-end">
                            {row.matchState && (
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${MATCH_STATE_COLORS[row.matchState]}`}>
                                {MATCH_STATE_LABELS[row.matchState]}
                              </span>
                            )}
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

      {/* Genuine product-attribute rows only (area, floor, delivery, payment)
          -- price/positioning rows live under "מול אילו פרויקטים אנחנו
          מתחרים?" instead (MarketPositionSection), never duplicated here. */}
      {workspace && projectPhase && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <CompetitorComparisonMatrix
            workspace={workspace}
            projectPhase={projectPhase}
            family={family.family}
            rowKeys={["area", "floor", "delivery", "payment"]}
            title="השוואת מאפיינים מול פרויקטים מתחרים"
          />
        </div>
      )}

      <NoAutomaticRuleNotes familyKey={familyKey} enrichment={enrichment} />
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
 * honest research-gap messages, never as an invented coefficient. A concise
 * one-line summary is always visible; the underlying bullets/bullet-level
 * detail (never deleted) sit behind a "הצג פירוט מתודולוגי" toggle so the
 * presentation flow isn't research-heavy by default. */
function NoAutomaticRuleNotes({
  familyKey,
  enrichment,
}: {
  familyKey: "standard_3r" | "standard_5r";
  enrichment: StandardAttributeEnrichment;
}) {
  const [open, setOpen] = useState(false);
  const fam = enrichment.families[familyKey];
  const hasMatchedObservations = Object.keys(fam.matched_observations).length > 0;

  return (
    <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
      <p>
        לא נמצא כלל כספי מקומי מאומת להשפעת קומה או מאפייני מוצר, ולכן מאפיינים אלה מוצגים כתמיכה בהחלטה ואינם
        משנים מחיר אוטומטית.
      </p>
      <button onClick={() => setOpen((v) => !v)} className="mt-2 text-xs text-slate-400 underline hover:text-slate-600">
        {open ? "הסתרת פירוט מתודולוגי" : "הצג פירוט מתודולוגי"}
      </button>

      {open && (
        <div className="mt-2 text-xs text-slate-600">
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
