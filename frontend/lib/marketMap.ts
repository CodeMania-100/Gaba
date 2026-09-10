// Pure derivation of the market map's view model -- MarketGeoMap.tsx only
// renders what this file produces, no business logic in JSX. Every point
// here is either (a) a real, already-collected coordinate (current-asking
// listings, which already carry lat/lng), or (b) joined against the frozen,
// one-time geocoding pass (gabay_pricing_core/build_map_geocodes_v1.py,
// exposed as workspace.market_map_geocodes) by a stable record_id/address --
// never geocoded here, never invented. Records with no resolved coordinate
// are simply omitted, never guessed. "Contributes to pricing" flags reuse
// already-computed engine/eligibility fields (evidence-lane primary
// contributors, sold quality_status, competitor quantitative_eligibility) --
// no eligibility rule is invented in this module.

import { CompetitorRegisterProject, JsonRecord, PetahTikvaWorkspace } from "./api";
import { buildFactSheet, CompetitorFactSheet } from "./competitorIntelligence";
import { ils } from "./format";

export type MarketMapKind = "asking" | "sold" | "competitor" | "project_area";
export type MarketMapFamily = "3R" | "5R";
export type CoordinatePrecision = "address" | "street" | "approximate";

export interface MarketMapPoint {
  id: string;
  kind: MarketMapKind;
  lat: number;
  lng: number;
  title: string;
  address?: string;
  family?: MarketMapFamily;
  rooms?: number;

  priceIls?: number;
  pricePerSqm?: number;
  priceBasis?: "sold" | "asking" | "starting_price" | "unit_price";

  internalArea?: number;
  outdoorArea?: number;
  floor?: string | number;
  date?: string;

  geographyRole?: "core" | "adjacent" | "context";
  classification?: "direct" | "relevant" | "context";
  contributesToPricing: boolean;
  coordinatePrecision: CoordinatePrecision;

  // asking-listing extras (only known facts are ever set)
  hasBalcony?: boolean;
  hasElevator?: boolean;
  hasSecureRoom?: boolean;
  parkingCount?: number;
  condition?: string;
  sourceUrl?: string;

  // sold-transaction extras -- multiple transactions at the same
  // address/family are grouped into one point rather than jittered.
  transactionCount?: number;
  transactions?: { priceIls: number; pricePerSqm: number; area: number; date: string }[];

  // asking-listing extra: why a non-contributing listing was excluded from
  // the pricing evidence pool (real backend exclusion_reasons, never
  // invented) -- shown only for honesty, never affects any calculation.
  exclusionReason?: string;

  // competitor extras
  fact?: CompetitorFactSheet;
  // Short, presentation-ready notable-facts bullets and relevance tags,
  // derived straight from the competitor register's own fields (room_range,
  // product_types, storage/parking/mamad, project_price_from_ils,
  // relevance[]) -- see deriveCompetitorHighlights/deriveCompetitorRelevanceTags.
  // Never inferred or compared against our own project's attributes, since
  // no per-unit product taxonomy exists on our side to compare against.
  highlights?: string[];
  relevanceTags?: string[];
}

// ---------------------------------------------------------------------------
// Project-area reference point -- the centroid of the real, already-
// collected asking-listing coordinates (the tight comparison submarket),
// never presented as the exact subject address (see task item 4).
// ---------------------------------------------------------------------------

export function deriveProjectAreaPoint(askingPoints: MarketMapPoint[]): MarketMapPoint | null {
  if (askingPoints.length === 0) return null;
  const lat = askingPoints.reduce((s, p) => s + p.lat, 0) / askingPoints.length;
  const lng = askingPoints.reduce((s, p) => s + p.lng, 0) / askingPoints.length;
  return {
    id: "project_area",
    kind: "project_area",
    lat,
    lng,
    title: "אזור הפרויקט – המרכז השקט / מרכז העיר",
    contributesToPricing: true,
    coordinatePrecision: "approximate",
  };
}

// ---------------------------------------------------------------------------
// Current-asking listings -- already carry real coordinates.
// ---------------------------------------------------------------------------

const EXCLUSION_REASON_LABELS: Record<string, string> = {
  outside_target_area_band: "מחוץ לרצועת המחיר הממוקדת",
  outside_target_commercial_area: "מחוץ לאזור המסחרי הממוקד",
};

