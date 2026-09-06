from __future__ import annotations

from pricing_core import QualityStatus, run_sold_qa


def rec(**overrides):
    base = {
        "dealDate": "2026-01-10",
        "dealAmount": 1700000,
        "pricePerSqm": 21250,
        "address": "נחלה 7",
        "cityName": "אשקלון",
        "neighborhoodName": None,
        "rooms": 3,
        "floor": "4",
        "area": 80,
        "propertyType": "דירה בבית קומות",
        "isFirstHand": None,
        "gush": "1200",
        "helka": "72",
        "tatHelka": "31",
        "assetId": "A1",
        "lat": 31.6766979,
        "lng": 34.5906070,
        "scrapedAt": "2026-09-04T18:54:18Z",
    }
    base.update(overrides)
    return base


def test_unknown_property_type_stays_unknown_and_low_confidence():
    result = run_sold_qa([rec(propertyType=None)]).records[0]
    assert result.normalized_property_type is None
    assert result.status is QualityStatus.LOW_CONFIDENCE
    assert "property_type_unknown" in result.reasons


def test_exact_duplicate_keeps_one_and_rejects_one():
    row = rec()
    output = run_sold_qa([row, dict(row)])
    statuses = sorted(r.status.value for r in output.records)
    assert statuses == ["rejected", "usable"]
    assert sum("exact_duplicate" in r.reasons for r in output.records) == 1


def test_same_registered_unit_same_day_conflicting_amount_is_ambiguous():
    a = rec(assetId="A1", dealAmount=834000, pricePerSqm=10831)
    b = rec(assetId="A2", dealAmount=838000, pricePerSqm=10883)
    output = run_sold_qa([a, b])
    assert all(r.status is QualityStatus.AMBIGUOUS for r in output.records)
    assert all("same_registered_unit_same_day_conflict" in r.reasons for r in output.records)


def test_possible_companion_pair_flags_unknown_record_but_does_not_delete_it():
    known = rec(
        dealDate="2026-07-21",
        dealAmount=1680000,
        floor="9",
        tatHelka="21",
        assetId="known",
        propertyType="דירה בבית קומות",
    )
    unknown = rec(
        dealDate="2026-07-20",
        dealAmount=1680000,
        floor="9",
        tatHelka="20",
        assetId="unknown",
        propertyType=None,
    )
    output = run_sold_qa([known, unknown])
    by_id = {r.transaction.asset_id: r for r in output.records}
    assert by_id["known"].status is QualityStatus.USABLE
    assert by_id["unknown"].status is QualityStatus.LOW_CONFIDENCE
    assert "possible_companion_record" in by_id["unknown"].reasons
    assert output.summary["raw_records"] == 2


def test_far_outlier_is_review_not_auto_rejected():
    rows = []
    for i, ppsqm in enumerate([18000, 18100, 18200, 18300, 18400, 18500, 18600, 18700]):
        rows.append(
            rec(
                dealDate=f"2026-01-{10+i:02d}",
                dealAmount=ppsqm * 80,
                pricePerSqm=ppsqm,
                tatHelka=str(100 + i),
                assetId=f"normal-{i}",
                floor=str(i + 1),
            )
        )
    rows.append(
        rec(
            dealDate="2026-02-01",
            dealAmount=15300000,
            pricePerSqm=186585,
            address="עמק יזרעאל 101",
            tatHelka="999",
            assetId="extreme",
            floor="2",
            area=82,
        )
    )
    output = run_sold_qa(rows)
    extreme = next(r for r in output.records if r.transaction.asset_id == "extreme")
    assert extreme.status is QualityStatus.LOW_CONFIDENCE
    assert "far_price_per_sqm_outlier" in extreme.reasons


def test_coherent_high_value_cluster_is_not_rejected_as_bad_data():
    rows = []
    for i, ppsqm in enumerate([17400, 17600, 17800, 18000, 18100, 18300]):
        rows.append(
            rec(
                dealDate=f"2026-03-{10+i:02d}",
                dealAmount=ppsqm * 140,
                pricePerSqm=ppsqm,
                address="עמק יזרעאל 99",
                rooms=5,
                area=140,
                floor=str(i + 2),
                tatHelka=str(200 + i),
                assetId=f"cluster-{i}",
            )
        )
    # Add ordinary same-room market observations so the cluster is assessed in context.
    for i, ppsqm in enumerate([14500, 15000, 15500, 16000, 16500, 17000, 17500, 18000]):
        rows.append(
            rec(
                dealDate=f"2026-04-{10+i:02d}",
                dealAmount=ppsqm * 140,
                pricePerSqm=ppsqm,
                address=f"רחוב {i}",
                rooms=5,
                area=140,
                floor="3",
                tatHelka=str(300 + i),
                assetId=f"market-{i}",
            )
        )
    output = run_sold_qa(rows)
    cluster = [r for r in output.records if r.transaction.address == "עמק יזרעאל 99"]
    assert all(r.status is not QualityStatus.REJECTED for r in cluster)
    assert all("far_price_per_sqm_outlier" not in r.reasons for r in cluster)


def test_missing_address_with_coordinates_is_not_rejected():
    rows = [rec(address=None, lat=31.6812, lng=34.6009, gush="1", helka="2", tatHelka="3")]
    out = run_sold_qa(rows)
    assert out.records[0].status is QualityStatus.USABLE
    assert "address_missing_but_geographic_locator_available" in out.records[0].reasons
