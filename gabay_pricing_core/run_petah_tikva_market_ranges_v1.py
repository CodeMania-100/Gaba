import json
from pathlib import Path
from datetime import date, datetime

from pricing_core.models import Unit, ProjectLocation
from pricing_core.sold_qa import run_sold_qa
from pricing_core.comparables import (
    ComparableCandidate,
    build_comparable_set,
)
from pricing_core.market_range import build_market_range


ROOT = Path.cwd()

AS_OF = date(2026, 9, 6)

CENTER = "מרכז העיר"
COMMERCIAL_CENTER = "המרכז השקט"

SOLD_FILE = (
    ROOT / "data" / "frozen"
    / "petah_tikva_standard_sold_evidence_v1.json"
)

ASKING_FILE = (
    ROOT / "data" / "frozen"
    / "petah_tikva_standard_asking_evidence_v1.json"
)

COMPETITOR_FILE = (
    ROOT / "data" / "frozen"
    / "petah_tikva_standard_competitor_evidence_v1.json"
)

OUT = (
    ROOT / "data" / "frozen"
    / "petah_tikva_standard_market_ranges_v1.json"
)

TARGETS = {
    "3R": {
        "rooms": 3.0,
        "area": 69.0,
        "balcony": 12.0,
    },
    "5R": {
        "rooms": 5.0,
        "area": 111.1,
        "balcony": 12.0,
    },
}


def num(v):
    try:
        if v in (None, ""):
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


SOLD_EVIDENCE = json.loads(
    SOLD_FILE.read_text(encoding="utf-8")
)

ASKING = json.loads(
    ASKING_FILE.read_text(encoding="utf-8")
)

COMPETITORS = json.loads(
    COMPETITOR_FILE.read_text(encoding="utf-8")
)


def sold_raw_rows(family):
    """Adapt the frozen sold-evidence snapshot into the raw dict shape
    ``SoldTransaction.from_raw``/``run_sold_qa`` expect (camelCase govmap-style
    keys), so the real sold QA engine -- not the freeze script's own lightweight
    qa_flags -- makes the usable/duplicate/companion/outlier decisions.

    cityName is deliberately omitted: the frozen scope records the city as
    "פתח תקוה" (single vav) while the demo location below uses the standard
    "פתח תקווה" (double vav) spelling. Both refer to the same city, but
    comparables._sold_candidates rejects any candidate whose tx.city differs
    from target_location.city -- feeding a mismatched spelling in would
    silently zero out the entire sold lane. Every transaction here was already
    scoped to this family's rooms/area/date/neighborhood at freeze time, so
    city is redundant for gating and is left unset rather than guessed.
    """

    family_data = SOLD_EVIDENCE["families"][family]
    neighborhood = family_data["scope"]["official_neighborhood"]
    assert neighborhood == CENTER, (
        f"frozen sold scope neighborhood {neighborhood!r} != {CENTER!r}"
    )

    rows = []
    for t in family_data["transactions"]:
        rows.append({
            "dealDate": t.get("deal_date"),
            "dealAmount": t.get("amount"),
            "pricePerSqm": t.get("ppsm"),
            "address": t.get("address"),
            "neighborhoodName": neighborhood,
            "rooms": t.get("rooms"),
            "floor": t.get("floor"),
            "area": t.get("area"),
            "propertyType": t.get("property_type"),
            "isFirstHand": t.get("first_hand"),
            "gush": t.get("gush"),
            "helka": t.get("helka"),
            "tatHelka": t.get("tat_helka"),
            "assetId": t.get("asset_id"),
            "scrapedAt": t.get("scraped_at"),
        })
    return rows


