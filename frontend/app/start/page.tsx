"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, InventoryPreview } from "@/lib/api";
import { checkWorkspaceContext, WORKSPACE_MISMATCH_MESSAGE } from "@/lib/workspaceGuard";

// Only Petah Tikva is a real, selectable option today. Adding another city
// later means adding another <option> here plus another registration in
// app_api/project_launcher.py -- this screen does not otherwise change.
const SUPPORTED_CITIES = ["פתח תקווה"];
const DEFAULT_ADDRESS = "חפץ חיים 25";

const STAGE_INTERVAL_MS = 350;

type Phase = "upload" | "identified" | "context" | "running" | "unsupported" | "mismatch" | "error";

export default function ProjectStartPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [phase, setPhase] = useState<Phase>("upload");
  const [preview, setPreview] = useState<InventoryPreview | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [city, setCity] = useState(SUPPORTED_CITIES[0]);
  const [address, setAddress] = useState(DEFAULT_ADDRESS);

  const [stages, setStages] = useState<string[]>([]);
  const [stageIndex, setStageIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function handleFile(file: File) {
    setUploadError(null);
    try {
      const result = await api.previewInventory(file);
      setPreview(result);
      setPhase("identified");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleResolve() {
    setPhase("running");
    setStageIndex(0);
    setMessage(null);

    try {
      // The stage list itself comes from the backend (the real pipeline step
      // names); only the pacing of revealing them is presentational. No data
      // is invented here -- the actual request below is the only source of
      // the eventual result.
      const resultPromise = api.startProject(city, address, preview?.fingerprint ?? null);

      timerRef.current = setInterval(() => {
        setStageIndex((i) => Math.min(i + 1, 7));
      }, STAGE_INTERVAL_MS);

      const result = await resultPromise;
      if (timerRef.current) clearInterval(timerRef.current);
      setStages(result.stages);
      setStageIndex(result.stages.length - 1);

      await new Promise((resolve) => setTimeout(resolve, 300));

      if (result.data_mode === "snapshot" || result.data_mode === "live") {
        if (!result.workspace) {
          setPhase("error");
          setMessage("שגיאה: לא התקבל תוכן מרחב תמחור מהשרת.");
          return;
        }
        // Defensive guard: fail loudly rather than render a Petah Tikva
        // context against mismatched/contaminated market data.
        const guard = checkWorkspaceContext(result.workspace);
        if (!guard.ok) {
          setPhase("mismatch");
          setMessage(guard.reason ?? null);
          return;
        }
        router.push("/petah-tikva");
        return;
      }
      setPhase("unsupported");
      setMessage(result.message ?? "פרויקט זה עדיין לא נתמך במצב הדגמה.");
    } catch (err) {
      if (timerRef.current) clearInterval(timerRef.current);
      setPhase("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">התחלת פרויקט תמחור</h1>
        <p className="mt-1 text-sm text-slate-600">העלאת תמהיל דירות ← בחירת מיקום פרויקט ← ניתוח שוק ← מחירון.</p>
      </div>

      <WorkflowProgress phase={phase} />

      {phase === "upload" && (
        <div className="rounded-lg border border-slate-300 bg-white p-5">
          <h2 className="font-semibold text-slate-900">1. העלאת תמהיל הדירות</h2>
          <p className="mt-1 text-sm text-slate-600">בחרו את חוברת התמהיל (קובץ xlsx). הקובץ ייקרא ויסווג בלבד — עדיין לא נוצר תיק תמחור.</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
            className="mt-4 block w-full text-sm text-slate-700 file:me-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-white hover:file:bg-slate-800"
          />
          {uploadError && <p className="mt-3 text-sm text-red-700">שגיאה בקריאת הקובץ: {uploadError}</p>}
        </div>
      )}

      {phase === "identified" && preview && (
        <div className="rounded-lg border border-slate-300 bg-white p-5">
          <h2 className="font-semibold text-slate-900">2. התמהיל נקלט</h2>
          <p className="mt-2 text-lg font-bold text-slate-900">{preview.total_units} יחידות זוהו</p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
            <span>{preview.standard_unit_count} יחידות סטנדרטיות (מסלול תמחור רגיל)</span>
            <span>{preview.special_unit_count} יחידות בבדיקה פרטנית (מסלול ייעודי)</span>
          </div>
          <button
            onClick={() => setPhase("context")}
            className="mt-4 rounded-md bg-slate-900 px-4 py-3 font-medium text-white hover:bg-slate-800"
          >
            המשך לפרטי הפרויקט
          </button>
        </div>
      )}

      {phase === "context" && (
        <div className="flex flex-col gap-4 rounded-lg border border-slate-300 bg-white p-5">
          <h2 className="font-semibold text-slate-900">3. פרטי הפרויקט</h2>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">עיר</span>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
            >
              {SUPPORTED_CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">כתובת / שם פרויקט</span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
              placeholder={DEFAULT_ADDRESS}
            />
          </label>

          <p className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-500">
            מיקום הדגמה — הכתובת לא סופקה על ידי החברה. הנתונים משויכים לתמהיל שהועלה ולפרויקט זה בלבד.
          </p>

          <button
            onClick={handleResolve}
            disabled={!city.trim() || !address.trim()}
            className="rounded-md bg-slate-900 px-4 py-3 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            המשך לניתוח השוק
          </button>
        </div>
      )}

      {phase === "running" && (
        <div className="rounded-lg border border-slate-300 bg-white p-5">
          <ul className="flex flex-col gap-2">
            {(stages.length ? stages : PLACEHOLDER_STAGES).map((s, i) => (
              <li key={s} className="flex items-center gap-2 text-sm">
                <span
                  className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs ${
                    i < stageIndex
                      ? "bg-emerald-600 text-white"
                      : i === stageIndex
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {i < stageIndex ? "✓" : i + 1}
                </span>
                <span className={i <= stageIndex ? "text-slate-900" : "text-slate-400"}>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase === "unsupported" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="whitespace-pre-line">{message}</p>
          <button
            onClick={() => setPhase("context")}
            className="mt-3 rounded-md border border-amber-400 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100"
          >
            חזרה
          </button>
        </div>
      )}

      {phase === "mismatch" && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p className="whitespace-pre-line font-medium">{WORKSPACE_MISMATCH_MESSAGE}</p>
          {message && <p className="mt-2 font-mono text-xs text-red-600">{message}</p>}
          <button
            onClick={() => setPhase("context")}
            className="mt-3 rounded-md border border-red-400 px-3 py-1.5 text-sm text-red-800 hover:bg-red-100"
          >
            חזרה
          </button>
        </div>
      )}

      {phase === "error" && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p>שגיאה באיתור הפרויקט: {message}</p>
          <button
            onClick={() => setPhase("context")}
            className="mt-3 rounded-md border border-red-400 px-3 py-1.5 text-sm text-red-800 hover:bg-red-100"
          >
            חזרה
          </button>
        </div>
      )}
    </main>
  );
}

const WORKFLOW_STEPS: { key: Phase[]; label: string }[] = [
  { key: ["upload"], label: "העלאת תמהיל" },
  { key: ["identified"], label: "39 יחידות זוהו" },
  { key: ["context"], label: "מיקום הפרויקט" },
  { key: ["running", "unsupported", "mismatch", "error"], label: "נתוני השוק" },
];

function WorkflowProgress({ phase }: { phase: Phase }) {
  const currentIndex = WORKFLOW_STEPS.findIndex((s) => s.key.includes(phase));
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
      {WORKFLOW_STEPS.map((s, i) => (
        <span key={s.label} className="flex items-center gap-1">
          <span className={i < currentIndex ? "text-emerald-700" : i === currentIndex ? "font-semibold text-slate-900" : "text-slate-400"}>
            {i < currentIndex ? "✓" : i === currentIndex ? "→" : "·"} {s.label}
          </span>
          {i < WORKFLOW_STEPS.length - 1 && <span className="text-slate-300">/</span>}
        </span>
      ))}
    </div>
  );
}

// Same 8 labels the backend sends; used only for the brief moment before the
// real response (with its own stages list) arrives, so the list never jumps
// from empty to populated mid-animation.
const PLACEHOLDER_STAGES = [
  "מאתר את הפרויקט",
  "אוסף עסקאות שבוצעו",
  "אוסף מחירי ביקוש",
  "מאתר פרויקטים מתחרים",
  "מנרמל ומסנן את הנתונים",
  "מבצע בדיקות איכות וכפילויות",
  "בונה טווחי שוק",
  "מייצר מחירון",
];
