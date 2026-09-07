"use client";

import { useState } from "react";
import { JsonRecord, PtkPriceListRow, SpecialUnitContext, SpecialUnitMarketContext } from "@/lib/api";
import { displayFamilyLabel, CONFIDENCE_COLORS, CONFIDENCE_LABELS } from "@/lib/family";
import { ils, num } from "@/lib/format";
import SpecialUnitCalculation from "./SpecialUnitCalculation";
import FirstResearcherContext from "./FirstResearcherContext";

interface Props {
  row: PtkPriceListRow;
  context: SpecialUnitContext | undefined;
  marketContext: SpecialUnitMarketContext;
}

const CATEGORY_LABELS: Record<string, string> = { garden: "דירת גן", duplex: "דופלקס", triplex: "טריפלקס" };

const EVIDENCE_CLASS_LABELS: Record<string, string> = {
  direct_current: "הצעה ישירה נוכחית",
  direct_current_rich: "הצעה ישירה נוכחית (מידע עשיר)",
  direct_current_lower_confidence: "הצעה ישירה (ביטחון נמוך יותר)",
  near_exact_current_rich: "כמעט-זהה, נוכחי (מידע עשיר)",
  direct_typology_size_relaxed: "אותו סוג מוצר, בגודל שונה מהותית",
  broadened_current: "הצעה מורחבת נוכחית",
  broadened_current_rich: "הצעה מורחבת (מידע עשיר)",
  broadened_current_low_confidence_activity: "הצעה מורחבת (ביטחון נמוך)",
  size_relaxed_current: "הצעה נוכחית, טווח שטח מורחב",
  premium_context: "הקשר פרימיום",
};

const SEVERITY_COLORS: Record<string, string> = {
  high: "border-red-300 bg-red-50 text-red-900",
  medium: "border-amber-300 bg-amber-50 text-amber-900",
  resolved: "border-slate-200 bg-slate-50 text-slate-600",
};

/** Same business-facing structure as the standard family page (subject ->
 * market evidence -> direct comparables -> broadened comparables -> product
 * differences -> decision), applied to one unit-specific special unit.
 * Sourced entirely from special_unit_market_context (data/frozen/special_
 * unit_master_data_v1.json) -- a payload branch fully isolated from
 * standard_attribute_enrichment; the only shared field is the read-only,
 * clearly-labeled family_anchor_context. No price or range is computed here. */
