"""One-off merge: adds second_researcher_context_v1 (context/provenance
only) to data/frozen/special_unit_master_data_v1.json from the corrected
second-researcher package in data/research/second_researcher/, and enriches
five existing canonical sold-basket records with typology-link/QA metadata
(never touching their price/numeric_status).

Preserves first_researcher_context_v2 -- does not remove or replace it.
Where a second-researcher record supersedes a weaker first-researcher record
for the same underlying property, the R1 record is tagged superseded_by (and
kept, never deleted) and the R2 record is tagged supersedes, so the frontend
can show one coherent card while both provenances remain in the data.

Ingested:
  - special_gap_research_v2.json  -> new_records[] (each already carries
    subject_targets, so unit relevance comes straight from the source,
    not re-derived by keyword matching like the first-researcher merge).
  - special_tax_linkage_v2.json   -> records[] (QA / classification).

Explicitly NOT ingested as new display records:
  - research_gap_closure_report_v1.json (reference only)
  - standard_feature_matched_pairs_v1_second_researcher.json: this IS the
    correct second-researcher standard-feature package (an earlier pass
    mistakenly had a different, unrelated file under the un-suffixed name
    standard_feature_matched_pairs_v1.json, which has since been replaced).
    Its four registered floor-sale pairs (אבינועם ילין 6, פנקס 5, בעל שם-טוב
    2, זאב ברנדה 40) and two attribute-observation projects (רוטשילד
    163-165, השופט ברנדייס 47) are verified byte-identical (deal_id, date,
    floor, price, subparcel) to the pre-existing canonical data/frozen/
    standard_unit_attribute_enrichment_v1.json -- see _verify_floor_pair_
    corroboration() below, which asserts this on every run rather than
    trusting a one-time manual read. Per instruction, canonical enrichment
    stays the runtime/UI source (app/petah-tikva/components/
    FloorAndAttributeContext already reads it) and this file is recorded
    only as corroborating research provenance (second_researcher_context_v1.
    standard_feature_provenance), not duplicated as separate display
    records.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RESEARCH_DIR = ROOT / "data" / "research" / "second_researcher"
MASTER_PATH = ROOT / "data" / "frozen" / "special_unit_master_data_v1.json"


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _units(subject_targets: list[str]) -> list[str]:
    return [t.replace("Apt", "") for t in subject_targets if t.startswith("Apt")]


TRACK_BY_RECORD_PREFIX = [
    ("TRIPLEX_", "triplex_context"),
    ("APT38_", "duplex_context"),
    ("APT39_", "duplex_context"),
    ("NEWDEV_", "new_development_updates"),
]


def _track_for(record_id: str) -> str:
    for prefix, track in TRACK_BY_RECORD_PREFIX:
        if record_id.startswith(prefix):
            return track
    return "qa_and_linkage"


# record_id -> the first-researcher record id it supersedes (same underlying
# property, materially richer/stronger R2 evidence). Both stay in the data;
# the frontend hides the superseded R1 card and shows the R2 one instead.
SUPERSESSION_MAP = {
    "TRIPLEX_MONTEFIORE_14_ARCHIVE": "TRIPLEX_001",
    "TRIPLEX_93_3_ARCHIVE_TAX_CROSSMATCH": "LINKAGE_006",
    "NEWDEV_ZEEV_BRANDA_22_DIRECT_DEVELOPER": "zeev_branda_22__duplex_penthouse_5-6R",
    "NEWDEV_NAVE_PARK": "NAVE_PARK__penthouse_5-6R",
    "NEWDEV_THE_SPOT_5R_UPPER_PRODUCT": "THE_SPOT__duplex_5R",
    "NEWDEV_DEFOUR_SPECIAL_PRODUCTS": "DeFour__penthouse_5-6R",
    "NEWDEV_BRANDA_49": "branda_49__garden_5R",
}


def _build_context_records(gap: dict, linkage: dict) -> dict[str, list[dict]]:
    tracks: dict[str, list[dict]] = {
        "garden_context": [], "triplex_context": [], "duplex_context": [], "new_development_updates": [], "qa_and_linkage": [],
    }

    for rec in gap["new_records"]:
        record_id = rec["record_id"]
        # Garden record has no dedicated prefix -- route by subject.
        targets = _units(rec["subject_targets"])
        if record_id.startswith("TRIPLEX_") or record_id.startswith("APT38_") or record_id.startswith("APT39_") or record_id.startswith("NEWDEV_"):
            track = _track_for(record_id)
        elif any(t in ("1", "2", "3") for t in targets):
            track = "garden_context"
        else:
            track = "qa_and_linkage"

        entry = {
            "id": record_id,
            "context_type": track,
            "relevant_units": targets,
            "numeric_eligibility": False,
            "source": rec["source"],
            "source_type": rec.get("source_type"),
            "source_url": rec.get("source_url"),
            "retrieved_date": rec.get("retrieved_at"),
            "normalized": rec.get("normalized"),
            "evidence_class": rec.get("evidence_class"),
            "why_relevant": rec.get("helps_because"),
            "why_not_numeric": rec.get("does_not_qualify_because"),
        }
        if record_id in SUPERSESSION_MAP:
            entry["supersedes"] = SUPERSESSION_MAP[record_id]
        tracks[track].append(entry)

    # These linkage_attempts entries describe the exact same underlying
    # property as a richer new_records entry above (verified by inspection:
    # same address, same tax_deal_id where applicable) -- skipped here so the
    # UI shows one card per property, not two. The richer new_records version
    # is kept in every case (it always carries at least as much detail).
    DUPLICATE_LINKAGE_PRODUCTS = {
        "התשעים ושלוש 3 triplex archive",  # == TRIPLEX_93_3_ARCHIVE_TAX_CROSSMATCH
        "אהרון כצנלסון 19 7R duplex/penthouse archive",  # == APT38_KATZENELSON_19_TAX_ARCHIVE_LINK
        "מבצע דקל 14 penthouse-duplex archive",  # == APT39_MIVTZA_DEKEL_14_TAX_ARCHIVE_LINK
        "אוסישקין 22 6R triplex archive",  # == TRIPLEX_USSISHKIN_22_ARCHIVE
        "מונטיפיורי 14 6R triplex archive",  # == TRIPLEX_MONTEFIORE_14_ARCHIVE
        "ארתור רופין 8 6R triplex archive",  # == TRIPLEX_ARTHUR_RUPPIN_8_ARCHIVE
        "מינץ בנימין 15 triplex archive",  # == TRIPLEX_MINTZ_15_ARCHIVE
    }

    for rec in linkage["records"]:
        if rec["listing_or_product"] in DUPLICATE_LINKAGE_PRODUCTS:
            continue
        targets = _units(rec["subject_targets"])
        entry = {
            "id": rec["listing_or_product"],
            "context_type": "qa_and_linkage",
            "relevant_units": targets,
            "numeric_eligibility": False,
            "classification": rec["classification"],
            "tax_record": rec.get("tax_record"),
            "listing_record": rec.get("listing_record"),
            "matching_basis": rec.get("matching_basis"),
            "data_quality_conflict": rec.get("data_quality_conflict"),
            "reason": rec.get("reason"),
        }
        tracks["qa_and_linkage"].append(entry)

    return tracks


def _apply_supersession_to_first_researcher(master: dict) -> None:
    frc = master.get("first_researcher_context_v2")
    if not frc:
        return
    reverse = {v: k for k, v in SUPERSESSION_MAP.items()}
    for track in ("garden_context", "triplex_context", "duplex_context", "new_development_updates", "qa_and_linkage"):
        for rec in frc.get(track, []):
            if rec.get("id") in reverse:
                rec["superseded_by"] = reverse[rec["id"]]


def _find_sold_record(master: dict, basket_key: str, deal_id: str) -> dict | None:
    basket = master["curated_special_review"]["baskets"][basket_key]
    for key in ("selected_sold", "selected_broadened_sold"):
        for rec in basket.get(key, []):
            if rec.get("deal_id") == deal_id:
                return rec
    return None


def _enrich_existing_sold_records(master: dict) -> list[str]:
    """Adds typology-link / QA metadata to existing canonical sold records.
    Never touches price, date, rooms, area, or numeric_status on any of
    them."""

    enriched = []

    mivtza_dekel = _find_sold_record(master, "APT39", "3633131484")
    if mivtza_dekel is not None:
        mivtza_dekel["typology_status"] = "high_confidence_duplex_penthouse_link"
        mivtza_dekel["typology_link_class"] = "HIGH_CONFIDENCE_UNIT_LINK"
        mivtza_dekel["typology_link_source"] = "second_researcher_context_v1:APT39_MIVTZA_DEKEL_14_TAX_ARCHIVE_LINK"
        assert mivtza_dekel["numeric_status"] == "usable", "must not touch numeric_status"
        enriched.append("APT39/מבצע דקל 14 (3633131484): typology_status, typology_link_class")

    hatishim = _find_sold_record(master, "APT39", "3655065895")
    if hatishim is not None:
        hatishim["known_typology_context"] = "triplex"
        hatishim["typology_link_confidence"] = "high"
        hatishim["relationship_to_Apt39"] = "type-relaxed multi-level transaction"
        hatishim["typology_link_source"] = "second_researcher_context_v1:TRIPLEX_93_3_ARCHIVE_TAX_CROSSMATCH"
        enriched.append("APT39/התשעים ושלוש 3 (3655065895): known_typology_context, typology_link_confidence, relationship_to_Apt39")

    for basket_key, deal_id in (("APT38", "3606035885"), ("APT39", "3605029846")):
        rec = _find_sold_record(master, basket_key, deal_id)
        if rec is not None:
            rec["property_form_conflict"] = True
            rec["cannot_upgrade_to_verified_duplex"] = True
            rec["typology_link_source"] = "second_researcher_context_v1:qa_and_linkage (כנסת ישראל 17 multi-level candidate)"
            enriched.append(f"{basket_key}/כנסת ישראל 17 ({deal_id}): property_form_conflict")

    isar_harel = _find_sold_record(master, "APT39", "3601967910")
    if isar_harel is not None:
        conflict = isar_harel.setdefault("building_product_context", {}).setdefault("price_conflict", {})
        conflict["market2_floor"] = 9
        conflict["market2_subparcel"] = "6360-188-74"
        conflict["floor_conflict_note"] = "local Tax floor 19+20 vs Market2 floor 9 -- unresolved, kept visible per second-researcher QA"
        assert isar_harel["numeric_status"] == "usable_with_public_mirror_conflict_flag", "must not touch numeric_status"
        enriched.append("APT39/איסר הראל 6 (3601967910): market2_floor conflict detail added")

    return enriched


CANONICAL_ENRICHMENT_PATH = ROOT / "data" / "frozen" / "standard_unit_attribute_enrichment_v1.json"
STANDARD_FEATURE_PROVENANCE_PATH = RESEARCH_DIR / "standard_feature_matched_pairs_v1_second_researcher.json"


def _verify_floor_pair_corroboration() -> dict:
    """Asserts (not just documents) that every floor-observation pair in the
    second-researcher provenance file matches the canonical enrichment
    file's own registered_sale_floor_pairs_observational_only record for the
    same address on every field that both sides carry (deal_id, date, floor,
    price, subparcel). Raises if any pair disagrees, so a future edit to
    either file that silently diverges them is caught immediately rather
    than trusting a one-time manual read."""

    provenance = _load(STANDARD_FEATURE_PROVENANCE_PATH)
    canonical = _load(CANONICAL_ENRICHMENT_PATH)
    canonical_pairs_by_address = {
        p["address"]: p for p in canonical["matched_unit_pairs"]["registered_sale_floor_pairs_observational_only"]
    }

    matched_addresses = []
    for pair in provenance["floor"]["registered_sale_observations"]:
        address = pair["address"]
        canonical_pair = canonical_pairs_by_address.get(address)
        if canonical_pair is None:
            raise RuntimeError(f"corroboration failed: '{address}' has no canonical floor-pair counterpart")

        prov_obs_by_deal = {o["deal_id"]: o for o in pair["observations"]}
        canon_obs_by_deal = {o["deal_id"]: o for o in canonical_pair["observations"]}
        if prov_obs_by_deal.keys() != canon_obs_by_deal.keys():
            raise RuntimeError(f"corroboration failed: '{address}' deal_id sets differ between provenance and canonical")
        for deal_id, prov_o in prov_obs_by_deal.items():
            canon_o = canon_obs_by_deal[deal_id]
            for field, canon_key in (("date", "date"), ("floor", "floor"), ("price_ils", "price"), ("subparcel", "subparcel")):
                if prov_o.get(field) != canon_o.get(canon_key):
                    raise RuntimeError(
                        f"corroboration failed: '{address}' deal {deal_id} field {field} "
                        f"({prov_o.get(field)!r}) != canonical {canon_key} ({canon_o.get(canon_key)!r})"
                    )
        matched_addresses.append(address)

    if len(matched_addresses) != 4:
        raise RuntimeError(f"expected exactly 4 corroborated floor pairs, found {len(matched_addresses)}")

    return {
        "corroborated_addresses": matched_addresses,
        "verified_monetary_rule": provenance["floor"]["verified_monetary_rule"],
        "verification": "every deal_id/date/floor/price/subparcel matches the canonical enrichment file exactly (asserted at merge time)",
    }


def main() -> None:
    gap = _load(RESEARCH_DIR / "special_gap_research_v2.json")
    linkage = _load(RESEARCH_DIR / "special_tax_linkage_v2.json")
    master = _load(MASTER_PATH)
    standard_feature_corroboration = _verify_floor_pair_corroboration()

    if "first_researcher_context_v2" not in master:
        raise RuntimeError("first_researcher_context_v2 missing -- run the first-researcher merge before this one")

    tracks = _build_context_records(gap, linkage)
    _apply_supersession_to_first_researcher(master)

    master["second_researcher_context_v1"] = {
        "source_bundle": "second_researcher_" + gap.get("retrieved_at", "unknown"),
        "source_files": [
            "data/research/second_researcher/special_gap_research_v2.json",
            "data/research/second_researcher/special_tax_linkage_v2.json",
        ],
        "excluded_source_files": {
            "research_gap_closure_report_v1.json": "reference only -- never ingested as pricing data",
        },
        "standard_feature_provenance": {
            "source_file": "data/research/second_researcher/standard_feature_matched_pairs_v1_second_researcher.json",
            "role": "corroboration only -- canonical data/frozen/standard_unit_attribute_enrichment_v1.json remains the runtime/UI source; these records are not duplicated as separate display cards",
            **standard_feature_corroboration,
        },
        "numeric_eligibility_default": False,
        "usage_rule": (
            "Context/provenance only, same as first_researcher_context_v2. No record here is read by "
            "pricing_core.special_market_indication or any voting-lane builder. pricing_engine_updated=false, "
            "new_records_allowed_to_vote=false, review_required_before_numeric_use=true per the source package's "
            "own scope statement."
        ),
        "supersession_note": (
            "Records with a 'supersedes' field replace a weaker first_researcher_context_v2 record for the same "
            "underlying property in the UI; the superseded record is kept (tagged superseded_by) and never deleted."
        ),
        **tracks,
    }

    enriched = _enrich_existing_sold_records(master)

    MASTER_PATH.write_text(json.dumps(master, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("Merged. Counts:")
    for key in ("garden_context", "triplex_context", "duplex_context", "new_development_updates", "qa_and_linkage"):
        print(f"  {key}: {len(tracks[key])}")
    print("Enriched existing sold records:")
    for e in enriched:
        print(f"  - {e}")


if __name__ == "__main__":
    main()
