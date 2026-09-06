"use client";

import { useState } from "react";
import { InventoryVersion } from "@/lib/api";
import { STATUS_COLORS, STATUS_LABELS, CONFIDENCE_LABELS, computeFamilyKey, familyLabel, isStandardFamily } from "@/lib/family";
import { ils, num } from "@/lib/format";

interface PriceListRow {
  unit_number: string;
  floor: string | null;
  rooms: number | null;
  internal_area: number | null;
  balcony_area: number | null;
  unit_type: string | null;
  family_key: string;
  status: string;
  market_confidence: string;
  supported_range: { lower: number | null; upper: number | null };
  proposed_list_price_ils: number | null;
  warnings: string[];
  requires_review: boolean;
}

interface Props {
  scenarioId: string;
  inventory: InventoryVersion;
  priceList: Record<string, unknown> | null;
  onReprice: () => Promise<void>;
  onSelectUnit: (unitNumber: string) => void;
  onGoToScenarios: () => void;
}

export default function PriceListTab({ inventory, priceList, onReprice, onSelectUnit, onGoToScenarios }: Props) {
  const [repricing, setRepricing] = useState(false);

  async function handleReprice() {
    setRepricing(true);
    try {
      await onReprice();
    } finally {
      setRepricing(false);
    }
  }

  const notPriced = !priceList || priceList.status === "not_priced";

  const standardFamiliesNeedingDecision = new Set<string>();
  if (notPriced) {
    for (const u of inventory.units) {
      if (isStandardFamily(u.unit_type)) {
        standardFamiliesNeedingDecision.add(computeFamilyKey(u.unit_type, u.rooms, u.internal_area));
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">מחירון הפרויקט</h2>
        <button
          onClick={handleReprice}
          disabled={repricing}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {repricing ? "מחשב..." : "תמחר את הפרויקט"}
        </button>
      </div>

      {notPriced ? (
        <div className="rounded-lg border border-slate-300 bg-white p-8 text-center">
          <p className="text-slate-700">טרם בוצע חישוב תמחור לתרחיש זה.</p>
          <p className="mt-1 text-sm text-slate-500">
            לחצו על &quot;תמחר את הפרויקט&quot; כדי לראות טווחי שוק נתמכים. עבור{" "}
            {[...standardFamiliesNeedingDecision].length} משפחות דירות סטנדרטיות תוצג &quot;נדרשת אסטרטגיה&quot; עד
            שתיקבע החלטה עסקית מפורשת בלשונית תרחישים.
          </p>
        </div>
      ) : (
        <>
          <MetricsStrip metrics={priceList!.project_metrics as Record<string, unknown>} onGoToScenarios={onGoToScenarios} rows={priceList!.units as PriceListRow[]} />
          <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <Th>דירה</Th>
                  <Th>קומה</Th>
                  <Th>חדרים</Th>
                  <Th>שטח (מ״ר)</Th>
                  <Th>מרפסת</Th>
                  <Th>משפחה</Th>
                  <Th>טווח שוק נתמך</Th>
                  <Th>מחיר מוצע</Th>
                  <Th>איכות ראיות</Th>
                  <Th>סטטוס</Th>
                </tr>
              </thead>
              <tbody>
                {(priceList!.units as PriceListRow[]).map((row) => {
                  const outside = row.warnings?.includes("proposed_list_price_outside_supported_market_range");
                  return (
                    <tr
                      key={row.unit_number}
                      onClick={() => onSelectUnit(row.unit_number)}
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                    >
                      <Td className="font-medium">{row.unit_number}</Td>
                      <Td>{row.floor ?? "—"}</Td>
                      <Td>{num(row.rooms, 0)}</Td>
                      <Td>{num(row.internal_area)}</Td>
                      <Td>{num(row.balcony_area)}</Td>
                      <Td className="whitespace-nowrap text-slate-600">
                        {familyLabel(row.unit_type, row.rooms, row.internal_area)}
                      </Td>
                      <Td>
                        {row.supported_range?.lower != null
                          ? `${ils(row.supported_range.lower)} – ${ils(row.supported_range.upper)}`
                          : "—"}
                      </Td>
                      <Td className="font-semibold">
                        {ils(row.proposed_list_price_ils)}
                        {outside && (
                          <span className="ms-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-normal text-red-800">
                            מחוץ לטווח
                          </span>
                        )}
                      </Td>
                      <Td>{CONFIDENCE_LABELS[row.market_confidence] ?? row.market_confidence}</Td>
                      <Td>
                        <span className={`rounded px-2 py-1 text-xs font-medium ${STATUS_COLORS[row.status] ?? "bg-slate-100 text-slate-700"}`}>
                          {STATUS_LABELS[row.status] ?? row.status}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function MetricsStrip({
  metrics,
  rows,
  onGoToScenarios,
}: {
  metrics: Record<string, unknown>;
  rows: PriceListRow[];
  onGoToScenarios: () => void;
}) {
  const strategyRequired = rows.filter((r) => r.status === "strategy_required");
  const families = new Set(strategyRequired.map((r) => r.family_key));
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-300 bg-white p-4 text-sm">
      <Metric label="שווי מחירון כולל" value={ils(metrics.total_proposed_list_value_ils as number)} />
      <Metric label="דירות מתומחרות" value={String(metrics.priced_unit_count ?? "—")} />
      <Metric label="בבדיקה פרטנית" value={String(metrics.manual_review_count ?? "—")} />
      <Metric label="מחוץ לטווח נתמך" value={String(metrics.units_outside_supported_range ?? "—")} />
      {families.size > 0 && (
        <button
          onClick={onGoToScenarios}
          className="ms-auto rounded-md bg-amber-100 px-3 py-2 text-amber-900 hover:bg-amber-200"
        >
          {families.size} משפחות דורשות אסטרטגיה — קביעה בלשונית תרחישים
        </button>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 text-start font-medium">{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-3 py-2 ${className ?? ""}`}>{children}</td>;
}
