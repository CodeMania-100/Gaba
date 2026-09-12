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

import { CompetitorRegisterProject, JsonRecord, PetahTikvaWorkspace, SpecialUnitIndication } from "./api";
import { buildFactSheet, CompetitorFactSheet } from "./competitorIntelligence";
import { ils } from "./format";

export type MarketMapKind = "asking" | "sold" | "competitor" | "project_area";
export type MarketMapFamily = "3R" | "5R";
export type CoordinatePrecision = "address" | "street" | "approximate";

// The 7 special (garden/duplex/triplex) apartments -- unit-specific
// comparable baskets, never generic "6-room"/"7-room" families (see task
// "Map Batch -- special apartments" item 1).
export type SpecialUnitNumber = 1 | 2 | 3 | 36 | 37 | 38 | 39;
export const SPECIAL_UNIT_NUMBERS: SpecialUnitNumber[] = [1, 2, 3, 36, 37, 38, 39];

// Replaces the map's old family-only concept. Standard selection behaves
// exactly as before; special selection is a completely separate concept
// (unit-specific basket, not a room-count family) -- see item 1/20.
export type MarketMapSelection =
  | { kind: "standard_family"; family: MarketMapFamily }
  | { kind: "special_unit"; unitNumber: SpecialUnitNumber };

// The three participation states every special-evidence point must
// distinguish (task item 6): actually voted in the suggested price,
// included as size/context info only, or excluded from the comparison
// basket entirely (with the real reason).
export type SpecialParticipation = "participating" | "context_only" | "excluded";

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

  // Free-text context note reused across kinds (special-unit asking's
  // known_features, etc.) -- always a pass-through of an existing backend
  // field, never generated.
  note?: string;

  // Special-unit evidence extras -- only set when this point was derived for
  // a specific special-unit selection (see deriveSpecial*Points below).
  // Standard points never set these; contributesToPricing stays the one
  // source of truth there.
  specialUnitNumber?: SpecialUnitNumber;
  specialStatus?: SpecialParticipation;
  specialStatusReason?: string;
  // The comparable's own tier label (tier_a_direct/tier_b_size_relaxed/
  // tier_c_broadened), straight from pricing_core.special_market_indication
  // -- shown in the "why relevant" panel, never a computed similarity score.
  specialTierLabel?: string;
  // The evidence record's own product-type text, when the source actually
  // states one (only current-asking special records carry this) -- used
  // only for the subject-vs-evidence comparison table's "סוג" row; left
  // unset (rendered as "—") when the source doesn't say, never guessed.
  specialEvidenceType?: string;
}

// ---------------------------------------------------------------------------
// Project-area reference point -- the centroid of the real, already-
// collected asking-listing coordinates (the tight comparison submarket),
// never presented as the exact subject address (see task item 4).
// ---------------------------------------------------------------------------

