import json
from pathlib import Path

import requests


# ============================================================
# CONFIG
# ============================================================

CITY = "אשקלון"

# Current government street-synonym resource.
STREETS_RESOURCE_ID = "bf185c7f-1a4e-4662-88c5-fa118a244bda"

DATA_GOV_API = "https://data.gov.il/api/3/action/datastore_search"

XPLAN_BASE = (
    "https://ags.iplan.gov.il/arcgisiplan/rest/services/"
    "PlanningPublic/Xplan/MapServer"
)

# Smoke-test point only.
# This is the Ramat Ashkelon competitor-project coordinate
# we already obtained from the Madlan project dataset.
TEST_LAT = 31.67666
TEST_LON = 34.59663

OUTPUT_DIR = Path("gov_source_tests")
OUTPUT_DIR.mkdir(exist_ok=True)


# ============================================================
# HELPERS
# ============================================================

def save_json(filename, data):
    path = OUTPUT_DIR / filename

    with open(path, "w", encoding="utf-8") as f:
        json.dump(
            data,
            f,
            ensure_ascii=False,
            indent=2,
            default=str,
        )

    print("Saved:", path)


def get_json(url, params=None):
    response = requests.get(
        url,
        params=params,
        timeout=60,
    )

    print("HTTP:", response.status_code)

    response.raise_for_status()

    return response.json()


# ============================================================
# PART 1 — GOVERNMENT STREET NORMALIZATION
# ============================================================

print("\n" + "=" * 75)
print("1. GOVERNMENT STREET / SYNONYM TEST")
print("=" * 75)

street_params = {
    "resource_id": STREETS_RESOURCE_ID,
    "limit": 5000,
    "filters": json.dumps(
        {
            "city_name": CITY,
        },
        ensure_ascii=False,
    ),
}

street_data = get_json(
    DATA_GOV_API,
    street_params,
)

save_json(
    "ashkelon_streets_raw.json",
    street_data,
)

result = street_data.get("result", {})
records = result.get("records", [])

print("\nAshkelon rows:", len(records))


# ------------------------------------------------------------
# Build official street map
# ------------------------------------------------------------

official_by_code = {}

for row in records:
    status = str(
        row.get("street_name_status") or ""
    ).lower()

    if status == "official":
        code = str(row.get("official_code"))

        official_by_code[code] = {
            "street_name": row.get("street_name"),
            "street_code": row.get("street_code"),
        }


normalized = []

for row in records:
    official_code = str(
        row.get("official_code")
    )

    official = official_by_code.get(
        official_code
    )

    normalized.append({
        "input_name": row.get("street_name"),
        "input_code": row.get("street_code"),
        "status": row.get("street_name_status"),
        "official_code": row.get("official_code"),
        "official_name": (
            official.get("street_name")
            if official
            else None
        ),
    })


save_json(
    "ashkelon_street_normalization.json",
    normalized,
)


# ------------------------------------------------------------
# Print actual synonym mappings
# ------------------------------------------------------------

synonyms = [
    x
    for x in normalized
    if x["status"]
    and "synonym" in str(x["status"]).lower()
]

print("Official streets:", len(official_by_code))
print("Synonym rows:", len(synonyms))

print("\nFIRST 25 SYNONYM MAPPINGS")
print("-" * 75)

for item in synonyms[:25]:
    print(
        f"{item['input_name']!r}"
        f"  ->  {item['official_name']!r}"
        f"  [official code {item['official_code']}]"
    )


# ------------------------------------------------------------
# Check some real street names from our datasets
# ------------------------------------------------------------

TEST_STREETS = [
    "עולי הגרדום",
    "מעלה הגת",
    "שפירא",
    "הסוכנות היהודית",
    "השונית",
]

print("\nREAL DATASET STREET CHECK")
print("-" * 75)

for test_name in TEST_STREETS:

    matches = [
        x
        for x in normalized
        if str(x["input_name"]).strip() == test_name
    ]

    print(f"\n{test_name}:")

    if not matches:
        print("  NOT FOUND")
        continue

    for match in matches:
        print(
            " ",
            match["status"],
            "| official:",
            match["official_name"],
            "| code:",
            match["official_code"],
        )


# ============================================================
# PART 2 — XPLAN SERVICE DISCOVERY
# ============================================================

print("\n\n" + "=" * 75)
print("2. XPLAN SERVICE DISCOVERY")
print("=" * 75)

service = get_json(
    XPLAN_BASE,
    {
        "f": "json",
    },
)

save_json(
    "xplan_service_metadata.json",
    service,
)

