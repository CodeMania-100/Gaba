"use client";

import { Fragment, useState } from "react";
import { AskingListingMarker, CompletedSaleObservation } from "@/lib/executiveVisuals";
import { LANE_LABELS } from "@/lib/family";
import { dateIL, ils, num } from "@/lib/format";

interface Props {
  soldObservations: CompletedSaleObservation[];
  askingMarkers: AskingListingMarker[];
}

interface EvidenceRow {
  lane: "sold" | "current_asking";
  family: "3R" | "5R";
  address: string | null;
  areaSqm: number | null;
  priceIls: number | null;
  ppsm: number | null;
  date: string | null;
  floor: string | number | null;
  contributesToPricing: boolean;
  targetEquivalentIndicationIls: number | null;
  nonContributionReason: string | null;
}

const STATUS_LABELS = { in: "נכנסה לחישוב", out: "לא נכנסה לחישוב" } as const;

/** Compact status chip -- same נכנסה לחישוב / לא נכנסה לחישוב vocabulary the
 * map detail cards use (task item 11), never a new set of words for the
 * same concept. */
function StatusChip({ contributes }: { contributes: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${
        contributes ? "bg-supported/15 text-supported" : "bg-hairline/60 text-ink-muted"
      }`}
    >
      {contributes ? STATUS_LABELS.in : STATUS_LABELS.out}
    </span>
  );
}

/** Collapsed-by-default evidence register for Tab 2-א -- the map is the
 * dominant visual; this is the "inspect more" detail behind it, never
 * rendered open by default. Built entirely from the same pure derivations
 * the map/trend chart already use (deriveCompletedSalesOverview's
 * observations, deriveAskingListingMarkers) -- no new data source, no
 * invented columns. Each row stays a compact main line; floor, the engine's
 * own target-equivalent indication, and the non-contribution reason (when
 * relevant) sit behind a per-row "פרטים" expand instead of adding more
 * always-visible columns (task item 6: "compact main row + expandable
 * detail", never a 15-column spreadsheet). */
export default function MarketEvidenceRegister({ soldObservations, askingMarkers }: Props) {
  const [open, setOpen] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const rows: EvidenceRow[] = [
    ...soldObservations.map((o) => ({
      lane: "sold" as const,
      family: o.family,
      address: o.address,
      areaSqm: o.areaSqm,
      priceIls: o.priceIls,
      ppsm: o.pricePerSqm,
      date: o.date,
      floor: o.floor,
      contributesToPricing: o.contributesToPricing,
      targetEquivalentIndicationIls: o.targetEquivalentIndicationIls,
      nonContributionReason: null,
    })),
    ...askingMarkers.map((m) => ({
      lane: "current_asking" as const,
      family: m.family,
      address: m.address,
      areaSqm: m.areaSqm,
      priceIls: m.askingPriceIls,
      ppsm: m.askingPpsm,
      date: null,
      floor: m.floor,
      contributesToPricing: m.contributesToPricing,
      targetEquivalentIndicationIls: m.targetEquivalentIndicationIls,
      nonContributionReason: m.nonContributionReason,
    })),
  ];

  if (rows.length === 0) return null;

  return (
    <div className="rounded-md border border-hairline">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-3 py-2.5 text-sm">
        <span className="font-medium text-ink">רשומות ראיות שוק ({rows.length})</span>
        <span className="text-xs text-ink-muted underline">{open ? "הסתרה" : "הצג את כל הראיות"}</span>
      </button>
      {open && (
        <div className="max-h-96 overflow-auto border-t border-hairline">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-canvas text-ink-muted">
              <tr>
                <th className="px-2 py-1.5 text-start font-medium">מקור</th>
                <th className="px-2 py-1.5 text-start font-medium">משפחה</th>
                <th className="px-2 py-1.5 text-start font-medium">כתובת</th>
                <th className="px-2 py-1.5 text-start font-medium">שטח</th>
                <th className="px-2 py-1.5 text-start font-medium">מחיר</th>
                <th className="px-2 py-1.5 text-start font-medium">מחיר למ״ר</th>
                <th className="px-2 py-1.5 text-start font-medium">תאריך</th>
                <th className="px-2 py-1.5 text-start font-medium">סטטוס</th>
                <th className="px-2 py-1.5 text-start font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const hasDetail = r.floor != null || r.targetEquivalentIndicationIls != null || r.nonContributionReason != null;
                const expanded = expandedIndex === i;
                return (
                  <Fragment key={i}>
                    <tr className="border-t border-hairline">
                      <td className="px-2 py-1 text-ink-muted">{LANE_LABELS[r.lane].title}</td>
                      <td className="px-2 py-1 text-ink-muted">{r.family === "3R" ? "3 חד׳" : "5 חד׳"}</td>
                      <td className="px-2 py-1 text-ink">{r.address ?? "—"}</td>
                      <td className="px-2 py-1 text-ink-muted tabular-nums">{r.areaSqm != null ? `${num(r.areaSqm)} מ״ר` : "—"}</td>
                      <td className="px-2 py-1 font-medium text-ink tabular-nums">{ils(r.priceIls)}</td>
                      <td className="px-2 py-1 text-ink-muted tabular-nums">{r.ppsm != null ? ils(Math.round(r.ppsm)) : "—"}</td>
                      <td className="px-2 py-1 text-ink-muted">{r.date ? dateIL(r.date) : "—"}</td>
                      <td className="px-2 py-1">
                        <StatusChip contributes={r.contributesToPricing} />
                      </td>
                      <td className="px-2 py-1">
                        {hasDetail && (
                          <button
                            onClick={() => setExpandedIndex(expanded ? null : i)}
                            className="text-[11px] text-ink-muted underline hover:text-ink"
                          >
                            {expanded ? "סגירה" : "פרטים"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded && hasDetail && (
                      <tr className="border-t border-hairline bg-canvas/60">
                        <td colSpan={9} className="px-2 py-1.5 text-[11px] text-ink-muted">
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {r.floor != null && <span>קומה: {String(r.floor)}</span>}
                            {r.targetEquivalentIndicationIls != null && (
                              <span>אינדיקציה מנורמלת ליעד: {ils(r.targetEquivalentIndicationIls)}</span>
                            )}
                            {!r.contributesToPricing && r.nonContributionReason && <span>הסיבה: {r.nonContributionReason}</span>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
