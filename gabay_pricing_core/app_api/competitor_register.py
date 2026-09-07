"""Petah Tikva competitor-register presentation layer.

Loads the frozen competitor-register seed (data/frozen/petah_tikva_competitor_
register_seed_v2.json) and exposes it, normalized, for the workspace payload's
decision-support UI ("competitor_landscape"). This module never touches
pricing_core, the market-range engine, or any frozen evidence/price-list
artifact -- it only reshapes the seed file for display and derives read-only
counts from the *existing* frozen market-range contributor counts.

Conceptual split (see the seed's own "usage_rules"):
  - Every project in the register may appear in the competitive-landscape UI.
  - Only a project that already independently satisfies the unmodified
    market-range engine's strict rules may affect the numerical
    new_development lane. That set is NOT decided here -- it is read as-is
    from the already-frozen petah_tikva_standard_market_ranges_v1.json
    contributor counts, so this module can never inflate or shrink it.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

DisplayClassification = Literal["direct", "relevant", "context"]

REGISTER_SEED_FILENAME = "petah_tikva_competitor_register_seed_v2.json"

# Cross-cutting relevance tags that count as "duplex/premium" for the
# item-20-style rollup counts -- read from each project's own "relevance"
# array, never inferred from product_types or notes.
_DUPLEX_OR_PREMIUM_RELEVANCE_TAGS = frozenset({"duplex", "penthouse", "large_premium"})


def classify_project(project: dict[str, Any]) -> DisplayClassification:
    """Deterministic 3-tier UI classification from fields the seed already
    carries -- geography_role, relevance, quantitative_eligibility. No
    weighted score, no inferred fields.

    direct     -- exact target geography AND already an independent strict
                  quantitative contributor for at least one family (the
                  engine's own eligibility verdict, not re-derived here).
    relevant   -- adjacent geography, OR exact target geography that is not
                  (yet) an exact price+area quantitative contributor
                  (starting price / project-level range only).
    context    -- broader Petah Tikva geography: useful mainly for product
                  breadth (gardens/duplex/penthouse/large units) and
                  commercial-term context, not exact-target comparison.
    """

    geography_role = project.get("geography_role")
    eligibility = project.get("quantitative_eligibility") or {}
    is_any_family_eligible = any(bool((v or {}).get("eligible")) for v in eligibility.values())

    if geography_role == "core_exact_target" and is_any_family_eligible:
        return "direct"
    if geography_role == "broader_petah_tikva":
        return "context"
    # adjacent_submarket, or core_exact_target without an exact price+area match.
    return "relevant"


def _load(path: Path) -> Any:
    import json

    return json.loads(path.read_text(encoding="utf-8"))


def _strict_contributor_count(market_ranges_doc: dict, family: str) -> int:
    """The existing, unmodified engine's own new_development contributor
    count for this family -- read straight from the already-frozen market
    ranges artifact. Never recomputed, never derived from the register."""

    return market_ranges_doc["families"][family]["market_range"]["lanes"]["new_development"][
        "primary_contributor_count"
    ]


def build_competitor_landscape(root: Path, market_ranges_doc: dict) -> dict:
    """Build the presentation-only competitor-landscape section of the
    workspace payload. `root` is the gabay_pricing_core directory (same
    convention as the rest of petah_tikva_workspace.py)."""

    seed = _load(root / "data" / "frozen" / REGISTER_SEED_FILENAME)
    projects_raw: list[dict[str, Any]] = seed["projects"]

    normalized_projects = []
    geography_counts: dict[str, int] = {}
    classification_counts: dict[str, int] = {"direct": 0, "relevant": 0, "context": 0}
    relevance_counts = {"standard_3r": 0, "standard_5r": 0, "garden": 0, "duplex_or_premium": 0}

    for project in projects_raw:
        classification = classify_project(project)
        classification_counts[classification] += 1

        geography_role = project.get("geography_role")
        if geography_role:
            geography_counts[geography_role] = geography_counts.get(geography_role, 0) + 1

        relevance = project.get("relevance") or []
        if "standard_3r" in relevance:
            relevance_counts["standard_3r"] += 1
        if "standard_5r" in relevance:
            relevance_counts["standard_5r"] += 1
        if "garden" in relevance:
            relevance_counts["garden"] += 1
        if _DUPLEX_OR_PREMIUM_RELEVANCE_TAGS.intersection(relevance):
            relevance_counts["duplex_or_premium"] += 1

        # Full passthrough of every field the seed provides, plus the
        # computed display classification -- no field is dropped, renamed, or
        # inferred, so "preserve where present / null remains null" holds by
        # construction rather than by an enumerated allowlist.
        normalized_projects.append({**project, "display_classification": classification})

    return {
        "version": seed["schema_version"],
        "market": seed["market"],
        "usage_rules": seed["usage_rules"],
        "project_count": len(projects_raw),
        "classification_counts": classification_counts,
        "geography_counts": geography_counts,
        "relevance_counts": relevance_counts,
        "quantitative_headline": {
            family: {
                "researched_project_count": relevance_counts["standard_3r" if family == "3R" else "standard_5r"],
                "strict_contributor_count": _strict_contributor_count(market_ranges_doc, family),
            }
            for family in ("3R", "5R")
        },
        "projects": normalized_projects,
    }
