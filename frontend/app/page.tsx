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

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">פרויקט הדגמה — עיר היין, אשקלון.</p>
        <p className="mt-1">
          תמהיל הדירות שסופק למטלה לא כלל מיקום פרויקט. עיר היין, אשקלון נבחרה כשוק הדגמה לצורך המטלה בלבד; אין
          משמעות הדבר שהתמהיל בן 39 הדירות שייך בפועל לפרויקט של גבאי במיקום זה.
        </p>
      </div>

      {saved && !busy && (
        <button
          onClick={() => router.push(`/w/${saved.projectId}/${saved.sessionId}/${saved.scenarioId}`)}
          className="rounded-md bg-slate-900 px-4 py-3 font-medium text-white hover:bg-slate-800"
        >
          המשך לתיק התמחור האחרון
        </button>
      )}

      <div className="rounded-lg border border-slate-300 bg-white p-5">
        <h2 className="font-semibold text-slate-900">{saved ? "התחלת תיק תמחור חדש" : "התחלת ההדגמה"}</h2>
        <p className="mt-1 text-sm text-slate-600">
          בחרו את חוברת התמהיל שסופקה (חוברת1.xlsx). המערכת תייבא את 39 הדירות, תטען תמונת מצב שוק אמיתית ותפתח תרחיש
          תמחור בסיס — ללא אסטרטגיה עדיין. את האסטרטגיה לדירות 3 ו-5 חדרים תקבעו בעצמכם במחירון.
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
          className="mt-4 block w-full text-sm text-slate-700 file:me-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-white hover:file:bg-slate-800"
        />
        {busy && <p className="mt-3 text-sm text-slate-600">{step}</p>}
        {error && <p className="mt-3 text-sm text-red-700">שגיאה: {error}</p>}
      </div>
    </main>
  );
}
