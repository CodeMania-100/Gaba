import json
from pathlib import Path
from datetime import datetime
from statistics import median

ROOT = Path.cwd()

SRC = (
    ROOT / "data" / "frozen"
    / "petah_tikva_standard_competitor_evidence_v1.json"
)

OUT = (
    ROOT / "data" / "frozen"
    / "petah_tikva_standard_competitor_evidence_v2_no_yad1.json"
)

data = json.loads(SRC.read_text(encoding="utf-8"))
records = data["records"]

# Recover the already-stored allowed Diraly source for Hankin.
hankin_diraly = None

for r in records:
    if r.get("project_id") == "hankin_11":
        for s in r.get("sources", []):
            if s.get("source") == "Diraly":
                hankin_diraly = dict(s)
                break

if hankin_diraly is None:
    raise RuntimeError("Existing allowed Hankin Diraly source not found")


clean = []
excluded = []

for r in records:
    project = r.get("project_id")
    family = r.get("family")

    # THE SPOT currently depends on forbidden Yad1 evidence.
    if project == "the_spot":
        excluded.append({
            "family": family,
            "project_id": project,
            "reason": "excluded_source_policy_yad1"
        })
        continue

    # DeFour context record also depended on a /yad1/ project page.
    if project == "defour":
        excluded.append({
            "family": family,
            "project_id": project,
            "reason": "excluded_source_policy_yad1"
        })
        continue

    if project == "hankin_11":
        rr = dict(r)

        # Remove all Yad1/Yad2-new-project evidence.
        rr["sources"] = [dict(hankin_diraly)]

        # Keep only fields supported by the allowed source.
        rr["area_sqm"] = None
        rr["area_min_sqm"] = None
        rr["area_max_sqm"] = None
        rr["ppsm"] = None
        rr["floor"] = None

        rr["evidence_status"] = "CONTEXT_ONLY"

        rr["warnings"] = [
            "room_specific_current_price_verified_via_allowed_source",
            "exact_unit_area_not_verified_without_yad1",
            "excluded_from_area_normalized_competitor_range",
            "adjacent_submarket_kfar_avraham"
        ]

        clean.append(rr)
        continue

    # Defensive rule: do not allow any remaining /yad1/ source.
    bad = [
        s for s in r.get("sources", [])
        if "/yad1/" in str(s.get("url", "")).lower()
    ]

    if bad:
        excluded.append({
            "family": family,
            "project_id": project,
            "reason": "excluded_source_policy_yad1"
        })
        continue

    clean.append(r)


def summarize(family):
    rows = [r for r in clean if r["family"] == family]

    quantitative = [
        r for r in rows
        if r["evidence_status"].startswith("PRIMARY_QUANTITATIVE")
    ]

    context = [
        r for r in rows
        if r["evidence_status"] == "CONTEXT_ONLY"
    ]

    tier1 = [r for r in quantitative if r["geo_tier"] == 1]
    tier2 = [r for r in quantitative if r["geo_tier"] == 2]

    prices = [
        r["price_ils"]
        for r in quantitative
        if r.get("price_ils") is not None
    ]

    ppsm = [
        r["ppsm"]
        for r in quantitative
        if r.get("ppsm") is not None
    ]

    independent = len({
        r["project_id"]
        for r in quantitative
    })

    # Existing range engine needs >=2 independent contributors
    # for a medium-confidence lane.
    gate = (
        "PASS"
        if independent >= 2
        else "INSUFFICIENT_FOR_CONSENSUS_BUT_CONTEXT_AVAILABLE"
    )

    return {
        "gate_status": gate,
        "project_records": len(rows),
        "quantitative_independent_projects": independent,
        "tier1_quantitative_projects": len({
            r["project_id"] for r in tier1
        }),
        "tier2_quantitative_projects": len({
            r["project_id"] for r in tier2
        }),
        "context_only_projects": len({
            r["project_id"] for r in context
        }),
        "quantitative_starting_price_min":
            min(prices) if prices else None,
        "quantitative_starting_price_median":
            median(prices) if prices else None,
        "quantitative_starting_price_max":
            max(prices) if prices else None,
        "quantitative_ppsm_min":
            min(ppsm) if ppsm else None,
        "quantitative_ppsm_median":
            median(ppsm) if ppsm else None,
        "quantitative_ppsm_max":
            max(ppsm) if ppsm else None,
    }


payload = {
    **data,
    "version": "petah_tikva_standard_competitor_evidence_v2_no_yad1",
    "frozen_at": datetime.now().isoformat(),
    "source_policy": {
        "yad1_allowed": False,
        "regular_yad2_resale_allowed": True,
        "forbidden_yad1_records_removed_or_downgraded": True
    },
    "summary": {
        "3R": summarize("3R"),
        "5R": summarize("5R")
    },
    "records": clean,
    "excluded_by_source_policy": excluded
}

OUT.write_text(
    json.dumps(payload, ensure_ascii=False, indent=2),
    encoding="utf-8"
)

for family in ("3R", "5R"):
    print()
    print("=" * 80)
    print(family)
    print("=" * 80)

    for k, v in payload["summary"][family].items():
        print(k + ":", v)

print()
print("EXCLUDED:")
for x in excluded:
    print(x)

print()
print("FROZEN:")
print(OUT)