export function deriveProjectAreaPoint(askingPoints: MarketMapPoint[], areaLabel?: string): MarketMapPoint | null {
  if (askingPoints.length === 0) return null;
  const lat = askingPoints.reduce((s, p) => s + p.lat, 0) / askingPoints.length;
  const lng = askingPoints.reduce((s, p) => s + p.lng, 0) / askingPoints.length;
  return {
    id: "project_area",
    kind: "project_area",
    lat,
    lng,
    // Falls back to the original Petah Tikva-specific label only when the
    // caller has no per-context label to pass (keeps Petah Tikva's own
    // render unchanged); every other market context passes its own
    // commercial_area/official_neighborhood instead (see MarketGeoMap.tsx).
    title: areaLabel ? `אזור הפרויקט – ${areaLabel}` : "אזור הפרויקט – המרכז השקט / מרכז העיר",
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
  // The generic, non-Petah-Tikva-specific equivalent emitted by the three
  // multi-city contexts for the same geography tier (see
  // app_api/multi_city_competitor_register.py) -- same visual "context"
  // tier, different label text (see competitorRegister.ts).
  broader_market: "context",
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
  // The multi-city register's own product_types vocabulary (see
  // special_full_v2/competitor_projects_v2.json) differs slightly from
  // Petah Tikva's -- additive entries, nothing above changes.
  garden: "דירת גן",
  garden_duplex: "דופלקס גן",
  large_apartment: "יחידה גדולה",
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

// ---------------------------------------------------------------------------
// Special units (garden/duplex/triplex) -- unit-specific comparable baskets,
// read entirely from workspace.special_unit_market_context (already the
// finalized, reviewed output of pricing_core.special_market_indication; see
// gabay_pricing_core/app_api/special_unit_context.py and
// special_market_indication_data.py). Nothing here recomputes eligibility,
// a tier, or a price -- every status/reason is a straight read of that
// payload. Coordinates come only from the frozen special_sold/special_asking
// geocode sets (or the standard competitor set) -- never geocoded here.
// ---------------------------------------------------------------------------

export const SPECIAL_UNIT_CATEGORY_LABELS: Record<string, string> = { garden: "דירת גן", duplex: "דופלקס", triplex: "טריפלקס" };

interface StatusEntry {
  status: SpecialParticipation;
  reason?: string;
  tier?: string;
}

/** label -> participation status, built from one lane of an already-computed
 * SpecialUnitIndication. `label` is exactly how pricing_core.
 * special_market_indication constructed it (sold/asking: address (or type as
 * a fallback when address is missing); new_development: "{project} ({price
 * segment})") -- matching against it is a plain lookup, never a re-derivation
 * of the classification itself. */
function buildStatusIndex(
  indication: SpecialUnitIndication | null | undefined,
  lane: "sold" | "current_asking" | "new_development"
): Map<string, StatusEntry> {
  const map = new Map<string, StatusEntry>();
  if (!indication) return map;
  const laneResult = indication.lanes[lane];
  if (laneResult) {
    for (const c of laneResult.comps_used) map.set(c.label, { status: "participating", tier: c.tier });
    for (const c of laneResult.comps_context_only) map.set(c.label, { status: "context_only", tier: c.tier });
  }
  for (const e of indication.excluded) {
    if (e.lane === lane) map.set(e.label, { status: "excluded", reason: e.reason });
  }
  return map;
}

function pricePerSqmOrUndefined(price: number | undefined, area: number | undefined): number | undefined {
  return price != null && area != null && area > 0 ? price / area : undefined;
}

/** Sold-basket evidence for one special unit -- merges the basket's selected
 * (participating/context, per market_indication) and basket-level-rejected
 * records (excluded before ever reaching the indication engine) into one
 * point set. Multiple records at the same address are grouped (never
 * jittered), matching the standard sold-point convention. */
export function deriveSpecialSoldPoints(workspace: PetahTikvaWorkspace, unitNumber: SpecialUnitNumber): MarketMapPoint[] {
  const context = workspace.special_unit_market_context.units[String(unitNumber)];
  if (!context) return [];
  const statusIdx = buildStatusIndex(context.market_indication, "sold");
  const geocodes = workspace.market_map_geocodes?.special_sold?.resolved ?? [];
  const geoByAddress = new Map(geocodes.map((g) => [g.address, g]));

  const byAddress = new Map<string, JsonRecord[]>();
  for (const r of [...context.sold_selected, ...context.sold_rejected]) {
    const addr = r.address as string | undefined;
    if (!addr) continue;
    if (!byAddress.has(addr)) byAddress.set(addr, []);
    byAddress.get(addr)!.push(r);
  }

  const points: MarketMapPoint[] = [];
  for (const [address, records] of byAddress) {
    const geo = geoByAddress.get(address);
    if (!geo) continue; // unresolved -- omitted, never guessed; see coverage helper
    const entry = statusIdx.get(address);
    // Basket-level rejects (context.sold_rejected) never reach build_sold_
    // inputs, so they never appear in statusIdx -- their own `reason` field
    // is the only source of truth for them.
    const basketReason = records.find((r) => typeof r.reason === "string")?.reason as string | undefined;
    const status: SpecialParticipation = entry?.status ?? (basketReason ? "excluded" : "context_only");
    const reason = entry?.reason ?? basketReason;
    const latest = records[0];
    const price = latest.price as number | undefined;
    const area = latest.internal_area as number | undefined;
    points.push({
      id: `special_sold:${unitNumber}:${address}`,
      kind: "sold",
      lat: geo.lat,
      lng: geo.lng,
      title: "עסקה שבוצעה — השוואה ליחידה מיוחדת",
      address,
      priceIls: price,
      pricePerSqm: pricePerSqmOrUndefined(price, area),
      priceBasis: "sold",
      internalArea: area,
      rooms: latest.rooms as number | undefined,
      date: latest.date as string | undefined,
      contributesToPricing: status === "participating",
      coordinatePrecision: geo.precision,
      specialUnitNumber: unitNumber,
      specialStatus: status,
      specialStatusReason: reason,
      specialTierLabel: entry?.tier,
      note: (latest.floor_configuration as string | undefined) ?? undefined,
      transactionCount: records.length,
    });
  }
  return points;
}

/** Current-asking evidence for one special unit -- direct + broadened
 * comparables (already segment-tagged and de-duplicated per unit by
 * build_special_unit_market_context), joined against participation status
 * from the same market_indication used for the suggested price. */
export function deriveSpecialAskingPoints(workspace: PetahTikvaWorkspace, unitNumber: SpecialUnitNumber): MarketMapPoint[] {
  const context = workspace.special_unit_market_context.units[String(unitNumber)];
  if (!context) return [];
  const statusIdx = buildStatusIndex(context.market_indication, "current_asking");
  const geocodes = workspace.market_map_geocodes?.special_asking?.resolved ?? [];
  const geoByAddress = new Map(geocodes.map((g) => [g.address, g]));

  const points: MarketMapPoint[] = [];
  const seen = new Set<string>();
  for (const r of [...context.direct_comparables, ...context.broadened_comparables]) {
    const address = r.address as string | undefined;
    if (!address || seen.has(address)) continue;
    seen.add(address);
    const geo = geoByAddress.get(address);
    if (!geo) continue;
    const entry = statusIdx.get(address) ?? (r.type ? statusIdx.get(r.type as string) : undefined);
    const price = r.price_ils as number | undefined;
    const area = r.area_m2 as number | undefined;
    const status: SpecialParticipation = entry?.status ?? "context_only";
    points.push({
      id: `special_asking:${unitNumber}:${address}`,
      kind: "asking",
      lat: geo.lat,
      lng: geo.lng,
      title: "דירה מוצעת — השוואה ליחידה מיוחדת",
      address,
      priceIls: price,
      pricePerSqm: pricePerSqmOrUndefined(price, area),
      priceBasis: "asking",
      internalArea: area,
      rooms: r.rooms as number | undefined,
      floor: r.floor as string | undefined,
      contributesToPricing: status === "participating",
      coordinatePrecision: geo.precision,
      specialUnitNumber: unitNumber,
      specialStatus: status,
      specialStatusReason: entry?.reason,
      specialTierLabel: entry?.tier,
      specialEvidenceType: (r.type as string | undefined) ?? undefined,
      note: (r.known_features as string | undefined) ?? undefined,
      sourceUrl: (r.source_url as string | undefined) ?? undefined,
    });
  }
  return points;
}

/** New-development/competitor evidence relevant to one special unit --
 * scoped to only the competitors pricing_core.special_market_indication
 * actually considered for this unit's category (via its lanes/excluded
 * lists), never every competitor in the register (task item 3: answer
 * "where is the evidence this unit's indication is based on", not "show
 * every project we happen to have"). A competitor with multiple price
 * segments takes its best-found status (participating > context > excluded)
 * since at least one of its offers is relevant at that level. */
export function deriveSpecialCompetitorPoints(workspace: PetahTikvaWorkspace, unitNumber: SpecialUnitNumber): MarketMapPoint[] {
  const context = workspace.special_unit_market_context.units[String(unitNumber)];
  const indication = context?.market_indication;
  if (!indication) return [];

  const parseProjectName = (label: string) => label.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const rank: Record<SpecialParticipation, number> = { participating: 2, context_only: 1, excluded: 0 };
  const statusByProject = new Map<string, StatusEntry>();
  const consider = (label: string, entry: StatusEntry) => {
    const name = parseProjectName(label);
    const existing = statusByProject.get(name);
    if (!existing || rank[entry.status] > rank[existing.status]) statusByProject.set(name, entry);
  };

  const laneResult = indication.lanes.new_development;
  if (laneResult) {
    for (const c of laneResult.comps_used) consider(c.label, { status: "participating", tier: c.tier });
    for (const c of laneResult.comps_context_only) consider(c.label, { status: "context_only", tier: c.tier });
  }
  for (const e of indication.excluded) {
    if (e.lane === "new_development") consider(e.label, { status: "excluded", reason: e.reason });
  }

  const geocodes = workspace.market_map_geocodes?.competitors.resolved ?? [];
  const geoByName = new Map(geocodes.map((g) => [g.record_id.replace(/^competitor:/, ""), g]));

  const points: MarketMapPoint[] = [];
  for (const [name, entry] of statusByProject) {
    const geo = geoByName.get(name);
    if (!geo) continue;
    const fact = buildFactSheet(workspace, name, name);
    const registerProject = workspace.competitor_landscape.projects.find((p) => p.project_name === name);
    points.push({
      id: geo.record_id,
      kind: "competitor",
      lat: geo.lat,
      lng: geo.lng,
      title: name,
      address: (registerProject?.address as string | null) ?? undefined,
      priceIls: fact.currentPriceIls ?? undefined,
      priceBasis: fact.isStartingPriceOnly ? "starting_price" : "unit_price",
      classification: registerProject?.display_classification,
      contributesToPricing: entry.status === "participating",
      coordinatePrecision: geo.precision,
      specialUnitNumber: unitNumber,
      specialStatus: entry.status,
      specialStatusReason: entry.reason,
      specialTierLabel: entry.tier,
      fact,
      highlights: registerProject ? deriveCompetitorHighlights(registerProject) : undefined,
      relevanceTags: registerProject ? deriveCompetitorRelevanceTags(registerProject) : undefined,
    });
  }
  return points;
}

/** Newly-researched triplex-product context points (task "Focused Batch —
 * Integrate New Research Evidence" item 9) -- archived listings that prove a
 * real 6R triplex product exists at that address, geocoded once (see
 * add_special_typology_context_geocodes_v1.py) and joined here purely by
 * address against this unit's own first_researcher_context (never a new
 * eligibility computation). Always contributesToPricing=false: these never
 * vote, so the map's existing "רק ראיות שנכנסו לחישוב" filter already hides
 * them automatically, leaving them visible only under "כל נתוני השוק". */
export function deriveSpecialTypologyContextPoints(workspace: PetahTikvaWorkspace, unitNumber: SpecialUnitNumber): MarketMapPoint[] {
  const geocodes = workspace.market_map_geocodes?.special_typology_context?.resolved ?? [];
  if (geocodes.length === 0) return [];
  const records = workspace.special_unit_market_context.units[String(unitNumber)]?.first_researcher_context ?? [];

  const points: MarketMapPoint[] = [];
  for (const geo of geocodes) {
    const record = records.find((r) => {
      if (r.context_type !== "triplex_context") return false;
      const address = ((r.normalized as JsonRecord | undefined) ?? r).address as string | undefined;
      return address != null && address.includes(geo.address);
    });
    if (!record) continue;
    const facts = (record.normalized as JsonRecord | undefined) ?? record;
    const states = facts.archive_states as JsonRecord[] | undefined;
    const rooms = (facts.rooms as number | undefined) ?? (states?.[0]?.rooms as number | undefined);
    const internalArea = (facts.advertised_area_m2 as number | undefined) ?? (facts.built_internal_area_m2 as number | undefined) ?? (states?.[0]?.advertised_area_m2 as number | undefined);
    const priceIls = (facts.asking_price_ils as number | undefined) ?? (states?.[0]?.asking_price_ils as number | undefined);
    points.push({
      id: geo.record_id,
      kind: "asking",
      lat: geo.lat,
      lng: geo.lng,
      title: "טריפלקס — הקשר לסוג הנכס",
      address: geo.address,
      rooms,
      internalArea,
      priceIls,
      priceBasis: "asking",
      contributesToPricing: false,
      coordinatePrecision: geo.precision,
      specialUnitNumber: unitNumber,
      specialStatus: "context_only",
      specialStatusReason: "לא השתתף בחישוב",
    });
  }
  return points;
}

export interface SpecialUnitMapCoverage {
  soldMappedCount: number;
  soldTotalCount: number;
  askingMappedCount: number;
  askingTotalCount: number;
}

/** How much of this unit's real evidence basket actually made it onto the
 * map -- never let the map silently look like the full basket when some
 * addresses didn't geocode (task item 15). */
export function deriveSpecialUnitMapCoverage(
  workspace: PetahTikvaWorkspace,
  unitNumber: SpecialUnitNumber,
  soldPoints: MarketMapPoint[],
  askingPoints: MarketMapPoint[]
): SpecialUnitMapCoverage {
  const context = workspace.special_unit_market_context.units[String(unitNumber)];
  const soldTotalCount = new Set([...(context?.sold_selected ?? []), ...(context?.sold_rejected ?? [])].map((r) => r.address).filter(Boolean)).size;
  const askingTotalCount = new Set(
    [...(context?.direct_comparables ?? []), ...(context?.broadened_comparables ?? [])].map((r) => r.address).filter(Boolean)
  ).size;
  return {
    soldMappedCount: soldPoints.length,
    soldTotalCount,
    askingMappedCount: askingPoints.length,
    askingTotalCount,
  };
}

export interface SpecialUnitSubjectFacts {
  unitNumber: SpecialUnitNumber;
  category: string; // "garden" | "duplex" | "triplex"
  categoryLabel: string;
  rooms: number | null;
  internalArea: number | null;
  outdoorArea: number | null;
  outdoorLabel: string; // "שטח חצר" for garden units, "מרפסת" otherwise
  floor: string | number | null;
  orientation: string | null;
}

/** Subject-apartment facts for the compact card shown above the map when a
 * special unit is selected (task item 9) -- read straight from the real
 * price-list row, never re-derived. Only fields that are actually known are
 * populated; the card itself only renders what's non-null. */
export function deriveSpecialUnitSubjectFacts(workspace: PetahTikvaWorkspace, unitNumber: SpecialUnitNumber): SpecialUnitSubjectFacts | null {
  const row = workspace.price_list.find((r) => r.unit_number === String(unitNumber));
  if (!row) return null;
  const context = workspace.special_unit_market_context.units[String(unitNumber)];
  const category = context?.category ?? (row.family === "garden_apartment" ? "garden" : row.family);
  return {
    unitNumber,
    category,
    categoryLabel: SPECIAL_UNIT_CATEGORY_LABELS[category] ?? category,
    rooms: row.rooms ?? null,
    internalArea: row.internal_area_sqm,
    outdoorArea: row.balcony_area_sqm,
    outdoorLabel: category === "garden" ? "שטח חצר" : "מרפסת",
    floor: row.floor,
    orientation: row.orientation,
  };
}

const SPECIAL_UNIT_SHORT_CATEGORY_LABELS: Record<string, string> = { garden: "גן", duplex: "דופלקס", triplex: "טריפלקס" };

/** Dropdown label for the special-unit selector, e.g. "דירה 1 — גן, 3 חד׳". */
export function specialUnitDropdownLabel(workspace: PetahTikvaWorkspace, unitNumber: SpecialUnitNumber): string {
  const facts = deriveSpecialUnitSubjectFacts(workspace, unitNumber);
  if (!facts) return `דירה ${unitNumber}`;
  const shortCategory = SPECIAL_UNIT_SHORT_CATEGORY_LABELS[facts.category] ?? facts.categoryLabel;
  const roomsPart = facts.rooms != null ? `, ${facts.rooms} חד׳` : "";
  return `דירה ${unitNumber} — ${shortCategory}${roomsPart}`;
}
