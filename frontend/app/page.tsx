"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, PetahTikvaWorkspace } from "@/lib/api";

/** Project launcher, not a marketing page: Marketing picks a project and
 * enters its pricing workspace. Project facts (name/location/unit count)
 * are read live from the same workspace payload the pricing page itself
 * uses -- never a hardcoded restatement of it, so this can never drift from
 * what the workspace actually shows. The legacy generic-DB-engine demo
 * (formerly surfaced here as an "Ashkelon" path) is intentionally not
 * linked from this page -- it stays fully intact in the codebase
 * (app/w/[...]/page.tsx and its backend routes are untouched) and is still
 * reachable directly by URL, it just no longer appears here. */
export default function HomePage() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<PetahTikvaWorkspace | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getMarketWorkspace("petah_tikva")
      .then((d) => {
        if (!cancelled) setWorkspace(d);
      })
      .catch((err) => console.error("Failed to load project list:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const project = workspace?.project;
  const location = project ? (project.address ?? `${project.commercial_area} / ${project.official_neighborhood}`) : null;

  return (
    <div className="min-h-screen bg-canvas">
      <main className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-10">
        <header>
          <h1 className="font-heading text-xl font-bold text-ink">מרחב תמחור גבאי</h1>
          <p className="mt-0.5 text-sm text-ink-muted">בחירת פרויקט לתמחור</p>
        </header>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">פרויקטים</h2>

          {project ? (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-hairline bg-surface p-4">
              <div>
                <div className="font-heading text-lg font-bold text-ink">{project.name}</div>
                <div className="mt-0.5 text-sm text-ink-muted">{location}</div>
                <div className="mt-0.5 text-sm text-ink-muted">{project.total_units} יחידות</div>
              </div>
              <button
                onClick={() => router.push("/petah-tikva")}
                className="shrink-0 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-surface hover:bg-ink/90"
              >
                פתח פרויקט
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-hairline bg-surface p-4 text-sm text-ink-muted">טוען פרויקטים...</div>
          )}
        </section>

        <section>
          <button
            onClick={() => router.push("/start")}
            className="flex w-full flex-col items-start gap-1 rounded-lg border border-dashed border-hairline bg-surface px-4 py-3 text-start hover:bg-canvas"
          >
            <span className="text-sm font-semibold text-ink">פרויקט חדש — העלה תמהיל דירות</span>
            <span className="text-xs text-ink-muted">טעינת תמהיל והתחלת תהליך תמחור</span>
          </button>
        </section>
      </main>
    </div>
  );
}
