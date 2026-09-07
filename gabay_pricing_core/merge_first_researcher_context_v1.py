"""One-off merge: adds first_researcher_context_v2 (context/provenance only)
to data/frozen/special_unit_master_data_v1.json from the corrected
first-researcher package in data/research/first_researcher/.

Read-only with respect to every existing key in the master file -- this
script only ADDS a new top-level section. It never touches curated_special_
review.baskets, expanded_market_evidence, or anything the numeric special-
pricing engine (pricing_core/special_market_indication.py) reads.

Ingested (per approved scope):
  - special_gap_research_v2_corrected.json  -> product/context evidence
  - special_tax_linkage_v2_corrected.json   -> QA / failed-linkage records

Explicitly NOT ingested:
  - research_gap_closure_report_v1_corrected.json (reference only)
  - standard_feature_matched_pairs_v1_corrected.json (does not exist in this
    package anyway; superseded by the project's own floor_observations)
  - executive_summary_corrected.pdf

Every record gets relevant_units (parsed from "helps_subject"/address, or a
track-wide default) and numeric_eligibility: false (hard-coded here, never
read from the source) so nothing here can be mistaken for a voting input.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RESEARCH_DIR = ROOT / "data" / "research" / "first_researcher"
MASTER_PATH = ROOT / "data" / "frozen" / "special_unit_master_data_v1.json"

GARDEN_UNITS = ["1", "2", "3"]
TRIPLEX_UNITS = ["36", "37"]


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _units_from_text(text: str, default: list[str]) -> list[str]:
    found = sorted(set(re.findall(r"Apt(\d+)", text)))
    return found if found else default


def _garden_context(gap: dict) -> list[dict]:
    track = gap["track_a_garden_apartments"]
    out = []
    for rec in track["new_evidence"]:
        out.append({
            "id": rec["id"],
            "context_type": "garden_context",
            "relevant_units": _units_from_text(rec["helps_subject"], GARDEN_UNITS),
            "numeric_eligibility": False,
            "source": rec["source"],
            "source_url": rec["url"],
            "retrieved_date": rec["retrieved_date"],
            "listing_date": rec["normalized_fields"].get("date_listed"),
            "property_type": rec["normalized_fields"].get("property_type"),
            "rooms": rec["normalized_fields"].get("rooms"),
            "internal_area_sqm": rec["normalized_fields"].get("internal_area_sqm"),
            "outdoor_area_sqm": rec["normalized_fields"].get("garden_area_sqm"),
            "price_ils": rec["normalized_fields"].get("asking_price_ils"),
            "price_basis": "asking_price",
            "submarket": rec["normalized_fields"].get("submarket"),
            "evidence_class": rec["evidence_class"],
            "why_relevant": rec["helps_subject"],
            "why_not_numeric": rec["does_not_qualify_because"],
        })
    out.append({
        "id": "GARDEN_VERIFIED_SOLD_LINKAGE",
        "context_type": "garden_context",
        "relevant_units": GARDEN_UNITS,
        "numeric_eligibility": False,
        "source": "gap_analysis",
        "note": track["verified_sold_garden_linkage"]["gap_analysis"],
        "status": track["verified_sold_garden_linkage"]["status"],
        "why_not_numeric": "No verified sold-garden Tax linkage found; does not create a new sold-garden lane.",
    })
    return out


def _triplex_context(gap: dict, linkage: dict) -> list[dict]:
    track = gap["track_b_triplex"]
    out = []
    for rec in track["new_evidence"]:
        fields = rec["normalized_fields"]
        note = None
        if rec["id"] == "TRIPLEX_001":
            note = (
                "Source (GP Realty listing + Dirobot Rupin-street Tax cross-check, see LINKAGE_005) provides no "
                "internal/outdoor area breakdown for this Montefiore triplex in any of the three corrected "
                "first-researcher files -- both fields are genuinely null at the source, not merely omitted here."
            )
        out.append({
            "id": rec["id"],
            "context_type": "triplex_context",
            "relevant_units": _units_from_text(rec["helps_subject"], TRIPLEX_UNITS),
            "numeric_eligibility": False,
            "source": rec["source"],
            "source_url": rec["url"],
            "retrieved_date": rec["retrieved_date"],
            "listing_date": fields.get("date_listed"),
            "property_type": fields.get("property_type"),
            "rooms": fields.get("rooms"),
            "internal_area_sqm": fields.get("internal_area_sqm"),
            "outdoor_area_sqm": fields.get("outdoor_area_sqm"),
            "price_ils": fields.get("asking_price_ils"),
            "price_basis": "asking_price",
            "submarket": fields.get("submarket"),
            "evidence_class": rec["evidence_class"],
            "why_relevant": rec["helps_subject"],
            "why_not_numeric": rec["does_not_qualify_because"],
            **({"note": note} if note else {}),
        })
    # LINKAGE_005 (Montefiore street-level Tax cross-check) and LINKAGE_006
    # (HaTishim VeShalosh 3 street-level Tax cross-check) are failed-linkage
    # attempts, not product evidence -- kept in qa_and_linkage instead.
    out.append({
        "id": "TRIPLEX_VERIFIED_SOLD_LINKAGE",
        "context_type": "triplex_context",
        "relevant_units": TRIPLEX_UNITS,
        "numeric_eligibility": False,
        "source": "gap_analysis",
        "note": track["verified_sold_triplex_linkage"]["gap_analysis"],
        "status": track["verified_sold_triplex_linkage"]["status"],
        "why_not_numeric": "No verified sold-triplex Tax linkage found.",
    })
    return out


def _duplex_context(gap: dict) -> list[dict]:
    out = []
    for track_key, default_units in (("track_c_7R_duplex_Apt38", ["38"]), ("track_d_5R_duplex_Apt39", ["39"])):
        track = gap[track_key]
        for rec in track["new_evidence"]:
            if rec["id"] == "DUPLEX5R_002":
                continue  # SOURCE_CONFLICT -- filed under qa_and_linkage instead
            fields = rec["normalized_fields"]
            out.append({
                "id": rec["id"],
                "context_type": "duplex_context",
                "relevant_units": _units_from_text(rec["helps_subject"], default_units),
                "numeric_eligibility": False,
                "source": rec["source"],
                "source_url": rec["url"],
                "retrieved_date": rec["retrieved_date"],
                "listing_date": fields.get("date_listed"),
                "property_type": fields.get("property_type"),
                "rooms": fields.get("rooms"),
                "internal_area_sqm": fields.get("internal_area_sqm"),
                "outdoor_area_sqm": fields.get("outdoor_area_sqm"),
                "price_ils": fields.get("asking_price_ils"),
                "price_basis": "asking_price",
                "submarket": fields.get("submarket"),
                "evidence_class": rec["evidence_class"],
                "why_relevant": rec["helps_subject"],
                "why_not_numeric": rec["does_not_qualify_because"],
            })
        if "verified_sold_duplex_linkage" in track:
            out.append({
                "id": f"{track_key.upper()}_VERIFIED_SOLD_LINKAGE",
                "context_type": "duplex_context",
                "relevant_units": default_units,
                "numeric_eligibility": False,
                "source": "gap_analysis",
                "note": track["verified_sold_duplex_linkage"]["gap_analysis"],
                "status": track["verified_sold_duplex_linkage"]["status"],
                "why_not_numeric": "No verified sold-duplex Tax linkage found.",
            })
    return out


# Rough product-room-count -> which assignment special units a competing
# project's product is contextually relevant to (never used numerically --
# see numeric_eligibility on every emitted record).
PROJECT_UNIT_RELEVANCE = {
    "zeev_branda_22": GARDEN_UNITS + TRIPLEX_UNITS + ["38", "39"],
    "branda_49": GARDEN_UNITS + TRIPLEX_UNITS + ["38", "39"],
    "shabazi_3-5": ["38"],
    "THE_SPOT": ["39"],
    "NAVE_PARK": TRIPLEX_UNITS + ["38", "39"],
    "DeFour": GARDEN_UNITS + TRIPLEX_UNITS + ["38", "39"],
}


def _new_development_updates(gap: dict) -> list[dict]:
    projects = gap["track_f_new_development_exact_models"]["projects"]
    out = []
    for project_key, project in projects.items():
        for unit_key, unit_data in project["special_units"].items():
            out.append({
                "id": f"{project_key}__{unit_key}",
                "context_type": "new_development_updates",
                "relevant_units": PROJECT_UNIT_RELEVANCE.get(project_key, []),
                "numeric_eligibility": False,
                "project": project["address"],
                "developer": project.get("developer"),
                "status": project.get("status"),
                "product": unit_key,
                "rooms": unit_data.get("rooms"),
                "property_type": unit_data.get("type"),
                "internal_area_note": unit_data.get("internal_area"),
                "outdoor_area_note": unit_data.get("garden_area") or unit_data.get("outdoor_area"),
                "price_note": unit_data.get("price"),
                "evidence_class": unit_data.get("evidence_class"),
                "reasoning": unit_data.get("reasoning"),
                "sources": project.get("sources", []),
                "why_not_numeric": (
                    "Range/starting-price or unpublished product-level context only -- never an exact "
                    "unit-specific price tied to a verified model."
                ),
            })
    return out


def _qa_and_linkage(gap: dict, linkage: dict) -> list[dict]:
    out = []
    for rec in linkage["linkage_attempts"]:
        out.append({
            "id": rec["id"],
            "context_type": "qa_and_linkage",
            "relevant_units": _relevant_units_for_linkage(rec["id"]),
            "numeric_eligibility": False,
            "address": rec["address"],
            "listing_data": rec.get("listing_data"),
            "tax_data": rec.get("tax_data"),
            "linkage_result": rec["linkage_result"],
            "confidence": rec.get("confidence"),
            "reasoning": rec.get("reasoning"),
            "action": rec["action"],
        })
    for rec in gap["track_h_data_quality_contradictions"]["quarantined_records"]:
        if rec["id"] == "QUARANTINE_005":
            continue  # outside Petah Tikva entirely -- not relevant to any subject
        out.append({
            "id": rec["id"],
            "context_type": "qa_and_linkage",
            "relevant_units": _relevant_units_for_linkage(rec["id"]),
            "numeric_eligibility": False,
            "address": rec["address"],
            "issue": rec["issue"],
            "listing_source": rec.get("listing_source"),
            "tax_source": rec.get("tax_source"),
            "resolution": rec["resolution"],
            "action": rec["action"],
        })
    # DUPLEX5R_002 (SOURCE_CONFLICT) filed here, not in duplex_context.
    d002 = gap["track_d_5R_duplex_Apt39"]["new_evidence"]
    rec = next(r for r in d002 if r["id"] == "DUPLEX5R_002")
    out.append({
        "id": rec["id"],
        "context_type": "qa_and_linkage",
        "relevant_units": ["39"],
        "numeric_eligibility": False,
        "address": rec["normalized_fields"].get("submarket"),
        "issue": "אחד העם (Lev Hamercaz duplex listing) is NOT the same address as איסר הראל 6 (Dirobot Tax lookup).",
        "listing_source": "Lev Hamercaz -- אחד העם, duplex 5R 115m² ₪2.28M",
        "tax_source": "Dirobot -- איסר הראל 6, 4R 98m² floor 4 ₪3.015M (2025-11-24)",
        "resolution": rec["evidence_class"],
        "action": (
            "Do not use this to invalidate, resolve, or replace the existing canonical איסר הראל 6 transaction "
            "(5R, 163m², ₪5.4M, 2024-06-07) -- that record is preserved unchanged in curated_special_review."
        ),
    })
    return out


_LINKAGE_UNIT_MAP = {
    "LINKAGE_001": ["39"],
    "LINKAGE_002": [],  # מיכל לייב כץ 80 -- not tied to a specific assignment unit
    "LINKAGE_003": TRIPLEX_UNITS,  # תרזה קוגלמן 4 5R finding -- broadened-sold context territory
    "LINKAGE_004": TRIPLEX_UNITS,  # תרזה קוגלמן 4 6R existing conflict
    "LINKAGE_005": TRIPLEX_UNITS,  # מונטיפיורי
    "LINKAGE_006": TRIPLEX_UNITS,  # התשעים ושלוש 3
    "QUARANTINE_001": ["39"],
    "QUARANTINE_002": [],
    "QUARANTINE_003": TRIPLEX_UNITS,
    "QUARANTINE_004": TRIPLEX_UNITS,
}


def _relevant_units_for_linkage(record_id: str) -> list[str]:
    return _LINKAGE_UNIT_MAP.get(record_id, [])


def main() -> None:
    gap = _load(RESEARCH_DIR / "special_gap_research_v2_corrected.json")
    linkage = _load(RESEARCH_DIR / "special_tax_linkage_v2_corrected.json")
    master = _load(MASTER_PATH)

    section = {
        "source_bundle": "first_researcher_corrected_2026-09-07",
        "source_files": [
            "data/research/first_researcher/special_gap_research_v2_corrected.json",
            "data/research/first_researcher/special_tax_linkage_v2_corrected.json",
        ],
        "excluded_source_files": {
            "research_gap_closure_report_v1_corrected.json": "reference only -- never ingested as pricing data",
            "standard_feature_matched_pairs_v1_corrected.json": (
                "not integrated -- superseded by this project's own floor_observations, which already contains "
                "valid observational floor comparisons (אבינועם ילין 6, פנקס 5); the matched-pair file incorrectly "
                "reports zero floor pairs"
            ),
            "executive_summary_corrected.pdf": "not integrated",
        },
        "numeric_eligibility_default": False,
        "usage_rule": (
            "Context/provenance only. No record in this section may be read by pricing_core.special_market_"
            "indication or app_api.special_market_indication_data's voting-lane builders. Every record's "
            "numeric_eligibility is hard-coded false regardless of source evidence_class."
        ),
        "garden_context": _garden_context(gap),
        "triplex_context": _triplex_context(gap, linkage),
        "duplex_context": _duplex_context(gap),
        "new_development_updates": _new_development_updates(gap),
        "qa_and_linkage": _qa_and_linkage(gap, linkage),
    }

    master["first_researcher_context_v2"] = section
    MASTER_PATH.write_text(json.dumps(master, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("Merged. Counts:")
    for key in ("garden_context", "triplex_context", "duplex_context", "new_development_updates", "qa_and_linkage"):
        print(f"  {key}: {len(section[key])}")


if __name__ == "__main__":
    main()
