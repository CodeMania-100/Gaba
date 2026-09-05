from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT.parent

ENRICHED = DATA / "tax_enriched_ashkelon_5room_36m.json"
GOVMAP_LOCAL = DATA / "wine_city_sold_5room_raw.json"
OUT_JSON = ROOT / "tax_enrichment_diagnostics.json"
OUT_MD = ROOT / "TAX_ENRICHMENT_DIAGNOSTICS.md"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def known(value):
    return value not in (None, "", [], {})


def rel_diff(a: float, b: float) -> float:
    return abs(a - b) / max(abs(a), abs(b), 1.0)


def parse_date(value: str) -> date:
    return date.fromisoformat(value[:10])


def floor_number(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    try:
        return float(text)
    except ValueError:
        pass
    mapping = {
        "קרקע": 0,
        "ראשונה": 1,
        "שניה": 2,
        "שנייה": 2,
        "שלישית": 3,
        "רביעית": 4,
        "חמישית": 5,
        "שישית": 6,
        "שביעית": 7,
        "שמינית": 8,
        "תשיעית": 9,
        "עשירית": 10,
        "אחת עשרה": 11,
        "שתים עשרה": 12,
        "שתיים עשרה": 12,
        "שלוש עשרה": 13,
        "ארבע עשרה": 14,
        "חמש עשרה": 15,
        "שש עשרה": 16,
        "שבע עשרה": 17,
        "שמונה עשרה": 18,
        "תשע עשרה": 19,
        "עשרים": 20,
        "עשרים ואחת": 21,
        "עשרים ושתיים": 22,
        "עשרים ושלוש": 23,
    }
    return mapping.get(text)


def coverage(rows, fields):
    return {field: sum(known(row.get(field)) for row in rows) for field in fields}


def stats_ppsqm(rows):
    values = sorted(float(r["pricePerSqm"]) for r in rows if known(r.get("pricePerSqm")))
    if not values:
        return None
    def pct(p):
        pos = (len(values) - 1) * p
        lo = int(pos)
        hi = min(lo + 1, len(values) - 1)
        w = pos - lo
        return values[lo] * (1 - w) + values[hi] * w
    return {
        "count": len(values),
        "min": round(min(values)),
        "p25": round(pct(0.25)),
        "median": round(median(values)),
        "p75": round(pct(0.75)),
        "max": round(max(values)),
    }


def near_twin_pairs(rows):
    pairs = []
    for i, left in enumerate(rows):
        dl = parse_date(left["dealDate"])
        for j in range(i + 1, len(rows)):
            right = rows[j]
            dr = parse_date(right["dealDate"])
            if abs((dr - dl).days) > 1:
                continue
            if str(left.get("gush")) != str(right.get("gush")):
                continue
            if str(left.get("helka")) != str(right.get("helka")):
                continue
            if left.get("rooms") != right.get("rooms") or left.get("area") != right.get("area"):
                continue
            if floor_number(left.get("floor")) != floor_number(right.get("floor")):
                continue
            if rel_diff(float(left["dealAmount"]), float(right["dealAmount"])) > 0.001:
                continue
            pairs.append((i, j, left, right))
    return pairs


def cross_source_matches(gov_rows, enriched_rows):
    matches = []
    for gi, gov in enumerate(gov_rows):
        if gov.get("rooms") != 5:
            continue
        gd = parse_date(gov["dealDate"])
        candidates = []
        for ei, enr in enumerate(enriched_rows):
            if enr.get("rooms") != 5:
                continue
            if str(gov.get("gush")) != str(enr.get("gush")) or str(gov.get("helka")) != str(enr.get("helka")):
                continue
            if float(gov.get("area") or 0) != float(enr.get("area") or 0):
                continue
            ed = parse_date(enr["dealDate"])
            day_gap = abs((ed - gd).days)
            if day_gap > 1:
                continue
            amount_gap = rel_diff(float(gov["dealAmount"]), float(enr["dealAmount"]))
            if amount_gap > 0.001:
                continue
            candidates.append((day_gap, amount_gap, ei, enr))
        if candidates:
            candidates.sort(key=lambda x: (x[0], x[1]))
            day_gap, amount_gap, ei, enr = candidates[0]
            matches.append({
                "govmap_index": gi,
                "enriched_index": ei,
                "day_gap": day_gap,
                "amount_gap_pct": amount_gap,
                "govmap": gov,
                "enriched": enr,
            })
    return matches


def parcel_summary(rows, gush, helka):
    selected = [
        r for r in rows
        if r.get("rooms") == 5 and str(r.get("gush")) == gush and str(r.get("helka")) == helka
    ]
    selected.sort(key=lambda r: (r["dealDate"], r["dealAmount"]))
    pps = [r["pricePerSqm"] for r in selected]
    return {
        "parcel": f"{gush}-{helka}",
        "records": len(selected),
        "min_ppsqm": min(pps) if pps else None,
        "median_ppsqm": round(median(pps)) if pps else None,
        "max_ppsqm": max(pps) if pps else None,
        "max_min_ratio": (max(pps) / min(pps)) if pps and min(pps) else None,
        "known_first_hand_true": sum(r.get("isFirstHand") is True for r in selected),
        "future_year_built": sum(isinstance(r.get("yearBuilt"), (int, float)) and r["yearBuilt"] > 2026 for r in selected),
        "rows": [
            {
                key: r.get(key)
                for key in [
                    "dealDate", "dealAmount", "pricePerSqm", "address", "neighborhoodName",
                    "rooms", "floor", "buildingFloors", "area", "yearBuilt", "propertyType",
                    "isFirstHand", "gush", "helka", "tatHelka", "assetId", "prevDeals",
                ]
            }
            for r in selected
        ],
    }


def main():
    enriched = load(ENRICHED)
    gov_local = load(GOVMAP_LOCAL)
    exact5 = [r for r in enriched if r.get("rooms") == 5]
    dates = sorted(parse_date(r["dealDate"]) for r in enriched if r.get("dealDate"))

    fields = [
        "address", "neighborhoodName", "floor", "buildingFloors", "yearBuilt",
        "propertyType", "isFirstHand", "assetId", "prevDeals", "trend",
    ]
    twins = near_twin_pairs(exact5)
    first_hand_true = [(i, r) for i, r in enumerate(exact5) if r.get("isFirstHand") is True]
    first_hand_true_with_richer_twin = 0
    for i, row in first_hand_true:
        for li, ri, left, right in twins:
            if i not in (li, ri):
                continue
            other = right if i == li else left
            if known(other.get("propertyType")):
                first_hand_true_with_richer_twin += 1
                break

    same_day_prev = [
        r for r in exact5
        if any(p.get("dealDate") == r.get("dealDate") for p in (r.get("prevDeals") or []))
    ]

    matches = cross_source_matches(gov_local, enriched)

    parcels = [
        parcel_summary(exact5, "1196", "70"),
        parcel_summary(exact5, "1196", "75"),
        parcel_summary(exact5, "1196", "100"),
        parcel_summary(exact5, "1197", "82"),
        parcel_summary(exact5, "1197", "93"),
        parcel_summary(exact5, "1196", "79"),
        parcel_summary(exact5, "370", "40"),
    ]

    all_parcels = defaultdict(list)
    for r in exact5:
        all_parcels[(str(r.get("gush")), str(r.get("helka")))].append(r)
    dispersion = []
    for (gush, helka), rows in all_parcels.items():
        if len(rows) < 2:
            continue
        pps = [float(r["pricePerSqm"]) for r in rows if known(r.get("pricePerSqm"))]
        if len(pps) < 2:
            continue
        dispersion.append({
            "parcel": f"{gush}-{helka}",
            "records": len(rows),
            "min_ppsqm": round(min(pps)),
            "median_ppsqm": round(median(pps)),
            "max_ppsqm": round(max(pps)),
            "max_min_ratio": max(pps) / min(pps),
            "first_hand_true": sum(r.get("isFirstHand") is True for r in rows),
            "future_year_built": sum(isinstance(r.get("yearBuilt"), (int, float)) and r["yearBuilt"] > 2026 for r in rows),
        })
    dispersion.sort(key=lambda x: x["max_min_ratio"], reverse=True)

    first_true_stats = stats_ppsqm([r for r in exact5 if r.get("isFirstHand") is True])
    first_unknown_stats = stats_ppsqm([r for r in exact5 if r.get("isFirstHand") is None])
    future_stats = stats_ppsqm([r for r in exact5 if isinstance(r.get("yearBuilt"), (int, float)) and r["yearBuilt"] > 2026])
    completed_stats = stats_ppsqm([r for r in exact5 if isinstance(r.get("yearBuilt"), (int, float)) and r["yearBuilt"] <= 2026])

    report = {
        "diagnostic_version": "tax-enrichment-diagnostics-v1",
        "warning": "Diagnostic only. No enriched field is promoted into production pricing or automatic exclusion by this report.",
        "source_sample": {
            "rows": len(enriched),
            "exact_5_room_rows": len(exact5),
            "requested_range": "36m",
            "observed_min_date": dates[0].isoformat() if dates else None,
            "observed_max_date": dates[-1].isoformat() if dates else None,
            "note": "The 250-row cap produced a recent citywide slice, not a complete 36-month Ashkelon history.",
            "coverage_all": coverage(enriched, fields),
            "coverage_exact_5_room": coverage(exact5, fields),
            "is_first_hand_values_all": {str(k): v for k, v in Counter(r.get("isFirstHand") for r in enriched).items()},
        },
        "cross_source": {
            "local_govmap_rows": len(gov_local),
            "matched_rows_strict_fuzzy": len(matches),
            "match_rule": "same rooms, gush, helka and area; date gap <= 1 day; amount gap <= 0.1%",
            "matches": [
                {
                    "govmap_index": m["govmap_index"],
                    "enriched_index": m["enriched_index"],
                    "day_gap": m["day_gap"],
                    "amount_gap_pct": m["amount_gap_pct"],
                    "govmap_date": m["govmap"].get("dealDate"),
                    "govmap_amount": m["govmap"].get("dealAmount"),
                    "govmap_ppsqm": m["govmap"].get("pricePerSqm"),
                    "gush": m["govmap"].get("gush"),
                    "helka": m["govmap"].get("helka"),
                    "enriched_date": m["enriched"].get("dealDate"),
                    "enriched_amount": m["enriched"].get("dealAmount"),
                    "enriched_ppsqm": m["enriched"].get("pricePerSqm"),
                    "yearBuilt": m["enriched"].get("yearBuilt"),
                    "buildingFloors": m["enriched"].get("buildingFloors"),
                    "isFirstHand": m["enriched"].get("isFirstHand"),
                    "prevDeals": m["enriched"].get("prevDeals"),
                }
                for m in matches
            ],
        },
        "near_twin_observation": {
            "near_twin_pairs_exact_5_room": len(twins),
            "first_hand_true_rows_exact_5_room": len(first_hand_true),
            "first_hand_true_rows_with_richer_near_twin": first_hand_true_with_richer_twin,
            "interpretation": "Near-twin/companion behavior is common enough that enrichment must not be treated as one-row-one-independent-sale. Existing conservative companion handling is supported; automatic merging is not.",
        },
        "same_day_prev_deals": {
            "count_exact_5_room": len(same_day_prev),
            "rows": [
                {
                    "dealDate": r.get("dealDate"),
                    "dealAmount": r.get("dealAmount"),
                    "pricePerSqm": r.get("pricePerSqm"),
                    "address": r.get("address"),
                    "gush": r.get("gush"),
                    "helka": r.get("helka"),
                    "tatHelka": r.get("tatHelka"),
                    "prevDeals": r.get("prevDeals"),
                }
                for r in same_day_prev
            ],
            "interpretation": "A prevDeals entry on the same date as the current transaction is a registry-complexity signal, not a clean historical repeat-sale observation. It should be flagged for review, not converted into a price adjustment.",
        },
        "descriptive_only": {
            "isFirstHand_true_ppsqm": first_true_stats,
            "isFirstHand_unknown_ppsqm": first_unknown_stats,
            "future_yearBuilt_ppsqm": future_stats,
            "completed_or_current_yearBuilt_ppsqm": completed_stats,
            "warning": "These are descriptive, confounded citywide summaries and are not causal premiums/discounts.",
        },
        "highest_parcel_dispersion": dispersion[:15],
        "focus_parcels": parcels,
        "conclusions": [
            "The enriched actor is useful as a secondary QA/segmentation source, not as a replacement for GovMap coordinates.",
            "isFirstHand can be genuinely informative when present, but it is sparse and does not by itself explain the local high/low price regimes.",
            "Future yearBuilt values identify planned-completion/new-build context, but the observed direction of price is not monotonic; yearBuilt is a segmentation field, not a price coefficient.",
            "The same parcel can contain radically different same-room/similar-area price regimes within weeks, including first-hand evidence in both regimes. Time normalization and floor alone cannot explain that.",
            "same-day prevDeals and same-day/same-subparcel conflicting prices are strong transaction-complexity signals and should reduce primary-comparable eligibility or confidence.",
            "No production pricing formula should change until these enrichment flags are joined conservatively to the GovMap records and re-tested in historical validation.",
        ],
        "next_experiment": [
            "Build a conservative cross-source enrichment join that never overwrites GovMap fields and records match confidence/provenance.",
            "Add diagnostic flags only: confirmed_first_hand_when_directly_matched, future_completion_context, same_day_prev_deal_complexity, and enriched_source_conflict.",
            "Re-run historical development validation with each flag independently; do not bundle changes.",
            "If a flag improves evidence reliability, validate the revised method on a fresh holdout before calling it production-ready.",
        ],
    }

    OUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Tax Authority Enrichment Diagnostics",
        "",
        "**Diagnostic only. No production pricing rule was changed.**",
        "",
        "## What the 250-row run actually contains",
        "",
        f"- rows: **{len(enriched)}**",
        f"- exact 5-room rows: **{len(exact5)}**",
        f"- observed dates: **{dates[0].isoformat()} → {dates[-1].isoformat()}**",
        "- because the run was capped at 250 rows, this is a recent citywide slice, **not** a complete 36-month history.",
        "",
        "### Enriched-field coverage on the 227 exact 5-room rows",
        "",
        "| Field | Known | Coverage |",
        "|---|---:|---:|",
    ]
    cov5 = coverage(exact5, fields)
    for field in fields:
        lines.append(f"| {field} | {cov5[field]} | {cov5[field] / len(exact5):.1%} |")

    lines += [
        "",
        "## Cross-source match against the targeted GovMap 5-room run",
        "",
        f"A conservative fuzzy join matched **{len(matches)} / {len(gov_local)}** targeted GovMap rows in this capped recent slice.",
        "The join requires same rooms, gush, helka and area; date within one day; amount within 0.1%.",
        "It is intentionally not used to overwrite the base transaction.",
        "",
        "## Main finding: first-hand status does not solve the price-regime problem",
        "",
        "Parcel `1197-82` contains 5-room units around 124–125 m² in two radically different price regimes during May 2026:",
        "",
        "- early-May rows around **₪11.7K–₪11.9K/m²**, including rows marked `isFirstHand=true`;",
        "- later-May rows around **₪20.6K–₪21.4K/m²**, also including `isFirstHand=true` and planned-completion year 2029.",
        "",
        "Therefore `isFirstHand` is useful context, but **cannot be used as a simple new-vs-resale split that explains the dispersion**.",
        "",
        "Parcel `1197-93` is the opposite pattern: a large group of developer/new-build-context 5-room deals is internally coherent around roughly **₪11.2K–₪11.9K/m²**, with several rows carrying planned completion year 2030.",
        "",
        "This supports **project/parcel-level regime segmentation** as an investigation, not an arbitrary global premium.",
        "",
        "## Source-complexity finding",
        "",
        f"There are **{len(twins)}** near-twin 5-room record pairs under the conservative diagnostic rule.",
        f"Of **{len(first_hand_true)}** exact 5-room rows marked `isFirstHand=true`, **{first_hand_true_with_richer_twin}** have a richer near-twin record in the same capped dataset.",
        "",
        f"There are also **{len(same_day_prev)}** exact 5-room records whose `prevDeals` contains a transaction on the **same date** as the current sale. That is not a clean repeat-sale history and should be treated as a transaction-complexity/review signal.",
        "",
        "## What we can safely conclude",
        "",
        "1. Keep GovMap as the geocoded base evidence source.",
        "2. Use the enriched Tax Authority actor as a **secondary enrichment and QA lane**.",
        "3. Do not transfer or merge fields across near-twin rows automatically.",
        "4. Do not create a generic `first-hand premium`, `future-build premium`, or floor premium.",
        "5. Add only provenance-preserving diagnostic flags first, then measure whether they improve historical validation.",
        "",
        "## Next controlled experiment",
        "",
        "- conservative cross-source matching with explicit match confidence;",
        "- flag direct `isFirstHand=true` only when the exact enriched row matches strongly;",
        "- flag future/planned completion context from `yearBuilt`;",
        "- flag same-day `prevDeals` / same-subparcel conflicts as transaction complexity;",
        "- test each flag independently in development validation;",
        "- only then modify comparable eligibility/ranking, followed by a fresh holdout.",
    ]
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(json.dumps({
        "rows": len(enriched),
        "exact_5_room": len(exact5),
        "date_min": dates[0].isoformat(),
        "date_max": dates[-1].isoformat(),
        "cross_source_matches": len(matches),
        "near_twin_pairs": len(twins),
        "first_hand_true": len(first_hand_true),
        "first_hand_true_with_richer_twin": first_hand_true_with_richer_twin,
        "same_day_prev_deals": len(same_day_prev),
        "top_dispersion": dispersion[:5],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
