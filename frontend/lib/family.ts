// Mirrors pricing_core.decision.family_key() exactly so family ids computed in the
// browser (before any pricing has run) match what the backend expects on
// PUT /scenarios/{id}/family-decisions/{family_id}.

export function formatG(n: number): string {
  if (Number.isInteger(n)) return String(n);
  let s = n.toPrecision(6);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

export function computeFamilyKey(unitType: string | null, rooms: number | null, area: number | null): string {
  const roomsStr = rooms == null ? "unknown" : `${formatG(rooms)}r`;
  const areaStr = area == null ? "unknown" : `${formatG(area)}sqm`;
  return `${unitType || "unknown"}|${roomsStr}|${areaStr}`;
}

const UNIT_TYPE_LABELS: Record<string, string> = {
  standard_apartment: "דירה סטנדרטית",
  garden_apartment: "דירת גן",
  duplex: "דופלקס",
  triplex: "טריפלקס",
  unknown: "סוג לא ידוע",
};

export function familyLabel(unitType: string | null, rooms: number | null, area: number | null): string {
  const typeLabel = UNIT_TYPE_LABELS[unitType ?? "unknown"] ?? unitType ?? "סוג לא ידוע";
  const roomsLabel = rooms == null ? "" : `${formatG(rooms)} חדרים`;
  const areaLabel = area == null ? "" : `${formatG(area)} מ״ר`;
  return [typeLabel, roomsLabel, areaLabel].filter(Boolean).join(" · ");
}

export function isStandardFamily(unitType: string | null): boolean {
  return unitType === "standard_apartment";
}

export const STATUS_LABELS: Record<string, string> = {
  priced: "מתומחר",
  manual_review: "בדיקה פרטנית",
  strategy_required: "נדרשת אסטרטגיה",
  insufficient_evidence: "ראיות לא מספיקות",
};

export const STATUS_COLORS: Record<string, string> = {
  priced: "bg-emerald-100 text-emerald-800",
  manual_review: "bg-violet-100 text-violet-800",
  strategy_required: "bg-amber-100 text-amber-900",
  insufficient_evidence: "bg-slate-200 text-slate-700",
};

export const CONFIDENCE_LABELS: Record<string, string> = {
  high: "גבוהה",
  medium: "בינונית",
  low: "נמוכה",
  insufficient: "לא מספיקה",
};
