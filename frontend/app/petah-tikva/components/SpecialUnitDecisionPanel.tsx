"use client";

import { PetahTikvaWorkspace, PtkPriceListRow, SpecialUnitContext, SpecialUnitIndication } from "@/lib/api";
import { CONFIDENCE_COLORS, CONFIDENCE_LABELS, outdoorLabel, roomsOf, unitTypeLabel } from "@/lib/family";
import { ils, ilsCompact, num } from "@/lib/format";
import { computePriceBreakdown, MarketingStrategyState } from "@/lib/marketingStrategy";
import { deriveApartmentParameterRows } from "@/lib/apartmentParameters";
import {
  ChartPoint,
  chartMethodLabel,
  confidenceDimensions,
  deriveChartPoints,
  deriveHighlightedComparable,
  deriveLaneFunnel,
  evidenceGapText,
  LANE_TITLES,
  methodSentence,
  primaryLaneName,
  SpecialLaneName,
} from "@/lib/specialUnitDecision";
import { SPECIAL_UNIT_CATEGORY_LABELS } from "@/lib/marketMap";
import PriceAxisChart from "./PriceAxisChart";
import EvidenceFunnel from "./EvidenceFunnel";
import SpecialUnitAnalysis from "./SpecialUnitAnalysis";
import StepHeading from "./StepHeading";

interface Props {
  row: PtkPriceListRow;
  workspace: PetahTikvaWorkspace;
  state: MarketingStrategyState;
  confidence: string | null;
  onOpenMapEvidence: (row: PtkPriceListRow) => void;
  // Rendered here so it stays visually "downstream of the pricing decision"
  // (task item 20) inside the new hierarchy, exactly as before -- content
  // and logic untouched.
  projectStatusAndDecision: React.ReactNode;
}

/** Special-unit ("Focused Batch — Special Apartment Decision Drawer")
 * primary decision layer: sections A-E answer, in order, what the market
 * says / why / how strong the evidence is / what's missing / what the
 * company can still change -- all in well under a screen's worth of
 * scrolling. Section F keeps the full, unmodified research report
 * (SpecialUnitAnalysis) reachable but collapsed. No pricing/eligibility
 * logic lives here -- every number is read from workspace.
 * special_unit_market_context via lib/specialUnitDecision.ts's pure
 * derivations, the same canonical fields the market map already uses. */
