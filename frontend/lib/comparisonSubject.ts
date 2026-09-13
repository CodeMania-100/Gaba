// Single source of truth for "what should the מול מי אנחנו מתחרים? product-
// comparison section currently show." Resolves purely from the apartment
// row the user most recently selected anywhere in the app (a price-list
// row click, a floor-map tile click, or opening the drawer) -- so the
// section can never silently keep showing a stale 3R comparison after the
// user has moved on to a 5R or special-unit apartment. Uses the exact same
// pricingRouteOf(row) routing rule the rest of the app already uses to tell
// standard and special units apart -- no separate classification here.

import { PtkPriceListRow, pricingRouteOf, SpecialUnitContext } from "./api";
import { roomsOf, SPECIAL_UNIT_TYPE_LABELS } from "./family";

export type ComparisonSubject =
  | { kind: "standard"; family: "3R" | "5R" }
  | { kind: "special"; row: PtkPriceListRow };

export function deriveComparisonSubject(row: PtkPriceListRow): ComparisonSubject {
  if (pricingRouteOf(row) === "standard_family") {
    return { kind: "standard", family: row.family as "3R" | "5R" };
  }
  return { kind: "special", row };
}

// ---------------------------------------------------------------------------
// Apartment-type selector -- the one control (rendered once, at the top of
// Tab 2-ב) that lets Marketing pick a comparison *segment* rather than a
// specific unit. It must resolve to a real row and go through the exact
// same deriveComparisonSubject above as every other selection entry point
// (price-list row, floor tile, drawer open) -- never a second, parallel
// family/selection state that can disagree with it.
//
// A segment is family + rooms, not family alone: two special units of the
// same unit_type (e.g. two garden apartments) are NOT necessarily the same
// comparison subject if their room counts differ -- a 3-room garden unit and
// a 2-room garden unit are materially different products. Grouping by
// unit_type alone would silently collapse them into one option and let
// "pick the lowest unit_number" quietly stand in for a real choice. Segments
// are derived from the live inventory every time (never a hardcoded list of
// room counts), so this stays correct if the inventory ever changes.
// ---------------------------------------------------------------------------

export interface ComparisonSelectorOption {
  // Stable, unique per segment -- "3R"/"5R" for standard, "<unit_type>:<rooms>"
  // for special (e.g. "garden_apartment:3").
  key: string;
  label: string;
  family: string; // "3R" | "5R" | a special unit_type ("garden_apartment"/"duplex"/"triplex")
  rooms: number | null; // null marks a standard segment (rooms are implied by family there)
}

// Presentation order for special categories only -- which *segments* exist
// within each category, and how many units back each one, are still read
// live from the inventory below, never hardcoded.
const SPECIAL_CATEGORY_ORDER: Record<string, number> = { garden_apartment: 0, triplex: 1, duplex: 2 };

function segmentLabel(family: string, rooms: number, isStandard: boolean): string {
  return isStandard ? `${rooms} חדרים — סטנדרט` : `${rooms} חדרים — ${SPECIAL_UNIT_TYPE_LABELS[family] ?? family}`;
}

/** Every real comparison segment currently in the inventory: the two fixed
 * standard families, plus one option per distinct (special unit_type,
 * rooms) pair actually present. Two real 3-room garden units and one
 * 2-room garden unit collapse into two options (never three, never one) --
 * a future 4-room garden unit would automatically get its own option too,
 * with no code change here. This is the one canonical product-group
 * breakdown of the inventory -- lib/marketingStrategy.ts's sales-
 * performance-by-product-type layer reuses it directly rather than
 * building a second classification. */
export function deriveComparisonSelectorOptions(rows: PtkPriceListRow[]): ComparisonSelectorOption[] {
  const standardOptions: ComparisonSelectorOption[] = [
    { key: "3R", label: segmentLabel("3R", 3, true), family: "3R", rooms: null },
    { key: "5R", label: segmentLabel("5R", 5, true), family: "5R", rooms: null },
  ];

  const segments = new Map<string, { family: string; rooms: number }>();
  for (const row of rows) {
    if (row.family_key != null) continue; // standard rows, already covered above
    if (row.rooms == null) continue; // never invent a room count for the segment key
    const key = `${row.family}:${row.rooms}`;
    if (!segments.has(key)) segments.set(key, { family: row.family, rooms: row.rooms });
  }

  const specialOptions = [...segments.values()]
    .sort((a, b) => {
      const categoryDiff = (SPECIAL_CATEGORY_ORDER[a.family] ?? 99) - (SPECIAL_CATEGORY_ORDER[b.family] ?? 99);
      return categoryDiff !== 0 ? categoryDiff : b.rooms - a.rooms;
    })
    .map((seg) => ({
      key: `${seg.family}:${seg.rooms}`,
      label: segmentLabel(seg.family, seg.rooms, false),
      family: seg.family,
      rooms: seg.rooms,
    }));

  return [...standardOptions, ...specialOptions];
}

