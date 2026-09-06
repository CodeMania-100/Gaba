from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class SourceManifestEntry:
    source_key: str
    relative_path: str
    required: bool
    lane: str
    description: str


# Paths are relative to DEMO_DATA_DIR (defaults to the repo's gov_source_tests/ folder).
# Required sources are the ones pricing_core.comparables.build_comparable_set actually
# consumes (sold / current-asking / new-development). Everything else is real, frozen,
# ingested data too, but only feeds the "secondary/supporting evidence" view -- it is
# never passed into the pricing engine, matching the brief's own "not mandatory" framing
# for Yad2/XPLAN/construction/tax-enrichment sources.
DEMO_SOURCE_MANIFEST: list[SourceManifestEntry] = [
    SourceManifestEntry(
        source_key="tax_enriched_sold_3room",
        relative_path="../gabay_pricing_core/tax_enriched_ashkelon_3room_36m.json",
        required=True,
        lane="sold",
        description=(
            "Tax Authority enriched completed sales, citywide Ashkelon, 3-room. Primary standard-3R "
            "sold source: eligibility is further restricted to a frozen official GIS/housing-program "
            "local-parcel whitelist (data/diagnostics/three_room_verified_demo_scope_v1.json) before "
            "any record can drive the target range -- this file's full citywide population is only "
            "provenance, never priced wholesale."
        ),
    ),
    SourceManifestEntry(
        source_key="wine_city_sold_3room_reference",
        relative_path="data_source_test/wine_city_sold_raw.json",
        required=True,
        lane="reference",
        description=(
            "GovMap completed sales, 3-room local-area query (עיר היין / רמת כרמים). Geographically "
            "concentrated real local evidence kept as reference/corroboration only -- superseded as "
            "the primary standard-3R sold source by tax_enriched_sold_3room, which has enough "
            "area-relevant, recent, MARKET_LIKE evidence in the verified local parcel scope. Never "
            "double-counted against the enriched source."
        ),
    ),
    SourceManifestEntry(
        source_key="govmap_sold_5room",
        relative_path="wine_city_sold_5room_raw.json",
        required=True,
        lane="sold",
        description="GovMap completed sales, 5-room targeted + adjacent-area query.",
    ),
    SourceManifestEntry(
        source_key="madlan_listings",
        relative_path="data_source_test/madlan_apify_200.json",
        required=True,
        lane="current_asking",
        description="Madlan current asking listings (Apify actor run).",
    ),
    SourceManifestEntry(
        source_key="madlan_projects",
        relative_path="data_source_test/madlan_projects_only.json",
        required=True,
        lane="new_development",
        description="Madlan new-development project offers (Apify actor run).",
    ),
    SourceManifestEntry(
        source_key="yad2_listings",
        relative_path="data_source_test/yad2_apify_enriched_100.json",
        required=False,
        lane="reference",
        description="Yad2 current asking listings -- secondary reference only, not used in range calculation.",
    ),
    SourceManifestEntry(
        source_key="xplan_area",
        relative_path="xplan_area_results.json",
        required=False,
        lane="reference",
        description="XPLAN area planning-layer results -- supporting planning context only.",
    ),
    SourceManifestEntry(
        source_key="xplan_point",
        relative_path="xplan_point_results.json",
        required=False,
        lane="reference",
        description="XPLAN point planning-layer results -- supporting planning context only.",
    ),
    SourceManifestEntry(
        source_key="construction_competitor_matches",
        relative_path="ashkelon_construction_competitor_matches.json",
        required=False,
        lane="reference",
        description="Active-construction registry rows matched to known competitor names -- supporting competitor discovery only.",
    ),
    SourceManifestEntry(
        source_key="construction_summary",
        relative_path="active_construction_summary.json",
        required=False,
        lane="reference",
        description="Active-construction registry summary counts for the city.",
    ),
    SourceManifestEntry(
        source_key="tax_enrichment",
        relative_path="tax_enriched_ashkelon_5room_36m.json",
        required=False,
        lane="reference",
        description="Tax Authority enriched deals -- optional QA/enrichment diagnostic only, never used to price.",
    ),
]


def default_demo_data_dir() -> Path:
    # app_api/source_manifest.py -> app_api -> gabay_pricing_core -> repo root -> gov_source_tests
    return Path(__file__).resolve().parents[2] / "gov_source_tests"


def resolve_source_path(entry: SourceManifestEntry, demo_data_dir: Path) -> Path:
    return demo_data_dir / entry.relative_path
