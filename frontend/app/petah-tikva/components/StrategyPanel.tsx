"use client";

import { useState } from "react";
import { PetahTikvaScenario } from "@/lib/api";
import { ROOM_FAMILY_LABELS } from "@/lib/family";
import { ils, num } from "@/lib/format";

interface Props {
  scenario: PetahTikvaScenario | null;
  loading: boolean;
  error: string | null;
  baselineTotalIls: number;
  selectedFamily: "3R" | "5R";
  familyRange: { lower: number | null; upper: number | null };
  onSelectPosition: (pct: number) => void;
  onResetToBaseline: () => void;
}

// Display-only readiness rows (item 18): each strategy lever a future
// company-configured rule could apply to, all defaulted to "not defined" --
// no monetary default is invented, and none of these persist yet (no
// write/persistence mechanism exists for company-specific rules in this demo).
const STRATEGY_PARAMETER_ROWS = [
  "קומה",
  "כיוון",
  "מרפסת / חצר",
  "חניה",
  "מחסן",
  "מו״מ / מרווח למשא ומתן",
  "מיקום יחסי מול מתחרה מסוים",
];

const PRESETS = [
  { key: "defensive", label: "שמרני", pct: 25 },
  { key: "aligned", label: "תואם שוק", pct: 50 },
  { key: "premium", label: "פרימיום", pct: 75 },
];

