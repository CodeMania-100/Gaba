"""Read-only Petah Tikva snapshot contamination audit.

Inspects only the frozen Petah Tikva evidence/market-range/price-list/workspace
chain plus the Petah Tikva integration scripts (grep only). Never modifies any
file. Run before any multi-city demo work to confirm the Petah Tikva chain
carries no Ashkelon ("City Wine") contamination -- either as literal text, as
an imported Ashkelon-only program-regime classifier, or as a numeric mismatch
between the frozen market-range file and what the price list / workspace
payload actually report.

Usage: PYTHONIOENCODING=utf-8 python audit_petah_tikva_snapshot.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path.cwd()
FROZEN = ROOT / "data" / "frozen"

FILES = {
    "sold": FROZEN / "petah_tikva_standard_sold_evidence_v1.json",
    "asking": FROZEN / "petah_tikva_standard_asking_evidence_v1.json",
    "competitor": FROZEN / "petah_tikva_standard_competitor_evidence_v1.json",
    "market_ranges": FROZEN / "petah_tikva_standard_market_ranges_v1.json",
    "price_list": FROZEN / "petah_tikva_standard_price_list_v1.json",
    "workspace_payload": FROZEN / "petah_tikva_workspace_payload_v1.json",
}

INTEGRATION_SCRIPTS = [
    ROOT / "freeze_petah_tikva_sold_v1.py",
    ROOT / "freeze_petah_tikva_asking_v1.py",
    ROOT / "freeze_petah_tikva_competitors_v1.py",
    ROOT / "run_petah_tikva_market_ranges_v1.py",
    ROOT / "run_petah_tikva_standard_price_list_v1.py",
    ROOT / "run_petah_tikva_workspace_payload_v1.py",
    ROOT / "petah_tikva_pricing.py",
    ROOT / "app_api" / "petah_tikva_workspace.py",
]

# Exactly the terms the task named.
REQUIRED_TERMS = ["אשקלון", "Ashkelon", "ashkelon", "city wine", "City Wine", "city_wine"]
# Extra, beyond what was asked: the Hebrew name for the same demo market, and a
# few other Ashkelon-only identifiers this codebase is known to use elsewhere
# (see app_api/demo_snapshot.py / CHECKPOINT.md) -- checked because missing them
# would leave an obvious contamination vector unaudited.
EXTRA_TERMS = [
    "עיר היין", "רמות אשקלון", "רמת כרמים", "CITY_WINE", "wine_city",
    "tax_enriched_ashkelon", "madlan_apify_200", "sold_deals_raw",
    "assess_market_regime", "אפי בעיר היין",
]
ALL_TERMS = REQUIRED_TERMS + EXTRA_TERMS
TERM_PATTERN = re.compile("|".join(re.escape(t) for t in ALL_TERMS), re.IGNORECASE)

# Valid Petah Tikva city spellings. Both appear by design in the frozen sold
# evidence file (top-level demo_location uses the double-vav spelling
# "פתח תקווה"; per-family scope uses the single-vav "פתח תקוה"). This is a
# known, already-handled orthographic quirk -- not contamination -- and sold
# transaction rows intentionally omit cityName entirely (see
# petah_tikva_pricing.py / app_api/petah_tikva_workspace.py docstrings on the
# spelling-driven city-mismatch gate risk). Both spellings are accepted here.
VALID_CITY_SPELLINGS = {"פתח תקווה", "פתח תקוה"}
VALID_NEIGHBORHOOD = "מרכז העיר"
VALID_COMMERCIAL_AREA_FRAGMENT = "המרכז השקט"


class Finding:
    def __init__(self, file: str, json_path: str, term: str, value: Any):
        self.file = file
        self.json_path = json_path
        self.term = term
        self.value = value

    def render(self) -> str:
        snippet = str(self.value)
        if len(snippet) > 160:
            snippet = snippet[:160] + "..."
        return f"  [{self.file}] {self.json_path} -- matched {self.term!r}: {snippet!r}"


def scan_for_terms(obj: Any, path: str, file_label: str, findings: list[Finding]) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            scan_for_terms(v, f"{path}.{k}", file_label, findings)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            scan_for_terms(v, f"{path}[{i}]", file_label, findings)
    elif isinstance(obj, str):
        m = TERM_PATTERN.search(obj)
        if m:
            findings.append(Finding(file_label, path, m.group(0), obj))


def load(path: Path) -> Any:
    if not path.exists():
        raise SystemExit(f"FATAL: required frozen file missing: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    docs = {key: load(path) for key, path in FILES.items()}
    findings: list[Finding] = []
    for key, doc in docs.items():
        scan_for_terms(doc, "$", key, findings)

    script_findings: list[str] = []
    for script in INTEGRATION_SCRIPTS:
        if not script.exists():
            script_findings.append(f"  MISSING SCRIPT: {script}")
            continue
        text = script.read_text(encoding="utf-8")
        for m in TERM_PATTERN.finditer(text):
            line_no = text.count("\n", 0, m.start()) + 1
            line = text.splitlines()[line_no - 1].strip()
            script_findings.append(f"  [{script.name}:{line_no}] matched {m.group(0)!r}: {line[:160]!r}")

    results: dict[str, tuple[bool, list[str]]] = {}

    # --- Geography -----------------------------------------------------------
    geo_issues: list[str] = []
    ws = docs["workspace_payload"]
    if ws["project"]["city"] not in VALID_CITY_SPELLINGS:
        geo_issues.append(f"workspace_payload.project.city = {ws['project']['city']!r}")
    if ws["project"]["official_neighborhood"] != VALID_NEIGHBORHOOD:
        geo_issues.append(f"workspace_payload.project.official_neighborhood = {ws['project']['official_neighborhood']!r}")
    if VALID_COMMERCIAL_AREA_FRAGMENT not in ws["project"]["commercial_area"]:
        geo_issues.append(f"workspace_payload.project.commercial_area = {ws['project']['commercial_area']!r}")
    for key in ("sold", "asking", "competitor", "market_ranges"):
        dl = docs[key].get("demo_location")
        if dl and dl.get("city") not in VALID_CITY_SPELLINGS:
            geo_issues.append(f"{key}.demo_location.city = {dl.get('city')!r}")
    results["Geography"] = (not geo_issues, geo_issues)

    # --- Sold evidence ---------------------------------------------------------
    sold_issues: list[str] = []
    for fam in ("3R", "5R"):
        scope = docs["sold"]["families"][fam]["scope"]
        if scope["city"] not in VALID_CITY_SPELLINGS:
            sold_issues.append(f"sold.families.{fam}.scope.city = {scope['city']!r}")
        if scope["official_neighborhood"] != VALID_NEIGHBORHOOD:
            sold_issues.append(f"sold.families.{fam}.scope.official_neighborhood = {scope['official_neighborhood']!r}")
        # Deliberately NOT checking per-transaction cityName -- intentionally
        # absent (see module docstring / VALID_CITY_SPELLINGS comment above).
        addresses = [t.get("address") for t in docs["sold"]["families"][fam]["transactions"] if t.get("address")]
        bad = [a for a in addresses if TERM_PATTERN.search(a)]
        if bad:
            sold_issues.append(f"sold.families.{fam}: {len(bad)} transaction address(es) matched a contamination term: {bad[:3]}")
    results["Sold evidence"] = (not sold_issues, sold_issues)

    # --- Asking evidence ---------------------------------------------------------
    asking_issues: list[str] = []
    for fam in ("3R", "5R"):
        fam_doc = docs["asking"]["families"][fam]
        src = fam_doc["source_file"]
        if "petah_tikva" not in src.lower():
            asking_issues.append(f"asking.families.{fam}.source_file does not reference petah_tikva: {src!r}")
        for lane in ("accepted_listings", "rejected_listings"):
            bad_city = [r for r in fam_doc[lane] if r.get("city") and r["city"] not in VALID_CITY_SPELLINGS]
            if bad_city:
                asking_issues.append(
                    f"asking.families.{fam}.{lane}: {len(bad_city)} record(s) with non-Petah-Tikva city, "
                    f"e.g. {bad_city[0].get('listing_id')}: city={bad_city[0].get('city')!r}"
                )
    results["Asking evidence"] = (not asking_issues, asking_issues)

    # --- Competitors ---------------------------------------------------------
    comp_issues: list[str] = []
    for r in docs["competitor"]["records"]:
        addr = r.get("address") or ""
        if "פתח תקווה" not in addr and "פתח תקוה" not in addr:
            comp_issues.append(f"competitor record {r.get('project_id')!r} address does not mention Petah Tikva: {addr!r}")
        if TERM_PATTERN.search(json.dumps(r, ensure_ascii=False)):
            comp_issues.append(f"competitor record {r.get('project_id')!r} matched a contamination term")
    results["Competitors"] = (not comp_issues, comp_issues)

    # --- Program classification -----------------------------------------------
    program_issues: list[str] = []
    program_check = docs["sold"].get("program_check", {})
    if TERM_PATTERN.search(json.dumps(program_check, ensure_ascii=False)):
        program_issues.append(f"sold.program_check matched a contamination term: {program_check}")
    # The Ashkelon-only market-regime classifier (CITY_WINE_STANDARD_*_PROGRAM_REGIME_V1,
    # assess_market_regime) must never be imported/used by the Petah Tikva chain --
    # checked via the script grep below, not here (it's a code-level, not data-level, fact).
    if any("CITY_WINE" in f or "assess_market_regime" in f for f in script_findings):
        program_issues.append("an integration script references the Ashkelon-only market-regime classifier (see script findings)")
    results["Program classification"] = (not program_issues, program_issues)

    # --- Market range provenance -----------------------------------------------
    mr_issues: list[str] = []
    mr = docs["market_ranges"]
    if mr["demo_location"]["city"] not in VALID_CITY_SPELLINGS:
        mr_issues.append(f"market_ranges.demo_location.city = {mr['demo_location']['city']!r}")
    methodology_version = mr["families"]["3R"]["market_range"]["methodology"]["version"]
    if TERM_PATTERN.search(methodology_version):
        mr_issues.append(f"market_ranges methodology.version matched a contamination term: {methodology_version!r}")
    results["Market range provenance"] = (not mr_issues, mr_issues)

    # --- Price-list provenance (cross-file numeric consistency) ----------------
    pl_issues: list[str] = []
    pl = docs["price_list"]
    expected_basis = FILES["market_ranges"].name
    if pl["market_basis_file"] != expected_basis:
        pl_issues.append(f"price_list.market_basis_file = {pl['market_basis_file']!r}, expected {expected_basis!r}")
    for fam in ("3R", "5R"):
        mr_lower = mr["families"][fam]["market_range"]["supported_range"]["lower"]
        mr_upper = mr["families"][fam]["market_range"]["supported_range"]["upper"]
        pl_rows = [r for r in pl["price_list"] if r["family"] == fam]
        if not pl_rows:
            pl_issues.append(f"price_list has no rows for family {fam}")
            continue
        mismatched = [
            r["unit_number"] for r in pl_rows
            if r["market_range"]["lower"] != mr_lower or r["market_range"]["upper"] != mr_upper
        ]
        if mismatched:
            pl_issues.append(
                f"price_list family {fam}: {len(mismatched)} unit(s) whose embedded market_range "
                f"does not match market_ranges.families.{fam} ({mr_lower}-{mr_upper}): units {mismatched[:5]}"
            )
    results["Price-list provenance"] = (not pl_issues, pl_issues)

    # --- Workspace payload (cross-file consistency against price_list/market_ranges) --
    wp_issues: list[str] = []
    if ws["project"]["total_standard_unit_revenue_ils"] != pl["total_standard_unit_revenue_ils"]:
        wp_issues.append(
            "workspace_payload.project.total_standard_unit_revenue_ils "
            f"({ws['project']['total_standard_unit_revenue_ils']}) != "
            f"price_list.total_standard_unit_revenue_ils ({pl['total_standard_unit_revenue_ils']})"
        )
    for fam_entry in ws["families"]:
        fam = fam_entry["family"]
        mr_lower = mr["families"][fam]["market_range"]["supported_range"]["lower"]
        mr_upper = mr["families"][fam]["market_range"]["supported_range"]["upper"]
        if fam_entry["market"]["supported_lower"] != mr_lower or fam_entry["market"]["supported_upper"] != mr_upper:
            wp_issues.append(
                f"workspace_payload family {fam} supported range "
                f"({fam_entry['market']['supported_lower']}-{fam_entry['market']['supported_upper']}) != "
                f"market_ranges ({mr_lower}-{mr_upper})"
            )
    results["Workspace payload"] = (not wp_issues, wp_issues)

    # --- Report ------------------------------------------------------------------
    print("PETAH TIKVA SNAPSHOT AUDIT")
    print()
    label_width = max(len(k) for k in results) + 2
    all_pass = True
    for label, (ok, issues) in results.items():
        status = "PASS" if ok else "FAIL"
        all_pass = all_pass and ok
        print(f"{label:<{label_width}} {status}")
    print()
    print(f"Suspicious references (frozen JSON files): {len(findings)}")
    for f in findings:
        print(f.render())
        all_pass = False
    print()
    print(f"Suspicious references (integration scripts, grep only): {len(script_findings)}")
    for line in script_findings:
        print(line)
        all_pass = False

    print()
    for label, (ok, issues) in results.items():
        if not ok:
            print(f"--- {label} details ---")
            for issue in issues:
                print(f"  {issue}")

    print()
    print("OVERALL:", "PASS" if all_pass else "FAIL -- see details above")
    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
