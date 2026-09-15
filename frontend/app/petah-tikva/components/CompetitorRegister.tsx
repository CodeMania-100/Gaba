"use client";

import { useState } from "react";
import { CommercialConflict, CompetitorRegisterProject, PetahTikvaWorkspace } from "@/lib/api";
import {
  areaRangeLabel,
  CLASSIFICATION_COLORS,
  CLASSIFICATION_LABELS,
  CompetitorFamilyFilter,
  CompetitorFilterGroup,
  developerLabel,
  matchedVariantSummary,
  matchesFamilyFilter,
  multiModelSummaryLabel,
  paymentTermsLabel,
  priceDisplayLabel,
  productTypesLabel,
  registerPromotionLabels,
  registerSpecificationLabels,
  roomRangeLabel,
  standoutFeatureLabel,
} from "@/lib/competitorRegister";
import { num } from "@/lib/format";
import { ProjectPhase } from "@/lib/marketingStrategy";
import {
  commercialSourceLine,
  compactCommercialOfferLine,
  conflictNote,
  deriveCommercialOfferSummary,
  findCommercialProject,
} from "@/lib/commercialTerms";
import MarketPositionSection from "./MarketPositionSection";

interface Props {
  workspace: PetahTikvaWorkspace;
  projectPhase: ProjectPhase;
  family: "3R" | "5R";
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

const COLLAPSED_PROJECT_COUNT = 6;

/** "מול מי אנחנו מתחרים?" (Tab 2-ב). Positioning leads (where our price
 * sits vs. the market) -- the register itself is the concise, secondary
 * piece: a capped grid of project cards with an explicit expand action,
 * never the whole register dumped open by default. This *is* the single
 * canonical competitor register grid (renamed from CompetitorMap.tsx, which
 * despite its old name was never a map -- see MarketGeoMap.tsx for the real
 * geographic view, Tab א). No new comparison logic lives here. */
export default function CompetitorRegister({ workspace, projectPhase, family }: Props) {
  const [groupFilter, setGroupFilter] = useState<CompetitorFilterGroup>("all");
  const [familyFilter, setFamilyFilter] = useState<CompetitorFamilyFilter>("all");
  const [showAllProjects, setShowAllProjects] = useState(false);

  const landscape = workspace.competitor_landscape;
  const projects = landscape.projects.filter(
    (p) => (groupFilter === "all" || p.display_classification === groupFilter) && matchesFamilyFilter(p, familyFilter)
  );
  const visibleProjects = showAllProjects ? projects : projects.slice(0, COLLAPSED_PROJECT_COUNT);
  // The currently selected family's own target area -- see
  // matchedVariantSummary's own docstring (task: "one canonical matched
  // competitor variant for every selected comparison subject"). Computed
  // once here, not per-card, since it's the same value for every card.
  const subjectAreaSqm = workspace.families.find((f) => f.family === family)?.target.internal_area ?? null;

  const h3 = landscape.quantitative_headline["3R"];
  const h5 = landscape.quantitative_headline["5R"];

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border-2 border-ink/80 bg-gradient-to-b from-canvas to-surface p-5">
        <MarketPositionSection workspace={workspace} projectPhase={projectPhase} family={family} />
      </div>

      <section id="competitor-register-section" className="flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-lg font-bold text-ink">מרשם המתחרים</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {landscape.project_count} פרויקטים רלוונטיים נותחו · {h3.strict_contributor_count} תרמו לטווח 3 חדרים · {h5.strict_contributor_count} תרמו לטווח 5 חדרים.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <FilterGroup options={GROUP_FILTERS} value={groupFilter} onChange={(v) => setGroupFilter(v as CompetitorFilterGroup)} />
          <FilterGroup options={FAMILY_FILTERS} value={familyFilter} onChange={(v) => setFamilyFilter(v as CompetitorFamilyFilter)} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleProjects.map((project) => (
            <CompetitorRegisterCard
              key={project.project_name}
              workspace={workspace}
              project={project}
              family={family}
              familyFilter={familyFilter}
              subjectAreaSqm={subjectAreaSqm}
            />
          ))}
        </div>

        {projects.length === 0 && <p className="text-sm text-ink-muted">אין פרויקטים התואמים את הסינון הנבחר.</p>}

