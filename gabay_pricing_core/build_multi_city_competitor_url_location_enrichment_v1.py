"""P0 "coordinate coverage" follow-up: a second, separate one-time location
pass for the multi-city competitor register's remaining address == null
projects -- the ones build_multi_city_competitor_coordinate_enrichment_v1.py
already (correctly) skipped, because that script only ever geocodes an
address/street string that is already sitting on the record; it never goes
looking for one.

This is location enrichment only, same as its sibling script: no new
pricing, no new commercial facts, no change to evidence eligibility. The
only source of new information here is location text that these projects'
OWN already-stored source_urls (special_full_v2/competitor_projects_v2.json's
source_urls field) already state about themselves -- never a new source,
never a different project's data, never an inferred/guessed position.

Manual research step (already performed, not re-derived by this script):
every address == null, coordinate_precision != "PROJECT" project across all
three cities was reviewed against its own stored source_urls, looking only
for a stated street name (with or without a house number) that the
existing address-only geocoding pass had nothing to work with. That review
is recorded verbatim below in CANDIDATES so a future reader can see exactly
what each source page did and did not say, and re-verify it, without this
script silently re-scraping (and potentially re-summarizing differently)
live pages that may change.

Result: 8 of 9 candidates state only a neighborhood/area name on their own
source page (e.g. "קריית השרון", "מזרח נתניה", "יד אליהו") -- never a
street name -- which is explicitly NOT an improvement over the existing
neighborhood-centroid fallback (same rule the address-based script already
enforces: coarser than street level is rejected). The remaining one
(DAVID נתניה, net-david) is the only candidate whose own official developer
page names an actual street ("על דרך דוד רזיאל", in "צפון מרכז נתניה") --
but that street does not resolve via the same Nominatim geocoder this
dataset already trusts (a nationwide search confirms "דוד רזיאל" streets
exist in Tel Aviv-Yafo, Jerusalem, Rishon LeZion, Bat Yam and Petah Tikva,
but not in Netanya -- most likely a very recently named road in a still-
developing area that OSM has not mapped yet). Guessing a coordinate from a
same-named street in a DIFFERENT city would be exactly the invented
position this task forbids, so it is correctly left unresolved.

Net effect of this pass: zero coordinate changes. Every one of these 9
projects keeps its existing neighborhood-centroid coordinate, honestly,
because no source-backed improvement could be verified for any of them.
The script and its output file still exist (rather than skipping this step
silently) so that: (a) the investigation is reproducible and auditable, and
(b) if OSM ever gains data for "דרך דוד רזיאל" in Netanya, or if a project
page is later updated with a street address, rerunning this script picks
it up automatically without any further code change (see
app_api/multi_city_map_coordinate_enrichment.py's
load_url_location_enrichment / apply_map_coordinate_enrichment, which
merges this file's "resolved" entries as a second, lower-priority overlay
behind the address-based pass).

Requires network access to nominatim.openstreetmap.org only for the one
candidate with an actual street name to attempt (net-david); every other
candidate is rejected before any geocode call, purely on "no street name
stated" grounds. Rerun with:
  python build_multi_city_competitor_url_location_enrichment_v1.py
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = (
    "GabayPricingDemo-Geocoder/1.0 "
    "(one-time offline geocoding pass for an educational pricing-demo assignment)"
)
RATE_LIMIT_SECONDS = 1.1

OUT_PATH = Path("data/frozen/multi_city_competitor_url_location_enrichment_v1.json")

CITY_CENTROIDS = {
    "תל אביב-יפו": (32.05899, 34.79285),
    "נתניה": (32.30321, 34.87567),
    "אשקלון": (31.68751, 34.57109),
}
CITY_TOKENS = {
    "תל אביב-יפו": ["תל אביב", "תל־אביב", "יפו", "tel aviv", "yafo", "tel aviv-yafo"],
    "נתניה": ["נתניה", "netanya"],
    "אשקלון": ["אשקלון", "ashkelon", "ashqelon"],
}

# Every address == null, coordinate_precision != "PROJECT" project across all
# three cities, as of this pass -- verified by re-reading
# special_full_v2/competitor_projects_v2.json's own source_urls field for
# each. "location_text_found" is the exact (translated where noted) text
# manually read off that project's own source page; never invented, never
# pulled from a different project or a different source.
CANDIDATES = [
    {
        "project_id": "net-gindi-tzamarot",
        "project_name": "גינדי צמרות נתניה",
        "city": "נתניה",
        "source_url": "https://gindi.com/project/gindi-tzamarot-netanya/",
        "location_text_found": "מזרח נתניה (East Netanya) -- area name only, no street stated.",
        "street_name": None,
    },
    {
        "project_id": "net-gindi-newnorth",
        "project_name": "הצפון החדש בקריית השרון — גינדי",
        "city": "נתניה",
        "source_url": "https://www.nadlancenter.co.il/article/15084",
        "location_text_found": "קריית השרון - נתניה (Kiryat HaSharon neighborhood) -- area name only, no street stated.",
        "street_name": None,
    },
    {
        "project_id": "net-ashdar-country",
        "project_name": "אשדר וקאנטרי",
        "city": "נתניה",
        "source_url": "https://www.ashtromconstruction.co.il/projects/ashdar-and-country-building",
        "location_text_found": "קריית השרון, near פארק האלונים -- area name only, no street stated. "
        "(second source_url, makorrishon.co.il, returned HTTP 403 and could not be reviewed.)",
        "street_name": None,
    },
    {
        "project_id": "net-david",
        "project_name": "DAVID נתניה",
        "city": "נתניה",
        "source_url": "https://www.boh.co.il/projects/44",
        "location_text_found": "צפון מרכז נתניה, \"על דרך דוד רזיאל\" (on David Raziel road) -- the one "
        "candidate with an actual street name on its own official page. "
        "(the boh.co.il page also names a sales-office address in Bnei Brak -- "
        "explicitly not the project's own location, not used here. Second "
        "source_url, nadlanshark.co.il, no longer resolves (DNS failure).)",
        "street_name": "דרך דוד רזיאל",
    },
    {
        "project_id": "net-the-strip",
        "project_name": "THE STRIP נתניה",
        "city": "נתניה",
        "source_url": "https://www.yad2.co.il/yad1/project/19096",
        "location_text_found": "yad2.co.il source_url returned only a bot-verification page (Radware), "
        "no content. Second source_url, auraisrael.co.il, returned HTTP 404. Neither "
        "source_url could be reviewed.",
        "street_name": None,
    },
    {
        "project_id": "ta-galipolis",
        "project_name": "GALIPOLIS",
        "city": "תל אביב-יפו",
        "source_url": "https://almog-ltd.com/project/galipoliz/",
        "location_text_found": "\"בלב שכונת יד אליהו... דקות ספורות מרחוב לה-גווארדיה\" (Yad Eliyahu "
        "neighborhood, minutes from La-Guardia street) -- a nearby reference street, "
        "not stated as the project's own address; not reliable enough to geocode as "
        "this project's location.",
        "street_name": None,
    },
    {
        "project_id": "ta-almog-complex",
        "project_name": "Almog The Complex",
        "city": "תל אביב-יפו",
        "source_url": "https://almog-ltd.com/project/%D7%AA%D7%90-almog-the-complex/",
        "location_text_found": "יד אליהו (Yad Eliyahu) -- area name only, no street stated for the project "
        "itself (only nearby highways/roads mentioned as landmarks).",
        "street_name": None,
    },
    {
        "project_id": "ash-demri-barnea",
        "project_name": "דמרי ברנע — historical phases",
        "city": "אשקלון",
        "source_url": "https://www.megureit.co.il/projects",
        "location_text_found": "רמת כרמים (Ramat Karmim neighborhood) -- area name only, no street stated.",
        "street_name": None,
    },
    {
        "project_id": "ash-dimri-wine",
        "project_name": "מגדלי עיר היין",
        "city": "אשקלון",
        "source_url": "https://www.dimri.co.il/projects/%D7%A2%D7%99%D7%A8-%D7%94%D7%99%D7%99%D7%9F/",
        "location_text_found": "\"בלב שכונת עיר היין\" (Ir HaYayin neighborhood) -- area name only. The "
        "page's one street address (\"שדרות ירושלים 1, נתיבות\") is the developer's own "
        "office in a different city, not this project's location -- not used here. "
        "(second source_url, project.dimri.co.il, confirmed the same: neighborhood "
        "name only, no street.)",
        "street_name": None,
    },
]


def _http_get_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def geocode_street(street_name: str, city: str) -> dict:
    """Same acceptance rule as the address-based script's geocode_one, but
    for a street-only query: accepted only at road precision or better, and
    only when Nominatim actually names this street within this city (never
    a same-named street resolved in a different city -- see net-david)."""
    query = f"{street_name}, {city}, ישראל"
    params = {"q": query, "format": "jsonv2", "addressdetails": 1, "limit": 3, "countrycodes": "il"}
    url = f"{NOMINATIM_URL}?{urllib.parse.urlencode(params)}"
    try:
        results = _http_get_json(url)
    except Exception as e:  # noqa: BLE001 -- one-time script, log and continue
        return {"rejected": True, "reason": f"request_failed: {e}"}
    if not results:
        return {"rejected": True, "reason": "no_results"}

    top = results[0]
    addr = top.get("address", {})
    city_text = " ".join(str(addr.get(k, "")) for k in ("city", "town", "suburb", "county", "state_district")).lower()
    tokens = CITY_TOKENS.get(city, [city])
    in_city = any(tok.lower() in city_text for tok in tokens)
    try:
        lat, lng = float(top["lat"]), float(top["lon"])
    except (KeyError, ValueError):
        return {"rejected": True, "reason": "malformed_coordinates"}
    if not in_city:
        return {"rejected": True, "reason": "outside_city_area", "raw_display_name": top.get("display_name")}

    addresstype = top.get("addresstype")
    has_house_number = bool(addr.get("house_number"))
    if has_house_number or addresstype in ("house", "building"):
        precision = "address"
    elif addresstype == "road":
        precision = "street"
    else:
        return {"rejected": True, "reason": "too_coarse", "raw_display_name": top.get("display_name")}

    return {"lat": lat, "lng": lng, "precision": precision, "resolved_label": top.get("display_name")}


def main() -> None:
    root = Path(__file__).resolve().parent
    resolved: list[dict] = []
    reviewed: list[dict] = []

    for c in CANDIDATES:
        entry = {
            "project_id": c["project_id"],
            "project_name": c["project_name"],
            "city": c["city"],
            "source_url_reviewed": c["source_url"],
            "location_text_found": c["location_text_found"],
        }
        if not c["street_name"]:
            entry["outcome"] = "no_street_level_text_on_own_source_page"
            reviewed.append(entry)
            print(f"  SKIP   {c['project_name']!r} -- no street-level text on its own source page")
            continue

        result = geocode_street(c["street_name"], c["city"])
        time.sleep(RATE_LIMIT_SECONDS)
        if result.get("rejected"):
            entry["outcome"] = f"street_named_but_unresolved: {result.get('reason')}"
            entry["street_name_reviewed"] = c["street_name"]
            reviewed.append(entry)
            print(f"  UNRESOLVED  {c['project_name']!r} ({c['street_name']!r}) -- {result.get('reason')}")
        else:
            resolved.append(
                {
                    "project_id": c["project_id"],
                    "project_name": c["project_name"],
                    "city": c["city"],
                    "input_kind": "street",
                    "query_text": c["street_name"],
                    "source_url": c["source_url"],
                    "lat": result["lat"],
                    "lng": result["lng"],
                    "coordinate_precision": "GEOCODED_ADDRESS" if result["precision"] == "address" else "GEOCODED_STREET",
                    "resolved_label": result["resolved_label"],
                    "geocoder": "nominatim_openstreetmap",
                }
            )
            print(f"  ok ({result['precision']})  {c['project_name']!r} ({c['street_name']!r})")

    output = {
        "version": "multi_city_competitor_url_location_enrichment_v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "geocoder": "nominatim_openstreetmap",
        "source": "manual review of each project's own already-stored source_urls "
        "(special_full_v2/competitor_projects_v2.json's source_urls field), for the "
        "subset of address==null / coordinate_precision != PROJECT projects that "
        "multi_city_competitor_coordinate_enrichment_v1 could not attempt (it only "
        "geocodes an address/street already on the record).",
        "note": (
            "Location enrichment only -- no new pricing, no new commercial fact, no change to evidence "
            "eligibility. Every candidate's own official/source page was reviewed for a stated street name; "
            "a project with only a neighborhood/area name on its own source page is NOT geocoded (no "
            "improvement over the existing neighborhood-centroid fallback -- same rule the address-based "
            "pass already enforces). A project with a real street name is geocoded and validated the same "
            "way as the address-based pass (must resolve within this project's own city, never accepted "
            "from a same-named street in a different city). Applied at workspace-build time as a second, "
            "lower-priority overlay behind multi_city_competitor_coordinate_enrichment_v1 (see "
            "app_api/multi_city_map_coordinate_enrichment.py) -- special_full_v2/competitor_projects_v2.json "
            "itself was never opened for writing and never modified."
        ),
        "resolution_priority": [
            "PROJECT (untouched)",
            "multi_city_competitor_coordinate_enrichment_v1 (address/street already on file, untouched)",
            "this file: GEOCODED_ADDRESS / GEOCODED_STREET (from the project's own source_url text)",
            "NEIGHBORHOOD_CENTROID (untouched fallback)",
        ],
        "counts": {
            "candidates_reviewed": len(CANDIDATES),
            "had_street_level_text": sum(1 for c in CANDIDATES if c["street_name"]),
            "resolved": len(resolved),
            "no_street_level_text_on_own_source_page": sum(
                1 for r in reviewed if r["outcome"] == "no_street_level_text_on_own_source_page"
            ),
            "street_named_but_unresolved": sum(
                1 for r in reviewed if r["outcome"] != "no_street_level_text_on_own_source_page"
            ),
        },
        "resolved": resolved,
        "reviewed": reviewed,
    }

    out_path = root / OUT_PATH
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {out_path}")
    print(f"Resolved: {len(resolved)}/{len(CANDIDATES)}. Reviewed-but-unresolved: {len(reviewed)}.")


if __name__ == "__main__":
    main()
