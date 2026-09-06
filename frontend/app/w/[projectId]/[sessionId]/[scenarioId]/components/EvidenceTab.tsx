"use client";

import { useEffect, useState } from "react";
import { api, InventoryVersion, JsonRecord } from "@/lib/api";
import { CONFIDENCE_LABELS, isStandardFamily } from "@/lib/family";
import { ils } from "@/lib/format";

interface Props {
  scenarioId: string;
  inventory: InventoryVersion;
  priceList: Record<string, unknown> | null;
  onSelectUnit: (unitNumber: string) => void;
}

export default function EvidenceTab({ scenarioId, inventory, priceList, onSelectUnit }: Props) {
  const [families, setFamilies] = useState<JsonRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getFamilies(scenarioId).then((data) => {
      if (!cancelled) setFamilies(data);
    });
    return () => {
      cancelled = true;
    };
  }, [scenarioId, priceList]);

  const priced = priceList && priceList.status === "priced";

  if (!priced || !families || families.status !== "priced") {
    return (
      <div className="rounded-lg border border-slate-300 bg-white p-8 text-center text-slate-600">
        יש לתמחר את הפרויקט בלשונית מחירון כדי לראות ראיות שוק מפורטות.
      </div>
    );
  }

  const representativeByFamily = new Map<string, string>();
  for (const u of inventory.units) {
    const key = `${u.unit_type}|${u.rooms}|${u.internal_area}`;
    if (!representativeByFamily.has(key)) representativeByFamily.set(key, u.unit_number);
  }

  const summaries = (families.family_summaries as JsonRecord[]) ?? [];
  const standardSummaries = summaries.filter((s) => s.family_key?.startsWith("standard_apartment"));
  const specialSummaries = summaries.filter((s) => !s.family_key?.startsWith("standard_apartment"));

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-xl font-bold text-slate-900">ראיות שוק לפי משפחת דירות</h2>
        <p className="mt-1 text-sm text-slate-500">
          כל משפחה מסתמכת על שלוש קטגוריות ראיות נפרדות: עסקאות שהושלמו, היצע נוכחי בשוק, ופרויקטים מתחרים חדשים —
          ללא מיזוג לממוצע אחד.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {standardSummaries.map((fam) => (
            <FamilyCard key={fam.family_key} fam={fam} onOpenEvidence={() => onSelectUnit(fam.unit_numbers[0])} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-slate-900">יחידות בבדיקה פרטנית</h2>
        <p className="mt-1 text-sm text-slate-500">
          דירות גן, דופלקסים וטריפלקסים אינם עוברים דרך מנוע התמחור הסטנדרטי.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          {specialSummaries.map((fam) => (
            <button
              key={fam.family_key}
              onClick={() => onSelectUnit(fam.unit_numbers[0])}
              className="rounded-md border border-violet-200 bg-violet-50 p-3 text-start text-sm hover:bg-violet-100"
            >
              <div className="font-medium text-violet-900">{fam.family_key}</div>
              <div className="text-violet-700">דירות: {fam.unit_numbers.join(", ")}</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function FamilyCard({ fam, onOpenEvidence }: { fam: JsonRecord; onOpenEvidence: () => void }) {
  const envelope = fam.supported_range_envelope_ils ?? {};
  return (
    <div className="rounded-lg border border-slate-300 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-slate-900">{fam.family_key}</div>
        <div className="text-xs text-slate-500">{fam.unit_count} דירות</div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Row label="טווח שוק נתמך" value={envelope.lower_min != null ? `${ils(envelope.lower_min)} – ${ils(envelope.upper_max)}` : "—"} />
        <Row label="ממוצע מחיר מוצע" value={ils(fam.average_proposed_price_ils)} />
        <Row label="שווי כולל" value={ils(fam.total_proposed_list_value_ils)} />
        <Row label="דורשות אסטרטגיה" value={String(fam.strategy_required_count ?? 0)} />
      </dl>

      <div className="mt-3 flex flex-wrap gap-1 text-xs">
        {Object.entries((fam.market_confidence_counts as Record<string, number>) ?? {}).map(([conf, count]) => (
          <span key={conf} className="rounded bg-slate-100 px-2 py-1 text-slate-700">
            {CONFIDENCE_LABELS[conf] ?? conf}: {count}
          </span>
        ))}
      </div>

      {fam.competitor_reference && (
        <div className="mt-3 rounded-md bg-sky-50 p-2 text-xs text-sky-900">
          מיצוב ביחס למתחרה אמיתי: {fam.competitor_reference.project_name} —{" "}
          {ils(fam.competitor_reference.observed_price_ils)}
        </div>
      )}

      <button onClick={onOpenEvidence} className="mt-3 text-sm font-medium text-slate-900 underline">
        פתיחת ראיות מפורטות ליחידה לדוגמה
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}
