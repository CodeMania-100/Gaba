"use client";

import { useState } from "react";
import { pricingRouteOf, PetahTikvaWorkspace, PtkPriceListRow } from "@/lib/api";
import { CONFIDENCE_COLORS, CONFIDENCE_LABELS, confidenceExplanation, LANE_LABELS, roomsOf, STATUS_LABELS, unitTypeLabel } from "@/lib/family";
import { ils, num, rangeOrPoint } from "@/lib/format";
import MarketingDecisionChain from "./MarketingDecisionChain";
import SpecialUnitDecisionPanel from "./SpecialUnitDecisionPanel";
import StandardFeatureFindings from "./StandardFeatureFindings";
import StepHeading from "./StepHeading";
import EvidenceCard from "./EvidenceCard";
import EvidenceDetailModal from "./EvidenceDetailModal";
import {
  computePriceBreakdown,
  computeSalesProgress,
  familyBucketOf,
  FAMILY_BUCKET_LABELS,
  internalSaleForUnit,
  internalSalesForBucket,
  MarketingStrategyState,
  PROJECT_PHASE_LABELS,
  sellThroughGapPoints,
} from "@/lib/marketingStrategy";
import { ApartmentParameterRow, deriveApartmentParameterRows, PARAMETER_STATUS_LABELS } from "@/lib/apartmentParameters";
import { buildConsistencySummary } from "@/lib/priceListConsistency";

