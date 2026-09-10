"use client";

import { useRouter } from "next/navigation";

/** Presentation entry point: exactly two visible actions -- open the
 * ready-made Petah Tikva demo, or upload a new apartment mix. The legacy
 * generic-DB-engine demo (formerly surfaced here as an "Ashkelon" path) is
 * intentionally not linked from this page anymore -- it stays fully intact
 * in the codebase (app/w/[...]/page.tsx and its backend routes are
 * untouched) and is still reachable directly by URL, it just no longer
 * appears in the presentation flow. */
export default function HomePage() {
  const router = useRouter();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">מרחב תמחור גבאי</h1>
        <p className="mt-1 text-slate-600">
          כלי תומך החלטה לתמחור דירות — מתמהיל הפרויקט, דרך נתוני שוק והשוואות, ועד החלטת המחיר והאסטרטגיה השיווקית.
        </p>
      </div>

      <button
        onClick={() => router.push("/petah-tikva")}
        className="rounded-lg border-2 border-slate-900 bg-slate-900 px-5 py-4 text-start font-semibold text-white hover:bg-slate-800"
      >
        פתח פרויקט הדגמה – המרכז השקט, פתח תקווה
        <span className="mt-1 block text-xs font-normal text-slate-300">
          מרחב תמחור מוכן: נתוני שוק אמיתיים, אינדיקציות מחיר, ואסטרטגיה שיווקית לכל 39 היחידות.
        </span>
      </button>

      <button
        onClick={() => router.push("/start")}
        className="rounded-lg border border-slate-300 bg-white px-5 py-4 text-start font-semibold text-slate-900 hover:bg-slate-50"
      >
        העלה תמהיל דירות חדש
        <span className="mt-1 block text-xs font-normal text-slate-500">
          העלאת תמהיל → בחירת מיקום הפרויקט → ניתוח שוק → תמחור.
        </span>
      </button>
    </main>
  );
}
