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
}

/** "איפה המחיר שלנו ממוקם מול האלטרנטיבות?" -- price-positioning only,
 * kept apart from the genuine product-attribute comparison in
 * ProductComparisonSection. `family` is read-only here -- it's driven by
 * the single canonical comparison-subject selector one level up
 * (MarketAndCompetitionWorkspace), never a toggle of this component's own,
 * so this can never show a family that disagrees with the rest of the tab.
 * Both pieces below are pure re-displays of lib/executiveVisuals.ts
 * derivations -- no independent market calculation, and this never
 * introduces a second "proposed price": it only shows where the existing
 * proposed price sits against alternatives. */
export default function MarketPositionSection({ workspace, projectPhase, family }: Props) {
  const categories = useMemo(() => deriveMarketPosition(workspace, family), [workspace, family]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-heading text-lg font-bold text-ink">איפה המחיר שלנו ממוקם מול האלטרנטיבות?</h2>
        <p className="text-xs text-ink-muted">השוואת מיקום מחיר בלבד — לא השוואת מאפייני מוצר — עבור המשפחה הנבחרת</p>
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
