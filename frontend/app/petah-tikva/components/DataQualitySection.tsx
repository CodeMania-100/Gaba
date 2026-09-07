"use client";

import { useState } from "react";
import { JsonRecord, PetahTikvaWorkspace, PtkFamily } from "@/lib/api";
import { LANE_LABELS, ROOM_FAMILY_LABELS, translateStage } from "@/lib/family";
import { ils, dateTimeIL } from "@/lib/format";

interface Props {
  workspace: PetahTikvaWorkspace;
  family: PtkFamily;
}

export default function DataQualitySection({ workspace, family }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const dq = workspace.data_quality;
  const meta = workspace.metadata as JsonRecord;
  const fam = family.family;

  const soldContributors = dq.funnel.sold[fam].quantitative_contributors;
  const askingContributors = dq.funnel.current_asking[fam].quantitative_contributors;
  const newDevContributors = dq.funnel.new_development[fam].quantitative_contributors;
  const supportingLanes = family.market.support_lanes.length;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-600">
          איכות הנתונים <span className="font-normal text-slate-400">— דירות {ROOM_FAMILY_LABELS[fam] ?? fam}</span>
        </h2>
        <button onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-slate-600 underline hover:text-slate-900">
          {expanded ? "הסתרה" : "איך הנתונים עובדו?"}
        </button>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
        <span>
          קבוצות השוואה בעסקאות שבוצעו: <b className="text-slate-900">{soldContributors}</b>
        </span>
        <span>
          מקורות בהיצע הנוכחי: <b className="text-slate-900">{askingContributors}</b>
        </span>
        <span>
          פרויקטים מתחרים כמותיים: <b className="text-slate-900">{newDevContributors}</b>
        </span>
        <span>
          ערוצי ראיות התומכים בתוצאה: <b className="text-slate-900">{supportingLanes}</b>
        </span>
      </div>

      {expanded && (
        <div className="mt-2 flex flex-col gap-4 border-t border-slate-200 pt-3">
          <div className="grid gap-4 lg:grid-cols-3">
            {(["sold", "current_asking", "new_development"] as const).map((lane) => (
              <FunnelCard key={lane} lane={lane} family={fam} data={dq.funnel[lane]} />
            ))}
          </div>
          <button
            onClick={() => setMethodologyOpen(true)}
            className="w-fit text-xs text-slate-500 underline hover:text-slate-800"
          >
            פרטים טכניים נוספים — מקורות, גרסאות ותאריכי איסוף
          </button>
        </div>
      )}

      {methodologyOpen && <MethodologyDrawer dq={dq} meta={meta} onClose={() => setMethodologyOpen(false)} />}
    </section>
  );
}

function FunnelCard({
  lane,
  family,
  data,
}: {
  lane: "sold" | "current_asking" | "new_development";
  family: "3R" | "5R";
  data: Record<"3R" | "5R", JsonRecord>;
}) {
  const d = data[family];
  const stages: string[] = d.stages;
  const values = stageValues(lane, d);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="text-sm font-semibold text-slate-800">{LANE_LABELS[lane].title}</h3>
      <div dir="ltr" className="mt-2 flex flex-wrap items-center justify-end gap-1 text-xs text-slate-700">
        {stages.map((stage, i) => (
          <span key={stage} className="flex items-center gap-1">
            <span className="rounded bg-slate-50 px-1.5 py-0.5" title={translateStage(stage)}>
              {values[i] != null ? values[i] : "—"}
            </span>
            {i < stages.length - 1 && <span className="text-slate-300">→</span>}
          </span>
        ))}
      </div>
      <div dir="ltr" className="mt-1 text-end text-[11px] leading-4 text-slate-400">
        {stages.map((s) => translateStage(s)).join(" ← ")}
      </div>
    </div>
  );
}

function stageValues(lane: string, d: JsonRecord): (number | null)[] {
  if (lane === "sold") {
    return [
      d.raw_source_records, d.raw_source_records, d.raw_source_records,
      null, null, d.independent_locations_at_freeze, d.quantitative_contributors,
    ];
  }
  if (lane === "current_asking") {
    return [d.raw_listings, d.accepted_target_size_and_submarket, d.accepted_target_size_and_submarket, d.independent_locations, d.quantitative_contributors];
  }
  return [d.discovered_records, d.exact_target_geography_projects, null, null, d.quantitative_projects_any_tier, d.quantitative_contributors];
}

