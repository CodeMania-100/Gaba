"use client";

import { useState } from "react";
import { PetahTikvaWorkspace, PtkFamily } from "@/lib/api";
import { confidenceExplanation, CONFIDENCE_COLORS, CONFIDENCE_LABELS, LANE_LABELS, ROOM_FAMILY_LABELS, translateWarning } from "@/lib/family";
import { ils, num } from "@/lib/format";
import EvidenceCard from "./EvidenceCard";
import MarketRangeExplanation from "./MarketRangeExplanation";
import ProductComparisonSection from "./ProductComparisonSection";

interface Props {
  family: PtkFamily;
  workspace: PetahTikvaWorkspace;
  onOpenEvidence: (lane: "sold" | "current_asking" | "new_development") => void;
}

/** Real floor range/orientation set for this family, computed from the
 * actual normalized assignment price list -- never from the enrichment
 * file's "subjects" block (that is QA/reference only, see task item 3). */
function subjectFloorAndOrientation(workspace: PetahTikvaWorkspace, family: PtkFamily) {
  const rows = workspace.price_list.filter((r) => r.family === family.family);
  const floors = rows.map((r) => (typeof r.floor === "number" ? r.floor : Number(r.floor))).filter((f) => Number.isFinite(f));
  const floorRange = floors.length > 0 ? `${Math.min(...floors)}–${Math.max(...floors)}` : null;
  const orientations = Array.from(new Set(rows.map((r) => r.orientation).filter((o): o is string => !!o)));
  const orientationLabel = orientations.length === 0 ? "לא נמסר" : orientations.length === 1 ? orientations[0] : `משתנה לפי יחידה (${orientations.join(", ")})`;
  return { floorRange, orientationLabel };
}

export default function FamilyPanel({ family, workspace, onOpenEvidence }: Props) {
  const [showTechnical, setShowTechnical] = useState(false);
  const { floorRange, orientationLabel } = subjectFloorAndOrientation(workspace, family);
  const familyKey = family.family === "3R" ? "standard_3r" : "standard_5r";

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-slate-300 bg-white p-5">
        {/* 1. subject / family */}
        <h2 className="text-lg font-bold text-slate-900">דירות {ROOM_FAMILY_LABELS[family.family] ?? family.family}</h2>
        <div className="mt-1 text-sm text-slate-600">
          {family.unit_count} יחידות · {num(family.target.internal_area)} מ״ר פנימי · {num(family.target.balcony_area)} מ״ר מרפסת
          {floorRange && <> · קומות {floorRange}</>} · כיוון: {orientationLabel}
        </div>

        {/* 2. supported market range */}
        <div className="mt-4">
          <div className="text-xs text-slate-500">טווח שוק נתמך</div>
          <div className="text-2xl font-bold text-slate-900">
            {family.market.supported_lower != null
              ? `${ils(family.market.supported_lower)} – ${ils(family.market.supported_upper)}`
              : "אין קונצנזוס"}
          </div>
          <div className="mt-1 text-sm text-slate-600">
            רמת ביטחון:{" "}
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${CONFIDENCE_COLORS[family.market.confidence] ?? ""}`}>
              {CONFIDENCE_LABELS[family.market.confidence] ?? family.market.confidence}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            {confidenceExplanation(family.market.confidence, family.market.support_lanes.length)}
          </p>
          <MarketRangeExplanation family={family} />
        </div>

        {/* 3. evidence sources that support it (compact checklist) */}
        <div className="mt-4">
          <div className="mb-1 text-xs text-slate-500">מבוסס על:</div>
          <ul className="flex flex-col gap-0.5 text-sm text-slate-700">
            {family.market.support_lanes.map((l) => (
              <li key={l} className="flex items-center gap-1.5">
                <span className="text-emerald-600">✓</span>
                {LANE_LABELS[l]?.title ?? l}
              </li>
            ))}
          </ul>
        </div>

        {/* 4. proposed baseline price */}
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="text-xs text-slate-500">מחיר בסיס מוצע</div>
          <div className="text-2xl font-bold text-slate-900">{ils(family.proposed_family_price_ils)}</div>
          <p className="mt-1 text-xs text-slate-500">
            מחיר הבסיס ממוקם באמצע טווח השוק לצורך ההדגמה. מדיניות התמחור המסחרית ניתנת לשינוי.
          </p>
        </div>

        {family.warnings.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1">
            {family.warnings.slice(0, 3).map((w, i) => (
              <span key={i} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                {translateWarning(w)}
              </span>
            ))}
          </div>
        )}

        <button
          onClick={() => setShowTechnical((v) => !v)}
          className="mt-3 text-xs text-slate-400 underline hover:text-slate-600"
        >
          {showTechnical ? "הסתרת פרטים טכניים" : "פרטים טכניים"}
        </button>
        {showTechnical && (
          <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-100 pt-2">
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              Engineering / demo strategy baseline
            </span>
            <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
              Not Gabay commercial strategy
            </span>
            {family.warnings.map((w, i) => (
              <span key={i} className="rounded bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-500">
                {w}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* full evidence detail cards */}
      <section className="grid gap-4 sm:grid-cols-3">
        <EvidenceCard lane="sold" data={family.evidence_lanes.sold} onClick={() => onOpenEvidence("sold")} />
        <EvidenceCard
          lane="current_asking"
          data={family.evidence_lanes.current_asking}
          onClick={() => onOpenEvidence("current_asking")}
        />
        <EvidenceCard
          lane="new_development"
          data={family.evidence_lanes.new_development}
          onClick={() => onOpenEvidence("new_development")}
        />
      </section>

      <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
        המערכת אינה מניחה שדירת יד שנייה ודירה חדשה הן אותו מוצר. עסקאות יד שנייה משמשות לעיגון השוק, הצעות קיימות
        מציגות חלופות לקונה, ופרויקטים חדשים משמשים להשוואת התחרות הישירה.
      </p>

      {/* 4. product comparison against strongest competitors */}
      <ProductComparisonSection
        family={family}
        familyKey={familyKey}
        enrichment={workspace.standard_attribute_enrichment}
        activePrice={family.proposed_family_price_ils}
        priceLabel="בסיס"
      />
    </div>
  );
}