layers = service.get("layers", [])

print("\nXPLAN layers:", len(layers))

for layer in layers:
    print(
        "ID:",
        layer.get("id"),
        "|",
        layer.get("name"),
        "|",
        layer.get("type"),
    )


# ============================================================
# PART 3 — QUERY XPLAN AT REAL ASHKELON POINT
# ============================================================

print("\n\n" + "=" * 75)
print("3. XPLAN SPATIAL QUERY")
print("=" * 75)

print("Smoke point:")
print("lat:", TEST_LAT)
print("lon:", TEST_LON)


all_results = []


def query_layer(layer_id, geometry, geometry_type):

    url = f"{XPLAN_BASE}/{layer_id}/query"

    params = {
        "f": "json",
        "where": "1=1",

        "geometry": geometry,
        "geometryType": geometry_type,

        # Input is normal GPS/WGS84.
        "inSR": "4326",

        "spatialRel": "esriSpatialRelIntersects",

        "outFields": "*",

        # Keep smoke test small.
        "returnGeometry": "false",

        "resultRecordCount": 20,
    }

    response = requests.get(
        url,
        params=params,
        timeout=60,
    )

    try:
        payload = response.json()
    except Exception:
        return {
            "http_status": response.status_code,
            "error": response.text[:1000],
        }

    return {
        "http_status": response.status_code,
        "payload": payload,
    }


# ------------------------------------------------------------
# First: exact point intersection
# ------------------------------------------------------------

point_geometry = f"{TEST_LON},{TEST_LAT}"

for layer in layers:

    layer_id = layer.get("id")
    layer_name = layer.get("name")

    print(
        f"\nQuerying layer {layer_id}: {layer_name}"
    )

    result = query_layer(
        layer_id,
        point_geometry,
        "esriGeometryPoint",
    )

    payload = result.get("payload", {})

    features = payload.get(
        "features",
        [],
    )

    print(
        "  point matches:",
        len(features),
    )

    all_results.append({
        "layer_id": layer_id,
        "layer_name": layer_name,
        "query_type": "point",
        "result": result,
    })


# ------------------------------------------------------------
# Fallback: ~600 m box around point
# ------------------------------------------------------------

delta = 0.006

xmin = TEST_LON - delta
xmax = TEST_LON + delta

ymin = TEST_LAT - delta
ymax = TEST_LAT + delta

envelope = (
    f"{xmin},{ymin},"
    f"{xmax},{ymax}"
)

print("\n\n600m-ish ENVELOPE TEST")
print("-" * 75)

for layer in layers:

    layer_id = layer.get("id")
    layer_name = layer.get("name")

    result = query_layer(
        layer_id,
        envelope,
        "esriGeometryEnvelope",
    )

    payload = result.get("payload", {})

    features = payload.get(
        "features",
        [],
    )

    print(
        f"Layer {layer_id}:"
        f" {layer_name}"
        f" -> {len(features)} matches"
    )

    if features:

        print("\nFIRST FEATURE ATTRIBUTES:")

        attributes = (
            features[0].get(
                "attributes",
                {}
            )
        )

        for key, value in attributes.items():
            print(
                f"    {key}: {value}"
            )

    all_results.append({
        "layer_id": layer_id,
        "layer_name": layer_name,
        "query_type": "envelope",
        "result": result,
    })


save_json(
    "xplan_ashkelon_queries.json",
    all_results,
)


# ============================================================
# PART 4 — SUMMARY
# ============================================================

print("\n\n" + "=" * 75)
print("SUMMARY")
print("=" * 75)

successful_layers = []

for entry in all_results:

    payload = (
        entry
        .get("result", {})
        .get("payload", {})
    )

    features = payload.get(
        "features",
        [],
    )

    if features:
        successful_layers.append({
            "layer_id": entry["layer_id"],
            "layer_name": entry["layer_name"],
            "query_type": entry["query_type"],
            "features": len(features),
        })


print(
    "Street records:",
    len(records),
)

print(
    "Street synonyms:",
    len(synonyms),
)

print(
    "XPLAN queries with data:",
    len(successful_layers),
)

for item in successful_layers:
    print(
        item["layer_id"],
        "|",
        item["layer_name"],
        "|",
        item["query_type"],
        "|",
        item["features"],
        "features",
    )


save_json(
    "test_summary.json",
    {
        "street_records": len(records),
        "street_synonyms": len(synonyms),
        "xplan_layers": layers,
        "xplan_successful_queries": successful_layers,
    },
)

print("\nDONE.")