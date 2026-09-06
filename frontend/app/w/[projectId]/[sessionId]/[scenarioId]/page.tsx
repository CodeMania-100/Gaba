"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, InventoryVersion, MarketSnapshot, PricingSession, Scenario } from "@/lib/api";
import PriceListTab from "./components/PriceListTab";
import EvidenceTab from "./components/EvidenceTab";
import ScenariosTab from "./components/ScenariosTab";
import OverviewTab from "./components/OverviewTab";
import UnitEvidenceModal from "./components/UnitEvidenceModal";

type TabKey = "price-list" | "evidence" | "scenarios" | "overview";

const TABS: { key: TabKey; label: string }[] = [
  { key: "price-list", label: "מחירון" },
  { key: "evidence", label: "ראיות שוק" },
  { key: "scenarios", label: "תרחישים" },
  { key: "overview", label: "סקירה" },
];

export default function WorkspacePage() {
  const params = useParams<{ projectId: string; sessionId: string; scenarioId: string }>();
  const router = useRouter();
  const { projectId, sessionId, scenarioId } = params;

  const [tab, setTab] = useState<TabKey>("price-list");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [session, setSession] = useState<PricingSession | null>(null);
  const [inventory, setInventory] = useState<InventoryVersion | null>(null);
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [priceList, setPriceList] = useState<Record<string, unknown> | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const currentScenario = scenarios.find((s) => s.id === scenarioId) ?? null;

  const loadPriceList = useCallback(async () => {
    const pl = await api.getPriceList(scenarioId);
    setPriceList(pl);
  }, [scenarioId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const s = await api.getPricingSession(sessionId);
        if (cancelled) return;
        setSession(s);
        const [inv, snap, scenarioList, pl] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/v1/inventory/${s.inventory_version_id}`).then((r) => r.json()),
          api.getMarketSnapshot(s.market_snapshot_id),
          api.listScenarios(sessionId),
          api.getPriceList(scenarioId),
        ]);
        if (cancelled) return;
        setInventory(inv);
        setSnapshot(snap);
        setScenarios(scenarioList);
        setPriceList(pl);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, scenarioId, refreshTick]);

  function refreshAll() {
    setRefreshTick((t) => t + 1);
  }

  if (loading) {
    return <div className="p-10 text-slate-600">טוען תיק תמחור...</div>;
  }
  if (error || !session || !inventory || !snapshot) {
    return <div className="p-10 text-red-700">שגיאה בטעינת תיק התמחור: {error}</div>;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm text-amber-900">
        פרויקט הדגמה — {snapshot.location.neighborhood}, {snapshot.location.city}. המיקום לא סופק על ידי גבאי; זהו שוק
        הדגמה שנבחר לצורך המטלה בלבד.
      </header>

      <div className="flex items-center justify-between border-b border-slate-300 bg-white px-6 py-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">מרחב תמחור גבאי — פרויקט הדגמה</h1>
          <p className="text-sm text-slate-500">
            תרחיש נוכחי: <span className="font-medium text-slate-800">{currentScenario?.name ?? "—"}</span>
          </p>
        </div>
        <button
          onClick={() => router.push("/")}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          פרויקטים
        </button>
      </div>

      <nav className="flex gap-1 border-b border-slate-300 bg-white px-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition ${
              tab === t.key
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="p-6">
        {tab === "price-list" && (
          <PriceListTab
            scenarioId={scenarioId}
            inventory={inventory}
            priceList={priceList}
            onReprice={async () => {
              await api.reprice(scenarioId);
              await loadPriceList();
            }}
            onSelectUnit={(unitNumber) => setSelectedUnit(unitNumber)}
            onGoToScenarios={() => setTab("scenarios")}
          />
        )}
        {tab === "evidence" && (
          <EvidenceTab
            scenarioId={scenarioId}
            inventory={inventory}
            priceList={priceList}
            onSelectUnit={(unitNumber) => setSelectedUnit(unitNumber)}
          />
        )}
        {tab === "scenarios" && (
          <ScenariosTab
            projectId={projectId}
            sessionId={sessionId}
            currentScenarioId={scenarioId}
            scenarios={scenarios}
            inventory={inventory}
            onScenariosChanged={refreshAll}
            onRepriced={loadPriceList}
          />
        )}
        {tab === "overview" && (
          <OverviewTab inventory={inventory} snapshot={snapshot} priceList={priceList} />
        )}
      </main>

      {selectedUnit && (
        <UnitEvidenceModal scenarioId={scenarioId} unitNumber={selectedUnit} onClose={() => setSelectedUnit(null)} />
      )}
    </div>
  );
}
