"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, PetahTikvaScenario, PetahTikvaWorkspace, pricingRouteOf, PtkPriceListRow } from "@/lib/api";
import { checkWorkspaceContext, WORKSPACE_MISMATCH_MESSAGE } from "@/lib/workspaceGuard";
import FamilyPanel from "./components/FamilyPanel";
import DecisionBoard from "./components/DecisionBoard";
import StrategyPanel from "./components/StrategyPanel";
import DataQualitySection, { CaseStudyCard3R } from "./components/DataQualitySection";
import PricingDecisionBoard from "./components/PricingDecisionBoard";
import UnitDrawer from "./components/UnitDrawer";
import EvidenceDetailModal from "./components/EvidenceDetailModal";
import CompetitorMap from "./components/CompetitorMap";
import MarketingStrategyPanel from "./components/MarketingStrategyPanel";
import ResearchSection from "./components/ResearchSection";
import { defaultMarketingStrategyState, MarketingStrategyState } from "@/lib/marketingStrategy";

export default function PetahTikvaWorkspacePage() {
  const [data, setData] = useState<PetahTikvaWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [family, setFamily] = useState<"3R" | "5R">("3R");
  const [selectedUnit, setSelectedUnit] = useState<PtkPriceListRow | null>(null);
  const [evidenceLane, setEvidenceLane] = useState<"sold" | "current_asking" | "new_development" | null>(null);

  const [scenario, setScenario] = useState<PetahTikvaScenario | null>(null);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  const [marketingStrategy, setMarketingStrategy] = useState<MarketingStrategyState>(defaultMarketingStrategyState());
  const [researchOpen, setResearchOpen] = useState(false);

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
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openFamilyEvidence = useCallback((f: "3R" | "5R") => {
    setSelectedUnit(null);
    setFamily(f);
    setResearchOpen(true);
    // Double rAF: the research section must mount (it's collapsed via the
    // `hidden` attribute, not unmounted, but the family switch above still
    // needs a render pass) before scrollIntoView can find #evidence-section.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById("evidence-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }, []);

  const loadScenario = useCallback(async (pct: number) => {
    setScenarioLoading(true);
    setScenarioError(null);
    try {
      const result = await api.getPetahTikvaScenario(pct);
      setScenario(result);
    } catch (err) {
      setScenarioError(err instanceof Error ? err.message : String(err));
    } finally {
      setScenarioLoading(false);
    }
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
    return <div className="p-10 text-red-700">שגיאה בטעינת מרחב התמחור: {error}</div>;
  }

  const currentFamily = data.families.find((f) => f.family === family) ?? data.families[0];

  // The frozen baseline price_list is never mutated. When a scenario is active,
  // standard rows are swapped for the scenario's (in-memory, backend-computed)
  // price -- with the baseline price carried alongside for comparison -- while
  // the 7 special rows always come from the untouched baseline, unaffected by
  // any strategy position.
  const scenarioByUnit = new Map((scenario?.price_list ?? []).map((r) => [r.unit_number, r]));
  const displayRows: PtkPriceListRow[] = data.price_list.map((baseRow) => {
    if (!scenario || pricingRouteOf(baseRow) !== "standard_family") return baseRow;
    return scenarioByUnit.get(baseRow.unit_number) ?? baseRow;
  });

  return (
    <div className="min-h-screen pb-16">
      <header className="border-b border-slate-300 bg-white px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">כלי תומך החלטה לתמחור דירות</div>
            <h1 className="mt-0.5 text-xl font-bold text-slate-900">
              פרויקט הדגמה – {data.project.name} | {data.project.city}
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

      <main className="flex flex-col gap-6 px-6 py-5">
        <PricingDecisionBoard
          rows={displayRows}
          state={marketingStrategy}
          onSelectUnit={setSelectedUnit}
          activeScenarioPct={scenario && !scenario.is_baseline_position ? scenario.range_position_pct : null}
        />

        <MarketingStrategyPanel rows={displayRows} state={marketingStrategy} onChange={setMarketingStrategy} />

        <ResearchSection open={researchOpen} onToggle={() => setResearchOpen((v) => !v)}>
          <section id="evidence-section">
            <div className="mb-3 flex overflow-hidden rounded-md border border-slate-300 w-fit">
              {(["3R", "5R"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFamily(f)}
                  className={`px-5 py-2 text-sm font-semibold transition ${
                    family === f ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {f === "3R" ? "3 חדרים" : "5 חדרים"}
                </button>
              ))}
            </div>
            {currentFamily && <FamilyPanel family={currentFamily} workspace={data} onOpenEvidence={setEvidenceLane} />}
          </section>

          <CompetitorMap workspace={data} />

          {currentFamily && <DecisionBoard workspace={data} family={currentFamily} scenario={scenario} />}

          <div id="strategy-section">
            <StrategyPanel
              scenario={scenario}
              loading={scenarioLoading}
              error={scenarioError}
              baselineTotalIls={data.project.total_standard_unit_revenue_ils}
              selectedFamily={family}
              familyRange={{ lower: currentFamily?.market.supported_lower ?? null, upper: currentFamily?.market.supported_upper ?? null }}
              onSelectPosition={loadScenario}
              onResetToBaseline={() => setScenario(null)}
            />
          </div>

          <CaseStudyCard3R caseStudy={data.data_quality.case_study_3r_new_development} />

          {currentFamily && <DataQualitySection workspace={data} family={currentFamily} />}
        </ResearchSection>

        <p className="text-xs text-slate-400">{data.project.disclaimer}</p>
      </main>

      {selectedUnit && (
        <UnitDrawer
          row={selectedUnit}
          workspace={data}
          marketingStrategy={marketingStrategy}
          onChangeMarketingStrategy={setMarketingStrategy}
          onOpenFamilyEvidence={openFamilyEvidence}
          onClose={() => setSelectedUnit(null)}
        />
      )}
      {evidenceLane && currentFamily && (
        <EvidenceDetailModal workspace={data} family={currentFamily.family} lane={evidenceLane} onClose={() => setEvidenceLane(null)} />
      )}
    </div>
  );
}
