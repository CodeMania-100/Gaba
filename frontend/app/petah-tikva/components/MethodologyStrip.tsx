const STEPS = ["ראיות שוק", "אינדיקציית שוק", "מאפייני הדירה", "אסטרטגיית החברה", "מחיר מוצע"];

/** Single thin line, shown once on Tab 1 -- not a card, not numbered
 * icon-tiles, not a fourth major zone (see plan: Tab 1 kept to project
 * summary / price list / units requiring attention). Purely explanatory;
 * carries no data of its own. */
export default function MethodologyStrip() {
  return (
    <div className="border-t border-hairline pt-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-ink-muted">
        {STEPS.map((step, i) => (
          <span key={step} className="flex items-center gap-2">
            <span className={i === STEPS.length - 1 ? "font-semibold text-ink" : ""}>{step}</span>
            {i < STEPS.length - 1 && <span className="text-ink-muted/50">←</span>}
          </span>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-ink-muted">
        המערכת אינה ממציאה מקדם כספי למאפיין דירה ללא ראיה מאומתת — מאפיינים ללא כלל מאומת מוצגים כתמיכה בהחלטה בלבד, לא כתוספת מחיר.
      </p>
    </div>
  );
}
