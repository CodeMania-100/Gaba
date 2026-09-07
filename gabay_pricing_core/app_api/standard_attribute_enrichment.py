"""Standard 3R/5R decision-support attribute enrichment.

Loads data/frozen/standard_unit_attribute_enrichment_v1.json and reshapes it
per family for the workspace payload. This is presentation/decision-support
enrichment only -- it never touches pricing_core, the market-range engine, or
any frozen evidence/price-list artifact, and it never computes a price or a
monetary adjustment from any observation in the file (see the file's own
"methodology_guards").

Authority hierarchy (see task): the enrichment file's own per-competitor
"role" strings (e.g. "strict_quantitative_3r_contributor") are research
metadata written by a separate research pass and are NOT re-validated against
the actual market-range engine -- several of them do not match the real,
already-frozen contributor state (see build_standard_attribute_enrichment's
docstring below for concrete examples). This module never reads "role" for
any classification/eligibility decision; the only classification exposed to
the UI (register_classification) is looked up from the already-validated
competitor_landscape (competitor_register.classify_project), never derived
from this file.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

FAMILY_ROOMS = {"standard_3r": 3, "standard_5r": 5}
ENRICHMENT_FILENAME = "standard_unit_attribute_enrichment_v1.json"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _normalize_key(name: str, address: str | None) -> str:
    """Same normalization for both the competitor register and this
    enrichment file's project names, so "רוטשילד 163-165" (ASCII hyphen, this
    file) and "רוטשילד 163–165" (en dash, the register) resolve to the same
    entity. Strips whitespace/punctuation only -- never guesses an address."""

    def norm(s: str) -> str:
        s = s.replace("–", "-").replace("—", "-")
        s = re.sub(r"[\s\-]+", " ", s).strip().lower()
        return s

    return f"{norm(name)}|{norm(address or '')}"


def _competitor_families(competitor: dict[str, Any]) -> set[str]:
    """Which standard family a competitor's product is relevant to, from its
    own structural unit_variants[].rooms -- never from the free-text "role"
    field, so this never depends on the (sometimes wrong) research labels."""

    rooms_seen = {v.get("rooms") for v in (competitor.get("unit_variants") or [])}
    return {fam for fam, rooms in FAMILY_ROOMS.items() if rooms in rooms_seen}


def _gap_applies_to_family(gap_text: str, family: str) -> bool:
    """A research-gap note applies to a specific family only when it names
    that family's room count explicitly (e.g. "3R subject's"); otherwise it
    is a general methodology note shown for both families."""

    mentions_3r = "3R" in gap_text
    mentions_5r = "5R" in gap_text
    if not mentions_3r and not mentions_5r:
        return True
    return (family == "standard_3r" and mentions_3r) or (family == "standard_5r" and mentions_5r)


def build_standard_attribute_enrichment(root: Path, competitor_landscape: dict[str, Any]) -> dict[str, Any]:
    """Build the standard_attribute_enrichment workspace-payload section.

    Known, real conflicts between this file's own "role" labels and the
    actual frozen market-range contributor state (kept here as documentation,
    not enforced in code -- the frontend never reads "role" for logic):
      - "חנקין 11" and "THE SPOT" are labeled *_contributor in this file, but
        the frozen petah_tikva_standard_competitor_evidence_v1.json scopes
        both to geo_tier 2 (adjacent submarket) and they are NOT among the
        real market_range primary_contributors for either family.
      - "TRIO" and "הבעל שם טוב 61" are labeled strict_quantitative_5r_contributor
        here, but are absent from the real frozen 5R primary_contributors
        (זאב ברנדה 22, רוטשילד 163-165 only).
      - "זאב ברנדה 22" and "רוטשילד 163-165" are the real, frozen contributors
        for at least one family, yet this file's own role labels for them
        say only "*_context"/"high_fidelity_*_product_competitor", not
        "contributor" -- the opposite direction of mislabeling.
    This is exactly why role strings are never used for eligibility here.
    """

    enrichment = _load(root / "data" / "frozen" / ENRICHMENT_FILENAME)

    register_classification_by_key = {
        _normalize_key(p["project_name"], p.get("address")): p["display_classification"]
        for p in competitor_landscape["projects"]
    }

    competitor_families: dict[str, set[str]] = {
        c["project"]: _competitor_families(c) for c in enrichment["new_development_competitors"]
    }

    floor_pairs = enrichment["matched_unit_pairs"]["registered_sale_floor_pairs_observational_only"]
    quarantined = enrichment["matched_unit_pairs"]["quarantined_or_non_clean_floor_groups"]

    families: dict[str, Any] = {}
    for family in ("standard_3r", "standard_5r"):
        new_development_comparables = []
        for competitor in enrichment["new_development_competitors"]:
            if family not in competitor_families.get(competitor["project"], set()):
                continue
            key = _normalize_key(competitor["project"], competitor.get("address"))
            classification = register_classification_by_key.get(key)
            new_development_comparables.append({
                **competitor,
                "register_classification": classification,
                "in_competitor_register": classification is not None,
            })

        matched_observations = {}
        for category, entries in enrichment["matched_attribute_observations"].items():
            relevant = [e for e in entries if family in competitor_families.get(e["project"], set())]
            if relevant:
                matched_observations[category] = relevant

        families[family] = {
            "subject_reference": enrichment["subjects"][family],
            "current_asking_comparables": enrichment["current_asking"].get(family, []),
            "new_development_comparables": new_development_comparables,
            "matched_observations": matched_observations,
            "floor_observations": (
                [p for p in floor_pairs if p["family"] == family]
                + [q for q in quarantined if q["family"] == family]
            ),
            "research_gaps": [g for g in enrichment["research_gaps"] if _gap_applies_to_family(g, family)],
        }

    return {
        "version": enrichment["version"],
        "retrieved_at": enrichment["retrieved_at"],
        "scope": enrichment["scope"],
        "methodology_guards": enrichment["methodology_guards"],
        "existing_standard_universe_context": enrichment["existing_standard_universe_context"],
        "new_development_floor_pair_search": enrichment["matched_unit_pairs"]["new_development_search_result"],
        "families": families,
    }
