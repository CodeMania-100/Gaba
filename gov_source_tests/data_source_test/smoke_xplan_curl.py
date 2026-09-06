import json
import subprocess
from pathlib import Path
from urllib.parse import urlencode


# ============================================================
# CONFIG
# ============================================================

XPLAN_BASE = (
    "https://ags.iplan.gov.il/arcgisiplan/rest/services/"
    "PlanningPublic/Xplan/MapServer"
)

# Same real Ramat Ashkelon competitor-project point
# we used for the first smoke test.
TEST_LAT = 31.67666
TEST_LON = 34.59663

OUTPUT_DIR = Path("gov_source_tests")
OUTPUT_DIR.mkdir(exist_ok=True)


# ============================================================
# HELPERS
# ============================================================

def curl_json(url, params=None):
    if params:
        url = f"{url}?{urlencode(params)}"

    result = subprocess.run(
        [
            "curl.exe",
            "-sS",
            "--tlsv1.2",
            "--max-time",
            "60",
            url,
        ],
        capture_output=True,
    )

    if result.returncode != 0:
        print("CURL ERROR:")
        print(
            result.stderr.decode(
                "utf-8",
                errors="replace",
            )
        )
        raise RuntimeError(
            f"curl failed: {result.returncode}"
        )

    raw = result.stdout

    try:
        text = raw.decode("utf-8-sig")
        return json.loads(text)

    except Exception:
        print("\nRAW RESPONSE:")
        print(
            raw[:2000].decode(
                "utf-8",
                errors="replace",
            )
        )
        raise


def save_json(name, data):
    path = OUTPUT_DIR / name

    with open(
        path,
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(
            data,
            f,
            ensure_ascii=False,
            indent=2,
        )

    print("Saved:", path)


# ============================================================
# 1. SERVICE METADATA
# ============================================================

print("=" * 75)
print("1. XPLAN SERVICE METADATA")
print("=" * 75)

service = curl_json(
    XPLAN_BASE,
    {
        "f": "pjson",
    },
)

save_json(
    "xplan_service_metadata_curl.json",
    service,
)

layers = service.get("layers", [])

print("\nLayers:", len(layers))

feature_layers = []

for layer in layers:
    print(
        layer.get("id"),
        "|",
        layer.get("name"),
        "|",
        layer.get("type"),
    )

    if layer.get("type") == "Feature Layer":
        feature_layers.append(layer)


print(
    "\nFeature layers:",
    len(feature_layers),
)


# ============================================================
# 2. GET METADATA FOR EACH FEATURE LAYER
# ============================================================

print("\n" + "=" * 75)
print("2. FEATURE-LAYER METADATA")
print("=" * 75)

layer_metadata = []

for layer in feature_layers:

    layer_id = layer["id"]

    print(
        "\nLayer",
        layer_id,
        "-",
        layer.get("name"),
    )

    meta = curl_json(
        f"{XPLAN_BASE}/{layer_id}",
        {
            "f": "pjson",
        },
    )

    fields = meta.get("fields", [])

    print(
        "Geometry:",
        meta.get("geometryType"),
    )

    print(
        "Fields:",
        len(fields),
    )

    for field in fields[:30]:
        print(
            "   ",
            field.get("name"),
            "=>",
            field.get("alias"),
            "|",
            field.get("type"),
        )

    layer_metadata.append({
        "id": layer_id,
        "name": layer.get("name"),
        "metadata": meta,
    })


save_json(
    "xplan_layer_metadata.json",
    layer_metadata,
)


# ============================================================
# QUERY FUNCTION
# ============================================================

def query_layer(
    layer_id,
    geometry,
    geometry_type,
    limit=30,
):
    return curl_json(
        f"{XPLAN_BASE}/{layer_id}/query",
        {
            "f": "json",
            "where": "1=1",

            "geometry": json.dumps(
                geometry,
                ensure_ascii=False,
            ),

            "geometryType": geometry_type,

            "inSR": "4326",
            "outSR": "4326",

            "spatialRel":
                "esriSpatialRelIntersects",

            "outFields": "*",

            "returnGeometry": "false",

            "resultRecordCount": limit,
        },
    )


# ============================================================
# 3. EXACT POINT TEST
# ============================================================

print("\n" + "=" * 75)
print("3. EXACT POINT QUERY")
print("=" * 75)

point = {
    "x": TEST_LON,
    "y": TEST_LAT,
    "spatialReference": {
        "wkid": 4326,
    },
}

point_results = []

for layer in feature_layers:

    layer_id = layer["id"]
    name = layer.get("name")

    try:
        payload = query_layer(
            layer_id,
            point,
            "esriGeometryPoint",
        )

    except Exception as exc:
        print(
            layer_id,
            name,
            "ERROR:",
            exc,
        )
        continue

    features = payload.get(
        "features",
        [],
    )

    print(
        layer_id,
        "|",
        name,
        "| matches:",
        len(features),
    )

    if features:
        print("  FIRST MATCH:")

        attrs = features[0].get(
            "attributes",
            {},
        )

        for key, value in attrs.items():
            print(
                "   ",
                key,
                "=",
                value,
            )

    point_results.append({
        "layer_id": layer_id,
        "layer_name": name,
        "features": features,
        "error": payload.get("error"),
    })


save_json(
    "xplan_point_results.json",
    point_results,
)


# ============================================================
# 4. NEARBY ENVELOPE TEST
# ============================================================

print("\n" + "=" * 75)
print("4. NEARBY AREA QUERY")
print("=" * 75)

# Roughly ~600-700m each direction.
delta = 0.006

envelope = {
    "xmin": TEST_LON - delta,
    "ymin": TEST_LAT - delta,
    "xmax": TEST_LON + delta,
    "ymax": TEST_LAT + delta,
    "spatialReference": {
        "wkid": 4326,
    },
}

area_results = []

for layer in feature_layers:

    layer_id = layer["id"]
    name = layer.get("name")

    try:
        payload = query_layer(
            layer_id,
            envelope,
            "esriGeometryEnvelope",
            limit=50,
        )

    except Exception as exc:
        print(
            layer_id,
            name,
            "ERROR:",
            exc,
        )
        continue

    features = payload.get(
        "features",
        [],
    )

    print(
        layer_id,
        "|",
        name,
        "| matches:",
        len(features),
    )

    if features:

        print("\n  FIRST FEATURE:")

        attrs = features[0].get(
            "attributes",
            {},
        )

        for key, value in attrs.items():
            print(
                "   ",
                key,
                "=",
                value,
            )

        print()

    area_results.append({
        "layer_id": layer_id,
        "layer_name": name,
        "features": features,
        "error": payload.get("error"),
    })


save_json(
    "xplan_area_results.json",
    area_results,
)


# ============================================================
# 5. SUMMARY
# ============================================================

print("\n" + "=" * 75)
print("SUMMARY")
print("=" * 75)

useful = []

for result in area_results:

    count = len(
        result.get(
            "features",
            [],
        )
    )

    if count:
        useful.append({
            "layer_id":
                result["layer_id"],

            "layer_name":
                result["layer_name"],

            "matches":
                count,
        })


print(
    "Total feature layers:",
    len(feature_layers),
)

print(
    "Layers returning nearby data:",
    len(useful),
)

for item in useful:
    print(
        item["layer_id"],
        "|",
        item["layer_name"],
        "|",
        item["matches"],
    )


save_json(
    "xplan_curl_summary.json",
    {
        "test_point": {
            "lat": TEST_LAT,
            "lon": TEST_LON,
        },
        "total_feature_layers":
            len(feature_layers),

        "layers_with_nearby_data":
            useful,
    },
)

print("\nDONE")