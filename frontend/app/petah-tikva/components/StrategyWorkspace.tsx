"use client";

import { useMemo, useState } from "react";
import { PtkPriceListRow } from "@/lib/api";
import { deriveProductGroupSalesSummary, deriveStrategyImpactSummary, MarketingStrategyState } from "@/lib/marketingStrategy";
import CommercialStatusSummary from "./CommercialStatusSummary";
import GeneralProjectAdjustments from "./GeneralProjectAdjustments";
import MarketingDecisionTable from "./MarketingDecisionTable";
import ProductGroupDecisionPanel from "./ProductGroupDecisionPanel";
import StrategyImpactSummary from "./StrategyImpactSummary";

interface Props {
  rows: PtkPriceListRow[];
  state: MarketingStrategyState;
  onChange: (updater: (prev: MarketingStrategyState) => MarketingStrategyState) => void;
  onOpenUnit?: (row: PtkPriceListRow) => void;
  onBackToPriceList?: () => void;
}

/** Tab 3, redesigned as a Marketing decision-support workspace rather than
 * a stack of percentage forms: מצב מסחרי -> נקודות החלטה -> קבוצה נבחרת ->
 * השפעת ההחלטה -> חזרה למחירון. Every price-relevant number here still
 * comes from the one canonical computePriceBreakdown path (via
 * deriveProductGroupSalesSummary/deriveStrategyImpactSummary/
 * computeRevenueSummary) -- this component and its children only decide
 * what to show and where, never how to compute a price. Decision signals
 * (deriveMarketingDecisionSignal, surfaced per group in the table and the
 * selected-group panel) are guidance only: they are never written into
 * state, and the group adjustment control always starts at 0% regardless
 * of what a signal says. */
export default function StrategyWorkspace({ rows, state, onChange, onOpenUnit, onBackToPriceList }: Props) {
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);

  const groups = useMemo(() => deriveProductGroupSalesSummary(rows, state), [rows, state]);
  const impact = useMemo(() => deriveStrategyImpactSummary(rows, state), [rows, state]);
  const selectedGroup = groups.find((g) => g.key === selectedGroupKey) ?? null;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-hairline bg-surface p-5">
      <div>
        <h2 className="font-heading text-lg font-bold text-ink">אסטרטגיית שיווק</h2>
        <p className="text-xs text-ink-muted">מצב מסחרי ← נקודות החלטה ← קבוצה נבחרת ← השפעת ההחלטה ← חזרה למחירון.</p>
      </div>

      <CommercialStatusSummary rows={rows} state={state} groups={groups} impact={impact} onChange={onChange} />

      <GeneralProjectAdjustments rows={rows} state={state} onChange={onChange} />

      <MarketingDecisionTable groups={groups} selectedKey={selectedGroupKey} onSelectGroup={setSelectedGroupKey} />

      {selectedGroup ? (
        <ProductGroupDecisionPanel rows={rows} state={state} group={selectedGroup} onChange={onChange} onOpenUnit={onOpenUnit} />
      ) : (
        <div className="rounded-md border border-dashed border-hairline p-4 text-center text-sm text-ink-muted/70">
          בחרו קבוצה מהטבלה למעלה כדי לראות פרטים ולבצע החלטת שיווק.
        </div>
      )}

      <StrategyImpactSummary rows={rows} state={state} groups={groups} onOpenUnit={onOpenUnit} onBackToPriceList={onBackToPriceList} />
    </section>
  );
}
