"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, MarketContextSlug, MarketContextSummary, PetahTikvaWorkspace, pricingRouteOf, PtkPriceListRow } from "@/lib/api";
import { checkWorkspaceContext, WORKSPACE_MISMATCH_MESSAGE } from "@/lib/workspaceGuard";
import { MarketMapSelection, SPECIAL_UNIT_NUMBERS, SpecialUnitNumber } from "@/lib/marketMap";
import PricingDecisionBoard from "./components/PricingDecisionBoard";
import PriceListConsistency from "./components/PriceListConsistency";
import ProjectKpiSummary from "./components/ProjectKpiSummary";
import BuildingExplorer from "./components/BuildingExplorer";
import UnitDrawer from "./components/UnitDrawer";
import StrategyWorkspace from "./components/StrategyWorkspace";
import WorkspaceTabs, { TopTab } from "./components/WorkspaceTabs";
import MarketAndCompetitionWorkspace, { MarketInnerTab } from "./components/MarketAndCompetitionWorkspace";
import MarketContextSelector from "./components/MarketContextSelector";
import ProjectIntro from "./components/ProjectIntro";
import MethodologyStrip from "./components/MethodologyStrip";
import { defaultMarketingStrategyState, MarketingStrategyState } from "@/lib/marketingStrategy";