export const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2, insufficient: 3 };

/** Resolves a selector option to one real row. For a standard segment, any
 * matching row is equivalent (deriveComparisonSubject reads only
 * row.family for those, never the specific row), so which one is picked
 * doesn't affect what's displayed. For a special segment with more than one
 * real candidate (e.g. two 3-room garden units), picking is NOT decided by
 * unit_number order -- determinism alone doesn't make a choice correct.
 * Instead, ranked by what actually makes one candidate the better
 * representative of the segment for a real comparison:
 *   1. has an actual computed price (never point at a unit still stuck
 *      without a numeric indication when a priced sibling exists);
 *   2. higher market-indication confidence;
 *   3. more total supporting evidence (comps_used across all lanes);
 *   4. only once every real signal ties, the lowest unit_number -- purely
 *      to stay deterministic, never the primary rule.
 * Returns null only when the inventory genuinely has no row for this
 * segment (never invented). Takes only the two pieces of workspace data it
 * actually reads (the price list, and the special-unit market-indication
 * context keyed by unit_number) rather than the whole workspace, so it's
 * easy to call and to test in isolation. */
export function resolveRowForSelector(
  rows: PtkPriceListRow[],
  specialUnits: Record<string, SpecialUnitContext>,
  option: ComparisonSelectorOption
): PtkPriceListRow | null {
  const isStandard = option.rooms == null;
  const candidates = rows.filter((r) =>
    isStandard ? r.family_key != null && r.family === option.family : r.family_key == null && r.family === option.family && r.rooms === option.rooms
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1 || isStandard) return candidates[0];

  const scored = candidates.map((row) => {
    const indication = specialUnits[row.unit_number]?.market_indication;
    const hasPrice = indication?.suggested_price_ils != null;
    const confidenceRank = indication ? (CONFIDENCE_RANK[indication.confidence] ?? 9) : 9;
    const evidenceCount = indication
      ? Object.values(indication.lanes).reduce((sum, lane) => sum + (lane?.comps_used.length ?? 0), 0)
      : 0;
    return { row, hasPrice, confidenceRank, evidenceCount };
  });

  scored.sort((a, b) => {
    if (a.hasPrice !== b.hasPrice) return a.hasPrice ? -1 : 1;
    if (a.confidenceRank !== b.confidenceRank) return a.confidenceRank - b.confidenceRank;
    if (a.evidenceCount !== b.evidenceCount) return b.evidenceCount - a.evidenceCount;
    return Number(a.row.unit_number) - Number(b.row.unit_number);
  });

  return scored[0].row;
}

/** The inverse of resolveRowForSelector -- which option key should read as
 * "active" for a given subject, so the selector never shows a highlighted
 * option that disagrees with what's actually being displayed below it. */
export function selectorKeyForSubject(subject: ComparisonSubject): string {
  if (subject.kind === "standard") return subject.family;
  return `${subject.row.family}:${subject.row.rooms ?? ""}`;
}

/** The exact segment key a specific row belongs to, computed directly from
 * the row -- always agrees with selectorKeyForSubject(deriveComparisonSubject(row)),
 * kept as a direct one-row shortcut for callers (e.g.
 * lib/marketingStrategy.ts's sales-performance-by-product-type layer) that
 * already have the row and shouldn't need to build a ComparisonSubject
 * first just to look up which group it belongs to. */
export function productGroupKeyOf(row: PtkPriceListRow): string {
  return selectorKeyForSubject(deriveComparisonSubject(row));
}

/** The display label for a row's own product group -- identical wording to
 * the matching entry in deriveComparisonSelectorOptions. */
export function productGroupLabelOf(row: PtkPriceListRow): string {
  const rooms = roomsOf(row) ?? 0;
  return row.family_key != null ? segmentLabel(row.family, rooms, true) : segmentLabel(row.family, rooms, false);
}
