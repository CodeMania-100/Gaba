"use client";

import { PetahTikvaWorkspace } from "@/lib/api";
import { deriveCompetitorMatrix } from "@/lib/executiveVisuals";
import { PROJECT_PHASE_LABELS, ProjectPhase } from "@/lib/marketingStrategy";

interface Props {
  workspace: PetahTikvaWorkspace;
  projectPhase: ProjectPhase;
  family: "3R" | "5R";
}

/** Management-facing side-by-side matrix -- separate from the detailed
 * competitor cards below it (see lib/executiveVisuals.ts
 * deriveCompetitorMatrix). Starting prices are always labeled as such, and
 * any field this workspace doesn't have shows "לא פורסם" rather than being
 * filled in. Family selection is controlled by the parent section so it
 * stays in sync with the market-position chart above it (item 19/20). */
export default function CompetitorComparisonMatrix({ workspace, projectPhase, family }: Props) {
  const matrix = deriveCompetitorMatrix(workspace, family, PROJECT_PHASE_LABELS[projectPhase]);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-slate-900">מיקום מול פרויקטים מתחרים</h3>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-start text-xs font-medium text-slate-500"></th>
              {matrix.columns.map((col, i) => (
                <th key={col} className={`px-3 py-2 text-start text-xs font-semibold ${i === 0 ? "text-slate-900" : "text-slate-600"}`}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.key} className="border-t border-slate-100">
                <td className="px-3 py-2 text-xs text-slate-500">{row.label}</td>
                {row.values.map((v, i) => (
                  <td key={i} className={`px-3 py-2 text-xs ${i === 0 ? "font-semibold text-slate-900" : "text-slate-700"} ${v === "לא פורסם" ? "text-slate-300" : ""}`}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
