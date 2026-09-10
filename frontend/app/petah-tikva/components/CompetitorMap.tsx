"use client";

import { useState } from "react";
import { CompetitorRegisterProject, PetahTikvaWorkspace } from "@/lib/api";
import {
  areaRangeLabel,
  CLASSIFICATION_COLORS,
  CLASSIFICATION_LABELS,
  CompetitorFamilyFilter,
  CompetitorFilterGroup,
  developerLabel,
  matchesFamilyFilter,
  paymentTermsLabel,
  priceDisplayLabel,
  productTypesLabel,
  roomRangeLabel,
  standoutFeatureLabel,
} from "@/lib/competitorRegister";

interface Props {
  workspace: PetahTikvaWorkspace;
}

const GROUP_FILTERS: { key: CompetitorFilterGroup; label: string }[] = [
  { key: "all", label: "הכל" },
  { key: "direct", label: "תחרות ישירה" },
  { key: "relevant", label: "תחרות רלוונטית" },
  { key: "context", label: "הקשר שוק" },
];

const FAMILY_FILTERS: { key: CompetitorFamilyFilter; label: string }[] = [
  { key: "all", label: "הכל" },
  { key: "standard_3r", label: "3 חדרים" },
  { key: "standard_5r", label: "5 חדרים" },
  { key: "garden", label: "דירות גן" },
  { key: "duplex_penthouse", label: "דופלקס / פנטהאוז" },
  { key: "large_premium", label: "יחידות גדולות" },
];

export default function CompetitorMap({ workspace }: Props) {
  const [groupFilter, setGroupFilter] = useState<CompetitorFilterGroup>("all");
  const [familyFilter, setFamilyFilter] = useState<CompetitorFamilyFilter>("all");

  const landscape = workspace.competitor_landscape;
  const projects = landscape.projects.filter(
    (p) => (groupFilter === "all" || p.display_classification === groupFilter) && matchesFamilyFilter(p, familyFilter)
  );

  const h3 = landscape.quantitative_headline["3R"];
  const h5 = landscape.quantitative_headline["5R"];

  return (
    <section id="competitor-map-section" className="flex flex-col gap-4 rounded-lg border border-slate-300 bg-white p-5">
      <div>
        <h2 className="text-lg font-bold text-slate-900">מפת התחרות</h2>
        <p className="mt-1 text-sm text-slate-700">{landscape.project_count} פרויקטים רלוונטיים נותחו.</p>
        <p className="mt-1 text-sm text-slate-700">
          {h3.strict_contributor_count} פרויקטים עמדו בתנאים המחמירים להשפעה כמותית על טווח דירות 3 חדרים ·{" "}
          {h5.strict_contributor_count} פרויקטים עמדו בתנאים המחמירים להשפעה כמותית על טווח דירות 5 חדרים.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          פרויקטים נוספים משמשים להשוואת תחרות, מאפייני מוצר והקשר שוק — לא לחישוב טווח השוק הכמותי.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <FilterGroup options={GROUP_FILTERS} value={groupFilter} onChange={(v) => setGroupFilter(v as CompetitorFilterGroup)} />
        <FilterGroup options={FAMILY_FILTERS} value={familyFilter} onChange={(v) => setFamilyFilter(v as CompetitorFamilyFilter)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <CompetitorRegisterCard key={project.project_name} project={project} />
        ))}
      </div>

      {projects.length === 0 && <p className="text-sm text-slate-500">אין פרויקטים התואמים את הסינון הנבחר.</p>}
    </section>
  );
}

function FilterGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-slate-300">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`px-3 py-1.5 text-sm font-medium transition ${
            value === opt.key ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function CompetitorRegisterCard({ project }: { project: CompetitorRegisterProject }) {
  const [showSource, setShowSource] = useState(false);

  const location = (project.address as string | null) ?? (project.neighborhood as string | null) ?? "—";
  const developer = developerLabel(project);
  const rooms = roomRangeLabel(project);
  const area = areaRangeLabel(project);
  const price = priceDisplayLabel(project);
  const products = productTypesLabel(project);
  const standout = standoutFeatureLabel(project);
  const terms = paymentTermsLabel(project);
  const classification = project.display_classification;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-900">{project.project_name}</div>
          <div className="text-xs text-slate-500">יזם: {developer ?? "לא פורסם"}</div>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${CLASSIFICATION_COLORS[classification]}`}>
          {CLASSIFICATION_LABELS[classification]}
        </span>
      </div>

      <dl className="flex flex-col gap-1 text-sm">
        <Row label="מיקום" value={location} />
        {products && <Row label="סוגי דירות" value={products} />}
        {(rooms || area) && <Row label="חדרים / שטח" value={[rooms, area].filter(Boolean).join(" · ")} />}
        {price && <Row label="מחיר" value={price} />}
        {standout && <Row label="מאפיין בולט" value={standout} />}
        {terms && <Row label="תנאי תשלום" value={terms} />}
      </dl>

      <button onClick={() => setShowSource((v) => !v)} className="mt-1 w-fit text-xs text-slate-400 underline hover:text-slate-600">
        {showSource ? "הסתרת מקור ופרטים" : "מקור ופרטים"}
      </button>

      {showSource && (
        <div className="mt-1 rounded border border-dashed border-slate-300 p-2 text-xs text-slate-500">
          <div className="font-semibold text-slate-600">כשירות כמותית לטווח השוק:</div>
          <ul className="list-inside list-disc">
            {Object.entries(project.quantitative_eligibility).map(([family, verdict]) => (
              <li key={family}>
                {family === "standard_3r" ? "3 חדרים" : family === "standard_5r" ? "5 חדרים" : family}:{" "}
                {verdict.eligible ? "עומד בתנאים" : "אינו עומד בתנאים"} — {verdict.reason}
              </li>
            ))}
          </ul>
          {((project.source_urls as string[] | undefined)?.length ?? 0) > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-slate-600">מקורות:</div>
              {(project.source_urls as string[]).map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="block break-all text-blue-700 underline">
                  {url}
                </a>
              ))}
            </div>
          )}
          {((project.warnings as string[] | undefined)?.length ?? 0) > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-slate-600">אזהרות:</div>
              <ul className="list-inside list-disc">
                {(project.warnings as string[]).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-slate-400">{label}</dt>
      <dd className="text-end font-medium text-slate-800">{value}</dd>
    </div>
  );
}
