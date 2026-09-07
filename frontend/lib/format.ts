export function ils(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(value);
}

export function num(value: number | null | undefined, digits = 1): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("he-IL", { maximumFractionDigits: digits }).format(value);
}

/** Compact business-format currency for dense list views (₪1.89M) -- values
 * under ₪1M fall back to the plain full-shekel format (ils()), which is
 * already short enough not to need compacting. Never shows raw
 * floating-point digits either way; use ils() instead wherever exact
 * precision matters (drawer detail, formulas). */
export function ilsCompact(value: number | null | undefined): string {
  if (value == null) return "—";
  if (Math.abs(value) < 1_000_000) return ils(value);
  return `₪${(value / 1_000_000).toFixed(2)}M`;
}

/** True when lower/upper collapse to the same value (sub-shekel float noise
 * tolerated) -- e.g. a special-unit indication with exactly one voting
 * lane. That is a single-source point estimate, not a range, and must never
 * be displayed as "₪X – ₪X". */
export function isPointValue(lower: number | null | undefined, upper: number | null | undefined): boolean {
  return lower != null && upper != null && Math.abs(upper - lower) < 1;
}

/** Formats a lower/upper pair as a real range, or as a single value when
 * they collapse to a point (see isPointValue) -- never a repeated "X – X". */
export function rangeOrPoint(lower: number | null | undefined, upper: number | null | undefined): string {
  if (lower == null || upper == null) return "—";
  if (isPointValue(lower, upper)) return ils(lower);
  return `${ils(lower)} – ${ils(upper)}`;
}

export function dateIL(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return value;
  }
}

export function dateTimeIL(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}
