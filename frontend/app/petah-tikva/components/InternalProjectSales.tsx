"use client";

import { ils } from "@/lib/format";

/** Recorded internal-project-sale transactions -- a separate evidence type
 * from external Tax/Madlan transactions, shown next to the marketing
 * decision but never merged into the market indication. Collapsed by
 * default; empty state is explicit rather than an empty list. */
export default function InternalProjectSales({
  records,
}: {
  records: { unit: string; sale_price_ils: number; sale_date: string; family: string }[];
}) {
  return (
    <details className="rounded-md border border-hairline p-3 text-sm">
      <summary className="cursor-pointer text-xs font-semibold text-ink-muted">עסקאות שבוצעו בפרויקט</summary>
      <div className="mt-2">
        {records.length === 0 ? (
          <p className="text-sm text-ink-muted/60">לא סופקו עסקאות מכירה שבוצעו בפרויקט במסגרת המטלה.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1 text-sm text-ink">
              {records.map((r, i) => (
                <li key={i}>
                  דירה {r.unit} ({r.family}): {ils(r.sale_price_ils)} — {r.sale_date}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-ink-muted/70">
              ראייה נפרדת מעסקאות רשומות חיצוניות (מיסוי) — אינה ממוזגת עם אינדיקציית השוק החיצונית.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
