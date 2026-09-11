"use client";

import { useState } from "react";
import { PetahTikvaWorkspace, PtkPriceListRow } from "@/lib/api";
import { FAMILY_BUCKET_LABELS, MarketingStrategyState } from "@/lib/marketingStrategy";
import { ils, num } from "@/lib/format";
import {
  buildConsistencySummary,
  buildFamilyLadder,
  ConsistencyFinding,
  FamilyLadderRow,
  unit3637Finding,
} from "@/lib/priceListConsistency";
import { outdoorLabel, unitTypeLabel } from "@/lib/family";
import StandardFeatureFindings from "./StandardFeatureFindings";

interface Props {
  workspace: PetahTikvaWorkspace;
  rows: PtkPriceListRow[];
  state: MarketingStrategyState;
  onSelectUnit: (row: PtkPriceListRow) => void;
}

const STATUS_LABELS: Record<ConsistencyFinding["status"], string> = {
  explained: "פער מוסבר",
  needs_review: "פער לבדיקה",
  consistent: "עקבי",
};

const STATUS_STYLES: Record<ConsistencyFinding["status"], string> = {
  explained: "bg-slate-100 text-slate-700",
  needs_review: "bg-amber-100 text-amber-900",
  consistent: "bg-slate-100 text-slate-500",
};

/** "בדיקת עקביות המחירון" -- decision-support review of the 39-unit
 * proposed price list (task "Focused Batch — Price List Consistency
 * Review"). Every number here is a plain re-read of computePriceBreakdown's
 * already-existing output (see lib/priceListConsistency.ts); nothing here
 * is a new valuation model, and no physical difference is ever monetized.
 * The tool only traces a price difference back to a known input (market
 * indication, or an explicit strategy adjustment) or, failing that, flags
 * it for human review -- it never calls a price right or wrong. */