export default function SpecialUnitDecisionPanel({ row, workspace, state, confidence, onOpenMapEvidence, projectStatusAndDecision }: Props) {
  const context = workspace.special_unit_market_context.units[row.unit_number];
  const indication = context?.market_indication;
  const breakdown = computePriceBreakdown(state, row);
  const categoryLabel = context ? (SPECIAL_UNIT_CATEGORY_LABELS[context.category] ?? context.category) : unitTypeLabel(row.family);

  const primaryLane = indication ? primaryLaneName(indication) : null;
  const laneResult = primaryLane && indication ? indication.lanes[primaryLane] : null;
  const highlighted = laneResult ? deriveHighlightedComparable(laneResult, roomsOf(row)) : null;
  const chartPoints: ChartPoint[] = laneResult ? deriveChartPoints(laneResult, highlighted?.comparable.label) : [];
  const funnel = context && primaryLane ? deriveLaneFunnel(context, primaryLane) : null;
  const gapText = context ? evidenceGapText(context) : null;

  return (
    <div className="flex flex-col gap-5">
      {/* A. החלטת מחיר / אינדיקציית שוק */}
      <PriceHeader row={row} categoryLabel={categoryLabel} breakdown={breakdown} confidence={confidence ?? indication?.confidence ?? null} />

      {/* B. למה זה המחיר */}
      {context && indication && indication.suggested_price_ils != null ? (
        <section className="rounded-md border border-slate-200 p-3">
          <StepHeading n="B" title="למה זה המחיר" />
          <p className="text-sm text-slate-700">{methodSentence(context)}</p>
          <button onClick={() => onOpenMapEvidence(row)} className="mt-1.5 text-xs text-slate-500 underline hover:text-slate-800">
            הצג את ראיות השוק על המפה
          </button>

          {laneResult && chartPoints.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <PriceAxisChart points={chartPoints} marketIndicationIls={indication.suggested_price_ils} methodLabel={chartMethodLabel(laneResult)} />
            </div>
          )}

          {funnel && funnel.stages.some((s) => s.count > 0) && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <EvidenceFunnel funnel={funnel} />
            </div>
          )}

          {highlighted && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <HighlightedComparableCard row={row} categoryLabel={categoryLabel} highlighted={highlighted} />
            </div>
          )}

          <div className="mt-3 border-t border-slate-100 pt-3">
            <ConfidenceExplanation indication={indication} />
          </div>

          {gapText && (
            <div className="mt-3 rounded-md bg-amber-50 p-2.5 text-xs text-amber-900">
              <div className="font-semibold">מה חסר כדי לחזק את האינדיקציה?</div>
              <p className="mt-0.5">{gapText}</p>
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          אין כרגע מספיק ראיות נומריות ליחידה זו כדי לחשב אינדיקציית מחיר.
        </section>
      )}

      {/* C. מאפייני הדירה */}
      <section>
        <StepHeading n="C" title="מאפייני הדירה" />
        <CompactApartmentFacts row={row} />
        <SiblingComparisonCompact row={row} workspace={workspace} />
      </section>

      {/* D. התאמות החברה (מצב הפרויקט + MarketingDecisionChain, including
          the Monday action -- unchanged content, positioned here). */}
      {projectStatusAndDecision}

      {/* E. הקשר שוק נוסף -- collapsed by default (task item 10). */}
      {context && indication && <AdditionalMarketContext context={context} indication={indication} primaryLane={primaryLane} />}

      {/* F. פירוט מלא של הראיות והמקורות -- the pre-existing full research
          report, unmodified, just relocated behind a collapsed toggle
          (task item 11). */}
      <details className="rounded-md border border-slate-200">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          פירוט מלא של הראיות והמקורות
        </summary>
        <div className="border-t border-slate-100 px-3 py-3">
          <SpecialUnitAnalysis row={row} context={context} marketContext={workspace.special_unit_market_context} />
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A. Price header
// ---------------------------------------------------------------------------

function PriceHeader({
  row,
  categoryLabel,
  breakdown,
  confidence,
}: {
  row: PtkPriceListRow;
  categoryLabel: string;
  breakdown: ReturnType<typeof computePriceBreakdown>;
  confidence: string | null;
}) {
  const rooms = roomsOf(row);
  const isZeroStrategy = breakdown.totalPct === 0;
  const primaryIls = isZeroStrategy ? breakdown.marketIndicationIls : breakdown.proposedIls;

  return (
    <section className="rounded-lg border-2 border-slate-900 bg-gradient-to-b from-slate-50 to-white p-4">
      <StepHeading n="A" title={`דירה ${row.unit_number}`} />
      <p className="-mt-1 mb-2 text-xs text-slate-500">
        {categoryLabel}
        {rooms != null ? ` · ${rooms} חדרים` : ""}
        {row.internal_area_sqm != null ? ` · ${num(row.internal_area_sqm)} מ״ר` : ""}
      </p>

      {/* Never repeat the same number three times (task item 3): the zero-
          strategy state shows the market indication exactly once as the
          primary number; the non-zero state promotes the proposed price and
          shows market indication + total strategy effect as secondary
          recap lines only. */}
      <div className="text-xs font-semibold text-slate-500">{isZeroStrategy ? "אינדיקציית שוק" : "מחיר מוצע"}</div>
      <div className="text-3xl font-bold text-slate-900">{ils(primaryIls)}</div>

      {!isZeroStrategy && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
          <span>
            אינדיקציית שוק <span className="font-medium text-slate-700">{ils(breakdown.marketIndicationIls)}</span>
          </span>
          <span>
            התאמות החברה{" "}
            <span className={`font-medium ${breakdown.totalPct > 0 ? "text-emerald-700" : "text-red-700"}`}>
              {breakdown.totalPct > 0 ? "+" : ""}
              {breakdown.totalPct}% · {breakdown.totalPct > 0 ? "+" : ""}
              {ils((breakdown.proposedIls ?? 0) - (breakdown.marketIndicationIls ?? 0))}
            </span>
          </span>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <span className={`rounded px-2 py-1 text-xs font-medium ${CONFIDENCE_COLORS[confidence ?? ""] ?? "bg-slate-100 text-slate-700"}`}>
          רמת ביטחון: {CONFIDENCE_LABELS[confidence ?? ""] ?? "—"}
        </span>
      </div>

      {isZeroStrategy && (
        <p className="mt-1.5 text-xs text-slate-400">המחיר המוצע זהה לאינדיקציית השוק — ללא התאמות מסחריות.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// B. Highlighted comparable + confidence explanation
// ---------------------------------------------------------------------------

function HighlightedComparableCard({
  row,
  categoryLabel,
  highlighted,
}: {
  row: PtkPriceListRow;
  categoryLabel: string;
  highlighted: NonNullable<ReturnType<typeof deriveHighlightedComparable>>;
}) {
  const c = highlighted.comparable;
  const rawType = (c.raw?.tax_property_type as string | undefined) ?? (c.raw?.floor_configuration as string | undefined) ?? null;
  const areaDeltaLabel = `${highlighted.areaDeltaSqm > 0 ? "+" : ""}${num(highlighted.areaDeltaSqm, 1)} מ״ר`;

  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold text-slate-500">{highlighted.ruleLabel}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-slate-500">
              <th className="px-1.5 py-1 text-start font-medium"></th>
              <th className="px-1.5 py-1 text-start font-medium">דירה {row.unit_number}</th>
              <th className="px-1.5 py-1 text-start font-medium">עסקת השוואה</th>
              <th className="px-1.5 py-1 text-start font-medium text-slate-300">Δ</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100">
              <td className="px-1.5 py-1 text-slate-500">שטח פנימי</td>
              <td className="px-1.5 py-1 font-medium text-slate-900">{num(c.subject_area_sqm)} מ״ר</td>
              <td className="px-1.5 py-1 font-medium text-slate-900">{num(c.comparable_area_sqm)} מ״ר</td>
              <td className="px-1.5 py-1 text-slate-400">
                {areaDeltaLabel} ({highlighted.areaDeltaPct > 0 ? "+" : ""}
                {num(highlighted.areaDeltaPct, 1)}%)
              </td>
            </tr>
            <tr className="border-t border-slate-100">
              <td className="px-1.5 py-1 text-slate-500">סוג</td>
              <td className="px-1.5 py-1 font-medium text-slate-900">{categoryLabel}</td>
              <td className="px-1.5 py-1 font-medium text-slate-900">{rawType ?? "לא ידוע"}</td>
              <td className="px-1.5 py-1 text-slate-300">—</td>
            </tr>
            <tr className="border-t border-slate-100">
              <td className="px-1.5 py-1 text-slate-500">מחיר</td>
              <td className="px-1.5 py-1 text-slate-300">—</td>
              <td className="px-1.5 py-1 font-medium text-slate-900">{ilsCompact(c.comparable_price_ils)}</td>
              <td className="px-1.5 py-1 text-slate-300">—</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{c.label}</p>
    </div>
  );
}

function ConfidenceExplanation({ indication }: { indication: SpecialUnitIndication }) {
  const dims = confidenceDimensions(indication);
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`rounded px-2 py-1 text-xs font-medium ${CONFIDENCE_COLORS[indication.confidence] ?? ""}`}>
          רמת ביטחון: {CONFIDENCE_LABELS[indication.confidence] ?? indication.confidence}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {dims.map((d) => (
          <div key={d.label} className="flex items-center justify-between text-xs">
            <span className="text-slate-500">{d.label}</span>
            <span className="font-medium text-slate-800">{d.value}</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">{indication.confidence_reason}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// C. Compact apartment facts (task item 14) + compact sibling card (item 15)
// ---------------------------------------------------------------------------

function CompactApartmentFacts({ row }: { row: PtkPriceListRow }) {
  const rows = deriveApartmentParameterRows(row, true);
  // Only the "soft" facts -- shown for comparison but never monetized --
  // get a one-line role note; the ones that quantitatively feed the
  // calculation (type/rooms/area) are self-evident from their value alone.
  const roleWorthy = rows.filter((r) => (r.status === "shown_for_comparison" || r.status === "not_monetized") && r.value !== "—" && r.value !== "לא ידוע");

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-2">
            <span className="text-slate-500">{r.label}</span>
            <span className="font-medium text-slate-900">{r.value}</span>
          </div>
        ))}
      </div>
      {roleWorthy.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 border-t border-slate-100 pt-2">
          {roleWorthy.map((r) => (
            <p key={r.label} className="text-[11px] text-slate-400">
              <span className="font-medium text-slate-500">{r.label}: </span>
              {r.usage}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// Compact variant of UnitDrawer's SiblingComparisonCard -- same data/rule,
// tighter layout to match this drawer's overall density (task item 15:
// "preserve... make it compact"). Only unit 36/37 render anything.
function SiblingComparisonCompact({ row, workspace }: { row: PtkPriceListRow; workspace: PetahTikvaWorkspace }) {
  const siblingNumber = row.unit_number === "36" ? "37" : row.unit_number === "37" ? "36" : null;
  if (!siblingNumber) return null;
  const sibling = workspace.price_list.find((r) => r.unit_number === siblingNumber);
  if (!sibling) return null;

  const marketIls = (r: PtkPriceListRow) => workspace.special_unit_market_context.units[r.unit_number]?.market_indication?.suggested_price_ils ?? null;
  const rows: { label: string; a: string; b: string }[] = [
    { label: "שטח פנימי", a: row.internal_area_sqm != null ? num(row.internal_area_sqm) : "—", b: sibling.internal_area_sqm != null ? num(sibling.internal_area_sqm) : "—" },
    { label: outdoorLabel(row.family), a: row.balcony_area_sqm != null ? num(row.balcony_area_sqm) : "—", b: sibling.balcony_area_sqm != null ? num(sibling.balcony_area_sqm) : "—" },
    { label: "כיוון", a: row.orientation ?? "—", b: sibling.orientation ?? "—" },
    { label: "אינדיקציית שוק", a: marketIls(row) != null ? ilsCompact(marketIls(row)!) : "—", b: marketIls(sibling) != null ? ilsCompact(marketIls(sibling)!) : "—" },
  ];

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-1.5 text-xs font-semibold text-slate-500">השוואה לדירה דומה בפרויקט</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] text-slate-400">
            <th className="text-start font-medium"></th>
            <th className="text-start font-medium">{row.unit_number}</th>
            <th className="text-start font-medium">{siblingNumber}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-slate-100">
              <td className="py-1 text-slate-500">{r.label}</td>
              <td className="py-1 font-medium text-slate-900">{r.a}</td>
              <td className="py-1 font-medium text-slate-900">{r.b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11px] text-slate-400">
        שתי הדירות נשענות על אותו בסיס שוק. הבדלי המוצר מוצגים למחלקת השיווק לצורך החלטה על התאמה מסחרית.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// E. הקשר שוק נוסף -- collapsed by default, compact per non-primary lane.
// ---------------------------------------------------------------------------

function AdditionalMarketContext({
  context,
  indication,
  primaryLane,
}: {
  context: SpecialUnitContext;
  indication: NonNullable<SpecialUnitContext["market_indication"]>;
  primaryLane: SpecialLaneName | null;
}) {
  const otherLanes = (["sold", "current_asking", "new_development"] as const).filter(
    (l) => l !== primaryLane && indication.lanes[l] && ((indication.lanes[l]?.comps_used.length ?? 0) > 0 || (indication.lanes[l]?.comps_context_only.length ?? 0) > 0)
  );
  if (otherLanes.length === 0) return null;

  return (
    <details className="rounded-md border border-slate-200">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">הקשר שוק נוסף</summary>
      <div className="flex flex-col gap-3 border-t border-slate-100 px-3 py-3">
        {otherLanes.map((laneName) => {
          const lane = indication.lanes[laneName]!;
          const entries = [...lane.comps_used, ...lane.comps_context_only].slice(0, 6);
          return (
            <div key={laneName}>
              <div className="mb-1 text-xs font-semibold text-slate-500">
                {LANE_TITLES[laneName]} ({lane.comps_used.length + lane.comps_context_only.length})
              </div>
              <ul className="flex flex-col gap-0.5 text-xs text-slate-600">
                {entries.map((c, i) => {
                  const isModelPrice = (c.note ?? "").startsWith("floorplan");
                  return (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="truncate">{c.label}</span>
                      <span className="shrink-0 tabular-nums text-slate-500">
                        {ilsCompact(c.comparable_price_ils)}
                        {isModelPrice && <span className="ms-1 text-[10px] text-slate-400">מחיר דגם</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        <p className="text-[11px] text-slate-400">
          נתונים אלה לא הצביעו באינדיקציית המחיר הסופית ליחידה זו — מוצגים כהקשר שוק בלבד. פירוט מלא זמין ב״פירוט מלא של הראיות והמקורות״.
        </p>
      </div>
    </details>
  );
}
