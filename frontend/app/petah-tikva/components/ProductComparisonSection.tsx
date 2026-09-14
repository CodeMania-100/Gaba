"use client";

import { useEffect, useRef, useState } from "react";
import { JsonRecord, PetahTikvaWorkspace, PtkFamily, StandardAttributeEnrichment, StandardAttributeEnrichmentFamily } from "@/lib/api";
import { CLASSIFICATION_COLORS, CLASSIFICATION_LABELS, normalizeProjectName } from "@/lib/competitorRegister";
import {
  ComparableItem,
  buildProductComparisonRows,
  comparableName,
  factScopeLabel,
  findComparableForCompetitorName,
  INSUFFICIENT_FLOOR_DATA_MESSAGE,
  NO_FLOOR_RULE_MESSAGE,
  noVerifiedRuleMessage,
  pickStrongestComparables,
  projectStatusLabel,
} from "@/lib/standardEnrichment";
import { ils } from "@/lib/format";
import { deriveMatchStateRows, MATCH_STATE_COLORS, MATCH_STATE_LABELS } from "@/lib/competitorMatchStates";
import { ROOM_FAMILY_LABELS } from "@/lib/family";
import { translateResearchNote } from "@/lib/researchNoteTranslations";
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
  // The one competitor most recently pinned via the map's "פתח השוואה מלאה"
  // -- when this family has a real comparable entry for it, that exact
  // competitor is force-included (even if it isn't one of
  // pickStrongestComparables' top picks) and auto-expanded/scrolled to, so
  // the button never lands on a comparison that silently shows a different
  // project instead. null/absent behaves exactly as before (auto-picked
  // top-3 only).
  pinnedCompetitorName?: string | null;
}

const PRIMARY_ROW_COUNT = 6;