export default function PriceListConsistency({ workspace, rows, state, onSelectUnit }: Props) {
  const [showFullLadder, setShowFullLadder] = useState(false);
  const summary = buildConsistencySummary(rows, state);
  const pairFinding = unit3637Finding(rows, state);
  // The 36/37 pair always gets its own rich card (task item 7) -- excluded
  // from the generic compact findings list below so it isn't shown twice.
  const otherFindings = summary.findings.filter((f) => f.id !== pairFinding?.id);

  const openUnit = (unitNumber: string) => {
    const row = rows.find((r) => r.unit_number === unitNumber);
    if (row) onSelectUnit(row);
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-300 bg-white p-5">
      <div>
        <h2 className="text-lg font-bold text-slate-900">בדיקת עקביות המחירון</h2>
        <p className="text-xs text-slate-500">איתור פערים בין דירות דומות כדי לוודא שהמחירון משקף החלטה מסחרית מכוונת.</p>
      </div>

      {/* KPIs (task item 9) */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md bg-slate-50 px-3 py-2.5 text-sm">
        <span className="font-semibold text-slate-800">{summary.unitsReviewed} יחידות נבדקו</span>
        <span className="text-slate-600">
          פערים מוסברים: <span className="font-semibold text-slate-800">{summary.explainedCount}</span>
        </span>
        <span className="text-slate-600">
          פערים לבדיקה: <span className="font-semibold text-amber-800">{summary.needsReviewCount}</span>
        </span>
        {summary.needsReviewCount === 0 && <span className="text-xs text-emerald-700">לא נמצאו פערים לא מוסברים במחירון</span>}
      </div>

      {/* Compact findings (standard families only -- 36/37 gets its own card below) */}
      {otherFindings.length > 0 && (
        <div className="flex flex-col gap-2">
          {otherFindings.map((f) => (
            <FindingCard key={f.id} finding={f} onOpenUnit={openUnit} />
          ))}
        </div>
      )}

      {/* Unit 36/37 -- the one defensible special-unit comparison (task item 7) */}
      {pairFinding && <Unit3637Card finding={pairFinding} onOpenUnit={openUnit} />}

      {/* Full standard-family ladders (task items 4, 16) */}
      <div>
        <button onClick={() => setShowFullLadder((v) => !v)} className="text-xs font-medium text-slate-500 underline hover:text-slate-800">
          {showFullLadder ? "הסתרת המחירון לפי קומה" : "הצג את כל המחירון לפי קומה"}
        </button>
        {showFullLadder && (
          <div className="mt-3 flex flex-col gap-5">
            {(["3R", "5R"] as const).map((family) => (
              <FamilyLadderSection key={family} workspace={workspace} rows={rows} state={state} family={family} onOpenUnit={openUnit} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function DiffHeadline({ finding }: { finding: ConsistencyFinding }) {
  const sign = finding.diffIls >= 0 ? "+" : "";
  return (
    <span className="font-semibold tabular-nums text-slate-800">
      {sign}
      {ils(finding.diffIls)} · {sign}
      {num(finding.diffPct, 1)}%
    </span>
  );
}

function ExplanationLines({ finding }: { finding: ConsistencyFinding }) {
  return (
    <div className="mt-1.5 flex flex-col gap-0.5 text-xs text-slate-600">
      <p>{finding.unitAdjustmentLine}</p>
      <p>{finding.groupAdjustmentLine}</p>
      <p>{finding.marketIndicationLine}</p>
      {finding.rationale && (
        <p className="mt-0.5 text-slate-500">
          <span className="font-medium text-slate-600">נימוק: </span>
          {finding.rationale.text}
        </p>
      )}
      {finding.rationaleMissing && <p className="mt-0.5 text-[11px] text-amber-700">לא הוזן נימוק להתאמה</p>}
    </div>
  );
}

function FindingCard({ finding, onOpenUnit }: { finding: ConsistencyFinding; onOpenUnit: (unitNumber: string) => void }) {
  const isExplained = finding.status === "explained";
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">{isExplained ? "פער במחיר בין דירות דומות" : "פער לבדיקה"}</span>
        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[finding.status]}`}>{STATUS_LABELS[finding.status]}</span>
      </div>
      <p className="text-sm text-slate-700">
        דירה {finding.unitA.row.unit_number} לעומת דירה {finding.unitB.row.unit_number} ({finding.groupLabel})
      </p>
      <p className="mt-0.5 text-sm">
        פער: <DiffHeadline finding={finding} />
      </p>

      {isExplained ? (
        <div className="mt-1.5">
          <p className="text-xs font-medium text-slate-500">הסבר שנמצא:</p>
          <ExplanationLines finding={finding} />
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-slate-600">
          נמצא פער של {ils(Math.abs(finding.diffIls))} בין דירות בעלות מאפיינים דומים.
          <br />
          לא נמצא נימוק מסחרי מתועד שמסביר את הפער.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        <button onClick={() => onOpenUnit(finding.unitA.row.unit_number)} className="text-xs text-slate-500 underline hover:text-slate-800">
          פתח את הדירות להשוואה — דירה {finding.unitA.row.unit_number}
        </button>
        <button onClick={() => onOpenUnit(finding.unitB.row.unit_number)} className="text-xs text-slate-500 underline hover:text-slate-800">
          דירה {finding.unitB.row.unit_number}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unit 36/37 (task item 7) -- always shown, full facts table.
// ---------------------------------------------------------------------------

function Unit3637Card({ finding, onOpenUnit }: { finding: ConsistencyFinding; onOpenUnit: (unitNumber: string) => void }) {
  const a = finding.unitA.row; // 36
  const b = finding.unitB.row; // 37
  const marketA = finding.unitA.breakdown.marketIndicationIls;
  const marketB = finding.unitB.breakdown.marketIndicationIls;
  const proposedA = finding.unitA.breakdown.proposedIls;
  const proposedB = finding.unitB.breakdown.proposedIls;
  const sameMarket = marketA != null && marketB != null && Math.abs(marketA - marketB) < 1;
  const samePrice = proposedA != null && proposedB != null && Math.abs(proposedA - proposedB) < 500;

  const tableRows: { label: string; a: string; b: string }[] = [
    { label: "סוג", a: unitTypeLabel(a.family), b: unitTypeLabel(b.family) },
    { label: "חדרים", a: a.rooms != null ? num(a.rooms) : "—", b: b.rooms != null ? num(b.rooms) : "—" },
    { label: "שטח פנימי", a: a.internal_area_sqm != null ? num(a.internal_area_sqm) : "—", b: b.internal_area_sqm != null ? num(b.internal_area_sqm) : "—" },
    { label: outdoorLabel(a.family), a: a.balcony_area_sqm != null ? num(a.balcony_area_sqm) : "—", b: b.balcony_area_sqm != null ? num(b.balcony_area_sqm) : "—" },
    { label: "קומות", a: a.floor != null ? String(a.floor) : "—", b: b.floor != null ? String(b.floor) : "—" },
    { label: "כיוון", a: a.orientation ?? "—", b: b.orientation ?? "—" },
    { label: "אינדיקציית שוק", a: ils(marketA), b: ils(marketB) },
    { label: "התאמה לדירה", a: `${finding.unitA.unitAdjustment.adjustment_pct}%`, b: `${finding.unitB.unitAdjustment.adjustment_pct}%` },
    { label: "מחיר מוצע", a: ils(proposedA), b: ils(proposedB) },
  ];

  return (
    <div className="rounded-md border-2 border-slate-300 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">דירה 36 מול דירה 37 — טריפלקס 6 חדרים</span>
        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${samePrice ? STATUS_STYLES.consistent : STATUS_STYLES[finding.status]}`}>
          {samePrice ? STATUS_LABELS.consistent : STATUS_LABELS[finding.status]}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-slate-400">
              <th className="text-start font-medium"></th>
              <th className="text-start font-medium">דירה 36</th>
              <th className="text-start font-medium">דירה 37</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r) => (
              <tr key={r.label} className="border-t border-slate-100">
                <td className="py-1 text-slate-500">{r.label}</td>
                <td className="py-1 font-medium text-slate-900">{r.a}</td>
                <td className="py-1 font-medium text-slate-900">{r.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {samePrice ? (
        <div className="mt-2 rounded bg-slate-50 p-2 text-xs">
          <p className="font-semibold text-slate-700">מחיר זהה</p>
          <p className="mt-0.5 text-slate-600">למרות הבדלים בשטח ובכיוון, לא הוגדרה כרגע התאמה מסחרית שונה בין היחידות.</p>
        </div>
      ) : (
        <div className="mt-2 rounded bg-slate-50 p-2 text-xs">
          <p className="text-slate-700">
            דירה {finding.diffIls >= 0 ? b.unit_number : a.unit_number} מתומחרת ב־{ils(Math.abs(finding.diffIls))}{" "}
            {finding.diffIls >= 0 ? "יותר" : "פחות"} מדירה {finding.diffIls >= 0 ? a.unit_number : b.unit_number}.
          </p>
          <p className="mt-1 font-medium text-slate-500">מקור הפער:</p>
          <ExplanationLines finding={finding} />
        </div>
      )}

      {!sameMarket && (
        <p className="mt-1.5 text-[11px] text-slate-400">שימו לב: אינדיקציית השוק עצמה אינה זהה בין שתי הדירות (ראו טבלה למעלה).</p>
      )}

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        <button onClick={() => onOpenUnit("36")} className="text-xs text-slate-500 underline hover:text-slate-800">
          פתח דירה 36
        </button>
        <button onClick={() => onOpenUnit("37")} className="text-xs text-slate-500 underline hover:text-slate-800">
          פתח דירה 37
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full standard-family ladder (task items 4, 12, 16)
// ---------------------------------------------------------------------------

function FamilyLadderSection({
  workspace,
  rows,
  state,
  family,
  onOpenUnit,
}: {
  workspace: PetahTikvaWorkspace;
  rows: PtkPriceListRow[];
  state: MarketingStrategyState;
  family: "3R" | "5R";
  onOpenUnit: (unitNumber: string) => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const ladder = buildFamilyLadder(rows, state, family);
  const familyKey = family === "3R" ? "standard_3r" : "standard_5r";

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">{FAMILY_BUCKET_LABELS[family]}</span>
        <button onClick={() => setShowEvidence((v) => !v)} className="text-[11px] text-slate-400 underline hover:text-slate-600">
          {showEvidence ? "הסתרת ראיות לקומה" : "הצג ראיות לקומה"}
        </button>
      </div>
      <p className="mb-1.5 text-[11px] text-slate-400">נתוני השוק שנבדקו אינם תומכים כרגע בכלל כספי קבוע לקומה.</p>
      {showEvidence && (
        <div className="mb-2">
          <StandardFeatureFindings family={workspace.standard_attribute_enrichment.families[familyKey]} familyKey={familyKey} />
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
              <th className="px-2 py-1.5 text-start font-medium">דירה</th>
              <th className="px-2 py-1.5 text-start font-medium">קומה</th>
              <th className="px-2 py-1.5 text-start font-medium">אינדיקציית שוק</th>
              <th className="px-2 py-1.5 text-start font-medium">התאמה כוללת</th>
              <th className="px-2 py-1.5 text-start font-medium">מחיר מוצע</th>
              <th className="px-2 py-1.5 text-start font-medium">שינוי מול היחידה הקודמת</th>
            </tr>
          </thead>
          <tbody>
            {ladder.map((r) => (
              <LadderRow key={r.unitNumber} row={r} onOpenUnit={onOpenUnit} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LadderRow({ row, onOpenUnit }: { row: FamilyLadderRow; onOpenUnit: (unitNumber: string) => void }) {
  return (
    <tr className="border-t border-slate-100">
      <td className="px-2 py-1">
        <button onClick={() => onOpenUnit(row.unitNumber)} className="font-medium text-slate-800 underline hover:text-slate-950">
          דירה {row.unitNumber}
        </button>
      </td>
      <td className="px-2 py-1 text-slate-600">{row.floor ?? "—"}</td>
      <td className="px-2 py-1 text-slate-600">{ils(row.marketIndicationIls)}</td>
      <td className={`px-2 py-1 tabular-nums ${row.totalPct > 0 ? "text-emerald-700" : row.totalPct < 0 ? "text-red-700" : "text-slate-400"}`}>
        {row.totalPct !== 0 ? `${row.totalPct > 0 ? "+" : ""}${row.totalPct}%` : "0%"}
      </td>
      <td className="px-2 py-1 font-medium text-slate-900">{ils(row.proposedIls)}</td>
      <td className="px-2 py-1 tabular-nums text-slate-500">
        {row.deltaVsPreviousIls == null ? "—" : row.deltaVsPreviousIls === 0 ? "₪0" : `${row.deltaVsPreviousIls > 0 ? "+" : ""}${ils(row.deltaVsPreviousIls)}`}
      </td>
    </tr>
  );
}
