from collections import Counter

from nadlan_mcp.govmap import GovmapClient


ADDRESS = "סוקולוב 38 חולון"

client = GovmapClient()

print("=" * 70)
print("FETCHING DEALS")
print("=" * 70)

deals = client.find_recent_deals_for_address(
    ADDRESS,
    years_back=5,
    radius=500,
    max_deals=100,
)

print(f"All deals: {len(deals)}")

# Keep only actual apartments
residential = [
    d
    for d in deals
    if getattr(d, "property_type_description", None) == "דירה"
]

print(f"Residential apartments: {len(residential)}")


# ------------------------------------------------------------
# 1. DUPLICATES
# ------------------------------------------------------------

print("\n" + "=" * 70)
print("1. DUPLICATE DEAL IDs")
print("=" * 70)

ids = [
    getattr(d, "dealId", None)
    for d in residential
]

counts = Counter(ids)

duplicates = {
    deal_id: count
    for deal_id, count in counts.items()
    if deal_id is not None and count > 1
}

print("Duplicates:", duplicates or "None")


# ------------------------------------------------------------
# 2. SUSPICIOUS VALUES
# IMPORTANT:
# These thresholds are ONLY for inspection.
# We are NOT saying these deals are invalid.
# ------------------------------------------------------------

print("\n" + "=" * 70)
print("2. SUSPICIOUS PRICE / SQM RECORDS")
print("=" * 70)

suspicious_count = 0

for d in residential:
    price = getattr(d, "deal_amount", None)
    ppm = getattr(d, "price_per_sqm", None)

    suspicious = (
        price is not None and price < 700_000
    ) or (
        ppm is not None and ppm < 10_000
    )

    if not suspicious:
        continue

    suspicious_count += 1

    print("\n--- SUSPICIOUS DEAL ---")

    for field in [
        "dealId",
        "objectid",
        "deal_date",
        "deal_amount",
        "asset_area",
        "rooms",
        "floorNo",
        "price_per_sqm",
        "dealNatureDescription",
        "property_type_description",
        "deal_type",
        "deal_type_description",
        "gushNum",
        "parcelNum",
        "subParcelNum",
        "streetNameHeb",
        "houseNum",
        "neighborhood",
        "deal_source",
        "distance_meters",
    ]:
        print(
            f"{field:28}: "
            f"{getattr(d, field, None)}"
        )

print(f"\nSuspicious records found: {suspicious_count}")


# ------------------------------------------------------------
# 3. RAW STREET RECORD
# ------------------------------------------------------------

print("\n" + "=" * 70)
print("3. RAW STREET RESULT")
print("=" * 70)

street_found = False

for d in residential:
    if getattr(d, "deal_source", None) == "street":
        street_found = True

        if hasattr(d, "model_dump"):
            print(d.model_dump())
        elif hasattr(d, "dict"):
            print(d.dict())
        else:
            print(vars(d))

        break

if not street_found:
    print("No street result found")


# ------------------------------------------------------------
# 4. RAW NEIGHBORHOOD RECORD
# ------------------------------------------------------------

print("\n" + "=" * 70)
print("4. RAW NEIGHBORHOOD RESULT")
print("=" * 70)

neighborhood_found = False

for d in residential:
    if getattr(d, "deal_source", None) == "neighborhood":
        neighborhood_found = True

        if hasattr(d, "model_dump"):
            print(d.model_dump())
        elif hasattr(d, "dict"):
            print(d.dict())
        else:
            print(vars(d))

        break

if not neighborhood_found:
    print("No neighborhood result found")


# ------------------------------------------------------------
# 5. ADDRESS COMPLETENESS BY SOURCE
# ------------------------------------------------------------

print("\n" + "=" * 70)
print("5. ADDRESS COMPLETENESS BY SOURCE")
print("=" * 70)

for source in ["same_building", "street", "neighborhood"]:
    subset = [
        d
        for d in residential
        if getattr(d, "deal_source", None) == source
    ]

    if not subset:
        continue

    with_street = sum(
        getattr(d, "streetNameHeb", None) not in (None, "")
        for d in subset
    )

    with_house = sum(
        getattr(d, "houseNum", None) not in (None, "")
        for d in subset
    )

    print(
        f"{source:15} "
        f"count={len(subset):2} | "
        f"street={with_street:2}/{len(subset):2} | "
        f"house={with_house:2}/{len(subset):2}"
    )