/** Tab 1's compact opening line -- the project identity + unit count,
 * replacing the shared header's role for this tab specifically (the header
 * itself stays a slim, city-neutral shell; the full identity now lives
 * here, first, before the price list). Real project fields only -- no
 * invented subtitle claims. */
export default function ProjectIntro({ projectName, unitCount }: { projectName: string; unitCount: number }) {
  return (
    <div>
      <h1 className="font-heading text-2xl font-bold text-ink">
        {projectName} — {unitCount} דירות
      </h1>
      <p className="mt-1 text-sm text-ink-muted">מחירון מוצע, חריגים לבדיקה ומצב מכירה — במבט אחד.</p>
    </div>
  );
}
