"use client";

import { PetahTikvaWorkspace } from "@/lib/api";
import { deriveCompetitorMatrix, deriveDefaultMatrixCompetitors } from "@/lib/executiveVisuals";
import { PROJECT_PHASE_LABELS, ProjectPhase } from "@/lib/marketingStrategy";

interface Props {
  workspace: PetahTikvaWorkspace;
  projectPhase: ProjectPhase;
  family: "3R" | "5R";
  // Restricts which matrix rows render (task: price-positioning rows belong
  // under "מול אילו פרויקטים אנחנו מתחרים?", genuine product-attribute rows
  // belong under "במה המוצר שלנו שונה מהמתחרים?" -- never both, never
  // duplicated). Omit to render every row (used by no current caller, kept
  // for safety).
  rowKeys?: string[];
  title?: string;
}

/** Management-facing side-by-side matrix (see lib/executiveVisuals.ts
 * deriveCompetitorMatrix). Starting prices are always labeled as such, and
 * any field this workspace doesn't have shows "לא פורסם" rather than being
 * filled in. Family selection is controlled by the parent section. */
export default function CompetitorComparisonMatrix({ workspace, projectPhase, family, rowKeys, title }: Props) {
  // Petah Tikva keeps its own curated 3-competitor selection untouched; the
  // three multi-city contexts have no such curation, so their real
  // competitor_landscape projects are used instead (see
  // deriveDefaultMatrixCompetitors) -- never Petah Tikva's names, which
  // would simply never match and render every cell as "לא פורסם".
  const isPetahTikva = !workspace.market_context || workspace.market_context.slug === "petah_tikva";
  const competitorOverride = isPetahTikva ? undefined : deriveDefaultMatrixCompetitors(workspace, family);
  const matrix = deriveCompetitorMatrix(workspace, family, PROJECT_PHASE_LABELS[projectPhase], competitorOverride);
  const rows = rowKeys ? matrix.rows.filter((r) => rowKeys.includes(r.key)) : matrix.rows;
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-slate-900">{title ?? "מיקום מול פרויקטים מתחרים"}</h3>

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
            {rows.map((row) => (
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
