// Price-semantics vocabulary shared across every market context (see
// app_api/multi_city_special_market.py's QUANTITATIVE_PRICE_TYPES /
// NON_QUANTITATIVE_PRICE_TYPES -- this is the frontend mirror of that exact
// split, so both layers can never disagree about which price types are
// quantitative). A price-tagged record's `price_type` field should always
// be rendered through PRICE_TYPE_LABELS rather than shown raw.

export type PriceType =
  | "VERIFIED_UNIT_PRICE"
  | "DEVELOPER_UNIT_OFFER"
  | "CURRENT_ASKING"
  | "STARTING_PRICE"
  | "HISTORICAL_MARKETING_PRICE"
  | "CONTEXT_ONLY";

export const PRICE_TYPE_LABELS: Record<PriceType, string> = {
  VERIFIED_UNIT_PRICE: "מחיר יחידה מאומת",
  DEVELOPER_UNIT_OFFER: "הצעת יזם ליחידה",
  CURRENT_ASKING: "מחיר מבוקש כיום",
  STARTING_PRICE: "מחיר החל מ־",
  HISTORICAL_MARKETING_PRICE: "מחיר שיווק היסטורי",
  CONTEXT_ONLY: "מידע הקשר בלבד",
};

// Only these three price types may ever be treated as a quantitative unit-
// price/area contributor. STARTING_PRICE and CONTEXT_ONLY are explicitly
// never quantitative (task rule); HISTORICAL_MARKETING_PRICE joins them --
// an archived/historical marketing price is evidence, never a current
// quantitative price/area contributor either.
const QUANTITATIVE_PRICE_TYPES = new Set<PriceType>(["VERIFIED_UNIT_PRICE", "DEVELOPER_UNIT_OFFER", "CURRENT_ASKING"]);

export function isQuantitativePriceType(priceType: string | null | undefined): boolean {
  return !!priceType && QUANTITATIVE_PRICE_TYPES.has(priceType as PriceType);
}

export function priceTypeLabel(priceType: string | null | undefined): string | null {
  if (!priceType) return null;
  return PRICE_TYPE_LABELS[priceType as PriceType] ?? priceType;
}

// Historical/archived records must be visibly labeled as such, and never
// rendered inside an "active listings" list (task rule for Yiftach 4-style
// archived marketing evidence).
export function isHistoricalPriceType(priceType: string | null | undefined): boolean {
  return priceType === "HISTORICAL_MARKETING_PRICE";
}
