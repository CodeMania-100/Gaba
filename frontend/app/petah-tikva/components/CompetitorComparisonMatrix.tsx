"use client";

import { PetahTikvaWorkspace } from "@/lib/api";
import { deriveCompetitorMatrix, filterMeaningfulMatrixRows, NOT_PUBLISHED } from "@/lib/executiveVisuals";
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
  // P0 fix: every market context, Petah Tikva included, now goes through
  // the exact same family-relevant competitor selection (see
  // lib/executiveVisuals.ts's deriveCompetitorMatrix -> its own default,
  // deriveDefaultMatrixCompetitors) -- no more Petah-Tikva-only hardcoded
  // name list that ignored which family was selected.
  const matrix = deriveCompetitorMatrix(workspace, family, PROJECT_PHASE_LABELS[projectPhase]);
  const keyFiltered = rowKeys ? matrix.rows.filter((r) => rowKeys.includes(r.key)) : matrix.rows;
  // UI cleanup: a row nobody actually published anything for (every
  // competitor column reads "לא פורסם") is dropped, and once nothing
  // meaningful is left the whole section is hidden rather than showing a
  // large, mostly-empty table -- never a change to the underlying values.
  const rows = filterMeaningfulMatrixRows(keyFiltered);
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-heading text-base font-semibold text-ink">{title ?? "מיקום מול פרויקטים מתחרים"}</h3>

      <div className="overflow-x-auto rounded-md border border-hairline">
        <table className="w-full min-w-[560px] table-fixed text-sm">
          <thead className="bg-canvas">
            <tr>
              <th className="w-28 px-3 py-2 text-start text-xs font-medium text-ink-muted"></th>
              {matrix.columns.map((col, i) => (
                <th key={col} className={`break-words px-3 py-2 text-center text-xs font-semibold ${i === 0 ? "text-ink" : "text-ink-muted"}`}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              // The commercial-terms row alone carries genuinely long prose
              // (financing/promotion digests) -- allowed to wrap and read
              // start-aligned like a sentence, while every other (short,
              // number/label-shaped) row stays centered so values line up
              // in a clean column instead of hugging alternating edges.
              const isProseRow = row.key === "commercial_terms";
              return (
                <tr key={row.key} className="border-t border-hairline">
                  <td className="px-3 py-1.5 align-middle text-xs text-ink-muted">{row.label}</td>
                  {row.values.map((v, i) => (
                    <td
                      key={i}
                      className={`break-words px-3 py-1.5 align-middle text-xs ${isProseRow ? "text-start" : "text-center"} ${
                        i === 0 ? "font-semibold text-ink" : "text-ink-muted"
                      } ${v === NOT_PUBLISHED ? "text-ink-muted/50" : ""}`}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
