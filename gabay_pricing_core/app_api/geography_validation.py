"""Tier-aware structured geography validator.

Shared, byte-for-byte equivalent logic to frontend/lib/geographyValidation.ts
-- used by the multi-city workspace assembler's own sanity checks, the
backend regression tests, and scripts/audit_market_contexts.py, so all three
surfaces can never quietly disagree about what counts as cross-city
contamination. This is deliberately never a free-text scan over notes/
warnings/provenance strings: only structured geography fields are inspected.

Rule: a `city` mismatch is always a violation. A `submarket` mismatch is a
violation only when the record's own geography tier is CORE (i.e. that
record claims to BE the exact target submarket) -- ADJACENT/BROADER-tier
records may legitimately carry a different submarket, since that is exactly
what those tiers mean (context beyond the exact target submarket).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Every spelling of "this record claims to be the exact target submarket"
# seen across the frozen data: the multi-city package's own "CORE", and
# Petah Tikva's "core_exact_target" competitor-register geography_role.
CORE_TIER_VALUES = {"CORE", "core_exact_target", "tier_1"}


@dataclass(slots=True)
class GeographyViolation:
    record_label: str
    field: str
    expected: str
    actual: str


def validate_geography_records(
    records: list[dict[str, Any]],
    expected_city: str | frozenset[str] | set[str],
    expected_submarket: str | None,
    *,
    city_field: str = "city",
    submarket_field: str = "normalized_submarket",
    tier_field: str = "geography_tier",
) -> list[GeographyViolation]:
    # Petah Tikva's own frozen data carries a known, pre-existing, accepted
    # spelling variance ("פתח תקווה" vs "פתח תקוה", double vs single vav --
    # see petah_tikva_workspace.py's _sold_raw_rows docstring and the
    # frontend's own VALID_PETAH_TIKVA_CITY_SPELLINGS set). Callers may pass
    # a set of acceptable spellings instead of one string so this validator
    # never flags that known quirk as new contamination.
    accepted_cities = expected_city if isinstance(expected_city, (set, frozenset)) else {expected_city}
    expected_city_label = next(iter(sorted(accepted_cities)))

    violations: list[GeographyViolation] = []
    for i, record in enumerate(records):
        label = str(record.get("record_uid") or record.get("record_id") or record.get("listing_id") or record.get("project_id") or i)

        city = record.get(city_field)
        if city is not None and city not in accepted_cities:
            violations.append(GeographyViolation(record_label=label, field=city_field, expected=expected_city_label, actual=str(city)))
            continue  # a city mismatch already disqualifies the record; submarket is moot

        if expected_submarket is None:
            continue
        submarket = record.get(submarket_field)
        tier = record.get(tier_field)
        is_core = tier in CORE_TIER_VALUES
        if is_core and submarket is not None and submarket != expected_submarket:
            violations.append(GeographyViolation(record_label=label, field=submarket_field, expected=expected_submarket, actual=str(submarket)))
    return violations


def find_geography_records(payload: Any) -> list[dict[str, Any]]:
    """Recursively collect every dict in a workspace payload that carries a
    `city` field -- the structured surface validate_geography_records checks
    against. Never inspects string/note content."""

    found: list[dict[str, Any]] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if "city" in node:
                found.append(node)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return found
