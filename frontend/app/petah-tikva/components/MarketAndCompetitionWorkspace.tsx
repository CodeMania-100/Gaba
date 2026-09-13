"use client";

import { useEffect, useMemo, useRef } from "react";
import { PetahTikvaWorkspace, PtkPriceListRow } from "@/lib/api";
import { MarketMapSelection } from "@/lib/marketMap";
import { deriveAskingListingMarkers, deriveCompletedSalesOverview } from "@/lib/executiveVisuals";
import { MarketingStrategyState } from "@/lib/marketingStrategy";
import { deriveComparisonSelectorOptions, deriveComparisonSubject, resolveRowForSelector, selectorKeyForSubject } from "@/lib/comparisonSubject";
import MarketGeoMap from "./MarketGeoMap";
import MarketTrendChart from "./MarketTrendChart";
import MarketEvidenceRegister from "./MarketEvidenceRegister";
import CompetitorRegister from "./CompetitorRegister";
import MarketPositionSection from "./MarketPositionSection";
import ProductComparisonSection from "./ProductComparisonSection";
import SpecialUnitProductComparison from "./SpecialUnitProductComparison";
import DataQualitySection from "./DataQualitySection";

export type MarketInnerTab = "map" | "competitors";

interface Props {
  workspace: PetahTikvaWorkspace;
  marketingStrategy: MarketingStrategyState;
  mapSelection: MarketMapSelection;
  onMapSelectionChange: (s: MarketMapSelection) => void;
  // Controlled from the page so "הצג את ראיות השוק על המפה" (UnitDrawer)
  // can jump straight to Tab א from anywhere, and so returning to this
  // workspace from another top-level tab preserves whichever inner tab was
  // open.
  innerTab: MarketInnerTab;
  onInnerTabChange: (t: MarketInnerTab) => void;
  // The single canonical comparison subject -- the apartment (standard or
  // special) the user most recently selected anywhere in the app: a price-
  // list row, a floor tile, opening the drawer, OR the apartment-type
  // selector rendered below (see onComparisonUnitChange). There is
  // deliberately no separate family/selector state anywhere in this tree --
  // every piece of Tab 2-ב (heading, price-positioning, competitor
  // register, MATCH/DIFFERENT/UNKNOWN table, special-unit comparable,
  // sibling comparison) is derived from this one value via
  // lib/comparisonSubject.ts's deriveComparisonSubject.
  comparisonUnit: PtkPriceListRow;
  onComparisonUnitChange: (row: PtkPriceListRow) => void;
  // The one competitor "פתח השוואה מלאה" (map popup) most recently pinned --
  // read by ProductComparisonSection so it force-includes/expands that
  // exact competitor's card instead of only ever showing its own
  // auto-picked "strongest 3", and by MarketGeoMap so the popup's button can
  // set it. Persists across a standard-family switch (3R <-> 5R) and across
  // returning to this tab, exactly like comparisonUnit above; only an
  // explicit new map selection changes it.
  selectedCompetitorName: string | null;
  onOpenFullComparison: (competitorName: string) => void;
}

type InnerTab = MarketInnerTab;

const INNER_TABS: { key: InnerTab; label: string }[] = [
  { key: "map", label: "איפה נמצאות ראיות השוק?" },
  { key: "competitors", label: "מול מי אנחנו מתחרים?" },
];

/** "השוק והמתחרים" -- two business questions, not a pile of research
 * widgets: א. where is market evidence (map first, trend chart secondary,
 * evidence register collapsed) and ב. who are we competing against
 * (one apartment-type selector at the top, everything below it -- price-
 * positioning, the competitor register, the product comparison -- reacting
 * to that exact same selection, standard or special, with no independent
 * state of its own). The map keeps its full functionality unchanged.
 * Collapsed "מקורות ומתודולוגיה" stays reachable regardless of which inner
 * tab is open, as a single disclosure. */
