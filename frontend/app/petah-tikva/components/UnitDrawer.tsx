"use client";

import { useState } from "react";
import { pricingRouteOf, PetahTikvaWorkspace, PtkPriceListRow } from "@/lib/api";
import {
  CONFIDENCE_COLORS,
  CONFIDENCE_LABELS,
  confidenceExplanation,
  LANE_LABELS,
  outdoorLabel,
  roomsOf,
  STATUS_LABELS,
  unitTypeLabel,
} from "@/lib/family";
import { ils, isPointValue, num, rangeOrPoint } from "@/lib/format";
import SpecialUnitAnalysis from "./SpecialUnitAnalysis";
import MarketingDecisionChain from "./MarketingDecisionChain";
import StepHeading from "./StepHeading";
import {
  computeSalesProgress,
  familyBucketOf,
  FAMILY_BUCKET_LABELS,
  internalSaleForUnit,
  internalSalesForBucket,
  MarketingStrategyState,
  PROJECT_PHASE_LABELS,
} from "@/lib/marketingStrategy";

interface Props {
  row: PtkPriceListRow;
  workspace: PetahTikvaWorkspace;
  marketingStrategy: MarketingStrategyState;
  onChangeMarketingStrategy: (updater: (prev: MarketingStrategyState) => MarketingStrategyState) => void;
  // Closes the drawer and scrolls the main page to the family's full
  // evidence section (#evidence-section) with that family selected -- the
  // "הצג ראיות והשוואות" drill-down for standard units. Special units use
  // their own inline SpecialUnitAnalysis toggle instead (no page navigation
  // needed -- see SpecialBody below).
  onOpenFamilyEvidence: (family: "3R" | "5R") => void;
  onClose: () => void;
}

/**
 * Future SpecialUnitReviewService payload shape (not implemented yet). Kept here,
 * fully optional, so the drawer/price-list flow does not need to be rebuilt when
 * the special-unit methodology lands -- only this interface gets filled in and a
 * real section replaces the placeholder below.
 */
export interface SpecialReviewPayload {
  subject?: unknown;
  search_path?: unknown;
  sold_lane?: unknown;
  asking_lane?: unknown;
  new_development_lane?: unknown;
  difference_board?: unknown;
  family_anchor?: unknown;
  evidence_quality?: unknown;
  unknowns?: unknown;
  market_indication?: unknown;
  commercial_decision?: unknown;
}

/** Phase 3B/3C row-detail panel: four compact, numbered blocks (1. פרטי
 * הדירה, 2. אינדיקציית שוק, 3. מצב הפרויקט, 4. החלטת שיווק) -- never a dump
 * of every research record; the full evidence detail stays reachable
 * through each route's own drill-down (see onOpenFamilyEvidence /
 * SpecialUnitAnalysis). */
export default function UnitDrawer({ row, workspace, marketingStrategy, onChangeMarketingStrategy, onOpenFamilyEvidence, onClose }: Props) {
  const route = pricingRouteOf(row);
  const isSold = marketingStrategy.soldUnitNumbers.has(row.unit_number);
  const saleRecord = internalSaleForUnit(marketingStrategy, row.unit_number);

  return (
    <div className="fixed inset-0 z-50 flex justify-start bg-black/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">דירה {row.unit_number}</h2>
            <p className="text-xs text-slate-400">{route === "standard_family" ? "מסלול תמחור סטנדרטי" : "מסלול בדיקה פרטנית"}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            סגירה ✕
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-4">
          {isSold && (
            <section className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="font-semibold">נמכרה</p>
              {saleRecord ? (
                <p className="mt-1">
                  מחיר מכירה בפועל: <span className="font-bold">{ils(saleRecord.sale_price_ils)}</span>
                </p>
              ) : (
                <p className="mt-1 text-xs text-emerald-700">מחיר מכירה בפועל לא סופק</p>
              )}
              <p className="mt-1 text-[11px] text-emerald-700">
                ראייה פנימית של הפרויקט — אינה דורסת ראיות שוק חיצוניות (מיסוי/מדלן).
              </p>
            </section>
          )}

          {/* 1. פרטי הדירה */}
          <UnitFactsBlock row={row} isSold={isSold} />

          {/* 2. אינדיקציית שוק */}
          {route === "standard_family" ? (
            <MarketIndicationBlockStandard row={row} workspace={workspace} onOpenFamilyEvidence={onOpenFamilyEvidence} />
          ) : (
            <MarketIndicationBlockSpecial row={row} workspace={workspace} />
          )}

          {/* 3. מצב הפרויקט */}
          <ProjectStatusBlock row={row} workspace={workspace} state={marketingStrategy} />

          {/* 4. החלטת שיווק -- the strongest visual element in this drawer; owns
              its own header, styled to match StepHeading (see MarketingDecisionChain) */}
          <MarketingDecisionChain row={row} state={marketingStrategy} onChange={onChangeMarketingStrategy} />
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-medium text-slate-900">{value}</div>
    </div>
  );
}

