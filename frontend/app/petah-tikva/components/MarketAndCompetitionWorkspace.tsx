"use client";

import { useMemo, useState } from "react";
import { PetahTikvaWorkspace } from "@/lib/api";
import { MarketMapSelection } from "@/lib/marketMap";
import { deriveAskingListingMarkers, deriveCompletedSalesOverview } from "@/lib/executiveVisuals";
import { MarketingStrategyState } from "@/lib/marketingStrategy";
import MarketGeoMap from "./MarketGeoMap";
import MarketTrendChart from "./MarketTrendChart";
import MarketEvidenceRegister from "./MarketEvidenceRegister";
import CompetitorRegister from "./CompetitorRegister";
import ProductComparisonSection from "./ProductComparisonSection";
import DataQualitySection from "./DataQualitySection";

export type MarketInnerTab = "map" | "competitors";

interface Props {
  workspace: PetahTikvaWorkspace;
  marketingStrategy: MarketingStrategyState;
  family: "3R" | "5R";
  onFamilyChange: (f: "3R" | "5R") => void;
  mapSelection: MarketMapSelection;
  onMapSelectionChange: (s: MarketMapSelection) => void;
  // Controlled from the page so "הצג את ראיות השוק על המפה" (UnitDrawer)
  // can jump straight to Tab א from anywhere, and so returning to this
  // workspace from another top-level tab preserves whichever inner tab was
  // open.
  innerTab: MarketInnerTab;
  onInnerTabChange: (t: MarketInnerTab) => void;
}

type InnerTab = MarketInnerTab;

const INNER_TABS: { key: InnerTab; label: string }[] = [
  { key: "map", label: "איפה נמצאות ראיות השוק?" },
  { key: "competitors", label: "מול מי אנחנו מתחרים?" },
];

/** "השוק והמתחרים" -- two business questions, not a pile of research
 * widgets: א. where is market evidence (map first, trend chart secondary,
 * evidence register collapsed) and ב. who are we competing against
 * (positioning first, register concise, genuine product comparison shown
 * only once the user asks for it). The map keeps its full functionality
 * unchanged. Collapsed "מקורות ומתודולוגיה" stays reachable regardless of
 * which inner tab is open, as a single disclosure. */
export default function MarketAndCompetitionWorkspace({
  workspace,
  marketingStrategy,
  family,
  onFamilyChange,
  mapSelection,
  onMapSelectionChange,
  innerTab,
  onInnerTabChange,
}: Props) {
  const [showComparison, setShowComparison] = useState(false);
  const currentFamily = workspace.families.find((f) => f.family === family) ?? workspace.families[0];
  const familyKey = family === "3R" ? "standard_3r" : "standard_5r";

  const completedSales = useMemo(() => deriveCompletedSalesOverview(workspace), [workspace]);
  const askingMarkers = useMemo(() => deriveAskingListingMarkers(workspace), [workspace]);

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="font-heading text-lg font-bold text-ink">השוק והמתחרים</h2>
        <p className="text-xs text-ink-muted">מה קורה סביב הפרויקט ומה האלטרנטיבות של הקונה.</p>
      </div>

      <div className="flex overflow-hidden rounded-md border border-hairline w-fit">
        {INNER_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => onInnerTabChange(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              innerTab === t.key ? "bg-ink text-surface" : "bg-surface text-ink-muted hover:bg-canvas"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Each inner tab stays mounted-but-hidden (not unmounted) so the map's
          own internal state -- viewport, layer toggles, evidence-only mode
          -- survives switching tabs and coming back. */}
      <div hidden={innerTab !== "map"} className="flex flex-col gap-4">
        <MarketGeoMap workspace={workspace} selection={mapSelection} onSelectionChange={onMapSelectionChange} />
        {/* Secondary, only when it has something to say -- the empty state
            is a metric this view has nothing to compute, not an unknown
            fact, so it renders nothing rather than a placeholder box. */}
        {completedSales.mode !== "empty" && (
          <div className="rounded-lg border border-hairline bg-surface p-5">
            <MarketTrendChart overview={completedSales} />
          </div>
        )}
        <MarketEvidenceRegister soldObservations={completedSales.observations} askingMarkers={askingMarkers} />
      </div>

      <div hidden={innerTab !== "competitors"} className="flex flex-col gap-4">
        <CompetitorRegister workspace={workspace} projectPhase={marketingStrategy.projectPhase} family={family} onFamilyChange={onFamilyChange} />

        {currentFamily && (
          <div>
            {!showComparison ? (
              <button
                onClick={() => setShowComparison(true)}
                className="w-fit rounded-md border border-hairline bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-canvas"
              >
                השוואת מוצר מול המתחרים — {family === "3R" ? "3 חדרים" : "5 חדרים"}
              </button>
            ) : (
              <ProductComparisonSection
                workspace={workspace}
                projectPhase={marketingStrategy.projectPhase}
                family={currentFamily}
                familyKey={familyKey}
                enrichment={workspace.standard_attribute_enrichment}
                activePrice={currentFamily.proposed_family_price_ils}
                priceLabel="בסיס"
              />
            )}
          </div>
        )}
      </div>

      {currentFamily && (
        <details className="rounded-md border border-hairline p-3 text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-ink-muted">מקורות ומתודולוגיה</summary>
          <div className="mt-2">
            <DataQualitySection workspace={workspace} family={currentFamily} />
          </div>
        </details>
      )}
    </section>
  );
}
