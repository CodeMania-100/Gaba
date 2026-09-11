"use client";

import { PetahTikvaWorkspace } from "@/lib/api";
import { MarketMapSelection } from "@/lib/marketMap";
import { MarketingStrategyState } from "@/lib/marketingStrategy";
import MarketGeoMap from "./MarketGeoMap";
import CompetitorRegister from "./CompetitorRegister";
import ProductComparisonSection from "./ProductComparisonSection";
import DataQualitySection from "./DataQualitySection";

export type MarketInnerTab = "map" | "register" | "comparison";

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
  // open (task: tab switches must not reset state).
  innerTab: MarketInnerTab;
  onInnerTabChange: (t: MarketInnerTab) => void;
}

type InnerTab = MarketInnerTab;

const INNER_TABS: { key: InnerTab; label: string }[] = [
  { key: "map", label: "איפה נמצאות ראיות השוק?" },
  { key: "register", label: "מול אילו פרויקטים אנחנו מתחרים?" },
  { key: "comparison", label: "במה המוצר שלנו שונה מהמתחרים?" },
];

/** "השוק והמתחרים" -- the second of the four capabilities the user should
 * perceive. One workspace, three inner tabs answering three distinct
 * business questions; the map (Tab א) is the default and keeps its full
 * functionality unchanged -- consolidation here only removes the
 * *duplicate* competitor presentations that used to sit next to it
 * (the old standalone "מודיעין תחרותי"/"מפת התחרות" split), never the map
 * itself. Collapsed "מקורות ומתודולוגיה" stays reachable regardless of
 * which inner tab is open, as a single disclosure -- not a rebuilt Research
 * section. */
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
  const currentFamily = workspace.families.find((f) => f.family === family) ?? workspace.families[0];
  const familyKey = family === "3R" ? "standard_3r" : "standard_5r";

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-bold text-slate-900">השוק והמתחרים</h2>
        <p className="text-xs text-slate-500">מה קורה סביב הפרויקט ומה האלטרנטיבות של הקונה.</p>
      </div>

      <div className="flex overflow-hidden rounded-md border border-slate-300 w-fit">
        {INNER_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => onInnerTabChange(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              innerTab === t.key ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Each inner tab stays mounted-but-hidden (not unmounted) so the map's
          own internal state -- viewport, layer toggles, evidence-only mode
          -- survives switching tabs and coming back, matching how it
          already behaves on this page today. */}
      <div hidden={innerTab !== "map"}>
        <MarketGeoMap workspace={workspace} selection={mapSelection} onSelectionChange={onMapSelectionChange} />
      </div>
      <div hidden={innerTab !== "register"}>
        <CompetitorRegister workspace={workspace} projectPhase={marketingStrategy.projectPhase} family={family} onFamilyChange={onFamilyChange} />
      </div>
      <div hidden={innerTab !== "comparison"}>
        {currentFamily && (
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

      {currentFamily && (
        <details className="rounded-md border border-slate-200 p-3 text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-slate-500">מקורות ומתודולוגיה</summary>
          <div className="mt-2">
            <DataQualitySection workspace={workspace} family={currentFamily} />
          </div>
        </details>
      )}
    </section>
  );
}
