"use client";

import { InventoryVersion, MarketSnapshot } from "@/lib/api";
import { isStandardFamily } from "@/lib/family";
import { dateTimeIL, dateIL } from "@/lib/format";

interface Props {
  inventory: InventoryVersion;
  snapshot: MarketSnapshot;
  priceList: Record<string, unknown> | null;
}

const SOURCE_LABELS: Record<string, string> = {
  govmap_sold_3room: "GovMap — עסקאות שהושלמו, 3 חדרים",
  govmap_sold_5room: "GovMap — עסקאות שהושלמו, 5 חדרים",
  madlan_listings: "מדלן — היצע נוכחי",
  madlan_projects: "מדלן — פרויקטים מתחרים חדשים",
  yad2_listings: "יד2 — היצע נוכחי (משני)",
  xplan_area: "XPLAN — הקשר תכנוני (שטח)",
  xplan_point: "XPLAN — הקשר תכנוני (נקודתי)",
  construction_competitor_matches: "רישום בנייה — מתחרים מזוהים",
  construction_summary: "רישום בנייה — סיכום עירוני",
  tax_enrichment: "רשות המסים — העשרה איכותית (משני)",
};

export default function OverviewTab({ inventory, snapshot, priceList }: Props) {
  const standard = inventory.units.filter((u) => isStandardFamily(u.unit_type));
  const special = inventory.units.filter((u) => !isStandardFamily(u.unit_type));

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatBox label="סה״כ דירות" value={inventory.units.length} />
        <StatBox label="דירות סטנדרטיות" value={standard.length} />
        <StatBox label="בדיקה פרטנית" value={special.length} />
        <StatBox
          label="דורשות אסטרטגיה"
          value={
            priceList && priceList.status === "priced"
              ? ((priceList.units as { status: string }[]).filter((u) => u.status === "strategy_required").length)
              : "—"
          }
        />
      </section>

      <section className="rounded-lg border border-slate-300 bg-white p-4">
        <h2 className="font-semibold text-slate-900">יחידות בבדיקה פרטנית</h2>
        <ul className="mt-2 flex flex-wrap gap-2 text-sm">
          {special.map((u) => (
            <li key={u.unit_number} className="rounded bg-violet-50 px-2 py-1 text-violet-900">
              דירה {u.unit_number} — {u.unit_type}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-slate-300 bg-white p-4">
        <h2 className="font-semibold text-slate-900">תמונת מצב השוק</h2>
        <p className="mt-1 text-sm text-slate-500">
          תאריך התייחסות לתמחור: {dateIL(snapshot.pricing_as_of)} ({snapshot.pricing_as_of_basis})
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start">מקור</th>
                <th className="px-3 py-2 text-start">סטטוס</th>
                <th className="px-3 py-2 text-start">רשומות</th>
                <th className="px-3 py-2 text-start">נאספו בפועל</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.source_runs.map((r) => (
                <tr key={r.source_key} className="border-t border-slate-100">
                  <td className="px-3 py-2">{SOURCE_LABELS[r.source_key] ?? r.source_key}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        r.status === "success"
                          ? "text-emerald-700"
                          : r.status === "unavailable"
                            ? "text-slate-500"
                            : "text-red-700"
                      }
                    >
                      {r.status === "success" ? "הצלחה" : r.status === "unavailable" ? "לא זמין" : "כשל"}
                    </span>
                  </td>
                  <td className="px-3 py-2">{r.raw_count}</td>
                  <td className="px-3 py-2">{dateTimeIL(r.collected_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-slate-300 bg-white p-4 text-center">
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
