import json
import requests


URL = "https://data.nadlan.gov.il/api/pages/neighborhood/buy/65210134.json"


print("=" * 70)
print("NADLAN.GOV.IL STATIC DATA TEST")
print("=" * 70)
print("URL:", URL)

response = requests.get(
    URL,
    timeout=30,
    headers={
        "User-Agent": "Mozilla/5.0"
    },
)

print("HTTP status:", response.status_code)
print("Content-Type:", response.headers.get("content-type"))
print("Bytes:", len(response.content))

response.raise_for_status()

data = response.json()


print("\n" + "=" * 70)
print("TOP-LEVEL KEYS")
print("=" * 70)

if isinstance(data, dict):
    for key in data.keys():
        print("-", key)
else:
    print("Unexpected root type:", type(data).__name__)


print("\n" + "=" * 70)
print("FULL RESPONSE")
print("=" * 70)

print(
    json.dumps(
        data,
        ensure_ascii=False,
        indent=2,
        default=str,
    )
)


with open(
    "nadlan_gov_7100.json",
    "w",
    encoding="utf-8",
) as f:
    json.dump(
        data,
        f,
        ensure_ascii=False,
        indent=2,
        default=str,
    )

print("\nSaved to nadlan_gov_7100.json")