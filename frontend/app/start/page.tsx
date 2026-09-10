"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, InventoryPreview } from "@/lib/api";
import { checkWorkspaceContext, WORKSPACE_MISMATCH_MESSAGE } from "@/lib/workspaceGuard";

// Only Petah Tikva is a real, selectable option today. Adding another city
// later means adding another <option> here plus another registration in
// app_api/project_launcher.py -- this screen does not otherwise change.
const SUPPORTED_CITIES = ["פתח תקווה"];

// The assignment never supplied an exact street address for the subject
// project -- חפץ חיים 25 is a *competitor* record in the evidence data, not
// the subject's address, and must never be shown here as if it were. The
// actual request sent to the backend always uses an empty address (see
// handleResolve) -- app_api/project_launcher.py's registered snapshot is
// keyed on an equally empty address for the same reason (_PETAH_TIKVA_ADDRESS
// there). The כתובת/גוש-חלקה selects below are demo-only UI: they show that
// the tool *can* narrow to street/parcel precision, but selecting one here
// does not feed any real filtering yet (no new geospatial backend logic in
// this pass) and must never be read as the real subject address.
const DEMO_NEIGHBORHOODS = ["המרכז השקט / מרכז העיר"];
const DEMO_ADDRESSES = ["(לא נבחר)", "כתובת לדוגמה 1", "כתובת לדוגמה 2", "כתובת לדוגמה 3"];
const DEMO_GUSH_HELKA = ["(לא נבחר)", "גוש לדוגמה 1234 / חלקה 56", "גוש לדוגמה 2210 / חלקה 12", "גוש לדוגמה 5567 / חלקה 8"];

const STAGE_INTERVAL_MS = 350;

type Phase = "upload" | "identified" | "context" | "running" | "unsupported" | "mismatch" | "error";

export default function ProjectStartPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [phase, setPhase] = useState<Phase>("upload");
  const [preview, setPreview] = useState<InventoryPreview | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const [city, setCity] = useState(SUPPORTED_CITIES[0]);
  // Demo-only geographic precision selects (see DEMO_* comment above) --
  // purely illustrative, never sent to the backend.
  const [neighborhood, setNeighborhood] = useState(DEMO_NEIGHBORHOODS[0]);
  const [demoAddress, setDemoAddress] = useState(DEMO_ADDRESSES[0]);
  const [demoGushHelka, setDemoGushHelka] = useState(DEMO_GUSH_HELKA[0]);

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
      console.error("Failed to preview inventory file:", err);
      setUploadError("לא ניתן לטעון כרגע את נתוני הפרויקט. נסה לרענן בעוד מספר שניות.");
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
      // the eventual result. Address is always empty: the assignment never
      // supplied one, and the כתובת/גוש-חלקה selects above are demo-only
      // (see the DEMO_* comment) -- not real filtering inputs yet.
      const resultPromise = api.startProject(city, "", preview?.fingerprint ?? null);

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
      console.error("Failed to start project:", err);
      if (timerRef.current) clearInterval(timerRef.current);
      setPhase("error");
      setMessage("לא ניתן לטעון כרגע את נתוני הפרויקט. נסה לרענן בעוד מספר שניות.");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">התחלת פרויקט תמחור</h1>
        <p className="mt-1 text-sm text-slate-600">העלאת תמהיל ← בחירת מיקום הפרויקט ← ניתוח שוק ← תמחור.</p>
      </div>

      <WorkflowProgress phase={phase} />

      {phase === "upload" && (
        <div className="rounded-lg border border-slate-300 bg-white p-5">
          <h2 className="font-semibold text-slate-900">1. העלאת תמהיל הדירות</h2>
          <p className="mt-1 text-sm text-slate-600">
            בחרו את קובץ התמהיל (XLSX).
            <br />
            בשלב זה המערכת קוראת ומאמתת את נתוני הדירות בלבד.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setSelectedFileName(file.name);
                void handleFile(file);
              }
            }}
            className="sr-only"
          />
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              בחירת קובץ Excel
            </button>
            <span className="text-sm text-slate-500">{selectedFileName || "לא נבחר קובץ"}</span>
          </div>
          {uploadError && <p className="mt-3 text-sm text-red-700">{uploadError}</p>}
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
          <p className="text-xs text-slate-500">
            ניתן לצמצם את היקף איסוף וסינון נתוני השוק בהדרגה: עיר ← אזור/שכונה ← כתובת ← גוש/חלקה.
          </p>

          <LocationSelect label="עיר" value={city} onChange={setCity} options={SUPPORTED_CITIES} />
          <LocationSelect label="אזור / שכונה" value={neighborhood} onChange={setNeighborhood} options={DEMO_NEIGHBORHOODS} />
          <LocationSelect label="כתובת" value={demoAddress} onChange={setDemoAddress} options={DEMO_ADDRESSES} />
          <LocationSelect label="גוש / חלקה" value={demoGushHelka} onChange={setDemoGushHelka} options={DEMO_GUSH_HELKA} />

          <p className="rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-500">
            רמת הדיוק במיקום קובעת את היקף איסוף וסינון נתוני השוק. כתובת וגוש/חלקה כאן הם ערכי הדגמה בלבד — הפרויקט
            עצמו מבוסס על אזור מסחרי לצורך ההדגמה; כתובת מדויקת לא סופקה במטלה.
          </p>

          <button
            onClick={handleResolve}
            disabled={!city.trim()}
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
          <p>{message}</p>
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

function LocationSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

// Static breadcrumb labels only -- never a data value (e.g. a real unit
// count). The dynamic "X יחידות זוהו" figure is shown once, inside the
// "identified" phase card below, only after a file has actually been parsed.
const WORKFLOW_STEPS: { key: Phase[]; label: string }[] = [
  { key: ["upload", "identified"], label: "העלאת תמהיל" },
  { key: ["context"], label: "בחירת מיקום הפרויקט" },
  { key: ["running", "unsupported", "mismatch", "error"], label: "ניתוח שוק" },
  { key: [], label: "תמחור" },
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