export default function MarketAndCompetitionWorkspace({
  workspace,
  marketingStrategy,
  mapSelection,
  onMapSelectionChange,
  innerTab,
  onInnerTabChange,
  comparisonUnit,
  onComparisonUnitChange,
  selectedCompetitorName,
  onOpenFullComparison,
}: Props) {
  // Resolved fresh on every render from comparisonUnit -- never cached
  // against a stale family, so 3R -> 5R -> garden -> triplex/duplex always
  // takes effect immediately, with no silent fallback to a previous subject.
  const comparisonSubject = deriveComparisonSubject(comparisonUnit);
  const selectorKey = selectorKeyForSubject(comparisonSubject);
  const selectorOptions = useMemo(() => deriveComparisonSelectorOptions(workspace.price_list), [workspace]);
  const comparisonFamily =
    comparisonSubject.kind === "standard" ? workspace.families.find((f) => f.family === comparisonSubject.family) : undefined;
  const comparisonFamilyKey = comparisonSubject.kind === "standard" ? (comparisonSubject.family === "3R" ? "standard_3r" : "standard_5r") : undefined;

  const completedSales = useMemo(() => deriveCompletedSalesOverview(workspace), [workspace]);
  const askingMarkers = useMemo(() => deriveAskingListingMarkers(workspace), [workspace]);

  // "פתח השוואה מלאה" (map popup) jumps here via innerTab, but the page can
  // still be scrolled to wherever the map itself was -- explicitly bring
  // the comparison area into view so the pinned competitor's card is
  // actually visible, not just technically mounted.
  const comparisonSectionRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selectedCompetitorName && innerTab === "competitors") {
      comparisonSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Only the arrival of a new pinned competitor (or landing on this tab
    // with one already pinned) should trigger the scroll -- never a
    // family/comparisonUnit change alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompetitorName, innerTab]);

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
        <MarketGeoMap workspace={workspace} selection={mapSelection} onSelectionChange={onMapSelectionChange} onOpenFullComparison={onOpenFullComparison} />
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
        {/* The one apartment-type selector for this whole tab -- everything
            below reacts to it via comparisonSubject, never a second state. */}
        <div className="flex flex-wrap overflow-hidden rounded-md border border-hairline w-fit">
          {selectorOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => {
                const row = resolveRowForSelector(workspace.price_list, workspace.special_unit_market_context.units, opt);
                if (row) onComparisonUnitChange(row);
              }}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                selectorKey === opt.key ? "bg-ink text-surface" : "bg-surface text-ink-muted hover:bg-canvas"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {comparisonSubject.kind === "standard" && comparisonFamily && comparisonFamilyKey ? (
          <div key={comparisonSubject.family} ref={comparisonSectionRef} className="flex flex-col gap-4">
            <CompetitorRegister workspace={workspace} projectPhase={marketingStrategy.projectPhase} family={comparisonSubject.family} />
            <ProductComparisonSection
              workspace={workspace}
              projectPhase={marketingStrategy.projectPhase}
              family={comparisonFamily}
              familyKey={comparisonFamilyKey}
              enrichment={workspace.standard_attribute_enrichment}
              activePrice={comparisonFamily.proposed_family_price_ils}
              priceLabel="בסיס"
              pinnedCompetitorName={selectedCompetitorName}
            />
          </div>
        ) : comparisonSubject.kind === "special" ? (
          <SpecialUnitProductComparison key={comparisonSubject.row.unit_number} row={comparisonSubject.row} workspace={workspace} />
        ) : null}
      </div>

      {/* Standard-family methodology only -- a special unit's own evidence
          detail already lives in its drawer ("פירוט מלא"), never restated
          here against a family that wouldn't actually match the selection. */}
      {comparisonSubject.kind === "standard" && comparisonFamily && (
        <details className="rounded-md border border-hairline p-3 text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-ink-muted">מקורות ומתודולוגיה</summary>
          <div className="mt-2">
            <DataQualitySection workspace={workspace} family={comparisonFamily} />
          </div>
        </details>
      )}
    </section>
  );
}
