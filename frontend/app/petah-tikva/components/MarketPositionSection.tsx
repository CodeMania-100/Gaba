"use client";

import { useMemo } from "react";
import { PetahTikvaWorkspace } from "@/lib/api";
import { deriveMarketPosition } from "@/lib/executiveVisuals";
import { ProjectPhase } from "@/lib/marketingStrategy";
import MarketPositionChart from "./MarketPositionChart";
import CompetitorComparisonMatrix from "./CompetitorComparisonMatrix";

interface Props {
  workspace: PetahTikvaWorkspace;
  projectPhase: ProjectPhase;
  family: "3R" | "5R";
  onFamilyChange: (f: "3R" | "5R") => void;
}

/** "איפה המחיר שלנו ממוקם מול האלטרנטיבות?" -- price-positioning only
 * (task: kept apart from the genuine product-attribute comparison in
 * ProductComparisonSection). Market-position chart + the price-only rows of
 * the competitor matrix share one family toggle, controlled by the parent
 * section so it never contradicts the map's own family filter. Both are
 * pure re-displays of lib/executiveVisuals.ts derivations -- no independent
 * market calculation, and this never introduces a second "proposed price"
 * (task item 5): it only shows where the existing proposed price sits
 * against alternatives. */
export default function MarketPositionSection({ workspace, projectPhase, family, onFamilyChange }: Props) {
  const categories = useMemo(() => deriveMarketPosition(workspace, family), [workspace, family]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">איפה המחיר שלנו ממוקם מול האלטרנטיבות?</h3>
          <p className="text-xs text-slate-500">השוואת מיקום מחיר בלבד — לא השוואת מאפייני מוצר — עבור המשפחה הנבחרת</p>
        </div>
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          {(["3R", "5R"] as const).map((f) => (
            <button
              key={f}
              onClick={() => onFamilyChange(f)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                family === f ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f === "3R" ? "3 חדרים" : "5 חדרים"}
            </button>
          ))}
        </div>
      </div>

      <MarketPositionChart categories={categories} />

      <CompetitorComparisonMatrix
        workspace={workspace}
        projectPhase={projectPhase}
        family={family}
        rowKeys={["price", "price_kind", "ppsm", "phase"]}
        title="השוואת מחיר מול פרויקטים מתחרים"
      />
    </div>
  );
}
