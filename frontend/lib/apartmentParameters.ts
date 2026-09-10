// Pure, presentation-only derivation of "מאפייני הדירה בתהליך התמחור" (task
// "Small Refinement Batch" item 8-10): what the pricing engine actually does
// with each physical apartment attribute, in plain Hebrew, using language
// that matches the real engine behavior -- never claiming a quantitative
// effect (e.g. "west orientation -> price+") unless a verified monetary
// rule exists (none does today, see lib/marketingStrategy.ts's explicit
// separation of business facts from company-entered adjustments). Every
// value here is read straight from the existing PtkPriceListRow already
// shown elsewhere in the drawer -- nothing new is fetched or computed.

import { PtkPriceListRow } from "./api";
import { outdoorLabel, roomsOf, unitTypeLabel } from "./family";
import { num } from "./format";

export type ParameterStatus = "affects_comparable_selection" | "factored_into_calculation" | "shown_for_comparison" | "not_monetized" | "no_verified_data";

// The five statuses the task explicitly allows -- deliberately not a
// numeric score, and the label text itself (not color alone) carries the
// meaning (task item 9).
export const PARAMETER_STATUS_LABELS: Record<ParameterStatus, string> = {
  affects_comparable_selection: "משפיע על בחירת ההשוואות",
  factored_into_calculation: "נלקח בחשבון בחישוב",
  shown_for_comparison: "מוצג לצורך השוואה",
  not_monetized: "לא כומת כספית",
  no_verified_data: "אין מידע מאומת",
};

export interface ApartmentParameterRow {
  label: string;
  value: string;
  usage: string;
  status: ParameterStatus;
}

/** `isSpecial` distinguishes the two real, different usages of "סוג דירה"
 * and "קומה" the engine actually has: standard rows route by room-count
 * family (pricing_core's 3R/5R market-range engine), special rows route by
 * garden/duplex/triplex category (pricing_core.special_market_indication) --
 * see gabay_pricing_core/app_api/special_unit_context.py's UNIT_CATEGORY/
 * route. Every other row is identical for both routes since neither uses
 * outdoor area, orientation, parking, or storage as a quantitative input. */
export function deriveApartmentParameterRows(row: PtkPriceListRow, isSpecial: boolean): ApartmentParameterRow[] {
  const rooms = roomsOf(row);

  return [
    {
      label: "סוג דירה",
      value: unitTypeLabel(row.family),
      usage: isSpecial ? "קובע את מסלול ההשוואה (דירת גן / דופלקס / טריפלקס)." : "קובע את מסלול ההשוואה (משפחת 3 או 5 חדרים).",
      status: "affects_comparable_selection",
    },
    {
      label: "חדרים",
      value: rooms != null ? String(rooms) : "—",
      usage: rooms != null ? "משמש לבחירת נכסים להשוואה." : "אין מידע מאומת על מספר החדרים.",
      status: rooms != null ? "affects_comparable_selection" : "no_verified_data",
    },
    {
      label: "שטח פנימי",
      value: row.internal_area_sqm != null ? `${num(row.internal_area_sqm)} מ״ר` : "—",
      usage:
        row.internal_area_sqm != null
          ? "משמש להשוואת גודל ולנרמול המחיר בין נכסים בגדלים שונים (בסיס לחישוב)."
          : "אין מידע מאומת על שטח פנימי.",
      status: row.internal_area_sqm != null ? "factored_into_calculation" : "no_verified_data",
    },
    {
      label: outdoorLabel(row.family),
      value: row.balcony_area_sqm != null ? `${num(row.balcony_area_sqm)} מ״ר` : "—",
      usage:
        row.balcony_area_sqm != null
          ? "מוצג בהשוואת המוצר. לא בוצעה התאמה כספית אוטומטית."
          : "אין מידע מאומת.",
      status: row.balcony_area_sqm != null ? "shown_for_comparison" : "no_verified_data",
    },
    {
      label: "קומה",
      value: row.floor != null ? String(row.floor) : "—",
      usage:
        row.floor == null
          ? "אין מידע מאומת."
          : isSpecial
            ? "משמש להבנת סוג המוצר (לדוגמה קומת קרקע לעומת קומות גג). לא הוגדרה השפעה כספית אוטומטית."
            : "מוצג לצורך השוואה בין דירות. לא הוגדרה השפעה כספית אוטומטית.",
      status: row.floor != null ? "shown_for_comparison" : "no_verified_data",
    },
    {
      label: "כיוון אוויר",
      value: row.orientation ?? "—",
      usage: row.orientation != null ? "מוצג לצורך השוואה בין דירות. לא הוגדרה השפעה כספית אוטומטית." : "אין מידע מאומת.",
      status: row.orientation != null ? "shown_for_comparison" : "no_verified_data",
    },
    {
      label: "חניה",
      value: row.parking != null ? String(row.parking) : "לא ידוע",
      usage: row.parking != null ? "ידוע כעובדה על הדירה. לא הוגדר עבורה כלל כספי מאומת." : "אין מידע מאומת.",
      status: row.parking != null ? "not_monetized" : "no_verified_data",
    },
    {
      label: "מחסן",
      value: row.storage == null ? "לא ידוע" : row.storage ? "יש" : "אין",
      usage: row.storage == null ? "אין מידע מאומת." : "ידוע כעובדה על הדירה. לא הוגדר עבורה כלל כספי מאומת.",
      status: row.storage == null ? "no_verified_data" : "not_monetized",
    },
  ];
}

// Units 36/37 are the two real triplex siblings in this inventory -- the
// only case where a "compare to a similar unit in the project" card is
// both meaningful and backed entirely by existing inventory data (task item
// 11). Deliberately not a general similarity engine: hardcoded to this one
// pair, exactly as the task asks.
const SIBLING_UNIT: Record<string, string> = { "36": "37", "37": "36" };

export function siblingUnitNumber(unitNumber: string): string | null {
  return SIBLING_UNIT[unitNumber] ?? null;
}
