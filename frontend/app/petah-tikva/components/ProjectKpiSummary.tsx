"use client";

import { PetahTikvaWorkspace, PtkPriceListRow } from "@/lib/api";
import { ROOM_FAMILY_LABELS, SPECIAL_UNIT_TYPE_LABELS } from "@/lib/family";
import { ilsCompact, num } from "@/lib/format";
import { computeRevenueSummary, computeSalesProgress, MarketingStrategyState, PROJECT_PHASE_LABELS } from "@/lib/marketingStrategy";

interface Props {
  workspace: PetahTikvaWorkspace;
  rows: PtkPriceListRow[];
  state: MarketingStrategyState;
}

/** The page's headline KPI row -- project status, market value, proposed
 * revenue, and total strategy effect, answered within a few seconds -- plus
 * a live structural breakdown of the inventory (standard vs. special, and
 * within each, the real room-count mix). Same computeSalesProgress/
 * computeRevenueSummary used by PricingDecisionBoard and
 * MarketingStrategyPanel -- kept in perfect sync since it's the same
 * calculation, just displayed once at the top too. */
export default function ProjectKpiSummary({ workspace, rows, state }: Props) {
  const progress = computeSalesProgress(rows, state.soldUnitNumbers);
  const revenue = computeRevenueSummary(rows, state);
  const effectPct = revenue.marketIndicationRevenueIls > 0 ? (revenue.differenceIls / revenue.marketIndicationRevenueIls) * 100 : 0;
  const salesDataSupplied = progress.unitsSold > 0;
  const breakdown = deriveStructuralBreakdown(workspace, rows);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={`${progress.unitsTotal} דירות`} value={String(progress.unitsTotal)} />
        <Stat label="שלב הפרויקט" value={PROJECT_PHASE_LABELS[state.projectPhase]} />
        <Stat
          label="נמכרו / נותרו"
          value={salesDataSupplied ? `${progress.unitsSold} / ${progress.unitsRemaining}` : "לא סופקו נתוני מכירות בפועל במטלה."}
          small={!salesDataSupplied}
        />
        <Stat label="שווי לפי שוק" value={ilsCompact(revenue.marketIndicationRevenueIls)} />
        <Stat label="הכנסה מוצעת" value={ilsCompact(revenue.proposedRevenueIls)} />
        <Stat
          label="השפעת אסטרטגיה"
          value={`${effectPct >= 0 ? "+" : ""}${num(effectPct, 1)}% · ${revenue.differenceIls >= 0 ? "+" : ""}${ilsCompact(revenue.differenceIls)}`}
          emphasize={revenue.differenceIls !== 0}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-hairline pt-3 text-xs text-ink-muted">
        <span>
          <b className="font-semibold text-ink">{breakdown.standardTotal} סטנדרטיות</b>
          {breakdown.standardParts.length > 0 && <> ({breakdown.standardParts.join(", ")})</>}
        </span>
        {breakdown.specialTotal > 0 && (
          <span>
            <b className="font-semibold text-ink">{breakdown.specialTotal} מיוחדות</b>
            {breakdown.specialParts.length > 0 && <> ({breakdown.specialParts.join(", ")})</>}
          </span>
        )}
        {breakdown.attentionCount > 0 && (
          <span className="text-warning">
            <b className="font-semibold">{breakdown.attentionCount}</b> לבדיקה / ביטחון נמוך
          </span>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, emphasize, small }: { label: string; value: string; emphasize?: boolean; small?: boolean }) {
  return (
    <div>
      <div className={`font-heading font-bold text-ink ${small ? "text-sm font-medium text-ink-muted" : "text-lg"} ${emphasize ? "text-supported" : ""}`}>
        {value}
      </div>
      <div className="text-xs text-ink-muted">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Structural breakdown -- computed purely from each row's own fields
// (family_key / family / rooms), never from a hardcoded unit-number list, so
// it stays correct even if the underlying inventory ever changes.
// ---------------------------------------------------------------------------

interface StructuralBreakdown {
  standardTotal: number;
  standardParts: string[];
  specialTotal: number;
  specialParts: string[];
  attentionCount: number;
}

function deriveStructuralBreakdown(workspace: PetahTikvaWorkspace, rows: PtkPriceListRow[]): StructuralBreakdown {
  const standardCounts = new Map<string, number>();
  const specialByType = new Map<string, Map<number | null, number>>();
  let attentionCount = 0;
  const specialUnits = workspace.special_unit_market_context.units;

  for (const row of rows) {
    if (row.family_key != null) {
      standardCounts.set(row.family, (standardCounts.get(row.family) ?? 0) + 1);
    } else {
      if (!specialByType.has(row.family)) specialByType.set(row.family, new Map());
      const byRooms = specialByType.get(row.family)!;
      byRooms.set(row.rooms ?? null, (byRooms.get(row.rooms ?? null) ?? 0) + 1);
    }

    const lowConfidence = specialUnits[row.unit_number]?.market_indication?.confidence === "low";
    if (row.requires_review || lowConfidence) attentionCount += 1;
  }

  const standardTotal = [...standardCounts.values()].reduce((a, b) => a + b, 0);
  const standardParts = (["3R", "5R"] as const)
    .filter((f) => standardCounts.has(f))
    .map((f) => `${standardCounts.get(f)} · ${ROOM_FAMILY_LABELS[f]}`);

  let specialTotal = 0;
  const specialParts: string[] = [];
  for (const [type, byRooms] of specialByType) {
    const typeTotal = [...byRooms.values()].reduce((a, b) => a + b, 0);
    specialTotal += typeTotal;
    const typeLabel = SPECIAL_UNIT_TYPE_LABELS[type] ?? type;
    const roomGroups = [...byRooms.entries()].sort((a, b) => (b[0] ?? 0) - (a[0] ?? 0));
    const roomsText =
      roomGroups.length > 1
        ? roomGroups.map(([rooms, count]) => `${count}×${rooms != null ? num(rooms) : "לא ידוע"} חד׳`).join(", ")
        : roomGroups[0][0] != null
          ? `${num(roomGroups[0][0])} חד׳`
          : "מספר חדרים לא ידוע";
    specialParts.push(`${typeTotal} ${typeLabel} (${roomsText})`);
  }

  return { standardTotal, standardParts, specialTotal, specialParts, attentionCount };
}
