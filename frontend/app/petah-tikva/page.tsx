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
import MarketingStrategyPanel from "./components/MarketingStrategyPanel";
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
  // Standard 3R/5R family, shared by the market/competition workspace --
  // unrelated to the map's own selection below (a special-unit map
  // selection must never break these standard-only sections).
  const [marketFamily, setMarketFamily] = useState<"3R" | "5R">("3R");
  // The geo map's own selection -- can be a standard family OR one of the 7
  // special units. Fully independent state; only the explicit "הצג ... על
  // המפה" drawer action (see openMapEvidence below) deliberately syncs the
  // two.
  const [mapSelection, setMapSelection] = useState<MarketMapSelection>({ kind: "standard_family", family: "3R" });
  const [selectedUnit, setSelectedUnit] = useState<PtkPriceListRow | null>(null);

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
    setMapSelection({ kind: "standard_family", family: "3R" });
    setMarketFamily("3R");
    setMarketInnerTab("map");
  }, []);

  // "הצג ראיות והשוואות" (UnitDrawer) -- closes the drawer, jumps to השוק
  // והמתחרים, and opens Tab ג (product comparison) for this unit's family.
  const openFamilyEvidence = useCallback((f: "3R" | "5R") => {
    setSelectedUnit(null);
    setMarketFamily(f);
    setActiveTab("market");
    setMarketInnerTab("competitors");
  }, []);

  // "הצג את ראיות השוק על המפה" (UnitDrawer) -- closes the drawer, switches
  // the map to this exact unit's evidence (special-unit basket, or standard
  // family), and jumps to Tab א of השוק והמתחרים. For a standard unit this
  // also syncs marketFamily, since navigating here is a deliberate single
  // "show me this unit's context" action (unlike the map's own family
  // toggle, which stays fully independent).
  const openMapEvidence = useCallback((row: PtkPriceListRow) => {
    setSelectedUnit(null);
    if (pricingRouteOf(row) === "standard_family") {
      const f = row.family as "3R" | "5R";
      setMarketFamily(f);
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
                  <BuildingExplorer rows={displayRows} marketingStrategy={marketingStrategy} onSelectUnit={setSelectedUnit} />
                ) : (
                  <PricingDecisionBoard rows={displayRows} state={marketingStrategy} onSelectUnit={setSelectedUnit} />
                )}
              </div>

              <PriceListConsistency workspace={data} rows={displayRows} state={marketingStrategy} onSelectUnit={setSelectedUnit} />
            </>
          }
          marketContent={
            <MarketAndCompetitionWorkspace
              key={marketContext}
              workspace={data}
              marketingStrategy={marketingStrategy}
              family={marketFamily}
              onFamilyChange={setMarketFamily}
              mapSelection={mapSelection}
              onMapSelectionChange={setMapSelection}
              innerTab={marketInnerTab}
              onInnerTabChange={setMarketInnerTab}
            />
          }
          strategyContent={
            <MarketingStrategyPanel
              rows={displayRows}
              state={marketingStrategy}
              onChange={setMarketingStrategy}
              onOpenUnit={setSelectedUnit}
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