def asking_candidates(family):
    rows = ASKING["families"][family]["accepted_listings"]

    result = []

    for r in rows:
        result.append(
            ComparableCandidate(
                lane="current_asking",
                source="Madlan",
                source_id=r.get("listing_id"),
                source_url=r.get("url"),
                price=num(r.get("asking_price")),
                rooms=num(r.get("rooms")),
                area=num(r.get("area")),
                floor=(
                    str(r.get("floor"))
                    if r.get("floor") is not None
                    else None
                ),
                property_type="flat",
                latitude=num(r.get("latitude")),
                longitude=num(r.get("longitude")),
                event_date=_parse_date(
                    r.get("scraped_at")
                    or r.get("first_seen")
                ),

                # Commercial Madlan taxonomy is cross-walked
                # to the official central-market label.
                neighborhood=CENTER,

                address=r.get("address"),
                project_name=None,
                reasons=[
                    "frozen_current_asking_evidence",
                    "commercial_to_official_neighborhood_crosswalk",
                ],
                raw=r,
                geographic_context={
                    "source_neighborhood":
                        r.get("neighborhood"),
                    "source_taxonomy":
                        "Madlan commercial",
                    "normalized_market_area":
                        CENTER,
                    "crosswalk":
                        f"{COMMERCIAL_CENTER} -> {CENTER}",
                },
            )
        )

    return result


def competitor_candidates(family):
    rows = [
        r
        for r in COMPETITORS["records"]
        if r.get("family") == family
    ]

    result = []

    for r in rows:
        status = str(r.get("evidence_status") or "")

        # Keep context records in the set, but the range
        # engine will only normalize exact-neighborhood
        # records with a known price and area.
        quantitative = status.startswith(
            "PRIMARY_QUANTITATIVE"
        )

        geo_tier = r.get("geo_tier")

        if geo_tier == 1:
            neighborhood = CENTER
        else:
            neighborhood = r.get("commercial_area")

        sources = r.get("sources") or []

        source_url = (
            sources[0].get("url")
            if sources
            else None
        )

        source_names = sorted({
            str(s.get("source"))
            for s in sources
            if s.get("source")
        })

        result.append(
            ComparableCandidate(
                lane="new_development",
                source=(
                    " + ".join(source_names)
                    if source_names
                    else "competitor_register"
                ),
                source_id=r.get("project_id"),
                source_url=source_url,
                price=num(r.get("price_ils")),
                rooms=num(r.get("rooms")),
                area=num(r.get("area_sqm")),
                floor=(
                    str(r.get("floor"))
                    if r.get("floor") is not None
                    else None
                ),
                property_type=r.get("unit_type"),
                latitude=None,
                longitude=None,
                event_date=_parse_date(
                    COMPETITORS.get("checked_at")
                ),
                project_name=r.get("project_name"),
                neighborhood=neighborhood,
                address=r.get("address"),
                quality_status=(
                    "usable"
                    if quantitative
                    else "reference"
                ),
                reasons=[
                    status,
                    *list(r.get("warnings") or []),
                ],
                raw=r,
                geographic_context={
                    "geo_tier": geo_tier,
                    "source_market_area":
                        r.get("commercial_area"),
                    "normalized_target_area":
                        CENTER if geo_tier == 1 else None,
                },
            )
        )

    return result


def _parse_date(v):
    if not v:
        return None

    try:
        return datetime.fromisoformat(
            str(v).replace("Z", "+00:00")
        ).date()
    except Exception:
        try:
            return datetime.strptime(
                str(v)[:10],
                "%Y-%m-%d",
            ).date()
        except Exception:
            return None


def lane_summary(lane, *, include_reference_count=False):
    out = {
        "confidence": lane["confidence"],
        "lower": lane["range"]["lower"],
        "center": lane["range"]["center"],
        "upper": lane["range"]["upper"],
        "contributor_count": lane["primary_contributor_count"],
        "warnings": lane["warnings"],
    }
    if include_reference_count:
        out["reference_record_count"] = len(lane["reference_records"])
    return out


