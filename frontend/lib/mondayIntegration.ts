// One outbound demo integration: "שלח לאישור ב-Monday" in the unit drawer
// posts the unit's current pricing decision to our own backend
// (POST /api/v1/integrations/monday/pricing-approval), which is the only
// thing that ever talks to api.monday.com -- MONDAY_API_TOKEN never reaches
// the browser (see task "Focused Batch — Real Monday Pricing Approval
// Integration", items 3-4). This module only builds the request payload
// from state the drawer already has and reads the backend's response; no
// business logic (strategy effect, market gap, label mapping) is
// duplicated here -- see gabay_pricing_core/app_api/monday_integration.py.

import { PtkPriceListRow } from "./api";
import { roomsOf, unitTypeLabel } from "./family";
import {
  FAMILY_BUCKET_LABELS,
  familyBucketOf,
  GROUP_ADJUSTMENT_LABEL,
  MarketingStrategyState,
  PriceBreakdown,
  PROJECT_ADJUSTMENT_LABEL,
  PROJECT_PHASE_LABELS,
  UNIT_ADJUSTMENT_LABEL,
} from "./marketingStrategy";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export interface MondayApprovalPayload {
  unit_number: string;
  property_type: string;
  rooms: number | null;
  market_indication: number;
  proposed_price: number;
  confidence: string;
  project_phase: string;
  sell_through_actual_pct: number | null;
  sell_through_target_pct: number | null;
  strategy_effect_pct: number;
  rationales: string[];
}

/** null only when the price breakdown has no market indication yet (special
 * unit still pending analysis) -- there is nothing meaningful to send. */
export function buildMondayApprovalPayload(
  row: PtkPriceListRow,
  state: MarketingStrategyState,
  breakdown: PriceBreakdown,
  confidence: string | null
): MondayApprovalPayload | null {
  if (breakdown.marketIndicationIls == null || breakdown.proposedIls == null) return null;

  const bucket = familyBucketOf(row);
  const familyAdjustment = state.familyAdjustments[bucket];
  const unitAdjustment = state.unitAdjustments[row.unit_number];

  // Only lines backed by data that actually exists -- never invented (task
  // item 9). Each line is already fully Hebrew; the backend only joins them.
  const rationales: string[] = [`שלב הפרויקט: תרחיש ${PROJECT_PHASE_LABELS[state.projectPhase]}.`];
  if (state.targetSellThroughPct) {
    rationales.push(`קצב מכירות: ${state.actualSellThroughPct}% מול יעד של ${state.targetSellThroughPct}%.`);
  }
  if (state.projectAdjustment.rationale.trim()) {
    rationales.push(`${PROJECT_ADJUSTMENT_LABEL}: ${state.projectAdjustment.rationale.trim()}.`);
  }
  if (familyAdjustment?.rationale?.trim()) {
    rationales.push(`${GROUP_ADJUSTMENT_LABEL} (${FAMILY_BUCKET_LABELS[bucket]}): ${familyAdjustment.rationale.trim()}.`);
  }
  if (unitAdjustment?.rationale?.trim()) {
    rationales.push(`${UNIT_ADJUSTMENT_LABEL}: ${unitAdjustment.rationale.trim()}.`);
  }

  return {
    unit_number: row.unit_number,
    property_type: unitTypeLabel(row.family),
    rooms: roomsOf(row),
    market_indication: breakdown.marketIndicationIls,
    proposed_price: breakdown.proposedIls,
    // Internal confidence code (e.g. "low"/"high"), never raw Hebrew --
    // the backend owns the Hebrew label mapping (task item 5/10).
    confidence: confidence ?? "insufficient",
    project_phase: state.projectPhase,
    sell_through_actual_pct: state.actualSellThroughPct || null,
    sell_through_target_pct: state.targetSellThroughPct || null,
    strategy_effect_pct: breakdown.totalPct,
    rationales,
  };
}

export type MondaySendResult =
  | { ok: true; itemId: string; boardUrl: string }
  | { ok: false; reason: "not_configured" | "failed" };

export async function sendPricingApprovalToMonday(payload: MondayApprovalPayload): Promise<MondaySendResult> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/integrations/monday/pricing-approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 503) return { ok: false, reason: "not_configured" };
    if (!res.ok) return { ok: false, reason: "failed" };
    const data = (await res.json()) as { monday_item_id: string; board_url: string };
    return { ok: true, itemId: String(data.monday_item_id), boardUrl: data.board_url };
  } catch {
    // Network failure -- never surface the raw error to Marketing (task item 13).
    return { ok: false, reason: "failed" };
  }
}