// 1. פרטי הדירה
function UnitFactsBlock({ row, isSold }: { row: PtkPriceListRow; isSold: boolean }) {
  const rooms = roomsOf(row);
  return (
    <section>
      <StepHeading n={1} title="פרטי הדירה" />
      <div className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-sm">
        <Fact label="סוג" value={unitTypeLabel(row.family)} />
        <Fact label="חדרים" value={rooms != null ? String(rooms) : "—"} />
        <Fact label="שטח פנימי" value={row.internal_area_sqm != null ? `${num(row.internal_area_sqm)} מ״ר` : "—"} />
        <Fact label={outdoorLabel(row.family)} value={row.balcony_area_sqm != null ? `${num(row.balcony_area_sqm)} מ״ר` : "—"} />
        <Fact label="קומה" value={row.floor != null ? String(row.floor) : "—"} />
        <Fact label="כיוון אוויר" value={row.orientation ?? "—"} />
        <Fact label="חניה" value={row.parking != null ? String(row.parking) : "לא ידוע"} />
        <Fact label="מחסן" value={row.storage == null ? "לא ידוע" : row.storage ? "יש" : "אין"} />
        <Fact label="סטטוס" value={isSold ? "נמכרה" : STATUS_LABELS[row.status] ?? row.status} />
      </div>
    </section>
  );
}