interface Props {
  row: PtkPriceListRow;
  workspace: PetahTikvaWorkspace;
  marketingStrategy: MarketingStrategyState;
  onChangeMarketingStrategy: (updater: (prev: MarketingStrategyState) => MarketingStrategyState) => void;
  // Closes the drawer and scrolls the main page to the family's full
  // evidence section with that family selected -- the "הצג ראיות והשוואות"
  // drill-down for standard units. Special units use their own inline
  // SpecialUnitAnalysis toggle instead (no page navigation needed).
  onOpenFamilyEvidence: (family: "3R" | "5R") => void;
  // "הצג את ראיות השוק על המפה" -- closes the drawer, switches MarketGeoMap
  // to this exact unit (special basket, or standard family), and scrolls to
  // it. A separate destination from onOpenFamilyEvidence above (the
  // research tables), not a replacement.
  onOpenMapEvidence: (row: PtkPriceListRow) => void;
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

/** Row-detail panel. First screenful answers exactly five questions: which
 * apartment, what market range, what proposed price, what confidence, and
 * one short line of why -- everything else (full evidence records,
 * provenance, the full research report) sits behind an expand/open action,
 * never inline. Standard units get a unified top card (StandardPriceHeader)
 * matching the special-unit drawer's existing A-block pattern -- the one
 * real structural gap between the two drawer types this batch closes. */
export default function UnitDrawer({ row, workspace, marketingStrategy, onChangeMarketingStrategy, onOpenFamilyEvidence, onOpenMapEvidence, onClose }: Props) {
  const route = pricingRouteOf(row);
  const isSold = marketingStrategy.soldUnitNumbers.has(row.unit_number);
  const saleRecord = internalSaleForUnit(marketingStrategy, row.unit_number);
  // Same confidence source each route's own market-indication block already
  // displays -- forwarded to MarketingDecisionChain's "שלח לאישור ב-Monday"
  // button so Monday receives the real confidence, not a guess.
  const confidence =
    route === "standard_family"
      ? (row.market_range?.confidence ?? null)
      : (workspace.special_unit_market_context.units[row.unit_number]?.market_indication?.confidence ?? null);

  const isSpecial = route !== "standard_family";

  // Recommended range for the closing recap in MarketingDecisionChain --
  // standard route reads row.market_range directly; special route reads the
  // same indicative_lower/upper_ils this drawer's own section A/B already
  // display elsewhere. Never a new range calculation.
  const marketRange = route === "standard_family"
    ? (row.market_range ? { lower: row.market_range.lower, upper: row.market_range.upper } : null)
    : (() => {
        const indication = workspace.special_unit_market_context.units[row.unit_number]?.market_indication;
        return indication ? { lower: indication.indicative_lower_ils, upper: indication.indicative_upper_ils } : null;
      })();

  // This unit's own consistency finding (if any), reusing the exact same
  // lib/priceListConsistency.ts logic PriceListConsistency.tsx already runs
  // over the whole board -- no new floor/size/sibling heuristics here.
  const consistencyFinding = buildConsistencySummary(workspace.price_list, marketingStrategy).findings.find(
    (f) => f.unitA.row.unit_number === row.unit_number || f.unitB.row.unit_number === row.unit_number
  ) ?? null;
  // Special units get real room to show the chart/funnel/comparison layers
  // on desktop, while staying full/near-full-screen on mobile. Standard
  // units keep the original compact width -- they don't need the extra
  // space.
  const widthClass = isSpecial ? "sm:w-[42vw] sm:min-w-[560px] sm:max-w-[650px]" : "max-w-md";

  const projectStatusAndDecision = (
    <>
      {/* מצב הפרויקט */}
      <ProjectStatusBlock row={row} workspace={workspace} state={marketingStrategy} />

      {/* D. התאמות החברה -- the strongest visual element in this drawer; owns
          its own header, styled to match StepHeading (see MarketingDecisionChain).
          Also where "שלח לאישור ב-Monday" lives, downstream of the proposed
          price. */}
      <MarketingDecisionChain
        row={row}
        state={marketingStrategy}
        onChange={onChangeMarketingStrategy}
        confidence={confidence}
        isSpecial={isSpecial}
        marketRange={marketRange}
        consistencyFinding={consistencyFinding}
      />
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-start bg-ink/40" onClick={onClose}>
      <div
        className={`h-full w-full overflow-y-auto bg-surface shadow-xl ${widthClass}`}
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-hairline bg-surface px-5 py-4">
          <div>
            <h2 className="font-heading text-lg font-bold text-ink">דירה {row.unit_number}</h2>
            <p className="text-xs text-ink-muted/70">{route === "standard_family" ? "מסלול תמחור סטנדרטי" : "מסלול בדיקה פרטנית"}</p>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">
            סגירה ✕
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-4">
          {isSold && (
            <section className="rounded-md border border-supported/40 bg-supported/10 p-3 text-sm text-supported">
              <p className="font-semibold">נמכרה</p>
              {saleRecord ? (
                <p className="mt-1">
                  מחיר מכירה בפועל: <span className="font-bold">{ils(saleRecord.sale_price_ils)}</span>
                </p>
              ) : (
                <p className="mt-1 text-xs opacity-80">מחיר מכירה בפועל לא סופק</p>
              )}
              <p className="mt-1 text-[11px] opacity-80">
                ראייה פנימית של הפרויקט — אינה דורסת ראיות שוק חיצוניות (מיסוי/מדלן).
              </p>
            </section>
          )}

          {isSpecial ? (
            <SpecialUnitDecisionPanel
              row={row}
              workspace={workspace}
              state={marketingStrategy}
              confidence={confidence}
              onOpenMapEvidence={onOpenMapEvidence}
              projectStatusAndDecision={projectStatusAndDecision}
            />
          ) : (
            <>
              {/* Unified top card -- which apartment, what market range, what
                  proposed price, what confidence, why -- and nothing else. */}
              <StandardPriceHeader row={row} isSold={isSold} />

              {/* 1. פרטי הדירה -- supporting detail, not the lead anymore */}
              <UnitFactsBlock row={row} isSold={isSold} isSpecial={false} />

              <StandardFeatureFindings
                family={workspace.standard_attribute_enrichment.families[row.family === "3R" ? "standard_3r" : "standard_5r"]}
                familyKey={row.family === "3R" ? "standard_3r" : "standard_5r"}
              />

              {/* 2. אינדיקציית שוק -- evidence lanes */}
              <MarketIndicationBlockStandard row={row} workspace={workspace} onOpenFamilyEvidence={onOpenFamilyEvidence} onOpenMapEvidence={onOpenMapEvidence} />

              {/* 3-4. מצב הפרויקט + החלטת שיווק */}
              {projectStatusAndDecision}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="font-medium text-ink">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unified top card -- standard-unit equivalent of the special-unit drawer's
// A-block (SpecialUnitDecisionPanel's PriceHeader). Built from fields this
// component already has (row.market_range, computePriceBreakdown) -- no new
// calculation.
// ---------------------------------------------------------------------------

function StandardPriceHeader({ row, isSold }: { row: PtkPriceListRow; isSold: boolean }) {
  const rooms = roomsOf(row);
  const confidence = row.market_range?.confidence ?? null;
  const marketIls = row.proposed_list_price_ils;

  return (
    <section className="rounded-lg border-2 border-ink/80 bg-gradient-to-b from-canvas to-surface p-4">
      <p className="mb-1 text-xs text-ink-muted">
        {unitTypeLabel(row.family)}
        {rooms != null ? ` · ${rooms} חדרים` : ""}
        {row.internal_area_sqm != null ? ` · ${num(row.internal_area_sqm)} מ״ר` : ""}
        {row.floor != null ? ` · קומה ${row.floor}` : ""}
      </p>

      <div className="text-xs font-semibold text-ink-muted">מחיר שיווק מוצע</div>
      <div className="text-3xl font-bold text-ink">{ils(marketIls)}</div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-1 text-xs font-medium ${CONFIDENCE_COLORS[confidence ?? ""] ?? "bg-canvas text-ink-muted"}`}>
          רמת ביטחון: {CONFIDENCE_LABELS[confidence ?? ""] ?? "—"}
        </span>
        {row.market_range?.lower != null && (
          <span className="text-xs text-ink-muted">טווח נתמך: {rangeOrPoint(row.market_range.lower, row.market_range.upper)}</span>
        )}
      </div>

      {isSold ? (
        <p className="mt-1.5 text-xs text-ink-muted/70">היחידה נמכרה — פרטי מכירה בפועל למטה.</p>
      ) : row.requires_review ? (
        <p className="mt-1.5 text-xs text-warning">יחידה זו מסומנת לבדיקה — ראו בדיקת עקביות המחירון.</p>
      ) : (
        <p className="mt-1.5 text-xs text-ink-muted/70">מבוסס על ראיות שוק ואסטרטגיית החברה — פירוט מלא למטה.</p>
      )}
    </section>
  );
}

// 1. פרטי הדירה + מאפייני הדירה בתהליך התמחור
function UnitFactsBlock({ row, isSold, isSpecial }: { row: PtkPriceListRow; isSold: boolean; isSpecial: boolean }) {
  const rows = deriveApartmentParameterRows(row, isSpecial);
  return (
    <section>
      <StepHeading n={1} title="פרטי הדירה" />
      <div className="mb-3 grid grid-cols-2 gap-3 rounded-md bg-canvas p-3 text-sm">
        <Fact label="סטטוס" value={isSold ? "נמכרה" : STATUS_LABELS[row.status] ?? row.status} />
      </div>

      {/* מאפייני הדירה בתהליך התמחור: what the engine actually does with
          each attribute -- never claims a quantitative price effect unless
          one really exists. */}
      <div className="mb-1 text-sm font-semibold text-ink">מאפייני הדירה בתהליך התמחור</div>
      <div className="overflow-x-auto rounded-md border border-hairline">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline bg-canvas text-start text-[11px] text-ink-muted">
              <th className="px-2.5 py-1.5 text-start font-medium">מאפיין</th>
              <th className="px-2.5 py-1.5 text-start font-medium">ערך</th>
              <th className="px-2.5 py-1.5 text-start font-medium">אופן השימוש</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: ApartmentParameterRow) => (
              <tr key={r.label} className="border-b border-hairline last:border-0">
                <td className="px-2.5 py-1.5 align-top font-medium text-ink-muted">{r.label}</td>
                <td className="px-2.5 py-1.5 align-top text-ink">{r.value}</td>
                <td className="px-2.5 py-1.5 align-top text-ink-muted">
                  <div>{r.usage}</div>
                  <div className="mt-0.5 text-[11px] font-medium text-ink-muted/70">{PARAMETER_STATUS_LABELS[r.status]}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Local title overrides to exactly match the spec's evidence-lane wording
// (עסקאות שבוצעו / מודעות פעילות / פרויקטים חדשים) -- lib/family.ts's
// shared LANE_LABELS constant stays untouched since it's also read by the
// unrelated /w/[projectId]/... route (UnitEvidenceModal); the two titles
// that differ from the exact spec wording are overridden locally here only.
const DRAWER_LANE_TITLES: Record<"sold" | "current_asking" | "new_development", string> = {
  sold: LANE_LABELS.sold.title,
  current_asking: "מודעות פעילות",
  new_development: "פרויקטים חדשים",
};

// ב. אינדיקציית השוק -- standard 3R/5R route. Each lane gets a compact
// summary card (EvidenceCard, already built for this exact purpose) with
// its full record list one click away (EvidenceDetailModal) -- never a full
// dump inline.
function MarketIndicationBlockStandard({
  row,
  workspace,
  onOpenFamilyEvidence,
  onOpenMapEvidence,
}: {
  row: PtkPriceListRow;
  workspace: PetahTikvaWorkspace;
  onOpenFamilyEvidence: (family: "3R" | "5R") => void;
  onOpenMapEvidence: (row: PtkPriceListRow) => void;
}) {
  const [openLane, setOpenLane] = useState<"sold" | "current_asking" | "new_development" | null>(null);
  const family = workspace.families.find((f) => f.family === row.family);
  const lanes: ("sold" | "current_asking" | "new_development")[] = ["sold", "current_asking", "new_development"];

  return (
    <section>
      <StepHeading n={2} title="אינדיקציית שוק" />
      {family ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            {lanes.map((lane) => (
              <EvidenceCard
                key={lane}
                lane={lane}
                data={family.evidence_lanes[lane]}
                onClick={() => setOpenLane(lane)}
                titleOverride={DRAWER_LANE_TITLES[lane]}
              />
            ))}
          </div>
          {openLane && (
            <EvidenceDetailModal workspace={workspace} family={row.family as "3R" | "5R"} lane={openLane} onClose={() => setOpenLane(null)} />
          )}
        </>
      ) : (
        <p className="text-sm text-ink-muted">אין נתוני שוק זמינים למשפחה זו.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <button onClick={() => onOpenFamilyEvidence(row.family as "3R" | "5R")} className="text-xs text-ink-muted underline hover:text-ink">
          הצג ראיות והשוואות
        </button>
        <button onClick={() => onOpenMapEvidence(row)} className="text-xs text-ink-muted underline hover:text-ink">
          הצג את ראיות השוק על המפה
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

  const salesDataSupplied = progress.unitsSold > 0;

  const gap = sellThroughGapPoints(state.actualSellThroughPct, state.targetSellThroughPct);

  return (
    <section>
      <StepHeading n={3} title="מצב הפרויקט" />
      <div className="grid grid-cols-2 gap-3 rounded-md bg-canvas p-3 text-sm">
        <Fact label="שלב הפרויקט" value={PROJECT_PHASE_LABELS[state.projectPhase]} />
        <Fact label="קצב מכירות בפועל" value={`${num(state.actualSellThroughPct, 0)}%`} />
        <Fact label="יעד קצב מכירות" value={`${num(state.targetSellThroughPct, 0)}%`} />
        <Fact
          label="פער מול היעד"
          value={gap != null ? `${gap > 0 ? "+" : ""}${num(gap, 1)} נקודות אחוז` : "—"}
        />
      </div>
      <p className="mt-1 text-[11px] text-ink-muted/70">
        שלב הפרויקט, קצב המכירות בפועל והיעד נערכים בכרטיס אסטרטגיית השיווק הראשי ואינם משנים את המחיר בעצמם.
      </p>
      {salesDataSupplied && (
        <div className="mt-2 grid grid-cols-2 gap-3 rounded-md bg-canvas p-3 text-sm">
          <Fact label="שיעור מכירה לפי עסקאות שנרשמו — כלל הפרויקט" value={`${num(progress.sellThroughPct, 0)}%`} />
          <Fact label={`שיעור מכירה לפי עסקאות שנרשמו — ${FAMILY_BUCKET_LABELS[bucket]}`} value={`${num(familyProgress.sellThroughPct, 0)}%`} />
        </div>
      )}
      <div className="mt-2">
        <div className="mb-1 text-xs font-semibold text-ink-muted">עסקאות שבוצעו בפרויקט (משפחה זו)</div>
        {relevantSales.length === 0 ? (
          <p className="rounded bg-canvas px-2 py-1.5 text-sm text-ink-muted">לא סופקו עסקאות מכירה שבוצעו בפרויקט במסגרת המטלה.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-ink">
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
