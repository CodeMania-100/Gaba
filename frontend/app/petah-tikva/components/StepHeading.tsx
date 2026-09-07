/** Numbered step badge shared by the unit drawer's four blocks (1. פרטי
 * הדירה, 2. אינדיקציית שוק, 3. מצב הפרויקט, 4. החלטת שיווק) so the
 * four-step hierarchy reads as one obvious sequence, not four unrelated
 * cards -- see UnitDrawer.tsx and MarketingDecisionChain.tsx. */
export default function StepHeading({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">{n}</span>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
    </div>
  );
}