// ב. אינדיקציית השוק -- standard 3R/5R route
function MarketIndicationBlockStandard({
  row,
  workspace,
  onOpenFamilyEvidence,
}: {
  row: PtkPriceListRow;
  workspace: PetahTikvaWorkspace;
  onOpenFamilyEvidence: (family: "3R" | "5R") => void;
}) {
  const family = workspace.families.find((f) => f.family === row.family);
  const confidence = row.market_range?.confidence;
  const lanes: ("sold" | "current_asking" | "new_development")[] = ["sold", "current_asking", "new_development"];

  return (
    <section>
      <StepHeading n={2} title="אינדיקציית שוק" />
      <div className="rounded-md border border-slate-200 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span
            className={`rounded px-2 py-1 text-xs font-medium ${CONFIDENCE_COLORS[confidence ?? ""] ?? "bg-slate-100 text-slate-700"}`}
            title={family ? confidenceExplanation(confidence ?? "insufficient", family.market.support_lanes.length) : undefined}
          >
            ביטחון {CONFIDENCE_LABELS[confidence ?? ""] ?? "—"}
          </span>
          {row.market_range?.lower != null && (
            <span className="text-xs text-slate-500">{rangeOrPoint(row.market_range.lower, row.market_range.upper)}</span>
          )}
        </div>
        {family && (
          <ul className="flex flex-col gap-1 text-sm">
            {lanes.map((lane) => {
              const used = family.market.support_lanes.includes(lane);
              const laneData = family.evidence_lanes[lane];
              return (
                <li key={lane} className="flex items-center justify-between">
                  <span className="text-slate-700">{LANE_LABELS[lane].title}</span>
                  <span className={used ? "text-emerald-700" : "text-slate-400"}>
                    {used ? "משתתף בחישוב" : "לא משתתף בחישוב"} · {CONFIDENCE_LABELS[laneData.confidence] ?? laneData.confidence}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <button
          onClick={() => onOpenFamilyEvidence(row.family as "3R" | "5R")}
          className="mt-3 text-xs text-slate-500 underline hover:text-slate-800"
        >
          הצג ראיות והשוואות
        </button>
      </div>
    </section>
  );
}

// ב. אינדיקציית השוק -- special (garden/duplex/triplex) route
function MarketIndicationBlockSpecial({ row, workspace }: { row: PtkPriceListRow; workspace: PetahTikvaWorkspace }) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  const context = workspace.special_unit_market_context.units[row.unit_number];
  const indication = context?.market_indication;
  const lanes: ("sold" | "current_asking" | "new_development")[] = ["sold", "current_asking", "new_development"];

  if (showAnalysis) {
    return <SpecialUnitAnalysis row={row} context={context} marketContext={workspace.special_unit_market_context} />;
  }

  return (
    <section>
      <StepHeading n={2} title="אינדיקציית שוק" />
      <div className="rounded-md border border-slate-200 p-3">
        {indication ? (
          <>
            <div className="mb-2 flex items-center gap-2">
              <span
                className={`rounded px-2 py-1 text-xs font-medium ${CONFIDENCE_COLORS[indication.confidence] ?? "bg-slate-100 text-slate-700"}`}
                title={indication.confidence_reason}
              >
                ביטחון {CONFIDENCE_LABELS[indication.confidence] ?? indication.confidence}
              </span>
              {indication.suggested_price_ils != null && (
                <span className="text-xs text-slate-500">
                  {ils(indication.suggested_price_ils)}
                  {!isPointValue(indication.indicative_lower_ils, indication.indicative_upper_ils) && (
                    <> ({rangeOrPoint(indication.indicative_lower_ils, indication.indicative_upper_ils)})</>
                  )}
                </span>
              )}
            </div>
            <ul className="flex flex-col gap-1 text-sm">
              {lanes.map((lane) => {
                const laneResult = indication.lanes[lane];
                const voting = indication.voting_lane_names.includes(lane);
                return (
                  <li key={lane} className="flex items-center justify-between">
                    <span className="text-slate-700">{LANE_LABELS[lane].title}</span>
                    <span className={voting ? "text-emerald-700" : laneResult ? "text-amber-700" : "text-slate-400"}>
                      {voting ? "משתתף בחישוב" : laneResult ? "הקשר בלבד" : "אין נתונים"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-sm text-slate-500">אין עדיין אינדיקציית שוק ליחידה זו — ממתינה לבדיקה פרטנית.</p>
        )}
        <button onClick={() => setShowAnalysis(true)} className="mt-3 text-xs text-slate-500 underline hover:text-slate-800">
          הצג ראיות והשוואות
        </button>
      </div>
    </section>
  );
}

// ג. מצב הפרויקט
function ProjectStatusBlock({ row, workspace, state }: { row: PtkPriceListRow; workspace: PetahTikvaWorkspace; state: MarketingStrategyState }) {
  const bucket = familyBucketOf(row);
  const progress = computeSalesProgress(workspace.price_list, state.soldUnitNumbers);
  const familyProgress = progress.byFamily[bucket];
  const relevantSales = internalSalesForBucket(state, bucket);

  return (
    <section>
      <StepHeading n={3} title="מצב הפרויקט" />
      <div className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-sm">
        <Fact label="שלב מכירות" value={PROJECT_PHASE_LABELS[state.projectPhase]} />
        <Fact label="קצב מכירה — כלל הפרויקט" value={`${num(progress.sellThroughPct, 0)}%`} />
        <Fact label={`קצב מכירה — ${FAMILY_BUCKET_LABELS[bucket]}`} value={`${num(familyProgress.sellThroughPct, 0)}%`} />
      </div>
      <div className="mt-2">
        <div className="mb-1 text-xs font-semibold text-slate-500">עסקאות שבוצעו בפרויקט (משפחה זו)</div>
        {relevantSales.length === 0 ? (
          <p className="rounded bg-slate-50 px-2 py-1.5 text-sm text-slate-500">לא סופקו נתוני מכירות שבוצעו בפרויקט במסגרת המטלה.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-slate-700">
            {relevantSales.map((s, i) => (
              <li key={i}>
                דירה {s.unit}: {ils(s.sale_price_ils)} — {s.sale_date}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