        {projects.length > COLLAPSED_PROJECT_COUNT && (
          <button onClick={() => setShowAllProjects((v) => !v)} className="w-fit text-xs text-ink-muted underline hover:text-ink">
            {showAllProjects ? "הצג פחות" : `הצג את כל הפרויקטים (${projects.length})`}
          </button>
        )}
      </section>
    </div>
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
    <div className="flex overflow-hidden rounded-md border border-hairline">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`px-3 py-1.5 text-sm font-medium transition ${
            value === opt.key ? "bg-ink text-surface" : "bg-surface text-ink-muted hover:bg-canvas"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function CompetitorRegisterCard({
  workspace,
  project,
  family,
  familyFilter,
  subjectAreaSqm,
}: {
  workspace: PetahTikvaWorkspace;
  project: CompetitorRegisterProject;
  family: "3R" | "5R";
  familyFilter: CompetitorFamilyFilter;
  subjectAreaSqm: number | null;
}) {
  const [showSource, setShowSource] = useState(false);

  // Commercial-terms enrichment (multi_city_commercial_terms_enrichment_v1)
  // -- a separate, display-only research layer covering 13 curated
  // competitors. Absent for most projects; that absence must never be
  // interpreted as "no financing/no promotion/no terms" (see lib/
  // commercialTerms.ts's own module docstring), so every value below stays
  // optional and the whole block renders nothing when there's no record.
  const commercialProject = findCommercialProject(workspace, project.project_name, (project.project_id as string | undefined) ?? null);
  const commercialSummary = deriveCommercialOfferSummary(commercialProject);
  const compactCommercialLine = compactCommercialOfferLine(commercialSummary);

  const location = (project.address as string | null) ?? (project.neighborhood as string | null) ?? "—";
  const developer = developerLabel(project);
  const products = productTypesLabel(project);
  const standout = standoutFeatureLabel(project);
  const terms = paymentTermsLabel(project);
  const classification = project.display_classification;

  // P0 fix ("matched-variant fact consistency"): while Tab 2 is scoped to a
  // selected family (the same 3R/5R selection every other surface here
  // already follows), prefer THIS project's own matched model for that
  // family -- rooms/area/price all read from the one matchedVariantSummary
  // bundle, never independently (task: "3 חדרים · 71 מ״ר · ₪3.7M", never a
  // project-wide range that happens to show "—" for a field the matched
  // model actually has). Only when this project has no model at all for the
  // selected family -- or the register's own explicit "הכל" filter is
  // active, where the visible cards legitimately span several room counts --
  // does the card fall back to a compact multi-model summary, and only when
  // that project even has more than one distinct priced model; otherwise the
  // existing project-wide range (itself now variant-fallback-aware, see
  // lib/competitorRegister.ts) is exactly as informative and is kept.
  const familyRooms = family === "3R" ? 3 : 5;
  const matched = matchedVariantSummary(project, familyRooms, subjectAreaSqm);
  const multiModel = !matched && familyFilter === "all" ? multiModelSummaryLabel(project) : null;

  const rooms = matched ? `${num(matched.rooms)} חדרים` : roomRangeLabel(project);
  const area = matched ? matched.areaLabel : areaRangeLabel(project);
  const roomsArea = multiModel ?? ([rooms, area].filter(Boolean).join(" · ") || null);
  const price = matched ? matched.priceLabel : priceDisplayLabel(project);
  const promotions = registerPromotionLabels(project);
  const specification = registerSpecificationLabels(project);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-hairline p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-ink">{project.project_name}</div>
          <div className="text-xs text-ink-muted">יזם: {developer ?? "לא פורסם"}</div>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${CLASSIFICATION_COLORS[classification]}`}>
          {CLASSIFICATION_LABELS[classification]}
        </span>
      </div>

      <dl className="flex flex-col gap-1 text-sm">
        <Row label="מיקום" value={location} />
        {products && <Row label="סוגי דירות" value={products} />}
        {roomsArea && <Row label="חדרים / שטח" value={roomsArea} />}
        {price && <Row label="מחיר" value={price} />}
        {standout && <Row label="מאפיין בולט" value={standout} />}
        {terms && <Row label="תנאי תשלום" value={terms} />}
        {compactCommercialLine && <Row label="תנאי עסקה" value={compactCommercialLine} />}
      </dl>

      <button onClick={() => setShowSource((v) => !v)} className="mt-1 w-fit text-xs text-ink-muted underline hover:text-ink">
        {showSource ? "הסתרת מקור ופרטים" : "מקור ופרטים"}
      </button>

      {showSource && (
        <div className="mt-1 rounded border border-dashed border-hairline p-2 text-xs text-ink-muted">
          <div className="font-semibold text-ink-muted">כשירות כמותית לטווח השוק:</div>
          <ul className="list-inside list-disc">
            {Object.entries(project.quantitative_eligibility).map(([family, verdict]) => (
              <li key={family}>
                {family === "standard_3r" ? "3 חדרים" : family === "standard_5r" ? "5 חדרים" : family}:{" "}
                {verdict.eligible ? "עומד בתנאים" : "אינו עומד בתנאים"} — {verdict.reason}
              </li>
            ))}
          </ul>
          {/* P0 fix ("surface existing promotions and specification_features
              wherever competitor details are expanded") -- compact, real
              stored facts only, never converted to a monetary value; an
              empty array omits the whole section rather than showing it
              blank. */}
          {promotions.length > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-ink-muted">הטבות / מבצעים:</div>
              <ul className="list-inside list-disc">
                {promotions.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {specification.length > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-ink-muted">מפרט ומאפיינים:</div>
              <ul className="list-inside list-disc">
                {specification.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {commercialSummary && <CommercialOfferDetails summary={commercialSummary} conflicts={commercialProject?.conflicts ?? []} />}
          {((project.source_urls as string[] | undefined)?.length ?? 0) > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-ink-muted">מקורות:</div>
              {(project.source_urls as string[]).map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="block break-all text-accent underline">
                  {url}
                </a>
              ))}
            </div>
          )}
          {((project.warnings as string[] | undefined)?.length ?? 0) > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-ink-muted">אזהרות:</div>
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
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="text-end font-medium text-ink">{value}</dd>
    </div>
  );
}

/** "תנאי העסקה וההטבות" -- the full per-field commercial breakdown (section
 * 23 of the commercial-terms enrichment task), shown only inside the
 * already-existing "מקור ופרטים" expansion, never in the compact card. Each
 * field honors UNKNOWN -> omitted (never "אין"); conflicts are shown as
 * separate preserved observations, never interpreted as a discount; sources
 * are auditable name + retrieved-at + link. */
function CommercialOfferDetails({
  summary,
  conflicts,
}: {
  summary: NonNullable<ReturnType<typeof deriveCommercialOfferSummary>>;
  conflicts: CommercialConflict[];
}) {
  const hasAnyField =
    summary.paymentLabel != null ||
    summary.financingLabels.length > 0 ||
    summary.indexationLabel != null ||
    summary.promotionLabels.length > 0 ||
    summary.includedBenefitLabels.length > 0 ||
    summary.deliveryLabel != null;

  if (!hasAnyField && !summary.hasConflicts && summary.sources.length === 0) return null;

  return (
    <div className="mt-2">
      <div className="font-semibold text-ink-muted">תנאי העסקה וההטבות:</div>
      <ul className="list-inside list-disc">
        {summary.paymentLabel && <li>תנאי תשלום: {summary.paymentLabel}</li>}
        {summary.financingLabels.map((line, i) => (
          <li key={`fin-${i}`}>{line}</li>
        ))}
        {summary.indexationLabel && <li>מדד תשומות בנייה: {summary.indexationLabel}</li>}
        {summary.deliveryLabel && <li>{summary.deliveryLabel}</li>}
        {summary.includedBenefitLabels.length > 0 && <li>כלול / מאפייני הצעה: {summary.includedBenefitLabels.join(" · ")}</li>}
        {summary.promotionLabels.map((p, i) => (
          <li key={`promo-${i}`}>{p}</li>
        ))}
      </ul>

      {summary.hasConflicts && (
        <div className="mt-2 rounded bg-canvas p-2">
          <div className="font-semibold text-ink-muted">נמצאו תצפיות מחיר שונות במועדים/מקורות שונים:</div>
          <ul className="list-inside list-disc">
            {conflicts.map((c, i) => (
              <li key={i}>{conflictNote(c)}</li>
            ))}
          </ul>
        </div>
      )}

      {summary.sources.length > 0 && (
        <div className="mt-2">
          <div className="font-semibold text-ink-muted">מקורות מסחריים:</div>
          {summary.sources.map((s, i) => (
            <a key={i} href={s.source_url} target="_blank" rel="noreferrer" className="block break-all text-accent underline">
              {commercialSourceLine(s)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