export default function SpecialUnitAnalysis({ row, context, marketContext }: Props) {
  const isGarden = row.family === "garden_apartment";

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-base font-bold text-slate-900">ניתוח שוק — דירה {row.unit_number}</h2>

      {/* subject */}
      <section className="rounded-md bg-slate-50 p-3 text-sm">
        <div className="text-xs font-semibold text-slate-500">1. הדירה שלנו</div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <Fact label="סוג" value={displayFamilyLabel(row.family)} />
          <Fact label="קומה" value={row.floor != null ? String(row.floor) : "—"} />
          <Fact label="שטח פנימי" value={row.internal_area_sqm != null ? `${num(row.internal_area_sqm)} מ״ר` : "—"} />
          <Fact label={isGarden ? "שטח חצר" : "מרפסת"} value={row.balcony_area_sqm != null ? `${num(row.balcony_area_sqm)} מ״ר` : "—"} />
          <Fact label="כיוון אוויר" value={row.orientation ?? "—"} />
        </div>
      </section>

      {!context ? (
        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">אין כרגע נתוני מחקר זמינים ליחידה זו.</p>
      ) : (
        <>
          {context.market_indication && <SpecialUnitCalculation indication={context.market_indication} />}

          {context.qa_flags.length > 0 && (
            <section>
              <div className="mb-1 text-xs font-semibold text-slate-500">אזהרות איכות נתונים</div>
              <div className="flex flex-col gap-1">
                {context.qa_flags.map((f, i) => (
                  <div key={i} className={`rounded-md border p-2 text-xs ${SEVERITY_COLORS[f.severity as string] ?? SEVERITY_COLORS.medium}`}>
                    <span className="font-semibold">[{String(f.severity)}]</span> {String(f.record)} — {String(f.issue)}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* direct comparables */}
          <section>
            <div className="mb-1 text-xs font-semibold text-slate-500">2. השוואה ישירה</div>
            {context.direct_comparables.length === 0 ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
                {CATEGORY_LABELS[context.category] ?? context.category} ישירות בגודל/הרכב חדרים דומה: לא נמצאו הצעות מאומתות.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {context.direct_comparables.map((c, i) => (
                  <MarketEvidenceCard key={i} record={c} />
                ))}
              </div>
            )}
            {context.category === "triplex" && marketContext.direct_triplex_status && (
              <p className="mt-1 text-xs text-slate-500">{String(marketContext.direct_triplex_status.interpretation)}</p>
            )}
          </section>

          {/* broadened comparables */}
          <section>
            <div className="mb-1 text-xs font-semibold text-slate-500">3. השוואה מורחבת</div>
            <p className="mb-1 text-xs text-slate-400">
              {context.category === "triplex"
                ? "דופלקסים / פנטהאוזים / יחידות רב-מפלסיות גדולות — אין מוצר טריפלקס ישיר בגודל מתאים בנתונים הקיימים."
                : "מוצרים דומים בקטגוריה עם הרכב חדרים או גודל שונה מהיחידה שלנו."}
            </p>
            {context.broadened_comparables.length === 0 ? (
              <p className="text-sm text-slate-500">אין כרגע הצעות מורחבות זמינות.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {context.broadened_comparables.slice(0, 5).map((c, i) => (
                  <MarketEvidenceCard key={i} record={c} />
                ))}
              </div>
            )}
          </section>

          {/* registered-sale market context */}
          {(context.sold_selected.length > 0 || context.sold_rejected.length > 0) && (
            <section>
              <div className="mb-1 text-xs font-semibold text-slate-500">4. הקשר עסקאות שבוצעו (לפי חדרים/שטח, לא מאומת כאותו סוג נכס)</div>
              {context.sold_evidence_gap && <p className="mb-1 text-xs text-amber-700">{context.sold_evidence_gap}</p>}
              <SoldContextTable selected={context.sold_selected} rejected={context.sold_rejected} additions={context.sold_context_additions} />
            </section>
          )}

          {/* family anchor -- context only, never a comparable */}
          {context.family_anchor_context && (
            <section className="rounded-md border border-dashed border-slate-300 p-3">
              <div className="mb-1 text-xs font-semibold text-slate-500">{context.family_anchor_context.label}</div>
              <p className="text-sm text-slate-700">
                משפחת דירות {context.family_anchor_context.family}: טווח שוק נתמך{" "}
                {context.family_anchor_context.supported_lower != null
                  ? `${ils(context.family_anchor_context.supported_lower)} – ${ils(context.family_anchor_context.supported_upper)}`
                  : "אין קונצנזוס"}
                {" · "}
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${CONFIDENCE_COLORS[context.family_anchor_context.confidence] ?? ""}`}>
                  {CONFIDENCE_LABELS[context.family_anchor_context.confidence] ?? context.family_anchor_context.confidence}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-400">
                מוצג לצורך הקשר בלבד — אינו הופך ליחידת השוואה ואינו יוצר פרמיה ליחידה המיוחדת.
              </p>
            </section>
          )}

          <FirstResearcherContext records={context.first_researcher_context} />
        </>
      )}

      {/* strategy / decision */}
      <section className="rounded-md border border-slate-200 p-3">
        <div className="mb-1 text-xs font-semibold text-slate-500">7. אסטרטגיית החברה והחלטת מחיר</div>
        <p className="text-sm text-slate-700">
          {context?.market_indication?.suggested_price_ils != null
            ? "המחיר המוצע לעיל הוא אינדיקציית שוק ניטרלית בלבד. עדיין לא הוחלה עליו מדיניות מיצוב אסטרטגית של החברה (בדומה למנגנון האחוזים במשפחות 3R/5R) — שכבה זו תתווסף בנפרד."
            : "לא הוגדר כלל תמחור כמותי ליחידות מיוחדות בשלב זה. יחידה זו תעבור תמחור פרטני נפרד המבוסס על ההשוואות שלמעלה."}
        </p>
      </section>
    </div>
  );
}

function MarketEvidenceCard({ record }: { record: JsonRecord }) {
  const [showSource, setShowSource] = useState(false);
  const evidenceClass = record.evidence_class as string | undefined;

  return (
    <div className="rounded-md border border-slate-200 p-2 text-sm">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="font-medium text-slate-800">{(record.address as string) ?? "כתובת לא ידועה"}</div>
        {evidenceClass && (
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
            {EVIDENCE_CLASS_LABELS[evidenceClass] ?? evidenceClass}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {record.type != null && (
          <span>
            סוג: <span className="font-medium text-slate-800">{String(record.type)}</span>
          </span>
        )}
        {record.rooms != null && (
          <span>
            חדרים: <span className="font-medium text-slate-800">{num(record.rooms as number)}</span>
          </span>
        )}
        {record.area_m2 != null && (
          <span>
            שטח: <span className="font-medium text-slate-800">{num(record.area_m2 as number)} מ״ר</span>
          </span>
        )}
        {record.floor != null && (
          <span>
            קומה: <span className="font-medium text-slate-800">{String(record.floor)}</span>
          </span>
        )}
        {record.price_ils != null && (
          <span>
            מחיר: <span className="font-medium text-slate-800">{ils(record.price_ils as number)}</span>
          </span>
        )}
      </div>
      {record.known_features != null && <p className="mt-1 text-xs text-slate-500">{String(record.known_features)}</p>}

      {record.source_url != null && (
        <button onClick={() => setShowSource((v) => !v)} className="mt-1 text-[11px] text-slate-400 underline hover:text-slate-600">
          {showSource ? "הסתרת מקור" : "מקור"}
        </button>
      )}
      {showSource && record.source_url != null && (
        <a href={String(record.source_url)} target="_blank" rel="noreferrer" className="mt-1 block break-all text-[11px] text-blue-700 underline">
          {String(record.source_url)}
        </a>
      )}
    </div>
  );
}

function SoldContextTable({ selected, rejected, additions }: { selected: JsonRecord[]; rejected: JsonRecord[]; additions: JsonRecord[] }) {
  const additionsByDealId = new Map(additions.map((a) => [a.target_deal_id, a]));

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <Th>כתובת</Th>
            <Th>חדרים</Th>
            <Th>שטח</Th>
            <Th>מחיר</Th>
            <Th>סטטוס</Th>
          </tr>
        </thead>
        <tbody>
          {selected.map((s, i) => {
            const excluded = String(s.numeric_status ?? "").startsWith("quarantined");
            const flagged = String(s.numeric_status ?? "").includes("conflict");
            const addition = additionsByDealId.get(s.deal_id as string);
            return (
              <tr key={i} className={`border-t border-slate-100 ${excluded ? "opacity-50" : ""}`}>
                <td className="px-2 py-1">
                  {String(s.address ?? "—")}
                  {addition && (
                    <div className="text-[10px] text-slate-400">
                      הקשר מוצר (לא הועבר ליחידה הנמכרת): {String(addition.facts)}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1">{s.rooms != null ? num(s.rooms as number) : "—"}</td>
                <td className="px-2 py-1">{s.internal_area != null ? `${num(s.internal_area as number)} מ״ר` : "—"}</td>
                <td className="px-2 py-1">{s.price != null ? ils(s.price as number) : "—"}</td>
                <td className="px-2 py-1 text-xs">
                  {excluded ? (
                    <span className="text-red-700">לא נכלל — קונפליקט מחיר</span>
                  ) : flagged ? (
                    <span className="text-amber-700">כלול, עם דגל קונפליקט</span>
                  ) : (
                    <span className="text-slate-500">כלול</span>
                  )}
                </td>
              </tr>
            );
          })}
          {rejected.map((r, i) => (
            <tr key={`rej-${i}`} className="border-t border-slate-100 opacity-50">
              <td className="px-2 py-1">{String(r.address ?? "—")}</td>
              <td className="px-2 py-1" colSpan={2}>
                {String(r.reason)}
              </td>
              <td className="px-2 py-1" />
              <td className="px-2 py-1 text-xs text-red-700">הוסר</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-medium text-slate-900">{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-1 text-start font-medium">{children}</th>;
}
