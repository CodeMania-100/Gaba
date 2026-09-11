"""Supplemental research context -- first-, second- and third-researcher
packages, merged into one coherent per-unit list (R1/R2: 2026-09-07, R3:
2026-09-11 rebuilt package).

Read-only, context/provenance-only integration on top of the canonical
special_unit_master_data_v1.json's own first_researcher_context_v2,
second_researcher_context_v1 and third_researcher_context_v1 sections
(populated by merge_first_researcher_context_v1.py, merge_second_researcher_
context_v1.py and merge_third_researcher_context_v1.py -- see those
scripts' docstrings for exactly which source files were ingested, which
were deliberately excluded, and the explicit supersession map).

User-facing presentation deliberately does not distinguish "researcher 1"
vs "researcher 2" -- both feed the same "השוואות נוספות והקשר שוק" UI
section as one evidence system. Where a second-researcher record supersedes
a weaker first-researcher record for the same underlying property (tagged
superseded_by on the R1 record at merge time), the R1 record is filtered out
here rather than shown twice; both provenances remain in the frozen file for
audit, only the display list is deduplicated.

Isolation invariant: nothing here is a numeric special-pricing input.
pricing_core/special_market_indication.py never imports this module, and no
record returned here is ever passed into compute_special_unit_indication.
Every record's numeric_eligibility is already hard-coded false at merge
time; this module does not re-derive or trust any eligibility flag from the
source research files.
"""

from __future__ import annotations

from typing import Any

CONTEXT_TRACKS = ("garden_context", "triplex_context", "duplex_context", "new_development_updates", "qa_and_linkage")
CONTEXT_SECTION_KEYS = ("first_researcher_context_v2", "second_researcher_context_v1", "third_researcher_context_v1")


def build_first_researcher_context_for_units(master: dict[str, Any], unit_numbers: list[str]) -> dict[str, list[dict]]:
    """Returns {unit_number: [context records relevant to that unit]},
    pooled from every track across all researcher sections, with any
    superseded record filtered out of the display list (see module
    docstring). Missing sections are simply skipped, so this works unchanged
    if a later merge hasn't run yet."""

    all_records: list[dict] = []
    for section_key in CONTEXT_SECTION_KEYS:
        section = master.get(section_key)
        if not section:
            continue
        for track in CONTEXT_TRACKS:
            all_records.extend(section.get(track, []))

    result: dict[str, list[dict]] = {unit_number: [] for unit_number in unit_numbers}
    for record in all_records:
        if record.get("superseded_by"):
            continue  # a stronger record for the same property is shown instead
        for unit_number in record.get("relevant_units", []):
            if unit_number in result:
                result[unit_number].append(record)
    return result
