// Pure helpers for the "Focused Batch — Integrate New Research Evidence"
// task: reshape the existing canonical enrichment payloads (workspace.
// standard_attribute_enrichment and each special unit's
// first_researcher_context, both already frozen/human-reviewed server-side
// -- see app_api/standard_attribute_enrichment.py and
// app_api/first_researcher_context.py) into exactly what the drawer needs.
// Nothing here reads a research JSON file directly (task item 14) and
// nothing here computes a price or a monetary adjustment.

import { JsonRecord, StandardAttributeEnrichmentFamily } from "./api";

// ---------------------------------------------------------------------------
// Standard 3R/5R matched-floor observations (task items 1-5)
// ---------------------------------------------------------------------------

export interface FloorObservationPoint {
  floor: string | number;
  priceIls: number;
  date: string | null;
}

export interface FloorPairSummary {
  address: string;
  matchBasis: string | null;
  observations: FloorObservationPoint[];
  observedDifferenceIls: number | null;
  qaNote: string | null;
}

function toFloorPairSummary(pair: JsonRecord): FloorPairSummary | null {
  const observations = (pair.observations as JsonRecord[] | undefined) ?? [];
  if (observations.length < 2) return null;
  // Always shown/ordered lowest-floor-first (task items 1/2's own examples:
  // "קומה 2 ... קומה 6", "קומה 1 ... קומה 5") so the difference's sign
  // consistently reads as "higher floor minus lower floor" regardless of
  // which transaction happened first chronologically in the source data.
  const points: FloorObservationPoint[] = [...observations]
    .sort((a, b) => Number(a.floor) - Number(b.floor))
    .map((o) => ({
      floor: o.floor as string | number,
      priceIls: o.price as number,
      date: (o.date as string | null) ?? null,
    }));
  const observedDifferenceIls = points.length === 2 ? points[1].priceIls - points[0].priceIls : null;
  return {
    address: (pair.address as string) ?? "",
    matchBasis: (pair.match_basis as string | null) ?? null,
    observations: points,
    observedDifferenceIls,
    qaNote: (pair.data_quality_flag as string | null) ?? null,
  };
}

export interface FloorEvidenceForFamily {
  primary: FloorPairSummary | null;
  secondary: FloorPairSummary[];
}

// The two strongest, task-designated primary observations -- matched by
// address rather than re-deriving "primary" from a generic quality score,
// since the task itself names these two exact addresses as the lead
// evidence for 3R/5R respectively.
const PRIMARY_ADDRESS_MATCH: Record<"standard_3r" | "standard_5r", string> = {
  standard_3r: "אבינועם ילין",
  standard_5r: "פנקס",
};

export function floorEvidenceForFamily(family: StandardAttributeEnrichmentFamily, familyKey: "standard_3r" | "standard_5r"): FloorEvidenceForFamily {
  const validPairs = family.floor_observations.filter((p) => p.status !== "quarantine" && p.observations != null);
  const summaries = validPairs.map(toFloorPairSummary).filter((s): s is FloorPairSummary => s != null);

  const primaryMatch = PRIMARY_ADDRESS_MATCH[familyKey];
  const primaryIndex = summaries.findIndex((s) => s.address.includes(primaryMatch));
  if (primaryIndex === -1) {
    return { primary: summaries[0] ?? null, secondary: summaries.slice(1) };
  }
  const primary = summaries[primaryIndex];
  const secondary = summaries.filter((_, i) => i !== primaryIndex);
  return { primary, secondary };
}

// ---------------------------------------------------------------------------
// Special-unit supplemental research context (task items 6-13) -- reads
// workspace.special_unit_market_context.units[unit].first_researcher_context,
// already the merged, human-reviewed, non-voting output of app_api.
// first_researcher_context.build_first_researcher_context_for_units.
// ---------------------------------------------------------------------------

function factsOf(record: JsonRecord): JsonRecord {
  return (record.normalized as JsonRecord | undefined) ?? record;
}

export interface TriplexContextCard {
  address: string;
  rooms: number | string | null;
  areaSqm: number | null;
  propertyType: string;
}

// The three addresses the new research pass specifically verified as real
// direct 6-room triplex products (task item 7) -- matched by address rather
// than a generic "is this a good enough triplex_context record" heuristic,
// since older/vaguer first-researcher records for this unit (no address, no
// area) exist in the same pooled list and must not be surfaced here.
const TRIPLEX_CONTEXT_ADDRESSES = ["ארתור רופין", "אוסישקין", "מונטיפיורי"];

