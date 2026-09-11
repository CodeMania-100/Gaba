"""Third-researcher supplemental context merge (2026-09-11 rebuilt package,
see task "Focused Batch — Integrate New Research Evidence Into Existing
Petah Tikva UI").

Source files read (reference only, human-reviewed by this script's author,
never parsed by the frontend directly -- see item 14):
  data/research/first_researcher/research_gap_closure_report_v1(2).json
  data/research/first_researcher/special_gap_research_v2(2).json
  data/research/first_researcher/special_tax_linkage_v2(2).json
  data/research/first_researcher/standard_feature_matched_pairs_v1(2).json

Same architecture as merge_first_researcher_context_v1.py / merge_second_
researcher_context_v1.py: one more context/provenance-only layer appended to
special_unit_master_data_v1.json under its own section key, read by
app_api/first_researcher_context.py alongside the two existing sections.
Nothing here is numeric-pricing input -- see that module's isolation
invariant.

Scope of this pass: the standard 3R/5R matched-floor observations (Avinoam
Yellin 6, Pinkas 5, Baal Shem Tov 2, Zeev Branda 40) and the Apt36/37
triplex-context records (Ossishkin 22, Arthur Ruppin 8, Montefiore 14) and
the Apt39 Mivtza Dekel 14 high-confidence link were independently re-
verified by this research pass and found to match the already-merged
second_researcher_context_v1 records exactly (same deal_id/date/floor/price
values) -- they are NOT duplicated here as separate display cards, matching
the standard_feature_provenance "corroboration only" precedent already
established by merge_second_researcher_context_v1.py. The one genuinely new
record this pass adds is the older, unlinked Apt38 7R/180m² duplex press
report, which did not exist in any prior researcher package.

Run with: python merge_third_researcher_context_v1.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MASTER_PATH = ROOT / "data" / "frozen" / "special_unit_master_data_v1.json"
RESEARCH_DIR = ROOT / "data" / "research" / "first_researcher"


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    gap_closure = _load(RESEARCH_DIR / "research_gap_closure_report_v1(2).json")
    master = _load(MASTER_PATH)

    if "second_researcher_context_v1" not in master:
        raise RuntimeError("second_researcher_context_v1 missing -- run the second-researcher merge before this one")

    master["third_researcher_context_v1"] = {
        "source_bundle": "third_researcher_" + gap_closure["metadata"]["retrieved_at"],
        "source_files": [
            "data/research/first_researcher/research_gap_closure_report_v1(2).json",
            "data/research/first_researcher/special_gap_research_v2(2).json",
            "data/research/first_researcher/special_tax_linkage_v2(2).json",
            "data/research/first_researcher/standard_feature_matched_pairs_v1(2).json",
        ],
        "excluded_source_files": {
            "research_gap_closure_report_v1(2).json": "reference/summary only -- never ingested as pricing data",
        },
        "standard_feature_provenance": {
            "role": (
                "corroboration only -- re-verified deal_id/date/floor/price/subparcel for Avinoam Yellin 6, "
                "Pinkas 5, Baal Shem Tov 2 and Zeev Branda 40 all match the canonical data/frozen/"
                "standard_unit_attribute_enrichment_v1.json exactly; that file remains the runtime/UI source "
                "and these records are not duplicated as separate display cards"
            ),
            "verified_monetary_rule": None,
        },
        "special_typology_provenance": {
            "role": (
                "corroboration only -- the Apt36/37 triplex-context records (Ossishkin 22, Arthur Ruppin 8, "
                "Montefiore 14) and the Apt39 Mivtza Dekel 14 high-confidence Tax/listing link were re-verified "
                "and match the already-merged second_researcher_context_v1 records; not duplicated here"
            ),
        },
        "numeric_eligibility_default": False,
        "usage_rule": (
            "Context/provenance only, same as first_researcher_context_v2 and second_researcher_context_v1. "
            "No record here is read by pricing_core.special_market_indication or any voting-lane builder. "
            "pricing_engine_updated=false (per this pass's own metadata), no causal feature-price rule was "
            "verified, review_required_before_numeric_use=true."
        ),
        "garden_context": [],
        "triplex_context": [],
        "duplex_context": [
            {
                "id": "APT38_URI_KARNI_HISTORICAL_PRESS_FALLBACK",
                "context_type": "duplex_context",
                "relevant_units": ["38"],
                "numeric_eligibility": False,
                "source": "local real-estate press report",
                "source_type": "reported_achieved_sale_press",
                "source_url": "https://www.melabes.co.il/real_estate/79524",
                "retrieved_date": "2026-09-11",
                "normalized": {
                    "address": "אורי קרני, כפר גנים ג, פתח תקווה",
                    "property_type": "duplex",
                    "rooms": 7,
                    "built_internal_area_m2": 180,
                    "outdoor_area_m2": 100,
                    "report_date": "2022-01-30",
                },
                "evidence_class": "DIRECT_TYPE_SIZE_FALLBACK_REPORTED_ACHIEVED_SALE",
                "why_relevant": (
                    "Direct 7R duplex at near-subject internal size (180m² vs Apt38's 170.1m²) with a separately "
                    "reported outdoor/terrace component -- structurally the closest direct-type match found for "
                    "Apt38."
                ),
                "why_not_numeric": (
                    "Old report (2022), not linked to any Tax deal ID/subparcel in this pass -- historical "
                    "context only, not a registered or Tax-linked transaction."
                ),
            }
        ],
        "new_development_updates": [],
        "qa_and_linkage": [],
    }

    MASTER_PATH.write_text(json.dumps(master, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Merged third_researcher_context_v1 into {MASTER_PATH}")
    print("duplex_context records added:", len(master["third_researcher_context_v1"]["duplex_context"]))


if __name__ == "__main__":
    main()