function pushAskingPoint(points: MarketMapPoint[], r: JsonRecord, fam: MarketMapFamily, contributes: boolean, exclusionReasons?: string[]) {
  if (r.latitude == null || r.longitude == null) return;
  const listingId = String(r.listing_id ?? "");
  points.push({
    id: `asking:${listingId}`,
    kind: "asking",
    lat: r.latitude as number,
    lng: r.longitude as number,
    title: "דירה מוצעת למכירה",
    address: (r.address as string | null) ?? undefined,
    family: fam,
    rooms: (r.rooms as number | null) ?? undefined,
    priceIls: (r.asking_price as number | null) ?? undefined,
    pricePerSqm: (r.asking_ppsm as number | null) ?? undefined,
    priceBasis: "asking",
    internalArea: (r.area as number | null) ?? undefined,
    floor: (r.floor as string | null) ?? undefined,
    date: (r.first_seen as string | null) ?? undefined,
    contributesToPricing: contributes,
    // Scraped listing coordinates are already address-resolved (not a
    // geocoded street centroid), so "address" precision is accurate.
    coordinatePrecision: "address",
    hasBalcony: typeof r.has_balcony === "boolean" ? r.has_balcony : undefined,
    hasElevator: typeof r.has_elevator === "boolean" ? r.has_elevator : undefined,
    hasSecureRoom: typeof r.has_secure_room === "boolean" ? r.has_secure_room : undefined,
    parkingCount: typeof r.parking === "number" ? r.parking : undefined,
    condition: (r.condition as string | null) ?? undefined,
    sourceUrl: (r.url as string | null) ?? undefined,
    exclusionReason: exclusionReasons?.length ? (EXCLUSION_REASON_LABELS[exclusionReasons[0]] ?? exclusionReasons[0]) : undefined,
  });
}

export function deriveAskingPoints(workspace: PetahTikvaWorkspace): MarketMapPoint[] {
  const points: MarketMapPoint[] = [];
  for (const fam of ["3R", "5R"] as const) {
    const family = workspace.families.find((f) => f.family === fam);
    const lane = family?.evidence_lanes.current_asking;
    const contributorIds = new Set<string>((lane?.primary_contributors ?? []).flatMap((c: JsonRecord) => (c.source_ids as string[]) ?? []));
    const laneData = workspace.evidence_provenance.current_asking[fam];
    const accepted = (laneData?.accepted_records as JsonRecord[] | undefined) ?? [];
    for (const r of accepted) {
      pushAskingPoint(points, r, fam, contributorIds.has(String(r.listing_id ?? "")));
    }
    // Listings collected but excluded purely for being outside the tight
    // comparison submarket (never a data-quality rejection) -- real,
    // already-collected records shown as non-contributing market context so
    // "כל נתוני השוק" vs "רק ראיות שנכנסו לחישוב" has something to show for
    // the asking layer too (see task item 33: the evidence-only toggle
    // should visibly demonstrate what evidence-based filtering excludes).
    const rejected = (laneData?.rejected_records as JsonRecord[] | undefined) ?? [];
    for (const r of rejected) {
      pushAskingPoint(points, r, fam, false, r.exclusion_reasons as string[] | undefined);
    }
  }
  return points;
}

// ---------------------------------------------------------------------------
// Sold transactions -- joined against the frozen geocode file by address;
// multiple transactions at the same address+family are grouped into one
// point (never jittered) with a transactions[] list the detail panel can
// list individually.
// ---------------------------------------------------------------------------

export function deriveSoldPoints(workspace: PetahTikvaWorkspace): MarketMapPoint[] {
  const geocodes = workspace.market_map_geocodes?.sold.resolved ?? [];
  const geoByAddress = new Map(geocodes.map((g) => [g.address, g]));

  const byKey = new Map<string, { family: MarketMapFamily; address: string; records: JsonRecord[] }>();
  for (const fam of ["3R", "5R"] as const) {
    const records = (workspace.evidence_provenance.sold[fam]?.records as JsonRecord[] | undefined) ?? [];
    for (const r of records) {
      // quality_status "usable" is the same gate the pricing engine itself
      // uses to let a transaction numerically participate -- reused as-is.
      if (r.quality_status !== "usable") continue;
      const address = r.address as string | undefined;
      if (!address) continue;
      const key = `${fam}|${address}`;
      if (!byKey.has(key)) byKey.set(key, { family: fam, address, records: [] });
      byKey.get(key)!.records.push(r);
    }
  }

  const points: MarketMapPoint[] = [];
  for (const { family, address, records } of byKey.values()) {
    const geo = geoByAddress.get(address);
    if (!geo) continue; // unresolved address -- omitted, never guessed
    const sorted = [...records].sort((a, b) => String(b.event_date ?? "").localeCompare(String(a.event_date ?? "")));
    const latest = sorted[0];
    points.push({
      id: `sold:${family}:${address}`,
      kind: "sold",
      lat: geo.lat,
      lng: geo.lng,
      title: "עסקה שבוצעה",
      address,
      family,
      priceIls: latest.price as number,
      pricePerSqm: latest.price_per_sqm as number,
      priceBasis: "sold",
      internalArea: latest.area as number,
      date: latest.event_date as string,
      contributesToPricing: true,
      coordinatePrecision: geo.precision,
      transactionCount: records.length,
      transactions: sorted.map((r) => ({
        priceIls: r.price as number,
        pricePerSqm: r.price_per_sqm as number,
        area: r.area as number,
        date: r.event_date as string,
      })),
    });
  }
  return points;
}

