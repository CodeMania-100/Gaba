"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface SavedWorkspace {
  projectId: string;
  sessionId: string;
  scenarioId: string;
}

const STORAGE_KEY = "gabay-demo-workspace";

export default function HomePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedWorkspace | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setSaved(JSON.parse(raw));
      } catch {
        /* ignore corrupt local state */
      }
    }
  }, []);

  async function startDemo(file: File) {
    setBusy(true);
    setError(null);
    try {
      setStep("יוצר / טוען את פרויקט ההדגמה...");
      const project = await api.getOrCreateDemoProject();

      setStep("מייבא את חוברת התמהיל שסופקה...");
      const inventory = await api.importInventoryFile(project.id, file);

      setStep("בונה תמונת מצב שוק מהמקורות האמיתיים...");
      const snapshot = await api.createDemoMarketSnapshot(project.id);

      setStep("פותח תיק תמחור...");
      const session = await api.createPricingSession({
        project_id: project.id,
        inventory_version_id: inventory.id,
        market_snapshot_id: snapshot.id,
      });

      setStep("יוצר תרחיש בסיס...");
      const scenario = await api.createScenario(session.id, { name: "בסיס" });

      const workspace: SavedWorkspace = { projectId: project.id, sessionId: session.id, scenarioId: scenario.id };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
      router.push(`/w/${project.id}/${session.id}/${scenario.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      setStep(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">מרחב תמחור גבאי</h1>
        <p className="mt-1 text-slate-600">
          כלי החלטת תמחור: מתמהיל הדירות של הפרויקט + ראיות שוק אמיתיות + אסטרטגיה עסקית מפורשת — אל מחירון דירות מלא.
        </p>
      </div>

      <button
        onClick={() => router.push("/start")}
        className="rounded-lg border-2 border-slate-900 bg-white px-5 py-4 text-start font-semibold text-slate-900 hover:bg-slate-50"
      >
        העלאת תמהיל דירות ← מרחב תמחור פתח תקווה ↗
        <span className="mt-1 block text-xs font-normal text-slate-500">
          העלאת קובץ התמהיל → 39 יחידות זוהו → בחירת עיר וכתובת → ראיות שוק אמיתיות → מחירון ותרחישים. זהו נתיב
          התמחור הפעיל היחיד לפרויקט פתח תקווה.
        </span>
      </button>

      {saved && !busy && (
        <button
          onClick={() => router.push(`/w/${saved.projectId}/${saved.sessionId}/${saved.scenarioId}`)}
          className="rounded-md bg-slate-900 px-4 py-3 font-medium text-white hover:bg-slate-800"
        >
          המשך לתיק התמחור האחרון (הדגמת אשקלון)
        </button>
      )}

      <details className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        <summary className="cursor-pointer font-medium text-slate-600">
          הדגמה ישנה (Legacy) — עיר היין, אשקלון — לא לשימוש פעיל
        </summary>
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">פרויקט הדגמה ישן — עיר היין, אשקלון.</p>
          <p className="mt-1">
            נתיב זה משויך תמיד לפרויקט הדגמה קבוע בעיר היין, אשקלון, ללא קשר לקובץ שמועלה — ולכן אינו משמש עוד את
            תהליך התמחור הפעיל. הוא נשמר כאן רק כהדגמה היסטורית של מנוע ה-DB הגנרי; לתמחור פתח תקווה האמיתי יש
            להשתמש בכפתור למעלה.
          </p>
        </div>
        <div className="mt-3">
          <h2 className="font-semibold text-slate-700">{saved ? "התחלת תיק תמחור חדש (הדגמה ישנה)" : "התחלת ההדגמה הישנה"}</h2>
          <p className="mt-1 text-sm text-slate-500">
            בחרו את חוברת התמהיל שסופקה (חוברת1.xlsx). המערכת תייבא את 39 הדירות ותטען תמונת מצב שוק של עיר היין,
            אשקלון בלבד — ללא קשר לעיר שתבחרו במסך התמחור הפעיל.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void startDemo(file);
            }}
            className="mt-4 block w-full text-sm text-slate-600 file:me-3 file:rounded-md file:border-0 file:bg-slate-600 file:px-4 file:py-2 file:text-white hover:file:bg-slate-500"
          />
          {busy && <p className="mt-3 text-sm text-slate-600">{step}</p>}
          {error && <p className="mt-3 text-sm text-red-700">שגיאה: {error}</p>}
        </div>
      </details>
    </main>
  );
}
