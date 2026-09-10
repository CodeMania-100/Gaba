"use client";

import { useMemo } from "react";
import { PetahTikvaWorkspace, PtkPriceListRow } from "@/lib/api";
import { deriveApartmentMix, deriveExecutiveInsights, deriveQuarterlySoldTrend } from "@/lib/executiveVisuals";
import ApartmentMixDonut from "./ApartmentMixDonut";
import MarketTrendChart from "./MarketTrendChart";
import ExecutiveInsights from "./ExecutiveInsights";

interface Props {
  workspace: PetahTikvaWorkspace;
  rows: PtkPriceListRow[];
}

/** "What is in the project? / What is happening in the local market?" --
 * the first business answers a management user sees, before any table or
 * research detail (see task's page-architecture mission). */
export default function ExecutiveOverview({ workspace, rows }: Props) {
  const mix = useMemo(() => deriveApartmentMix(rows), [rows]);
  const trend = useMemo(() => deriveQuarterlySoldTrend(workspace), [workspace]);
  const insights = useMemo(() => deriveExecutiveInsights(workspace), [workspace]);
  const total = rows.length;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-300 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-slate-900">תמונת מצב</h2>
        <p className="text-xs text-slate-500">מה יש בפרויקט, ומה קורה בשוק המקומי — לפני הפרטים.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ApartmentMixDonut mix={mix} total={total} />
        <MarketTrendChart series={trend} />
      </div>

      <ExecutiveInsights insights={insights} />
    </section>
  );
}