export interface SoldMapCoverage {
  usableTransactionsTotal: number;
  uniqueAddressesTotal: number;
  uniqueAddressesResolved: number;
}

export function deriveSoldMapCoverage(workspace: PetahTikvaWorkspace): SoldMapCoverage | null {
  const c = workspace.market_map_geocodes?.sold_evidence_coverage;
  if (!c) return null;
  return {
    usableTransactionsTotal: c.usable_transactions_total,
    uniqueAddressesTotal: c.unique_addresses_total,
    uniqueAddressesResolved: c.unique_addresses_resolved,
  };
}

export interface SoldFamilyCoverage {
  // Every usable (quality_status === "usable") transaction for this family
  // -- the same set the pricing engine itself treats as real evidence,
  // regardless of whether its address happened to geocode.
  includedTotal: number;
  // How many of those usable transactions are actually shown as map dots
  // (sum of transactionCount across this family's mapped sold points) --
  // always <= includedTotal, the gap being addresses the one-time geocoding
  // pass couldn't resolve.
  mappedTotal: number;
}

export function deriveSoldFamilyCoverage(workspace: PetahTikvaWorkspace, family: MarketMapFamily, soldPointsForFamily: MarketMapPoint[]): SoldFamilyCoverage {
  const records = (workspace.evidence_provenance.sold[family]?.records as JsonRecord[] | undefined) ?? [];
  const includedTotal = records.filter((r) => r.quality_status === "usable").length;
  const mappedTotal = soldPointsForFamily.reduce((s, p) => s + (p.transactionCount ?? 1), 0);
  return { includedTotal, mappedTotal };
}

// ---------------------------------------------------------------------------
// Competitor projects -- joined against the frozen geocode file by
// record_id; facts reuse buildFactSheet exactly as the competitive-
// intelligence section already does (no duplicated derivation).
// ---------------------------------------------------------------------------

const GEOGRAPHY_ROLE_MAP: Record<string, "core" | "adjacent" | "context"> = {
  core_exact_target: "core",
  adjacent_submarket: "adjacent",
  broader_petah_tikva: "context",
};

// Only the product types that actually distinguish a competitor from a
// plain standard apartment are worth a bullet -- "standard_apartment" itself
// never is.
const PRODUCT_TYPE_LABELS: Record<string, string> = {
  garden_apartment: "דירת גן",
  roof_duplex: "דופלקס גג",
  penthouse_roof: "פנטהאוז גג",
  duplex: "דופלקס",
  penthouse: "פנטהאוז",
};

const RELEVANCE_TAG_LABELS: Record<string, string> = {
  standard_3r: "רלוונטי למשפחת 3 חדרים",
  standard_5r: "רלוונטי למשפחת 5 חדרים",
  garden: "מוצר גן",
  duplex: "דופלקס",
  large_premium: "יחידות פרימיום גדולות",
  penthouse: "פנטהאוז",
};

function formatRoomRange(range: unknown): string | null {
  if (!Array.isArray(range) || range.length !== 2) return null;
  const [lo, hi] = range as [number, number];
  if (lo == null || hi == null) return null;
  return lo === hi ? `${lo} חדרים` : `${lo}–${hi} חדרים`;
}

// A project-level field is only claimed "for every apartment" when the
// register's own free-text value says so -- otherwise we show the fact
// (storage/parking exists) without overclaiming universal coverage.
function isPerUnit(value?: string): boolean {
  return value != null && /every (apartment|unit)/i.test(value);
}