export function triplexContextCards(records: JsonRecord[]): TriplexContextCard[] {
  const cards: TriplexContextCard[] = [];
  for (const r of records) {
    if (r.context_type !== "triplex_context") continue;
    const facts = factsOf(r);
    const address = facts.address as string | undefined;
    if (!address || !TRIPLEX_CONTEXT_ADDRESSES.some((a) => address.includes(a))) continue;
    // Arthur Ruppin 8's record carries conflicting archive_states instead of
    // one flat rooms/area pair -- take its first (6R/150m²) state, the one
    // the task's own example names, rather than averaging or guessing.
    const states = facts.archive_states as JsonRecord[] | undefined;
    const rooms = (facts.rooms as number | undefined) ?? (states?.[0]?.rooms as number | undefined) ?? null;
    const areaSqm =
      (facts.advertised_area_m2 as number | undefined) ??
      (facts.built_internal_area_m2 as number | undefined) ??
      (states?.[0]?.advertised_area_m2 as number | undefined) ??
      null;
    cards.push({
      address,
      rooms,
      areaSqm,
      propertyType: (facts.property_type as string | undefined) ?? "טריפלקס",
    });
  }
  return cards;
}

export interface HistoricalDuplexContext {
  address: string;
  rooms: number | null;
  internalAreaSqm: number | null;
  outdoorAreaSqm: number | null;
  propertyType: string;
  reason: string | null;
}

// Task item 12: the older, unlinked 7R/180m² duplex press report -- matched
// by its own evidence_class (set at merge time in merge_third_researcher_
// context_v1.py) rather than by address, so this stays correct if the
// record's exact address text ever changes.
export function historicalDuplexContext(records: JsonRecord[]): HistoricalDuplexContext | null {
  const record = records.find((r) => r.context_type === "duplex_context" && r.evidence_class === "DIRECT_TYPE_SIZE_FALLBACK_REPORTED_ACHIEVED_SALE");
  if (!record) return null;
  const facts = factsOf(record);
  return {
    address: (facts.address as string) ?? "",
    rooms: (facts.rooms as number | null) ?? null,
    internalAreaSqm: (facts.built_internal_area_m2 as number | null) ?? null,
    outdoorAreaSqm: (facts.outdoor_area_m2 as number | null) ?? null,
    propertyType: (facts.property_type as string | undefined) ?? "דופלקס",
    reason: (record.why_relevant as string | null) ?? null,
  };
}

export interface HighConfidenceListingLink {
  address: string;
  taxRecord: { rooms: number | null; areaSqm: number | null; floorConfiguration: string | null; priceIls: number | null };
  linkedListing: {
    balconyAreaSqm: number | null;
    storageAreaSqm: number | null;
    hasParking: boolean | null;
    hasElevator: boolean | null;
    floorConfiguration: string | null;
  };
}

// Task items 10-11: the Mivtza Dekel 14 high-confidence Tax/listing link --
// matched by evidence_class, scoped to duplex_context records that actually
// carry both a tax_* and archive_* field group (the shape this specific
// linkage record uses; see second_researcher_context_v1.duplex_context).
export function highConfidenceListingLink(records: JsonRecord[]): HighConfidenceListingLink | null {
  const record = records.find(
    (r) => r.context_type === "duplex_context" && r.evidence_class === "HIGH_CONFIDENCE_UNIT_LINK" && (r.normalized as JsonRecord | undefined)?.tax_deal_id != null
  );
  if (!record) return null;
  const facts = factsOf(record);
  return {
    address: (facts.address as string) ?? "",
    taxRecord: {
      rooms: (facts.tax_rooms as number | null) ?? null,
      areaSqm: (facts.tax_registered_area_m2 as number | null) ?? null,
      floorConfiguration: (facts.tax_floor_configuration as string | null) ?? null,
      priceIls: (facts.tax_price_ils as number | null) ?? null,
    },
    linkedListing: {
      balconyAreaSqm: (facts.archive_balcony_area_m2 as number | null) ?? null,
      storageAreaSqm: (facts.archive_storage_area_m2 as number | null) ?? null,
      hasParking: (facts.archive_parking_count as number | null) != null ? (facts.archive_parking_count as number) > 0 : (facts.archive_parking as boolean | null),
      hasElevator: (facts.archive_elevator as boolean | null) ?? null,
      floorConfiguration: (facts.archive_floor_configuration as string | null) ?? null,
    },
  };
}
