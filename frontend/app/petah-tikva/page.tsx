"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, PetahTikvaWorkspace, pricingRouteOf, PtkPriceListRow } from "@/lib/api";
import { checkWorkspaceContext, WORKSPACE_MISMATCH_MESSAGE } from "@/lib/workspaceGuard";
import { MarketMapSelection, SPECIAL_UNIT_NUMBERS, SpecialUnitNumber } from "@/lib/marketMap";
import PricingDecisionBoard from "./components/PricingDecisionBoard";
import PriceListConsistency from "./components/PriceListConsistency";
import ProjectKpiSummary from "./components/ProjectKpiSummary";
import ExecutiveOverview from "./components/ExecutiveOverview";
import BuildingExplorer from "./components/BuildingExplorer";
import UnitDrawer from "./components/UnitDrawer";
import MarketingStrategyPanel from "./components/MarketingStrategyPanel";
import WorkspaceTabs, { TopTab } from "./components/WorkspaceTabs";
import MarketAndCompetitionWorkspace, { MarketInnerTab } from "./components/MarketAndCompetitionWorkspace";
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

  useEffect(() => {
    let cancelled = false;
    api
      .getPetahTikvaWorkspace()
      .then((d) => {
        if (cancelled) return;
        // Defensive guard: never render a Petah Tikva page against
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
        console.error("Failed to load Petah Tikva workspace:", err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // "הצג ראיות והשוואות" (UnitDrawer) -- closes the drawer, jumps to השוק
  // והמתחרים, and opens Tab ג (product comparison) for this unit's family.
  const openFamilyEvidence = useCallback((f: "3R" | "5R") => {
    setSelectedUnit(null);
    setMarketFamily(f);
    setActiveTab("market");
    setMarketInnerTab("comparison");
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
    return <div className="p-10 text-slate-600">טוען את מרחב התמחור...</div>;
  }
  if (mismatch) {
    return (
      <div className="mx-auto max-w-lg p-10">
        <div className="rounded-lg border border-red-300 bg-red-50 p-5 text-sm text-red-800">
          <p className="whitespace-pre-line font-medium">{WORKSPACE_MISMATCH_MESSAGE}</p>
          <p className="mt-2 font-mono text-xs text-red-600">{mismatch}</p>
        </div>
      </div>
    );
  }
  if (error || !data) {
    // User-facing only -- never the raw fetch error (which can include a
    // stack trace or a bare hostname/URL); the actual error is still
    // available in the browser console for debugging.
    return (
      <div className="mx-auto max-w-lg p-10">
        <div className="rounded-lg border border-red-300 bg-red-50 p-5 text-center text-sm text-red-800">
          <p className="font-medium">לא ניתן לטעון כרגע את נתוני הפרויקט.</p>
          <p className="mt-1">נסה לרענן בעוד מספר שניות.</p>
        </div>
      </div>
    );
  }

  const currentFamily = data.families.find((f) => f.family === marketFamily) ?? data.families[0];

  // The frozen baseline price_list is the only price list rendered anywhere
  // in the user-facing product -- the historical 25/50/75 scenario selector
  // that used to swap it out has been removed entirely (kept only outside
  // this application, for historical research), so there is exactly one
  // market indication and one proposed price everywhere.
  const displayRows: PtkPriceListRow[] = data.price_list;

  return (
    <div className="min-h-screen pb-16">
      <header className="border-b border-slate-300 bg-white px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">כלי תומך החלטה לתמחור דירות</div>
            <h1 className="mt-0.5 text-xl font-bold text-slate-900">
              {data.project.name} | {data.project.city}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {data.project.address ?? `${data.project.commercial_area} / ${data.project.official_neighborhood}`}
            </p>
          </div>
          <Link href="/" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            פרויקטים
          </Link>
        </div>
        {data.project.demo_location_assumption && (
          <p className="mt-2 inline-block rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-400">
            {data.project.location_note ??
              "מיקום הפרויקט לצורך ההדגמה מבוסס על הנחת עבודה; כתובת מדויקת לא סופקה במטלה."}
          </p>
        )}
      </header>

      <main className="px-6 py-5">
        <WorkspaceTabs
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          pricingContent={
            <>
              <ProjectKpiSummary rows={displayRows} state={marketingStrategy} />
              <ExecutiveOverview workspace={data} rows={displayRows} />
              <BuildingExplorer rows={displayRows} marketingStrategy={marketingStrategy} onSelectUnit={setSelectedUnit} />
              <PricingDecisionBoard rows={displayRows} state={marketingStrategy} onSelectUnit={setSelectedUnit} />
              <PriceListConsistency workspace={data} rows={displayRows} state={marketingStrategy} onSelectUnit={setSelectedUnit} />
            </>
          }
          marketContent={
            <MarketAndCompetitionWorkspace
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
          strategyContent={<MarketingStrategyPanel rows={displayRows} state={marketingStrategy} onChange={setMarketingStrategy} />}
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