export default function StrategyPanel({
  scenario,
  loading,
  error,
  baselineTotalIls,
  selectedFamily,
  familyRange,
  onSelectPosition,
  onResetToBaseline,
}: Props) {
  const [customPct, setCustomPct] = useState(50);
  const [showCalc, setShowCalc] = useState(false);
  const activePct = scenario?.range_position_pct ?? 50;
  const isCustomActive = !PRESETS.some((p) => p.pct === activePct);

  return (
    <section className="rounded-lg border border-slate-300 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900">אסטרטגיית תמחור החברה</h2>
          <p className="text-xs text-slate-500">
            בחרו היכן למקם את המחיר בתוך טווח השוק הנתמך. שינוי האסטרטגיה אינו משנה את נתוני השוק — רק את המחיר המסחרי
            המוצע.
          </p>
        </div>
        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">בסיס ההדגמה (50%) נשמר ללא שינוי</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => onSelectPosition(p.pct)}
            className={`rounded-md border px-4 py-2 text-sm font-medium transition ${
              activePct === p.pct && !isCustomActive
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {p.label} {p.pct}%
          </button>
        ))}

        <div className={`flex items-center gap-2 rounded-md border px-3 py-2 ${isCustomActive ? "border-slate-900" : "border-slate-300"}`}>
          <span className="text-sm text-slate-600">מותאם אישית</span>
          <input
            type="range"
            min={0}
            max={100}
            value={customPct}
            onChange={(e) => setCustomPct(Number(e.target.value))}
            onMouseUp={() => onSelectPosition(customPct)}
            onTouchEnd={() => onSelectPosition(customPct)}
            className="w-32"
          />
          <span className="w-10 text-sm font-semibold text-slate-900">{customPct}%</span>
        </div>

        {scenario && !scenario.is_baseline_position && (
          <button onClick={onResetToBaseline} className="ms-auto rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            איפוס לבסיס (50%)
          </button>
        )}
      </div>

      {familyRange.lower != null && familyRange.upper != null && (
        <div className="mt-3">
          <button onClick={() => setShowCalc((v) => !v)} className="text-xs font-medium text-blue-700 underline hover:text-blue-900">
            {showCalc ? "הסתרת החישוב" : "איך הגענו למחיר?"}
          </button>
          {showCalc && (
            <CalculationBreakdown
              lower={familyRange.lower}
              upper={familyRange.upper}
              pct={activePct}
              result={scenario?.families.find((f) => f.family === selectedFamily)?.proposed_family_price_ils ?? null}
            />
          )}
        </div>
      )}

      {loading && <p className="mt-3 text-sm text-slate-500">מחשב תרחיש...</p>}
      {error && <p className="mt-3 text-sm text-red-700">שגיאה בחישוב תרחיש: {error}</p>}

      {scenario && !loading && <FinancialImpact scenario={scenario} selectedFamily={selectedFamily} />}

      <StrategyParameterReadiness />

      {scenario && !loading && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="grid gap-4 sm:grid-cols-2">
            {scenario.families.map((f) => (
              <div key={f.family} className="rounded-md bg-slate-50 p-3">
                <div className="text-xs text-slate-500">מחיר מוצע — דירות {ROOM_FAMILY_LABELS[f.family] ?? f.family}</div>
                <div className="text-xl font-bold text-slate-900">{ils(f.proposed_family_price_ils)}</div>
                {f.proposed_family_price_ils !== f.baseline_proposed_family_price_ils && (
                  <div className="text-xs text-slate-500">בסיס ההדגמה: {ils(f.baseline_proposed_family_price_ils)}</div>
                )}
              </div>
            ))}
          </div>

          <div className="rounded-md border border-slate-200 p-3">
            <div className="mb-1 text-xs font-medium text-slate-500">השוואת שווי מחירון — בסיס מול תרחיש</div>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
              <div>
                <div className="text-xs text-slate-400">בסיס</div>
                <div className="text-lg font-semibold text-slate-700">{ils(baselineTotalIls)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">תרחיש</div>
                <div className="text-lg font-semibold text-slate-900">{ils(scenario.total_standard_unit_revenue_ils)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">הפרש</div>
                <div className={`text-lg font-semibold ${scenario.comparison.delta_ils >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {scenario.comparison.delta_ils >= 0 ? "+" : ""}
                  {ils(scenario.comparison.delta_ils)}
                  {scenario.comparison.delta_pct != null && (
                    <span className="ms-1 text-sm font-normal">
                      ({scenario.comparison.delta_pct >= 0 ? "+" : ""}
                      {num(scenario.comparison.delta_pct, 2)}%)
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">יחידות שהושפעו</div>
                <div className="text-lg font-semibold text-slate-700">{scenario.comparison.units_changed_count}</div>
              </div>
            </div>
          </div>

          {scenario.is_baseline_position && (
            <p className="text-xs text-slate-500">תרחיש זה זהה לבסיס הקפוא (50%) — אין שינוי.</p>
          )}
        </div>
      )}
    </section>
  );
}

/** "Do not make the user hunt for the consequence of moving the slider" --
 * every value here comes straight from the existing scenario response
 * (scenario.families[]/comparison/total_standard_unit_revenue_ils); the only
 * arithmetic performed here is plain subtraction between numbers the backend
 * already computed. */
function FinancialImpact({ scenario, selectedFamily }: { scenario: PetahTikvaScenario; selectedFamily: "3R" | "5R" }) {
  const fam = scenario.families.find((f) => f.family === selectedFamily);
  if (!fam) return null;

  const perUnitDelta = (fam.proposed_family_price_ils ?? 0) - (fam.baseline_proposed_family_price_ils ?? 0);
  const familyDelta = fam.total_family_list_value_ils - fam.baseline_total_family_list_value_ils;

  return (
    <div className="mt-4 rounded-md border border-slate-300 bg-slate-50 p-3">
      <div className="mb-2 text-sm font-semibold text-slate-800">השפעת ההחלטה</div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <div className="text-xs text-slate-500">מחיר לדירה — דירות {ROOM_FAMILY_LABELS[selectedFamily]}</div>
          <div className="text-sm font-semibold text-slate-900">
            {ils(fam.baseline_proposed_family_price_ils)} → {ils(fam.proposed_family_price_ils)}
          </div>
          <DeltaText value={perUnitDelta} />
        </div>
        <div>
          <div className="text-xs text-slate-500">השפעה על משפחת {ROOM_FAMILY_LABELS[selectedFamily]}</div>
          <DeltaText value={familyDelta} emphasize />
        </div>
        <div>
          <div className="text-xs text-slate-500">השפעה על כלל היחידות הסטנדרטיות</div>
          <DeltaText value={scenario.comparison.delta_ils} emphasize />
        </div>
        <div>
          <div className="text-xs text-slate-500">הכנסות בתרחיש</div>
          <div className="text-sm font-semibold text-slate-900">{ils(scenario.total_standard_unit_revenue_ils)}</div>
        </div>
      </div>
    </div>
  );
}

/** Item 15: never just "75% -> ₪1,909,750" -- show the input, the explicit
 * formula, and the arithmetic, using the real supported range and the real
 * chosen position. `result` (the backend-computed price) is shown alongside
 * so the reader can see the explained arithmetic actually matches the real
 * output, rather than trusting a parallel, potentially-wrong explanation. */
function CalculationBreakdown({ lower, upper, pct, result }: { lower: number; upper: number; pct: number; result: number | null }) {
  const computed = lower + (pct / 100) * (upper - lower);
  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
      <div>
        טווח שוק: <span className="font-semibold">{ils(lower)} – {ils(upper)}</span>
      </div>
      <div>
        מיקום שנבחר: <span className="font-semibold">{pct}%</span>
      </div>
      <div className="mt-1 font-mono text-xs">
        חישוב: {ils(lower)} + {(pct / 100).toFixed(2)} × ({ils(upper)} − {ils(lower)}) = {ils(computed)}
      </div>
      {result != null && <div className="mt-1 text-xs text-slate-500">מחיר בפועל מהמערכת: {ils(result)}</div>}
    </div>
  );
}

/** Item 18: visible readiness rows for future company-configured strategy
 * levers. No write/persistence mechanism exists yet for these in this demo,
 * so they are display-only and every one defaults to "not defined" -- never
 * an invented default value. */
function StrategyParameterReadiness() {
  return (
    <div className="mt-4 rounded-md border border-dashed border-slate-300 p-3">
      <div className="mb-1 text-xs font-semibold text-slate-500">פרמטרי אסטרטגיה עתידיים (החברה תגדיר בהמשך)</div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {STRATEGY_PARAMETER_ROWS.map((label) => (
          <li key={label} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
            <span>{label}</span>
            <span className="font-medium text-slate-400">לא הוגדר כלל כספי</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeltaText({ value, emphasize }: { value: number; emphasize?: boolean }) {
  return (
    <div className={`${emphasize ? "text-base" : "text-xs"} font-semibold ${value >= 0 ? "text-emerald-700" : "text-red-700"}`}>
      {value >= 0 ? "+" : ""}
      {ils(value)}
    </div>
  );
}