function MethodologyDrawer({ dq, meta, onClose }: { dq: PetahTikvaWorkspace["data_quality"]; meta: JsonRecord; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="mt-8 w-full max-w-3xl rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">פרטים טכניים — מקורות ומתודולוגיה</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            סגירה ✕
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-6 py-4 flex flex-col gap-5">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">מקורות נתונים</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {dq.source_catalog.map((s) => (
                <li key={s.name} className="flex justify-between rounded bg-slate-50 px-3 py-1.5">
                  <span>{s.name}</span>
                  <span className="text-slate-400">{s.lane}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">שרשרת עיבוד</h3>
            <div dir="ltr" className="flex flex-wrap items-center gap-1 text-sm">
              {dq.pipeline_stages.map((s, i) => (
                <span key={s} className="flex items-center gap-1">
                  <span className="rounded bg-slate-900 px-2 py-1 text-xs text-white">{translateStage(s)}</span>
                  {i < dq.pipeline_stages.length - 1 && <span className="text-slate-300">→</span>}
                </span>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Yad2 nearby-deals — דוגמת העשרה ממוקדת</h3>
            <div className="rounded border border-slate-200 p-3 text-xs text-slate-700 flex flex-col gap-1">
              <p><b>שיטה:</b> {dq.nearby_deals_enrichment.method}</p>
              <p><b>מטרה:</b> {dq.nearby_deals_enrichment.purpose}</p>
              <p><b>עוגן דוגמה:</b> {dq.nearby_deals_enrichment.example_anchor} ({dq.nearby_deals_enrichment.example_record_count} רשומות)</p>
              <p><b>הצלבה:</b> {dq.nearby_deals_enrichment.cross_check}</p>
              <p><b>תוצאה:</b> {dq.nearby_deals_enrichment.result}</p>
              <p><b>עצמאות:</b> {dq.nearby_deals_enrichment.independence}</p>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">גרסאות מתודולוגיה ותאריכי תמונת מצב</h3>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
              {Object.entries(meta.methodology_versions as JsonRecord).map(([k, v]) => (
                <div key={k} className="rounded bg-slate-50 px-2 py-1">
                  {k}: <span className="font-medium">{String(v)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-700">
              {Object.entries(meta.frozen_timestamps as JsonRecord).map(([k, v]) => (
                <div key={k} className="rounded bg-slate-50 px-2 py-1">
                  {k}: <span className="font-medium">{dateTimeIL(v as string)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function CaseStudyCard3R({ caseStudy }: { caseStudy: JsonRecord }) {
  const revenue = caseStudy.standard_revenue_change_ils as JsonRecord;
  const after = caseStudy.after as JsonRecord;
  const afterRange = after.supported_range_ils as JsonRecord;
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h3 className="text-sm font-semibold text-amber-950">דוגמה להשפעת מידע חדש</h3>
      <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold text-amber-800">לפני</div>
          <p className="text-amber-900">2 מקורות שוק תמכו במחיר</p>
          <p className="text-amber-900">רמת ביטחון: בינונית</p>
        </div>
        <div>
          <div className="text-xs font-semibold text-amber-800">אחרי</div>
          <p className="text-amber-900">3 מקורות שוק תמכו במחיר</p>
          <p className="text-amber-900">רמת ביטחון: גבוהה</p>
        </div>
      </div>
      <p className="mt-2 text-xs text-amber-800">נוסף מידע מאומת משני פרויקטים חדשים.</p>
      <p className="mt-2 text-sm font-medium text-amber-950">
        טווח חדש: {ils(afterRange.lower)} – {ils(afterRange.upper)}
      </p>
      <p className="mt-1 text-sm font-semibold text-amber-950">
        הכנסות הבסיס עודכנו: {ils(revenue.before)} → {ils(revenue.after)}
      </p>
      <p className="mt-2 text-xs text-amber-700">המתודולוגיה לא השתנתה — הראיות השתפרו.</p>
    </section>
  );
}
