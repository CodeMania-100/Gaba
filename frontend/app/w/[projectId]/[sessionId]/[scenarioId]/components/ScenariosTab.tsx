"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, InventoryVersion, JsonRecord, Scenario } from "@/lib/api";
import { computeFamilyKey, familyLabel, isStandardFamily } from "@/lib/family";
import { ils } from "@/lib/format";

interface Props {
  projectId: string;
  sessionId: string;
  currentScenarioId: string;
  scenarios: Scenario[];
  inventory: InventoryVersion;
  onScenariosChanged: () => void;
  onRepriced: () => Promise<void>;
}

interface FamilyGroup {
  familyKey: string;
  label: string;
  unitCount: number;
  representativeUnit: string;
}

export default function ScenariosTab({
  projectId,
  sessionId,
  currentScenarioId,
  scenarios,
  inventory,
  onScenariosChanged,
  onRepriced,
}: Props) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [compareAgainst, setCompareAgainst] = useState<string>("");
  const [impact, setImpact] = useState<JsonRecord | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);

  const families = useMemo<FamilyGroup[]>(() => {
    const groups = new Map<string, FamilyGroup>();
    for (const u of inventory.units) {
      if (!isStandardFamily(u.unit_type)) continue;
      const key = computeFamilyKey(u.unit_type, u.rooms, u.internal_area);
      const existing = groups.get(key);
      if (existing) existing.unitCount += 1;
      else
        groups.set(key, {
          familyKey: key,
          label: familyLabel(u.unit_type, u.rooms, u.internal_area),
          unitCount: 1,
          representativeUnit: u.unit_number,
        });
    }
    return [...groups.values()];
  }, [inventory]);

  const otherScenarios = scenarios.filter((s) => s.id !== currentScenarioId);

  async function handleClone() {
    setCreating(true);
    try {
      const scenario = await api.createScenario(sessionId, {
        name: newName.trim() || `תרחיש ${scenarios.length + 1}`,
        parent_scenario_id: currentScenarioId,
      });
      onScenariosChanged();
      router.push(`/w/${projectId}/${sessionId}/${scenario.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function loadImpact(against: string) {
    setCompareAgainst(against);
    if (!against) {
      setImpact(null);
      return;
    }
    setLoadingImpact(true);
    try {
      const data = await api.getImpact(currentScenarioId, against);
      setImpact(data);
    } finally {
      setLoadingImpact(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-slate-300 bg-white p-4">
        <h2 className="text-lg font-bold text-slate-900">תרחישים בתיק התמחור</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {scenarios.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
              <div>
                <div className="font-medium text-slate-900">
                  {s.name} {s.id === currentScenarioId && <span className="text-xs text-slate-500">(נוכחי)</span>}
                </div>
                {s.parent_scenario_id && <div className="text-xs text-slate-500">שובט מתוך תרחיש קודם</div>}
              </div>
              {s.id !== currentScenarioId && (
                <button
                  onClick={() => router.push(`/w/${projectId}/${sessionId}/${s.id}`)}
                  className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
                >
                  מעבר לתרחיש
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center gap-2 border-t border-slate-200 pt-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="שם התרחיש החדש (למשל: מיצוב 3 חדרים גבוה יותר)"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            onClick={handleClone}
            disabled={creating}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            שכפול התרחיש הנוכחי לתרחיש חדש
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-300 bg-white p-4">
        <h2 className="text-lg font-bold text-slate-900">אסטרטגיית מחיר לפי משפחת דירות — תרחיש נוכחי</h2>
        <p className="mt-1 text-sm text-slate-500">
          החלטה מפורשת לכל משפחה בנפרד. משפחה שלא נקבעה לה אסטרטגיה תוצג כ&quot;נדרשת אסטרטגיה&quot; במחירון.
        </p>
        <div className="mt-4 flex flex-col gap-4">
          {families.map((fam) => (
            <FamilyDecisionEditor
              key={fam.familyKey}
              scenarioId={currentScenarioId}
              family={fam}
              onSaved={onRepriced}
            />
          ))}
        </div>
      </section>

      {otherScenarios.length > 0 && (
        <section className="rounded-lg border border-slate-300 bg-white p-4">
          <h2 className="text-lg font-bold text-slate-900">השפעת תרחיש</h2>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span>השוואת התרחיש הנוכחי מול:</span>
            <select
              value={compareAgainst}
              onChange={(e) => void loadImpact(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1"
            >
              <option value="">בחרו תרחיש</option>
              {otherScenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {loadingImpact && <p className="mt-3 text-sm text-slate-500">מחשב השפעה...</p>}

          {impact && impact.status === "not_priced" && (
            <p className="mt-3 text-sm text-slate-500">יש לתמחר את שני התרחישים לפני חישוב ההשפעה.</p>
          )}

          {impact && impact.status === "priced" && <ImpactView impact={impact} />}
        </section>
      )}
    </div>
  );
}

function ImpactView({ impact }: { impact: JsonRecord }) {
  const breakdown = (impact.family_changed_breakdown ?? {}) as Record<string, { changed: number; unchanged: number }>;
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="דירות שהשתנו" value={String(impact.changed_unit_count)} />
        <Metric
          label="שווי מחירון — לפני"
          value={ils(impact.total_list_value_before_ils as number)}
        />
        <Metric label="שווי מחירון — אחרי" value={ils(impact.total_list_value_after_ils as number)} />
        <Metric
          label="הפרש כולל"
          value={ils(impact.total_list_value_delta_ils as number)}
          emphasis={(impact.total_list_value_delta_ils as number) !== 0}
        />
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-start">משפחה</th>
              <th className="px-3 py-2 text-start">שינוי</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(breakdown).map(([family, counts]) => (
              <tr key={family} className="border-t border-slate-100">
                <td className="px-3 py-2">{family}</td>
                <td className="px-3 py-2">
                  {counts.changed > 0 ? (
                    <span className="text-amber-800">{counts.changed} דירות השתנו</span>
                  ) : (
                    <span className="text-slate-500">{counts.unchanged} דירות ללא שינוי</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`font-semibold ${emphasis ? "text-amber-800" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}

function FamilyDecisionEditor({
  scenarioId,
  family,
  onSaved,
}: {
  scenarioId: string;
  family: FamilyGroup;
  onSaved: () => Promise<void>;
}) {
  const [basis, setBasis] = useState<"market_range_position" | "competitor_reference">("market_range_position");
  const [positionPct, setPositionPct] = useState(50);
  const [rationale, setRationale] = useState("");
  const [negotiationBuffer, setNegotiationBuffer] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [competitors, setCompetitors] = useState<JsonRecord[] | null>(null);
  const [selectedCompetitor, setSelectedCompetitor] = useState<string>("");
  const [competitorValueKind, setCompetitorValueKind] = useState<"observed" | "target_equivalent">("observed");
  const [competitorDelta, setCompetitorDelta] = useState(0);

  useEffect(() => {
    if (basis !== "competitor_reference" || competitors !== null) return;
    api
      .getUnitEvidence(scenarioId, family.representativeUnit)
      .then((ev) => {
        if (ev.status !== "priced") {
          setCompetitors([]);
          return;
        }
        const contributors =
          ev.market_range?.lanes?.new_development?.primary_contributors ?? [];
        setCompetitors(contributors);
      })
      .catch(() => setCompetitors([]));
  }, [basis, competitors, scenarioId, family.representativeUnit]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      if (basis === "market_range_position") {
        await api.putFamilyDecision(scenarioId, family.familyKey, {
          name: `${family.label} — מיצוב ${positionPct}% בטווח הנתמך`,
          basis: "market_range_position",
          range_position_pct: positionPct,
          negotiation_buffer_ils: negotiationBuffer,
          rationale: rationale || "החלטה עסקית מפורשת של השיווק.",
        });
      } else {
        const contributor = competitors?.find((c) => c.source_ids?.[0] === selectedCompetitor);
        if (!contributor) return;
        const value =
          competitorValueKind === "observed"
            ? contributor.representative_observed_price
            : contributor.target_equivalent_indication;
        await api.putFamilyDecision(scenarioId, family.familyKey, {
          name: `${family.label} — ביחס למתחרה ${contributor.group_key}`,
          basis: "competitor_reference",
          competitor_reference_ils: value,
          competitor_reference_source_id: contributor.source_ids[0],
          competitor_reference_name: contributor.group_key,
          competitor_delta_ils: competitorDelta,
          rationale: rationale || "מיצוב ביחס למתחרה אמיתי מתוך ראיות השוק.",
        });
      }
      await api.reprice(scenarioId);
      await onSaved();
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-slate-900">{family.label}</div>
        <div className="text-xs text-slate-500">{family.unitCount} דירות</div>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={basis === "market_range_position"}
            onChange={() => setBasis("market_range_position")}
          />
          מיקום בטווח השוק הנתמך
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={basis === "competitor_reference"}
            onChange={() => setBasis("competitor_reference")}
          />
          ביחס למתחרה אמיתי
        </label>
      </div>

      {basis === "market_range_position" ? (
        <div className="mt-3">
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">גבול תחתון</span>
            <input
              type="range"
              min={0}
              max={100}
              value={positionPct}
              onChange={(e) => setPositionPct(Number(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs text-slate-500">גבול עליון</span>
            <span className="w-12 text-end text-sm font-medium">{positionPct}%</span>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {competitors === null && <p className="text-sm text-slate-500">טוען ראיות מתחרים...</p>}
          {competitors?.length === 0 && (
            <p className="text-sm text-slate-500">
              אין כרגע פרויקט מתחרה עם היצע מתומחר לדירת {family.label} בסביבה שנבדקה. יש לתמחר את הפרויקט לפחות פעם
              אחת כדי לטעון ראיות.
            </p>
          )}
          {competitors && competitors.length > 0 && (
            <>
              <select
                value={selectedCompetitor}
                onChange={(e) => setSelectedCompetitor(e.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="">בחרו פרויקט מתחרה אמיתי</option>
                {competitors.map((c) => (
                  <option key={c.source_ids?.[0]} value={c.source_ids?.[0]}>
                    {c.group_key} — {ils(c.representative_observed_price)} ({c.representative_observed_area} מ״ר)
                  </option>
                ))}
              </select>
              {selectedCompetitor && (
                <div className="flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={competitorValueKind === "observed"}
                      onChange={() => setCompetitorValueKind("observed")}
                    />
                    מחיר נצפה בפועל
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={competitorValueKind === "target_equivalent"}
                      onChange={() => setCompetitorValueKind("target_equivalent")}
                    />
                    התאמה לשטח היעד
                  </label>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                מיצוב יחסי (₪, ניתן שלילי):
                <input
                  type="number"
                  value={competitorDelta}
                  onChange={(e) => setCompetitorDelta(Number(e.target.value))}
                  className="w-32 rounded-md border border-slate-300 px-2 py-1"
                />
              </label>
            </>
          )}
        </div>
      )}

      {basis === "market_range_position" && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          תוספת מו&quot;מ קבועה (₪):
          <input
            type="number"
            value={negotiationBuffer}
            onChange={(e) => setNegotiationBuffer(Number(e.target.value))}
            className="w-32 rounded-md border border-slate-300 px-2 py-1"
          />
        </label>
      )}

      <textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        placeholder="נימוק ההחלטה העסקית (חובה)"
        className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        rows={2}
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !rationale.trim() || (basis === "competitor_reference" && !selectedCompetitor)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? "שומר..." : "שמירה ותמחור מחדש"}
        </button>
        {saved && <span className="text-sm text-emerald-700">נשמר ותומחר מחדש</span>}
      </div>
    </div>
  );
}
