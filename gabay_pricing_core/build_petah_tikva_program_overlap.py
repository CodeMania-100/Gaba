import argparse
import json
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import shapefile


ROOT = Path(__file__).resolve().parent

INPUT = (
    ROOT
    / "data"
    / "diagnostics"
    / "petah_tikva_center_program_parcels_v1.json"
)

SHP = (
    ROOT
    / "data"
    / "raw"
    / "parcel_all"
    / "PARCEL_ALL.shp"
)

OUT_DIR = ROOT / "data" / "diagnostics"

LAYER_URL = (
    "https://services6.arcgis.com/"
    "I08Ekaykft5ELucH/"
    "arcgis/rest/services/"
    "GIS_Dira/FeatureServer/2"
)

SOURCE_FIELDS = [
    "ActiveProjectId",
    "ProjectName",
    "MarketingMethod",
    "Neighborhood",
    "LamasName",
    "ProviderName",
    "HousingUnits",
    "ProjectHousingUnits",
    "PriceForMeter",
    "LotteryId",
]


def integer(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def http_json(url, params=None, timeout=60):
    if params is None:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0"},
        )
    else:
        body = urllib.parse.urlencode(params).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )

    with urllib.request.urlopen(
        req,
        timeout=timeout,
    ) as response:
        raw = response.read().decode("utf-8")

    data = json.loads(raw)

    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(
            json.dumps(
                data["error"],
                ensure_ascii=False,
            )
        )

    return data


def parse_parcel_reference(row):
    gush = integer(row.get("gush"))
    raw = row.get("parcel")

    helka = None
    subparcel = None

    if raw is None:
        return gush, helka, subparcel

    raw_text = str(raw).strip()

    if "-" in raw_text:
        parts = [
            p.strip()
            for p in raw_text.split("-")
            if p.strip()
        ]

        # Expected Govmap form:
        # gush-helka-subparcel
        if len(parts) >= 2:
            embedded_gush = integer(parts[0])

            if gush is None:
                gush = embedded_gush

            if embedded_gush == gush:
                helka = integer(parts[1])

                if len(parts) >= 3:
                    subparcel = integer(parts[2])
            else:
                # Defensive fallback if gush was supplied separately
                # and parcel contains helka-subparcel.
                helka = integer(parts[0])

                if len(parts) >= 2:
                    subparcel = integer(parts[1])

    else:
        helka = integer(raw)

    return gush, helka, subparcel


def load_requested_parcels():
    raw = json.loads(
        INPUT.read_text(encoding="utf-8")
    )

    requested = {}

    families = raw.get("families", {})

    for family, rows in families.items():
        for row in rows:
            gush, helka, subparcel = (
                parse_parcel_reference(row)
            )

            if gush is None or helka is None:
                continue

            key = (gush, helka)

            if key not in requested:
                requested[key] = {
                    "families": set(),
                    "source_rows": [],
                    "subparcels": set(),
                }

            requested[key]["families"].add(
                family
            )

            if subparcel is not None:
                requested[key]["subparcels"].add(
                    subparcel
                )

            source_row = dict(row)
            source_row["_parsed_gush"] = gush
            source_row["_parsed_helka"] = helka
            source_row["_parsed_subparcel"] = subparcel

            requested[key]["source_rows"].append(
                source_row
            )

    return requested


def find_cadastral_records(targets):
    print()
    print("Scanning national cadastral shapefile...")
    print("Target parcels:", len(targets))

    reader = shapefile.Reader(
        str(SHP),
        encoding="cp1255",
    )

    found = defaultdict(list)

    wanted = set(targets)

    for index, rec in enumerate(
        reader.iterRecords(
            fields=[
                "GUSH_NUM",
                "PARCEL",
                "PARCEL_ID",
                "GUSH_SUFFI",
                "STATUS",
                "STATUS_TEX",
                "LOCALITY_I",
                "LOCALITY_N",
            ]
        )
    ):
        gush = integer(rec[0])
        parcel = integer(rec[1])

        key = (gush, parcel)

        if key not in wanted:
            continue

        found[key].append({
            "record_index": index,
            "parcel_id": integer(rec[2]),
            "gush_suffix": integer(rec[3]),
            "status": integer(rec[4]),
            "status_text": rec[5],
            "locality_id": integer(rec[6]),
            "locality_name": rec[7],
        })

    return reader, found