def build_family(family):
    target = TARGETS[family]

    unit = Unit(
        unit_number=f"{family}-STANDARD",
        floor=None,
        rooms=target["rooms"],
        internal_area=target["area"],
        balcony_area=target["balcony"],
        orientation=None,
        parking=None,
        storage=None,
        unit_type="standard_apartment",
        notes="Standard family pricing target",
    )

    location = ProjectLocation(
        city="פתח תקווה",
        neighborhood=CENTER,
        address="חפץ חיים 25",
        latitude=None,
        longitude=None,
        source="demo_location_assumption",
    )

    raw_sold = sold_raw_rows(family)

    sold_qa = run_sold_qa(raw_sold)

    comp = build_comparable_set(
        target_unit=unit,
        target_location=location,
        sold_qa=sold_qa.records,
        madlan_listings=[],
        madlan_projects=[],
        as_of=AS_OF,
        source_context={
            "sold_query_scope": {
                "city": "פתח תקווה",
                "neighborhoods": [CENTER],
                "scope_type":
                    "exact_neighborhood_label",
                "coordinates_available": False,
            },
            "demo_location_assumption": True,
            "commercial_official_crosswalk": {
                "commercial": COMMERCIAL_CENTER,
                "official": CENTER,
            },
        },
    )

    # Attach the frozen, already-audited asking/competitor evidence.
    comp.current_asking = asking_candidates(family)
    comp.new_development = competitor_candidates(family)

    result = build_market_range(
        comp,
        as_of=AS_OF,
    )

    public = result.public_dict()

    summary = {
        "status": public["status"],
        "confidence": public["confidence"],
        "supported_lower": public["supported_range"]["lower"],
        "supported_upper": public["supported_range"]["upper"],
        "support_lanes": public["supported_range"]["support_lanes"],
        "sold": lane_summary(public["lanes"]["sold"]),
        "asking": lane_summary(public["lanes"]["current_asking"]),
        "new_development": lane_summary(
            public["lanes"]["new_development"],
            include_reference_count=True,
        ),
    }

    return {
        "target": {
            "family": family,
            "rooms": target["rooms"],
            "internal_area": target["area"],
            "balcony_area": target["balcony"],
        },
        "input_counts": {
            "sold_raw_target_neighborhood":
                len(raw_sold),
            "sold_qa_usable":
                len(sold_qa.usable_primary),
            "sold_comparable_candidates":
                len(comp.sold),
            "asking_candidates":
                len(comp.current_asking),
            "competitor_records":
                len(comp.new_development),
        },
        "summary": summary,
        "market_range": public,
    }


payload = {
    "version":
        "petah_tikva_standard_market_ranges_v1",
    "generated_at": datetime.now().isoformat(),
    "as_of": AS_OF.isoformat(),
    "demo_location": {
        "address": "חפץ חיים 25",
        "city": "פתח תקווה",
        "commercial_area":
            "המרכז השקט / מרכז העיר",
        "is_assumption": True,
    },
    "families": {},
}


for family in ("3R", "5R"):
    result = build_family(family)
    payload["families"][family] = result

    s = result["summary"]

    print()
    print("=" * 90)
    print(family)
    print("=" * 90)

    print(
        "INPUT COUNTS:",
        result["input_counts"]
    )

    print(
        "STATUS:", s["status"],
        "| CONFIDENCE:", s["confidence"],
    )

    print(
        "SUPPORTED RANGE:",
        s["supported_lower"], "-", s["supported_upper"],
        "| SUPPORT LANES:", s["support_lanes"],
    )

    print()
    print("LANES:")

    for lane_name in ("sold", "asking", "new_development"):
        lane = s[lane_name]
        print(
            lane_name,
            "| confidence:", lane["confidence"],
            "| range:", (lane["lower"], lane["center"], lane["upper"]),
            "| contributors:", lane["contributor_count"],
            "| reference_records:", lane.get("reference_record_count"),
            "| warnings:", lane["warnings"],
        )


OUT.parent.mkdir(
    parents=True,
    exist_ok=True,
)

OUT.write_text(
    json.dumps(
        payload,
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)

print()
print("=" * 90)
print("SAVED:")
print(OUT)
