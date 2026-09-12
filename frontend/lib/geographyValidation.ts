// Tier-aware structured geography validator -- byte-for-byte equivalent
// logic to gabay_pricing_core/app_api/geography_validation.py, so the
// frontend guard, the backend tests, and scripts/audit_market_contexts.py
// can never quietly disagree about what counts as cross-city contamination.
// Deliberately never a free-text scan over notes/warnings/provenance
// strings: only structured geography fields are inspected.
//
// Rule: a `city` mismatch is always a violation. A `submarket` mismatch is
// a violation only when the record's own geography tier is CORE (i.e. that
// record claims to BE the exact target submarket) -- ADJACENT/BROADER-tier
// records may legitimately carry a different submarket.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// Every spelling of "this record claims to be the exact target submarket"
// seen across the frozen data: the multi-city package's own "CORE", and
// Petah Tikva's "core_exact_target" competitor-register geography_role.
const CORE_TIER_VALUES = new Set(["CORE", "core_exact_target", "tier_1"]);

export interface GeographyViolation {
  recordLabel: string;
  field: string;
  expected: string;
  actual: string;
}

export function validateGeographyRecords(
  records: AnyRecord[],
  expectedCity: string | Set<string> | string[],
  expectedSubmarket: string | null,
  opts?: { cityField?: string; submarketField?: string; tierField?: string }
): GeographyViolation[] {
  const acceptedCities = expectedCity instanceof Set ? expectedCity : new Set(Array.isArray(expectedCity) ? expectedCity : [expectedCity]);
  const expectedCityLabel = [...acceptedCities].sort()[0];
  const cityField = opts?.cityField ?? "city";
  const submarketField = opts?.submarketField ?? "normalized_submarket";
  const tierField = opts?.tierField ?? "geography_tier";

  const violations: GeographyViolation[] = [];
  records.forEach((record, i) => {
    const label = String(record.record_uid ?? record.record_id ?? record.listing_id ?? record.project_id ?? i);

    const city = record[cityField];
    if (city != null && !acceptedCities.has(city)) {
      violations.push({ recordLabel: label, field: cityField, expected: expectedCityLabel, actual: String(city) });
      return; // a city mismatch already disqualifies the record; submarket is moot
    }

    if (expectedSubmarket == null) return;
    const submarket = record[submarketField];
    const tier = record[tierField];
    const isCore = CORE_TIER_VALUES.has(tier);
    if (isCore && submarket != null && submarket !== expectedSubmarket) {
      violations.push({ recordLabel: label, field: submarketField, expected: expectedSubmarket, actual: String(submarket) });
    }
  });
  return violations;
}

/** Recursively collects every object in a workspace payload that carries a
 * `city` field -- the structured surface validateGeographyRecords checks
 * against. Never inspects string/note content. */
export function findGeographyRecords(payload: unknown): AnyRecord[] {
  const found: AnyRecord[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === "object") {
      const record = node as AnyRecord;
      if ("city" in record) found.push(record);
      Object.values(record).forEach(walk);
    }
  };
  walk(payload);
  return found;
}
