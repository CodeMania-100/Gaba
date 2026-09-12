// Defensive project-context guard (see task: "detect obvious incompatible
// market metadata... fail loudly instead of rendering"). This is a
// presentation-layer safety net, not a data-quality tool.
//
// Generalized for multi-city market-context switching: with Ashkelon now a
// real, supported context (barnea), a free-text scan for the word "אשקלון"
// would flag every legitimate Barnea payload as contamination -- so this
// guard is now a tier-aware STRUCTURED geography check only (see
// lib/geographyValidation.ts, the same validator the backend tests and
// scripts/audit_market_contexts.py use), never a free-text scan, in any
// capacity. The workspace's own `market_context` block (populated purely
// from the backend's static per-slug registry, never derived from
// evidence) is the trusted source of "what city/submarket did we ask for" --
// the rest of the payload's own geography-bearing records are checked
// against it.

import { PetahTikvaWorkspace } from "./api";
import { findGeographyRecords, GeographyViolation, validateGeographyRecords } from "./geographyValidation";

export interface WorkspaceGuardResult {
  ok: boolean;
  reason?: string;
}

/** Checked once, right after the workspace payload loads, before anything
 * renders from it. If the payload predates `market_context` (should not
 * happen once the backend always sends it, but defensive), the guard
 * passes rather than failing on a false negative. */
export function checkWorkspaceContext(workspace: PetahTikvaWorkspace): WorkspaceGuardResult {
  const context = workspace.market_context;
  if (!context) return { ok: true };

  const acceptedCities = new Set(context.city_spellings?.length ? context.city_spellings : [context.city]);
  if (!acceptedCities.has(workspace.project.city)) {
    return { ok: false, reason: `project.city ${JSON.stringify(workspace.project.city)} does not match the requested market context (${context.display_name})` };
  }

  const records = findGeographyRecords(workspace);
  const violations = validateGeographyRecords(records, acceptedCities, context.submarket);
  if (violations.length > 0) {
    const v: GeographyViolation = violations[0];
    return {
      ok: false,
      reason: `cross-context geography mismatch (${violations.length} record(s)): ${v.field} expected ${JSON.stringify(v.expected)}, found ${JSON.stringify(v.actual)}`,
    };
  }
  return { ok: true };
}

export const WORKSPACE_MISMATCH_MESSAGE =
  "נמצאה אי-התאמה בין מיקום הפרויקט לנתוני השוק.\nלא ניתן להמשיך עד לבחירת מקור נתונים מתאים.";