export default function PetahTikvaWorkspacePage() {
  const [data, setData] = useState<PetahTikvaWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<string | null>(null);
  // The geo map's own selection -- can be a standard family OR one of the 7
  // special units. Fully independent state; only the explicit "הצג ... על
  // המפה" drawer action (see openMapEvidence below) deliberately syncs the
  // two.
  const [mapSelection, setMapSelection] = useState<MarketMapSelection>({ kind: "standard_family", family: "3R" });
  const [selectedUnit, setSelectedUnit] = useState<PtkPriceListRow | null>(null);
  // The single source of truth for "which apartment does Tab 2's product-
  // comparison section (במה המוצר שלנו שונה מהמתחרים?) currently describe" --
  // set from every real selection action anywhere in the app, so it can
  // represent a standard family OR a specific special unit, and is never
  // silently stuck on a previous subject. null until the user makes an
  // explicit selection, in which case a sensible default is derived from
  // the loaded workspace below (see effectiveComparisonUnit). Two distinct
  // ways to set it, both converging on this one state:
  //   - selectUnit(row) below: opening an apartment's drawer (board row,
  //     floor tile, a finding link) -- also opens the drawer.
  //   - setComparisonUnit directly, passed to Tab 2's own apartment-type
  //     selector -- changes the comparison subject WITHOUT opening the
  //     drawer, since picking "5 חדרים"/"טריפלקס" there is a type choice,
  //     not "open this specific apartment".
  const [comparisonUnit, setComparisonUnit] = useState<PtkPriceListRow | null>(null);
  // The one competitor most recently pinned via the map's "פתח השוואה מלאה"
  // -- a plain project-name string (the same identity used throughout
  // competitor_landscape/new_development_comparables), read by
  // ProductComparisonSection to force-show/expand that exact competitor.
  // null until an explicit map action sets it; reset on market-context
  // switch below since competitor identities are specific to one context.
  const [selectedCompetitorName, setSelectedCompetitorName] = useState<string | null>(null);

  const [marketingStrategy, setMarketingStrategy] = useState<MarketingStrategyState>(defaultMarketingStrategyState());

  // Top-level capability shell + the market workspace's own inner tab --
  // both controlled here (not self-managed) so the drawer's "הצג ראיות"
  // actions can jump straight to a specific tab/inner-tab from anywhere,
  // and so navigating away and back never resets either selection.
  const [activeTab, setActiveTab] = useState<TopTab>("pricing");
  const [marketInnerTab, setMarketInnerTab] = useState<MarketInnerTab>("map");
  // Tab 1's stacking-plan / full-table toggle -- only one of
  // BuildingExplorer/PricingDecisionBoard renders at a time (previously both
  // rendered simultaneously).
  const [pricingView, setPricingView] = useState<"stacking" | "table">("stacking");

  // "הקשר שוק" -- which of the four frozen market contexts the same
  // 39-apartment inventory is being evaluated against. Persistent, page-
  // level state (not per-tab) since it affects all three capabilities.
  const [marketContext, setMarketContext] = useState<MarketContextSlug>("petah_tikva");
  const [marketContexts, setMarketContexts] = useState<MarketContextSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.getMarketContexts().then((list) => {
      if (!cancelled) setMarketContexts(list);
    }).catch((err) => console.error("Failed to load market contexts:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMismatch(null);
    setError(null);
    api
      .getMarketWorkspace(marketContext)
      .then((d) => {
        if (cancelled) return;
        // Defensive guard: never render a market context against
        // mismatched/contaminated market metadata -- fail loudly instead.
        const guard = checkWorkspaceContext(d);
        if (!guard.ok) {
          setMismatch(guard.reason ?? "unknown mismatch");
          return;
        }
        setData(d);
      })
      .catch((err) => {
        // Logged for developer debugging only -- never rendered to the user
        // (see the error branch below).
        console.error("Failed to load market workspace:", err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [marketContext]);

  // Switching market context must reset every stale selection tied to the
  // PREVIOUS context's evidence -- a competitor card, a map popup, the
  // selected inner tab -- so the UI never accidentally shows one context's
  // record while another is selected. `MarketAndCompetitionWorkspace` also
  // receives `key={marketContext}` below (see render) so its own internally
  // -managed state (map viewport, register filters, product-comparison
  // selection) is reset by a full remount rather than needing every nested
  // piece of state threaded up here individually.
  const handleMarketContextChange = useCallback((slug: MarketContextSlug) => {
    setMarketContext(slug);
    setSelectedUnit(null);
    setComparisonUnit(null);
    setSelectedCompetitorName(null);
    setMapSelection({ kind: "standard_family", family: "3R" });
    setMarketInnerTab("map");
  }, []);

  // "פתח השוואה מלאה" (map competitor popup) -- pins that exact competitor
  // and jumps to Tab ב (מול מי אנחנו מתחרים?) of השוק והמתחרים, mirroring
  // openFamilyEvidence/openMapEvidence above. Never touches comparisonUnit:
  // the comparison must reflect whatever product group is CURRENTLY
  // selected, not force a family switch of its own.
  const openCompetitorComparison = useCallback((competitorName: string) => {
    setSelectedCompetitorName(competitorName);
    setActiveTab("market");
    setMarketInnerTab("competitors");
  }, []);

  // Opens an apartment's drawer AND makes it the current product-comparison
  // subject (see comparisonUnit above) -- the one action every "select a
  // unit" entry point in the app (board row, floor tile, consistency
  // finding, strategy-impact row) should go through, so Tab 2's comparison
  // section always reflects whatever apartment was looked at last, standard
  // or special, with no separate "sync the comparison tab" step required.
  const selectUnit = useCallback((row: PtkPriceListRow) => {
    setSelectedUnit(row);
    setComparisonUnit(row);
  }, []);

  // "הצג ראיות והשוואות" (UnitDrawer) -- closes the drawer, jumps to השוק
  // והמתחרים, and opens Tab ב (product comparison). comparisonUnit is
  // already this same unit (selectUnit set it when the drawer opened), so
  // Tab ב's apartment-type selector already shows and reacts to it -- no
  // separate family state to sync here anymore.
  const openFamilyEvidence = useCallback(() => {
    setSelectedUnit(null);
    setActiveTab("market");
    setMarketInnerTab("competitors");
  }, []);

  // "הצג את ראיות השוק על המפה" (UnitDrawer) -- closes the drawer, switches
  // the map to this exact unit's evidence (special-unit basket, or standard
  // family), and jumps to Tab א of השוק והמתחרים. mapSelection stays its own
  // independent state (the map's own family/unit toggle, deliberately
  // separate from the comparison subject) -- only it is synced here.
  const openMapEvidence = useCallback((row: PtkPriceListRow) => {
    setSelectedUnit(null);
    if (pricingRouteOf(row) === "standard_family") {
      const f = row.family as "3R" | "5R";
      setMapSelection({ kind: "standard_family", family: f });
    } else {
      const n = Number(row.unit_number);
      if ((SPECIAL_UNIT_NUMBERS as number[]).includes(n)) {
        setMapSelection({ kind: "special_unit", unitNumber: n as SpecialUnitNumber });
      }
    }
    setActiveTab("market");
    setMarketInnerTab("map");
  }, []);

  if (loading) {
    return <div className="bg-canvas p-10 text-ink-muted">טוען את מרחב התמחור...</div>;
  }
  if (mismatch) {
    return (
      <div className="mx-auto max-w-lg bg-canvas p-10">
        <div className="rounded-lg border border-conflict/40 bg-conflict/10 p-5 text-sm text-conflict">
          <p className="whitespace-pre-line font-medium">{WORKSPACE_MISMATCH_MESSAGE}</p>
          <p className="mt-2 font-mono text-xs opacity-80">{mismatch}</p>
        </div>
      </div>
    );
  }
  if (error || !data) {
    // User-facing only -- never the raw fetch error (which can include a
    // stack trace or a bare hostname/URL); the actual error is still
    // available in the browser console for debugging.
    return (
      <div className="mx-auto max-w-lg bg-canvas p-10">
        <div className="rounded-lg border border-conflict/40 bg-conflict/10 p-5 text-center text-sm text-conflict">
          <p className="font-medium">לא ניתן לטעון כרגע את נתוני הפרויקט.</p>
          <p className="mt-1">נסה לרענן בעוד מספר שניות.</p>
        </div>
      </div>
    );
  }

  // The frozen baseline price_list is the only price list rendered anywhere
  // in the user-facing product -- the historical 25/50/75 scenario selector
  // that used to swap it out has been removed entirely (kept only outside
  // this application, for historical research), so there is exactly one
  // market indication and one proposed price everywhere.
  const displayRows: PtkPriceListRow[] = data.price_list;

  // Falls back to a real, concrete row (never null/undefined) so the
  // comparison section always has a subject -- a 3R row when nothing has
  // been explicitly selected yet, matching today's baseline view, but a
  // genuine selection always wins once one exists.
  const effectiveComparisonUnit: PtkPriceListRow = comparisonUnit ?? displayRows.find((r) => r.family === "3R") ?? displayRows[0];

  return (
    <div className="min-h-screen bg-canvas pb-16">
      <header className="border-b border-hairline bg-surface px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">מרחב תמחור גבאי</div>
            <p className="mt-0.5 text-sm text-ink-muted">כלי תומך החלטה לתמחור דירות</p>
          </div>
          <div className="flex items-center gap-3">
            <MarketContextSelector contexts={marketContexts} value={marketContext} onChange={handleMarketContextChange} />
            <Link href="/" className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink-muted hover:bg-canvas">
              פרויקטים
            </Link>
          </div>
        </div>
      </header>

      <main className="px-6 py-5">
        <WorkspaceTabs
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          pricingContent={
            <>
              <ProjectIntro projectName={`${data.project.name} | ${data.project.city}`} unitCount={displayRows.length} />
              {data.project.demo_location_assumption && (
                <p className="-mt-3 inline-block w-fit rounded bg-hairline/40 px-2 py-1 text-[11px] text-ink-muted">
                  {data.project.location_note ??
                    "מיקום הפרויקט לצורך ההדגמה מבוסס על הנחת עבודה; כתובת מדויקת לא סופקה במטלה."}
                </p>
              )}
              <ProjectKpiSummary workspace={data} rows={displayRows} state={marketingStrategy} />
              <MethodologyStrip />

              <div className="flex overflow-hidden rounded-md border border-hairline w-fit">
                <button
                  onClick={() => setPricingView("stacking")}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${pricingView === "stacking" ? "bg-ink text-surface" : "bg-surface text-ink-muted hover:bg-canvas"}`}
                >
                  מבט קומות
                </button>
                <button
                  onClick={() => setPricingView("table")}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${pricingView === "table" ? "bg-ink text-surface" : "bg-surface text-ink-muted hover:bg-canvas"}`}
                >
                  מחירון מלא
                </button>
              </div>

              <div className="rounded-lg border border-hairline bg-surface p-5">
                {pricingView === "stacking" ? (
                  <BuildingExplorer rows={displayRows} marketingStrategy={marketingStrategy} onSelectUnit={selectUnit} />
                ) : (
                  <PricingDecisionBoard rows={displayRows} state={marketingStrategy} onSelectUnit={selectUnit} />
                )}
              </div>

              <PriceListConsistency workspace={data} rows={displayRows} state={marketingStrategy} onSelectUnit={selectUnit} />
            </>
          }
          marketContent={
            <MarketAndCompetitionWorkspace
              key={marketContext}
              workspace={data}
              marketingStrategy={marketingStrategy}
              mapSelection={mapSelection}
              onMapSelectionChange={setMapSelection}
              innerTab={marketInnerTab}
              onInnerTabChange={setMarketInnerTab}
              comparisonUnit={effectiveComparisonUnit}
              onComparisonUnitChange={setComparisonUnit}
              selectedCompetitorName={selectedCompetitorName}
              onOpenFullComparison={openCompetitorComparison}
            />
          }
          strategyContent={
            <StrategyWorkspace
              rows={displayRows}
              state={marketingStrategy}
              onChange={setMarketingStrategy}
              onOpenUnit={selectUnit}
              onBackToPriceList={() => setActiveTab("pricing")}
            />
          }
        />
      </main>

      {selectedUnit && (
        <UnitDrawer
          row={selectedUnit}
          workspace={data}
          marketingStrategy={marketingStrategy}
          onChangeMarketingStrategy={setMarketingStrategy}
          onOpenFamilyEvidence={openFamilyEvidence}
          onOpenMapEvidence={openMapEvidence}
          onClose={() => setSelectedUnit(null)}
        />
      )}
    </div>
  );
}