def shape_to_arcgis_geometry(shape):
    points = shape.points
    parts = list(shape.parts)

    if not points:
        raise ValueError("Shape has no points")

    parts.append(len(points))

    rings = []

    for i in range(len(parts) - 1):
        ring = [
            [float(x), float(y)]
            for x, y in points[
                parts[i]:parts[i + 1]
            ]
        ]

        if len(ring) < 3:
            continue

        if ring[0] != ring[-1]:
            ring.append(ring[0])

        rings.append(ring)

    if not rings:
        raise ValueError("Shape has no usable polygon rings")

    return {
        "rings": rings,
        "spatialReference": {
            "wkid": 2039
        },
    }


def query_program_layer(geometry):
    params = {
        "f": "json",
        "where": "1=1",
        "geometry": json.dumps(
            geometry,
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        "geometryType": "esriGeometryPolygon",
        "inSR": "2039",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": ",".join(SOURCE_FIELDS),
        "returnGeometry": "false",
        "resultRecordCount": "1000",
    }

    return http_json(
        LAYER_URL + "/query",
        params=params,
    )


def normalize_project(attrs):
    lottery = attrs.get("LotteryId")

    lottery_ids = []

    if lottery not in (None, ""):
        if isinstance(lottery, list):
            lottery_ids = lottery
        else:
            lottery_ids = [lottery]

    return {
        "ActiveProjectId": attrs.get("ActiveProjectId"),
        "ProjectName": attrs.get("ProjectName"),
        "MarketingMethod": attrs.get("MarketingMethod"),
        "Neighborhood": attrs.get("Neighborhood"),
        "LamasName": attrs.get("LamasName"),
        "ProviderName": attrs.get("ProviderName"),
        "HousingUnits": attrs.get("HousingUnits"),
        "ProjectHousingUnits": attrs.get(
            "ProjectHousingUnits"
        ),
        "PriceForMeter": attrs.get("PriceForMeter"),
        "LotteryIds": lottery_ids,
    }


def project_key(p):
    return (
        p.get("ActiveProjectId"),
        p.get("ProjectName"),
        p.get("MarketingMethod"),
        p.get("ProviderName"),
        p.get("PriceForMeter"),
        tuple(p.get("LotteryIds") or []),
    )


def process_parcel(
    reader,
    key,
    source_info,
    cadastral_rows,
):
    gush, parcel = key

    base = {
        "gush": gush,
        "helka": parcel,
        "families": sorted(
            source_info["families"]
        ),
        "cadastral_record_count": len(
            cadastral_rows
        ),
        "cadastral_records": cadastral_rows,
    }

    if not cadastral_rows:
        return {
            **base,
            "resolved": False,
            "program_overlap": None,
            "projects": [],
            "reason": "cadastral_parcel_not_found",
        }

    projects = {}
    query_errors = []

    successful_queries = 0

    for cad in cadastral_rows:
        try:
            shape = reader.shape(
                cad["record_index"]
            )

            geometry = shape_to_arcgis_geometry(
                shape
            )

            response = query_program_layer(
                geometry
            )

            successful_queries += 1

            for feature in response.get(
                "features", []
            ):
                attrs = feature.get(
                    "attributes", {}
                )

                project = normalize_project(
                    attrs
                )

                projects[
                    project_key(project)
                ] = project

        except Exception as exc:
            query_errors.append({
                "record_index": cad[
                    "record_index"
                ],
                "error": str(exc),
            })

    project_list = list(projects.values())

    if successful_queries == 0:
        return {
            **base,
            "resolved": False,
            "program_overlap": None,
            "projects": [],
            "query_errors": query_errors,
            "reason": "gis_query_failed",
        }

    return {
        **base,
        "resolved": True,
        "program_overlap": bool(project_list),
        "projects": project_list,
        "query_errors": query_errors,
        "reason": (
            "official_program_overlap_found"
            if project_list
            else "official_gis_confirmed_no_program_overlap"
        ),
    }


def summarize(parcels):
    return {
        "requested_parcels": len(parcels),
        "resolved_parcels": sum(
            1
            for p in parcels
            if p["resolved"]
        ),
        "unresolved_parcels": sum(
            1
            for p in parcels
            if not p["resolved"]
        ),
        "program_overlap_parcels": sum(
            1
            for p in parcels
            if p["program_overlap"] is True
        ),
        "confirmed_no_program_overlap": sum(
            1
            for p in parcels
            if p["program_overlap"] is False
        ),
        "official_projects": sum(
            len(p["projects"])
            for p in parcels
        ),
    }


def write_outputs(all_results):
    combined_path = (
        OUT_DIR
        / "petah_tikva_program_overlap_parcels.json"
    )

    combined = {
        "version": "petah_tikva_program_overlap_v1",
        "generated_at": datetime.now().isoformat(),
        "city": "פתח תקווה",
        "official_neighborhood": "מרכז העיר",
        "source": {
            "cadastral_source": "PARCEL_ALL",
            "cadastral_crs": "EPSG:2039",
            "gis_layer": LAYER_URL,
            "method": (
                "exact gush/helka cadastral polygon "
                "intersected with official GIS_Dira layer"
            ),
        },
        "summary": summarize(all_results),
        "parcels": all_results,
    }

    combined_path.write_text(
        json.dumps(
            combined,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    for family, filename in [
        (
            "3R",
            "petah_tikva_3room_program_overlap_parcels.json",
        ),
        (
            "5R",
            "petah_tikva_5room_program_overlap_parcels.json",
        ),
    ]:
        rows = [
            p
            for p in all_results
            if family in p.get("families", [])
        ]

        payload = {
            "version": "petah_tikva_program_overlap_v1",
            "generated_at": combined["generated_at"],
            "city": combined["city"],
            "official_neighborhood": (
                combined["official_neighborhood"]
            ),
            "family": family,
            "source": combined["source"],
            "summary": summarize(rows),
            "parcels": rows,
        }

        path = OUT_DIR / filename

        path.write_text(
            json.dumps(
                payload,
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    return combined_path


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process first N unique parcels",
    )

    args = parser.parse_args()

    if not INPUT.exists():
        raise SystemExit(
            f"Missing input: {INPUT}"
        )

    if not SHP.exists():
        raise SystemExit(
            f"Missing shapefile: {SHP}"
        )

    print("=" * 80)
    print("PETAH TIKVA OFFICIAL PROGRAM GIS OVERLAP")
    print("=" * 80)

    print("\nChecking GIS_Dira layer...")

    metadata = http_json(
        LAYER_URL + "?f=json"
    )

    print("Layer name:", metadata.get("name"))
    print("Layer type:", metadata.get("type"))

    available_fields = {
        f.get("name")
        for f in metadata.get("fields", [])
    }

    print(
        "Required fields found:",
        [
            f
            for f in SOURCE_FIELDS
            if f in available_fields
        ],
    )

    missing = [
        f
        for f in SOURCE_FIELDS
        if f not in available_fields
    ]

    if missing:
        print(
            "WARNING missing layer fields:",
            missing,
        )

    requested = load_requested_parcels()

    keys = sorted(requested)

    if args.limit:
        keys = keys[:args.limit]

    limited = {
        key: requested[key]
        for key in keys
    }

    reader, cadastral = find_cadastral_records(
        limited
    )

    print(
        "Cadastral parcels found:",
        sum(
            1
            for key in keys
            if cadastral.get(key)
        ),
        "/",
        len(keys),
    )

    results = []

    for i, key in enumerate(keys, 1):
        gush, parcel = key

        print(
            f"[{i}/{len(keys)}] "
            f"{gush}/{parcel}",
            end=" ",
            flush=True,
        )

        result = process_parcel(
            reader,
            key,
            requested[key],
            cadastral.get(key, []),
        )

        results.append(result)

        print(
            "| resolved=",
            result["resolved"],
            "| overlap=",
            result["program_overlap"],
            "| projects=",
            len(result["projects"]),
        )

        time.sleep(0.05)

    summary = summarize(results)

    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)

    for k, v in summary.items():
        print(f"{k}: {v}")

    path = write_outputs(results)

    print("\nSaved:")
    print(path)


if __name__ == "__main__":
    main()
