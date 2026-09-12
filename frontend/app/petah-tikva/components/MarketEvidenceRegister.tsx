"use client";

import { useState } from "react";
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
}

/** Collapsed-by-default evidence register for Tab 2-א -- the map is the
 * dominant visual; this is the "inspect more" detail behind it, never
 * rendered open by default. Built entirely from the same pure derivations
 * the map/trend chart already use (deriveCompletedSalesOverview's
 * observations, deriveAskingListingMarkers) -- no new data source, no
 * invented columns. */
export default function MarketEvidenceRegister({ soldObservations, askingMarkers }: Props) {
  const [open, setOpen] = useState(false);
  const rows: EvidenceRow[] = [
    ...soldObservations.map((o) => ({ lane: "sold" as const, family: o.family, address: o.address, areaSqm: o.areaSqm, priceIls: o.priceIls, ppsm: o.pricePerSqm, date: o.date })),
    ...askingMarkers.map((m) => ({ lane: "current_asking" as const, family: m.family, address: m.address, areaSqm: m.areaSqm, priceIls: m.askingPriceIls, ppsm: m.askingPpsm, date: null })),
  ];

  if (rows.length === 0) return null;

  return (
    <div className="rounded-md border border-hairline">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-3 py-2.5 text-sm">
        <span className="font-medium text-ink">רשומות ראיות שוק ({rows.length})</span>
        <span className="text-xs text-ink-muted underline">{open ? "הסתרה" : "הצג את כל הראיות"}</span>
      </button>
      {open && (
        <div className="max-h-80 overflow-auto border-t border-hairline">
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-hairline">
                  <td className="px-2 py-1 text-ink-muted">{LANE_LABELS[r.lane].title}</td>
                  <td className="px-2 py-1 text-ink-muted">{r.family === "3R" ? "3 חד׳" : "5 חד׳"}</td>
                  <td className="px-2 py-1 text-ink">{r.address ?? "—"}</td>
                  <td className="px-2 py-1 text-ink-muted tabular-nums">{r.areaSqm != null ? `${num(r.areaSqm)} מ״ר` : "—"}</td>
                  <td className="px-2 py-1 font-medium text-ink tabular-nums">{ils(r.priceIls)}</td>
                  <td className="px-2 py-1 text-ink-muted tabular-nums">{r.ppsm != null ? ils(Math.round(r.ppsm)) : "—"}</td>
                  <td className="px-2 py-1 text-ink-muted">{r.date ? dateIL(r.date) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
