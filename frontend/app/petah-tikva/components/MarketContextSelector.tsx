"use client";

import { MarketContextSlug, MarketContextSummary } from "@/lib/api";

interface Props {
  contexts: MarketContextSummary[];
  value: MarketContextSlug;
  onChange: (slug: MarketContextSlug) => void;
}

/** Persistent "הקשר שוק" selector -- deliberately not labeled "פרויקט":
 * switching it evaluates the SAME 39-apartment inventory against a
 * different local market context, it does not switch to a different
 * subject development. Lives in the page header (not inside השוק והמתחרים)
 * so it's visible regardless of which of the three top-level tabs is open,
 * since the market context affects all of them. */
export default function MarketContextSelector({ contexts, value, onChange }: Props) {
  if (contexts.length === 0) return null;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-medium text-slate-600">הקשר שוק</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as MarketContextSlug)}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
      >
        {contexts.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.display_name}
          </option>
        ))}
      </select>
    </label>
  );
}
