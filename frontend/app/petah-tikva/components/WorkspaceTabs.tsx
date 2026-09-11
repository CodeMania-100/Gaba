"use client";

import { ReactNode } from "react";

export type TopTab = "pricing" | "market" | "strategy";

interface Props {
  activeTab: TopTab;
  onActiveTabChange: (t: TopTab) => void;
  pricingContent: ReactNode;
  marketContent: ReactNode;
  strategyContent: ReactNode;
}

const TABS: { key: TopTab; label: string }[] = [
  { key: "pricing", label: "מחירון הפרויקט" },
  { key: "market", label: "השוק והמתחרים" },
  { key: "strategy", label: "אסטרטגיה ותרחישים" },
];

/** The top-level shell for the three persistent capabilities (מחירון
 * הפרויקט / השוק והמתחרים / אסטרטגיה ותרחישים) -- תמחור דירה, the fourth
 * capability, is the existing apartment drawer, rendered by the page as a
 * global overlay outside this shell, not a fourth tab here (it opens from
 * anywhere: the board, the floor explorer, a consistency finding).
 *
 * Controlled from the page (not self-managed) so cross-capability actions
 * from inside the drawer -- "הצג את ראיות השוק על המפה", "הצג ראיות
 * והשוואות" -- can switch tabs on the user's behalf. All three tab bodies
 * stay mounted (`hidden`, not conditionally rendered) so switching tabs
 * never resets a tab's own internal state, and the open apartment drawer
 * (owned by the page, not this component) is never affected by a tab
 * switch at all. */
export default function WorkspaceTabs({ activeTab, onActiveTabChange, pricingContent, marketContent, strategyContent }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex overflow-hidden rounded-lg border-2 border-slate-900 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => onActiveTabChange(t.key)}
            className={`px-6 py-2.5 text-sm font-bold transition-colors ${
              activeTab === t.key ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div hidden={activeTab !== "pricing"} className="flex flex-col gap-6">
        {pricingContent}
      </div>
      <div hidden={activeTab !== "market"} className="flex flex-col gap-6">
        {marketContent}
      </div>
      <div hidden={activeTab !== "strategy"} className="flex flex-col gap-6">
        {strategyContent}
      </div>
    </div>
  );
}
