"use client";

interface Props {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

/** Demotes every research/methodology section (evidence lanes, competitor
 * map, product comparisons, the engineering-demo strategy slider, data
 * quality) below the primary 39-unit decision board, collapsed by default --
 * the tool should read as a pricing tool with evidence behind it, not a
 * research report with pricing buried inside. Nothing inside is deleted or
 * changed, only visually demoted; content stays mounted (not unmounted) so a
 * drill-down link (e.g. "הצג ראיות והשוואות") can force it open and scroll
 * straight to a specific subsection even while collapsed. */
export default function ResearchSection({ open, onToggle, children }: Props) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50/60">
      <button onClick={onToggle} className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-4 text-start">
        <div>
          <h2 className="text-base font-bold text-slate-700">נתוני שוק, השוואות ומתודולוגיה</h2>
          <p className="text-xs text-slate-500">ראיות שוק מפורטות, השוואות מתחרים, ומתודולוגיית החישוב שמאחורי לוח ההחלטה.</p>
        </div>
        <span className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
          {open ? "הסתרה" : "הצגת הנתונים"}
        </span>
      </button>
      <div hidden={!open} className="flex flex-col gap-6 border-t border-slate-200 px-5 py-5">
        {children}
      </div>
    </section>
  );
}
