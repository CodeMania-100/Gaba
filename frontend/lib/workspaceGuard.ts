// Defensive project-context guard (see task: "detect obvious incompatible
// market metadata... fail loudly instead of rendering"). This is a
// presentation-layer safety net, not a data-quality tool: the frozen Petah
// Tikva chain already has its own read-only audit
// (gabay_pricing_core/audit_petah_tikva_snapshot.py). This just re-checks the
// same handful of contamination terms against the live payload right before
// it's rendered, so a bad snapshot can never silently display as if it were
// Petah Tikva.

import { PetahTikvaWorkspace } from "./api";

const VALID_PETAH_TIKVA_CITY_SPELLINGS = new Set(["פתח תקווה", "פתח תקוה"]);

const CONTAMINATION_TERMS = [
  /אשקלון/i,
  /ashkelon/i,
  /city[ _]wine/i,
  /עיר היין/,
  /wine_city/i,
];

function findContamination(value: unknown): string | null {
  if (typeof value === "string") {
    for (const pattern of CONTAMINATION_TERMS) {
      if (pattern.test(value)) return `${pattern} matched in ${JSON.stringify(value).slice(0, 120)}`;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findContamination(item);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) {
      const hit = findContamination(v);
      if (hit) return hit;
    }
  }
  return null;
}

export interface WorkspaceGuardResult {
  ok: boolean;
  reason?: string;
}

/** Checked once, right after the workspace payload loads, before anything
 * renders from it. Scans the whole payload (project/metadata/evidence/price
 * list) for the known Ashkelon/"City Wine" terms and confirms the project
 * city is a real Petah Tikva spelling -- never both silently ignored. */
export function checkWorkspaceContext(workspace: PetahTikvaWorkspace): WorkspaceGuardResult {
  if (!VALID_PETAH_TIKVA_CITY_SPELLINGS.has(workspace.project.city)) {
    return { ok: false, reason: `project.city is not a recognized Petah Tikva spelling: ${JSON.stringify(workspace.project.city)}` };
  }
  const hit = findContamination(workspace);
  if (hit) {
    return { ok: false, reason: `contaminated field found: ${hit}` };
  }
  return { ok: true };
}

export const WORKSPACE_MISMATCH_MESSAGE =
  "נמצאה אי-התאמה בין מיקום הפרויקט לנתוני השוק.\nלא ניתן להמשיך עד לבחירת מקור נתונים מתאים.";
