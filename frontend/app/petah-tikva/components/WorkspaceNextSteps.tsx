"use client";

import { PetahTikvaScenario, PtkFamily } from "@/lib/api";

interface Props {
  family: PtkFamily;
  scenario: PetahTikvaScenario | null;
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function WorkspaceNextSteps({ family, scenario }: Props) {
  const hasConsensus = family.market.status === "consensus";
  const hasScenario = scenario != null;

  return (
    <div className="flex flex-col gap-2">
      <WorkflowStepper hasScenario={hasScenario} />
      <NextActionBanner hasConsensus={hasConsensus} hasScenario={hasScenario} />
    </div>
  );
}

function WorkflowStepper({ hasScenario }: { hasScenario: boolean }) {
  // Reaching this page already implies upload/project-context/evidence/ranges
  // are resolved (the /start launcher only navigates here on data_mode ===
  // "snapshot"/"live"); the remaining two steps reflect real page state.
  const steps: { label: string; done: boolean }[] = [
    { label: "תמהיל הדירות", done: true },
    { label: "נתוני הפרויקט", done: true },
    { label: "ראיות שוק", done: true },
    { label: "טווחי שוק", done: true },
    { label: "החלטת תמחור", done: hasScenario },
    { label: "מחירון ותרחישים", done: false },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
      {steps.map((s, i) => (
        <span key={s.label} className={s.done ? "text-emerald-700" : i === steps.findIndex((x) => !x.done) ? "font-semibold text-slate-900" : "text-slate-400"}>
          {s.done ? "✓" : "→"} {s.label}
        </span>
      ))}
    </div>
  );
}

function NextActionBanner({ hasConsensus, hasScenario }: { hasConsensus: boolean; hasScenario: boolean }) {
  if (!hasConsensus) {
    return (
      <ActionCard tone="amber" title="אין מספיק ראיות לקבלת החלטת מחיר." body={null} ctaLabel="לצפייה בפערי המידע" onClick={() => scrollTo("evidence-section")} />
    );
  }
  if (!hasScenario) {
    return (
      <ActionCard
        tone="emerald"
        title="נתוני השוק נאספו ונבדקו. נמצא טווח מחיר נתמך ברמת ביטחון גבוהה."
        body="השלב הבא הוא לבחור את מיקום המחיר של החברה."
        ctaLabel="לבחירת אסטרטגיית מחיר"
        onClick={() => scrollTo("strategy-section")}
      />
    );
  }
  return (
    <ActionCard
      tone="emerald"
      title="אסטרטגיית המחיר הוגדרה."
      body="ניתן לעבור למחירון ולבחון תרחישים."
      ctaLabel="למחירון הפרויקט"
      onClick={() => scrollTo("price-list-section")}
    />
  );
}

function ActionCard({
  tone,
  title,
  body,
  ctaLabel,
  onClick,
}: {
  tone: "amber" | "emerald";
  title: string;
  body: string | null;
  ctaLabel: string;
  onClick: () => void;
}) {
  const toneClasses = tone === "amber" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900";
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 ${toneClasses}`}>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide opacity-70">השלב הבא</div>
        <p className="text-sm font-medium">{title}</p>
        {body && <p className="text-sm">{body}</p>}
      </div>
      <button onClick={onClick} className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
        {ctaLabel}
      </button>
    </div>
  );
}
