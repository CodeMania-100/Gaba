"use client";

import { useState } from "react";
import { JsonRecord, PetahTikvaScenario, PetahTikvaWorkspace, PtkFamily } from "@/lib/api";
import {
  buildComparisonRows,
  buildObservations,
  buildRegisterConsiderations,
  CompetitorProject,
  competitorProvenanceWarning,
  Observation,
  rankCompetitorProjects,
  SubjectFacts,
} from "@/lib/decisionBoard";
import { matchRegisterProject } from "@/lib/competitorRegister";
import { CONFIDENCE_COLORS, CONFIDENCE_LABELS } from "@/lib/family";
import { ils, num, dateIL } from "@/lib/format";

interface Props {
  workspace: PetahTikvaWorkspace;
  family: PtkFamily;
  scenario: PetahTikvaScenario | null;
}

export default function DecisionBoard({ workspace, family, scenario }: Props) {
  const [showMore, setShowMore] = useState(false);

  const scenarioFamily = scenario?.families.find((f) => f.family === family.family);
  const activePrice = scenarioFamily?.proposed_family_price_ils ?? family.proposed_family_price_ils;
  const priceLabel = scenarioFamily && !scenario?.is_baseline_position ? "בתרחיש" : "בסיס";

  const subject: SubjectFacts = {
    internalArea: family.target.internal_area,
    balconyArea: family.target.balcony_area,
    floor: null,
    orientation: null,
    price: activePrice,
    priceLabel,
  };

  // Sourced only from the new_development/competitor lane -- rankCompetitorProjects
  // itself also filters defensively (isNewDevelopmentRecord), so completed sales or
  // resale asking records can never end up ranked as "direct competitors".
  const records = (workspace.evidence_provenance.new_development[family.family]?.records as JsonRecord[]) ?? [];
  const contributorSourceIds = new Set<string>(
    (family.evidence_lanes.new_development.primary_contributors ?? []).flatMap((c: JsonRecord) => (c.source_ids as string[]) ?? [])
  );
  const ranked = rankCompetitorProjects(records, contributorSourceIds, family.target.internal_area);

  if (activePrice == null) return null;

  const primary = ranked.slice(0, 2);
  const extra = ranked.slice(2);

  // Position summary -- counted only over the projects actually displayed
  // (primary, or primary+extra once expanded), never implied as a second
  // market range.
  const visible = showMore ? ranked : primary;
  const visiblePrices = visible.map((p) => p.representative.price_ils).filter((v): v is number => v != null);
  const cheaperCount = visiblePrices.filter((p) => p < activePrice).length;
  const pricierCount = visiblePrices.filter((p) => p > activePrice).length;

  // Commercial terms block -- only from records that actually carry payment_terms.
  const termsEntries = ranked
    .map((p) => ({ name: p.projectName, terms: p.representative.payment_terms as string | undefined }))
    .filter((e): e is { name: string; terms: string } => !!e.terms);

  const askingRecords = (workspace.evidence_provenance.current_asking[family.family]?.accepted_records as JsonRecord[]) ?? [];
  const representativeListing = pickRepresentativeListing(askingRecords, family.target.internal_area);

  return (
    <section className="flex flex-col gap-5 rounded-lg border border-slate-300 bg-white p-5">
      <div>
        <h2 className="text-lg font-bold text-slate-900">שיקולים להחלטת מחיר</h2>
        <p className="text-xs text-slate-500">מידע לתמיכה בהחלטה עסקית, לא חישוב תמחור נוסף.</p>
      </div>

      {/* 1. what buyers actually paid */}
      <ContextBlock
        step="1. מה קונים שילמו בפועל"
        title="עסקאות שבוצעו באזור"
        purpose="עוגן למה שקונים שילמו בפועל"
        lane={family.evidence_lanes.sold}
      />

      {/* 2. resale alternatives available today */}
      <ContextBlock
        step="2. אילו חלופות יד שנייה קיימות היום"
        title="חלופות בשוק היד השנייה"
        purpose="מה יכול הקונה לרכוש כיום בשוק הקיים"
        lane={family.evidence_lanes.current_asking}
        contributorLabel="מקורות עצמאיים"
      >
        {representativeListing && (
          <div className="mt-2 border-t border-slate-100 pt-2">
            <div className="text-[11px] text-slate-400">דוגמאות לחלופות קיימות (לא מתחרים ישירים)</div>
            <div className="text-xs text-slate-600">
              {representativeListing.address ?? "כתובת לא ידועה"} · {num(representativeListing.area)} מ״ר ·{" "}
              {ils(representativeListing.asking_price)}
            </div>
          </div>
        )}
      </ContextBlock>

      {/* 3 + 4. new development = direct competition, and where our price sits */}
      <div>
        <div className="mb-2 text-xs font-semibold text-slate-500">3. מה מציעים פרויקטים חדשים מתחרים</div>
        <h3 className="text-sm font-bold text-slate-900">תחרות ישירה — פרויקטים חדשים</h3>

        {ranked.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">אין כרגע ראיית תחרות ישירה ממקור פרויקטים חדשים עבור משפחה זו.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            <div>
              <div className="text-xs font-semibold text-slate-500">4. איך המחיר שלנו ממוקם מול התחרות הישירה</div>
              <div className="mt-1 text-sm font-semibold text-slate-800">השוואה מול פרויקטים חדשים נבחרים</div>
              <p className="text-xs text-slate-500">השוואה זו אינה טווח השוק — היא מציגה את מיקום המחיר מול תחרות ישירה.</p>
            </div>

            {visiblePrices.length > 0 && (
              <div className="rounded-md bg-slate-50 p-3">
                <div className="flex flex-wrap items-end gap-x-8 gap-y-2 text-sm">
                  <div>
                    <div className="text-xs text-slate-400">מחיר {priceLabel} שלנו</div>
                    <div className="text-lg font-bold text-slate-900">{ils(activePrice)}</div>
                  </div>
                  <div className="text-slate-700">
                    {cheaperCount} מתחר{cheaperCount === 1 ? "ה רלוונטי" : "ים רלוונטיים"} זול{cheaperCount === 1 ? "" : "ים"} יותר
                    <br />
                    {pricierCount} מתחר{pricierCount === 1 ? "ה רלוונטי" : "ים רלוונטיים"} יקר{pricierCount === 1 ? "" : "ים"} יותר
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">טווח מתחרים מוצגים</div>
                    <div className="font-semibold text-slate-800">
                      {ils(Math.min(...visiblePrices))} – {ils(Math.max(...visiblePrices))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {visible.map((project) => (
                <CompetitorCard
                  key={project.projectName}
                  subject={subject}
                  project={project}
                  scenarioFamily={scenarioFamily}
                  registerProject={matchRegisterProject(project.projectName, workspace.competitor_landscape.projects)}
                />
              ))}
            </div>

            {extra.length > 0 && (
              <button onClick={() => setShowMore((v) => !v)} className="w-fit text-sm text-slate-600 underline hover:text-slate-900">
                {showMore ? "הצג פחות" : "הצג השוואות נוספות"}
              </button>
            )}

            {termsEntries.length > 0 && (
              <div className="rounded-md border border-slate-200 p-3">
                <div className="mb-1 text-xs font-semibold text-slate-500">תנאים מסחריים אצל מתחרים</div>
                <ul className="flex flex-col gap-0.5 text-sm text-slate-700">
                  {termsEntries.map((e) => (
                    <li key={e.name}>
                      {e.name} — {e.terms}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-[11px] text-slate-400">
              מאפייני מוצר משמשים לשיקול מסחרי בלבד, אלא אם קיים עבורם כלל תמחור מאומת.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function ContextBlock({
  step,
  title,
  purpose,
  lane,
  contributorLabel,
  children,
}: {
  step: string;
  title: string;
  purpose: string;
  lane: PtkFamily["evidence_lanes"]["sold"];
  contributorLabel?: string;
  children?: React.ReactNode;
}) {
  const hasRange = lane.range.lower != null;
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="text-xs font-semibold text-slate-500">{step}</div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${CONFIDENCE_COLORS[lane.confidence] ?? ""}`}>
          {CONFIDENCE_LABELS[lane.confidence] ?? lane.confidence}
        </span>
      </div>
      {hasRange ? (
        <>
          <div className="mt-1 text-base font-bold text-slate-900">
            {ils(lane.range.lower)} – {ils(lane.range.upper)}
          </div>
          <div className="text-xs text-slate-500">
            {lane.range.center != null && <>חציון {ils(lane.range.center)} · </>}
            {lane.primary_contributor_count} {contributorLabel ?? "קבוצות השוואה עצמאיות"}
          </div>
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-500">אין כרגע מספיק ראיה עצמאית לטווח מבוסס.</p>
      )}
      <p className="mt-1 text-xs text-slate-400">{purpose}</p>
      {children}
    </div>
  );
}

function CompetitorCard({
  subject,
  project,
  scenarioFamily,
  registerProject,
}: {
  subject: SubjectFacts;
  project: CompetitorProject;
  scenarioFamily?: { proposed_family_price_ils: number | null };
  registerProject?: JsonRecord;
}) {
  const [showSource, setShowSource] = useState(false);
  const r = project.representative;
  const rows = buildComparisonRows(subject, r);
  const observations = [...buildObservations(subject, r), ...buildRegisterConsiderations(registerProject, r)];
  const provenanceWarning = competitorProvenanceWarning(r);

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <div className="font-semibold text-slate-900">{project.projectName}</div>
          <div className="text-xs text-slate-400">פרויקט מתחרה</div>
        </div>
        {scenarioFamily && subject.price != null && r.price_ils != null && (
          <div className={`text-xs font-medium ${subject.price - r.price_ils >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {subject.price - r.price_ils >= 0 ? "+" : ""}
            {ils(subject.price - r.price_ils)}
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400">
              <th className="text-start font-normal"> </th>
              <th className="text-start font-normal">הפרויקט שלנו</th>
              <th className="text-start font-normal">המתחרה</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-slate-100">
                <td className="py-1 text-slate-500">{row.label}</td>
                <td className="py-1 font-medium text-slate-900">{row.subjectValue}</td>
                <td className="py-1 font-medium text-slate-900">{row.competitorValue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {observations.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-slate-500">מה בולט בהשוואה?</div>
          <ul className="flex flex-col gap-1 text-sm">
            {observations.map((o, i) => (
              <ObservationLine key={i} observation={o} />
            ))}
          </ul>
        </div>
      )}

      {provenanceWarning && <p className="mt-2 text-xs text-amber-700">⚠ {provenanceWarning}</p>}

      <button onClick={() => setShowSource((v) => !v)} className="mt-3 text-xs text-slate-400 underline hover:text-slate-600">
        {showSource ? "הסתרת מקור ופרטים" : "מקור ופרטים"}
      </button>

      {showSource && (
        <div className="mt-2 rounded border border-dashed border-slate-300 p-2 text-xs text-slate-500">
          {(r.sources as JsonRecord[] | undefined)?.map((s, i) => (
            <div key={i} className="mb-1">
              <div>
                מקור: <span className="font-medium text-slate-700">{s.source}</span>
                {s.checked_at && <> · נבדק: {dateIL(s.checked_at)}</>}
              </div>
              {s.url && (
                <a href={s.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                  {s.url}
                </a>
              )}
            </div>
          ))}
          {(r.warnings as string[] | undefined)?.length ? (
            <div className="mt-1">
              <div className="font-semibold text-slate-600">אזהרות גולמיות:</div>
              <ul className="list-inside list-disc font-mono">
                {(r.warnings as string[]).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-1 font-semibold text-slate-600">שדות גולמיים:</div>
          <pre className="whitespace-pre-wrap break-words">{JSON.stringify(r, null, 1)}</pre>
        </div>
      )}
    </div>
  );
}

function ObservationLine({ observation }: { observation: Observation }) {
  return (
    <li className="flex items-start gap-1.5">
      <span
        className={`mt-0.5 rounded px-1 py-0.5 text-[10px] font-medium ${
          observation.kind === "fact" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-800"
        }`}
      >
        {observation.kind === "fact" ? "עובדה" : "שיקול"}
      </span>
      <span className="text-slate-700">{observation.text}</span>
    </li>
  );
}

/** One resale listing closest to the subject's internal area, for illustration
 * only ("דוגמאות לחלופות קיימות") -- never treated as a direct competitor. */
function pickRepresentativeListing(listings: JsonRecord[], targetArea: number | null): JsonRecord | null {
  const withArea = listings.filter((r) => r.area != null && r.asking_price != null);
  if (withArea.length === 0 || targetArea == null) return null;
  return withArea.reduce((best, r) => (Math.abs(r.area - targetArea) < Math.abs(best.area - targetArea) ? r : best));
}
