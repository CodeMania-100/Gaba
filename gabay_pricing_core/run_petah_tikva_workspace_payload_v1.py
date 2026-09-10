import json
from pathlib import Path

from app_api.petah_tikva_workspace import build_petah_tikva_workspace_payload

ROOT = Path.cwd()

OUT = (
    ROOT / "data" / "frozen"
    / "petah_tikva_workspace_payload_v1.json"
)

payload = build_petah_tikva_workspace_payload()

# Minimum validation only (per task): load once, verify the numbers the UI
# workspace screen depends on. Not a broad test suite.
families_by_key = {f["family"]: f for f in payload["families"]}
assert set(families_by_key) == {"3R", "5R"}, families_by_key.keys()
for fam in ("3R", "5R"):
    m = families_by_key[fam]["market"]
    assert m["status"] == "consensus", (fam, m)
    assert m["supported_lower"] is not None and m["supported_upper"] is not None, (fam, m)

standard_rows = [r for r in payload["price_list"] if r["status"] == "priced"]
special_rows = [r for r in payload["price_list"] if r["status"] == "manual_special_pricing_pending"]
assert len(payload["price_list"]) == 39, len(payload["price_list"])
assert len(standard_rows) == 32, len(standard_rows)
assert len(special_rows) == 7, len(special_rows)

assert payload["project"]["total_standard_unit_revenue_ils"] == sum(
    r["proposed_list_price_ils"] for r in standard_rows
), "revenue mismatch between project total and summed standard rows"

for fam in ("3R", "5R"):
    sold_records = payload["evidence_provenance"]["sold"][fam]["records"]
    asking_records = payload["evidence_provenance"]["current_asking"][fam]["accepted_records"]
    competitor_records = payload["evidence_provenance"]["new_development"][fam]["records"]
    assert len(sold_records) > 0, (fam, "sold")
    assert len(asking_records) > 0, (fam, "asking")
    assert len(competitor_records) > 0, (fam, "competitor")

competitor_3r = payload["evidence_provenance"]["new_development"]["3R"]["records"]
context_only = [r for r in competitor_3r if r.get("evidence_status") == "CONTEXT_ONLY"]
assert context_only, "expected at least one CONTEXT_ONLY competitor record to survive into the payload"

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(
    json.dumps(payload, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

print("VALIDATION OK")
print("total_units:", payload["project"]["total_units"])
print("standard_units_priced:", payload["project"]["standard_units_priced"])
print("special_units_pending:", payload["project"]["special_units_pending"])
print("total_standard_unit_revenue_ils:", payload["project"]["total_standard_unit_revenue_ils"])
for fam in ("3R", "5R"):
    m = families_by_key[fam]
    print(
        fam,
        "| range:", m["market"]["supported_lower"], "-", m["market"]["supported_upper"],
        "| confidence:", m["market"]["confidence"],
        "| support_lanes:", m["market"]["support_lanes"],
        "| proposed_family_price:", m["proposed_family_price_ils"],
    )
print()
print("SAVED:", OUT)