/** Short, notable-facts bullets for a competitor's detail card ("מה בולט
 * מול הפרויקט שלנו?") -- every bullet reads directly off the competitor
 * register's own fields, nothing compared or invented (task: "use existing
 * metadata only"). */
export function deriveCompetitorHighlights(project: CompetitorRegisterProject): string[] {
  const bullets: string[] = [];

  const roomRange = formatRoomRange(project.room_range);
  if (roomRange) bullets.push(roomRange);

  const productTypes = ((project.product_types as string[] | undefined) ?? [])
    .map((t) => PRODUCT_TYPE_LABELS[t])
    .filter((v, i, arr): v is string => v != null && arr.indexOf(v) === i);
  if (productTypes.length) bullets.push(productTypes.join(" / "));

  const storage = project.storage as { value?: string } | null | undefined;
  if (storage?.value) bullets.push(isPerUnit(storage.value) ? "מחסן פרטי לכל דירה" : "מחסן פרטי");

  const parking = project.parking as { value?: string } | null | undefined;
  if (parking?.value) bullets.push(isPerUnit(parking.value) ? "חניה לכל דירה" : "חניה");

  if (project.mamad === true) bullets.push("ממ״ד");

  if (typeof project.project_price_from_ils === "number") {
    bullets.push(`מחיר התחלתי ${ils(project.project_price_from_ils)}`);
  }

  return bullets;
}

/** Translated relevance tags (register's own relevance[] classification
 * codes) -- shown alongside the existing geography-role reasoning to answer
 * "why is this relevant" a bit more concretely than submarket proximity
 * alone, still without inventing any new comparison. */
export function deriveCompetitorRelevanceTags(project: CompetitorRegisterProject): string[] {
  return ((project.relevance as string[] | undefined) ?? [])
    .map((tag) => RELEVANCE_TAG_LABELS[tag])
    .filter((v, i, arr): v is string => v != null && arr.indexOf(v) === i);
}

export function deriveCompetitorPoints(workspace: PetahTikvaWorkspace): MarketMapPoint[] {
  const geocodes = workspace.market_map_geocodes?.competitors.resolved ?? [];
  const geoByName = new Map(geocodes.map((g) => [g.record_id.replace(/^competitor:/, ""), g]));

  const points: MarketMapPoint[] = [];
  for (const p of workspace.competitor_landscape.projects) {
    const geo = geoByName.get(p.project_name);
    if (!geo) continue;
    const fact = buildFactSheet(workspace, p.project_name, p.project_name);
    const eligibility = p.quantitative_eligibility as Record<string, { eligible: boolean }> | undefined;
    const eligible3R = eligibility?.standard_3r?.eligible ?? false;
    const eligible5R = eligibility?.standard_5r?.eligible ?? false;
    points.push({
      id: geo.record_id,
      kind: "competitor",
      lat: geo.lat,
      lng: geo.lng,
      title: p.project_name,
      address: (p.address as string | null) ?? undefined,
      priceIls: fact.currentPriceIls ?? undefined,
      priceBasis: fact.isStartingPriceOnly ? "starting_price" : "unit_price",
      geographyRole: GEOGRAPHY_ROLE_MAP[p.geography_role] ?? "context",
      classification: p.display_classification,
      // "Contributes to pricing" for a competitor project means it's an
      // eligible quantitative contributor for *some* family -- the map's
      // family filter narrows this further per-family (see
      // marketMapPointContributes).
      contributesToPricing: eligible3R || eligible5R,
      coordinatePrecision: geo.precision,
      fact,
      highlights: deriveCompetitorHighlights(p),
      relevanceTags: deriveCompetitorRelevanceTags(p),
    });
  }
  return points;
}

/** Whether a point should count as "contributed to pricing" for the
 * currently-selected family -- reuses the same per-family eligibility flags
 * already computed on the workspace (competitor quantitative_eligibility),
 * never a new rule. For asking/sold points, contributesToPricing is already
 * family-specific (see above); for competitors it's re-checked per family. */
export function pointContributesForFamily(point: MarketMapPoint, workspace: PetahTikvaWorkspace, family: MarketMapFamily): boolean {
  if (point.kind !== "competitor") return point.contributesToPricing;
  const project = workspace.competitor_landscape.projects.find((p) => p.project_name === point.title);
  const eligibility = project?.quantitative_eligibility as Record<string, { eligible: boolean }> | undefined;
  const key = family === "3R" ? "standard_3r" : "standard_5r";
  return eligibility?.[key]?.eligible ?? false;
}
