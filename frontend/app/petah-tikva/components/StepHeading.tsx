/** Numbered/lettered step badge shared by the unit drawer's blocks (1. פרטי
 * הדירה... for the standard route; A-F for the special-unit decision drawer,
 * see SpecialUnitDecisionPanel.tsx) so each hierarchy reads as one obvious
 * sequence, not a pile of unrelated cards -- see UnitDrawer.tsx and
 * MarketingDecisionChain.tsx. */
export default function StepHeading({ n, title }: { n: number | string; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">{n}</span>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
    </div>
  );
}