export default function ProductComparisonSection({
  workspace,
  projectPhase,
  family,
  familyKey,
  enrichment,
  activePrice,
  priceLabel,
  pinnedCompetitorName,
}: Props) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [sourcesIndex, setSourcesIndex] = useState<number | null>(null);
  const pinnedCardRef = useRef<HTMLDivElement | null>(null);

  const fam = enrichment.families[familyKey];
  const rooms = family.family === "3R" ? 3 : 5;
  const autoComparables = pickStrongestComparables(fam, rooms, family.target.internal_area, 3);
  const pinnedComparable = pinnedCompetitorName ? findComparableForCompetitorName(fam, rooms, family.target.internal_area, pinnedCompetitorName) : null;
  // Compared via normalizeProjectName, not a raw === -- the map's pinned
  // name comes from the register (competitor_landscape), which can use a
  // different dash character than this same competitor's own entry in
  // new_development_comparables (see lib/competitorRegister.ts's
  // normalizeProjectName). A raw string mismatch here would both fail to
  // recognize the pinned competitor as already-auto-included (rendering it
  // twice) and fail to find its own index to expand/scroll to.
  const pinnedNameNormalized = pinnedCompetitorName ? normalizeProjectName(pinnedCompetitorName) : null;
  const pinnedAlreadyIncluded = pinnedComparable != null && autoComparables.some((c) => normalizeProjectName(comparableName(c)) === pinnedNameNormalized);
  const comparables = pinnedComparable && !pinnedAlreadyIncluded ? [pinnedComparable, ...autoComparables] : autoComparables;
  const pinnedIndex = pinnedNameNormalized ? comparables.findIndex((c) => normalizeProjectName(comparableName(c)) === pinnedNameNormalized) : -1;

  // Expand and scroll to the pinned competitor's own card whenever a new
  // one is pinned (or one is already pinned when this family first mounts)
  // -- never on an unrelated re-render, and never overriding a subsequent
  // manual expand/collapse click.
  useEffect(() => {
    if (pinnedIndex >= 0) {
      setExpandedIndex(pinnedIndex);
      pinnedCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedCompetitorName, familyKey]);

  const subject = {
    price: activePrice,
    rooms,
    internalArea: family.target.internal_area,
    balconyArea: family.target.balcony_area,
    floor: null,
    orientation: null,
  };

  return (
    <section className="rounded-lg border border-hairline bg-surface p-5">
      <div className="mb-1">
        <h2 className="font-heading text-lg font-bold text-ink">במה המוצר שלנו שונה מהמתחרים?</h2>
        <p className="text-xs text-ink-muted">
          {ROOM_FAMILY_LABELS[family.family] ?? family.family} · השוואת מאפיינים אמיתיים — ללא המצאת מקדמי מחיר. מחיר {priceLabel} מוצג לצורך התמצאות בלבד.
        </p>
      </div>

      {comparables.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">אין כרגע נתוני השוואת מוצר עשירים עבור משפחה זו.</p>
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

            const isPinned = i === pinnedIndex;
            return (
              <div
                key={i}
                ref={isPinned ? pinnedCardRef : undefined}
                className={`flex flex-col gap-2 rounded-md border p-3 ${isPinned ? "border-accent ring-1 ring-accent" : "border-hairline"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-ink">{comparableName(item)}</div>
                    {item.kind === "new_development" && <div className="text-xs text-ink-muted">יזם: {developer ?? "לא פורסם"}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {isPinned && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent">נבחר מהמפה</span>}
                    {classification && (
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${CLASSIFICATION_COLORS[classification as "direct" | "relevant" | "context"]}`}>
                        {CLASSIFICATION_LABELS[classification as "direct" | "relevant" | "context"]}
                      </span>
                    )}
                    {item.kind === "current_asking" && (
                      <span className="rounded bg-canvas px-1.5 py-0.5 text-xs font-medium text-ink-muted">הצעה קיימת</span>
                    )}
                  </div>
                </div>

                {status && <div className="text-xs text-ink-muted">סטטוס: {status}</div>}

                {rows.length === 0 ? (
                  <p className="text-sm text-ink-muted/70">אין נתוני מוצר ידועים להשוואה.</p>
                ) : (
                  <table className="w-full table-fixed text-sm">
                    <thead>
                      <tr className="text-[11px] font-normal text-ink-muted/70">
                        <th className="w-[28%] text-start font-normal"></th>
                        <th className="w-[27%] text-end font-normal">שלנו</th>
                        <th className="w-[27%] text-end font-normal">המתחרה</th>
                        <th className="w-[18%] text-end font-normal"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {deriveMatchStateRows(visibleRows).map((row) => (
                        <tr key={row.label} className="border-t border-hairline">
                          <td className="py-1 text-ink-muted">{row.label}</td>
                          <td className="py-1 text-end font-medium text-ink">{row.subjectValue}</td>
                          <td className="py-1 text-end font-medium text-ink">
                            {row.competitorValue}
                            {row.scope && <span className="ms-1 text-[10px] font-normal text-ink-muted/70">({factScopeLabel(row.scope)})</span>}
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
                    className="w-fit text-xs text-ink-muted underline hover:text-ink"
                  >
                    {expanded ? "הצג פחות" : "הצג השוואה מלאה"}
                  </button>
                )}

                <button
                  onClick={() => setSourcesIndex(sourcesIndex === i ? null : i)}
                  className="w-fit text-xs text-ink-muted/70 underline hover:text-ink-muted"
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
          -- price/positioning rows live under "מול מי אנחנו מתחרים?" instead
          (MarketPositionSection), never duplicated here. */}
      {workspace && projectPhase && (
        <div className="mt-4 border-t border-hairline pt-4">
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
      <div className="rounded border border-dashed border-hairline p-2 text-xs text-ink-muted">
        {provenance.map((p, i) => (
          <div key={i} className="mb-1">
            <div>
              מקור: <span className="font-medium text-ink-muted">{String(p.source)}</span>
              {p.retrieved_at != null && <> · נבדק: {String(p.retrieved_at)}</>}
              {p.scope != null && <> · {factScopeLabel(p.scope as string)}</>}
            </div>
            {p.source_url != null && (
              <a href={String(p.source_url)} target="_blank" rel="noreferrer" className="text-accent underline">
                {String(p.source_url)}
              </a>
            )}
          </div>
        ))}
        {qaNotes.length > 0 && (
          <div className="mt-1">
            <div className="font-semibold text-ink-muted">הערות QA:</div>
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
  const projectLevel = (competitor.project_level as JsonRecord) ?? {};
  const projectProvenance = (projectLevel.provenance as JsonRecord[] | undefined) ?? [];
  const variantProvenance = (item.variant?.provenance as JsonRecord[] | undefined) ?? [];
  const qaNotes = (competitor.qa_notes as string[] | undefined) ?? [];
  // P0 fix ("surface existing promotions and specification_features
  // wherever competitor details are expanded") -- project_level.promotions
  // is a single free-text sentence (or null) in this dataset, never a list;
  // specification_features is already an array of real, already-collected
  // fact strings. Compact, real facts only -- an empty/absent source omits
  // the whole section, never converted to a monetary value.
  const promotionText = projectLevel.promotions as string | null | undefined;
  const promotions = promotionText && promotionText.trim() !== "" ? [promotionText] : [];
  const specification = (projectLevel.specification_features as string[] | undefined) ?? [];

  return (
    <div className="rounded border border-dashed border-hairline p-2 text-xs text-ink-muted">
      {[...variantProvenance, ...projectProvenance].map((p, i) => (
        <div key={i} className="mb-1">
          <div>
            מקור: <span className="font-medium text-ink-muted">{String(p.source)}</span>
            {p.retrieved_at != null && <> · נבדק: {String(p.retrieved_at)}</>}
            {p.scope != null && <> · {factScopeLabel(p.scope as string)}</>}
          </div>
          {p.source_url != null && (
            <a href={String(p.source_url)} target="_blank" rel="noreferrer" className="text-accent underline">
              {String(p.source_url)}
            </a>
          )}
        </div>
      ))}
      {promotions.length > 0 && (
        <div className="mt-1">
          <div className="font-semibold text-ink-muted">הטבות / מבצעים:</div>
          <ul className="list-inside list-disc">
            {promotions.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {specification.length > 0 && (
        <div className="mt-1">
          <div className="font-semibold text-ink-muted">מפרט ומאפיינים:</div>
          <ul className="list-inside list-disc">
            {specification.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {qaNotes.length > 0 && (
        <div className="mt-1">
          <div className="font-semibold text-ink-muted">הערות QA:</div>
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

/** Floor/orientation/balcony/parking/storage have rich observed evidence but
 * no defensible price effect was found -- shown as honest research-gap
 * messages, never as an invented coefficient. A concise one-line summary is
 * always visible; the underlying bullets sit behind a "הצג פירוט מתודולוגי"
 * toggle so the presentation flow isn't research-heavy by default. */
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
    <div className="mt-4 rounded-md bg-canvas p-3 text-sm text-ink-muted">
      <p>
        לא נמצא כלל כספי מקומי מאומת להשפעת קומה או מאפייני מוצר, ולכן מאפיינים אלה מוצגים כתמיכה בהחלטה ואינם
        משנים מחיר אוטומטית.
      </p>
      <button onClick={() => setOpen((v) => !v)} className="mt-2 text-xs text-ink-muted/70 underline hover:text-ink-muted">
        {open ? "הסתרת פירוט מתודולוגי" : "הצג פירוט מתודולוגי"}
      </button>

      {open && (
        <div className="mt-2 text-xs text-ink-muted">
          <div className="mb-1 font-semibold text-ink-muted">{NO_FLOOR_RULE_MESSAGE}</div>
          <p>{translateResearchNote(enrichment.new_development_floor_pair_search?.note) ?? INSUFFICIENT_FLOOR_DATA_MESSAGE}</p>

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
                <li key={i}>{translateResearchNote(g)}</li>
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
