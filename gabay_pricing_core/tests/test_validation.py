from __future__ import annotations

from datetime import date

from pricing_core import (
    HistoricalValidationPolicy,
    QualityStatus,
    benchmark_policies,
    choose_best_by_calibration_mdape,
    run_sold_qa,
    validate_policy,
)


def sold(*, idx: int, when: str, amount: int, area: int, address: str, lat: float, lng: float, rooms: int = 3):
    return {
        "dealDate": when,
        "dealAmount": amount,
        "pricePerSqm": round(amount / area),
        "address": address,
        "cityName": "אשקלון",
        "neighborhoodName": "עיר היין",
        "rooms": rooms,
        "floor": "3",
        "area": area,
        "propertyType": "דירה בבית קומות",
        "gush": "1",
        "helka": str(idx),
        "tatHelka": str(idx),
        "assetId": f"A{idx}",
        "lat": lat,
        "lng": lng,
    }


def qa(rows):
    out = run_sold_qa(rows)
    assert all(r.status is QualityStatus.USABLE for r in out.records)
    return out.records


def test_walk_forward_validation_never_uses_future_sale():
    rows = qa([
        sold(idx=1, when="2024-01-01", amount=1_000_000, area=100, address="A 1", lat=31.6800, lng=34.6000),
        sold(idx=2, when="2024-02-01", amount=1_100_000, area=100, address="B 1", lat=31.6810, lng=34.6000),
        sold(idx=3, when="2024-03-01", amount=1_200_000, area=100, address="C 1", lat=31.6820, lng=34.6000),
        sold(idx=4, when="2024-04-01", amount=9_000_000, area=100, address="D 1", lat=31.6830, lng=34.6000),
    ])
    policy = HistoricalValidationPolicy(name="nearest2", max_clusters=2)
    result = validate_policy(rows, policy, target_start=date(2024, 3, 1), target_end=date(2024, 4, 1))
    assert result.metrics.predicted_targets == 1
    prediction = result.predictions[0]
    assert prediction.target_date == date(2024, 3, 1)
    assert prediction.predicted_price == 1_050_000
    assert "D 1" not in prediction.selected_cluster_keys


def test_independent_building_cluster_contributes_once():
    rows = qa([
        sold(idx=1, when="2024-01-01", amount=1_000_000, area=100, address="A 1", lat=31.6800, lng=34.6000),
        sold(idx=2, when="2024-02-01", amount=1_200_000, area=100, address="A 1", lat=31.6800, lng=34.6000),
        sold(idx=3, when="2024-02-15", amount=2_000_000, area=100, address="B 1", lat=31.6810, lng=34.6000),
        sold(idx=4, when="2024-03-01", amount=1_500_000, area=100, address="C 1", lat=31.6820, lng=34.6000),
    ])
    policy = HistoricalValidationPolicy(name="all")
    result = validate_policy(rows, policy, target_start=date(2024, 3, 1))
    prediction = result.predictions[0]
    assert prediction.selected_cluster_count == 2
    assert set(prediction.selected_cluster_keys) == {"A 1", "B 1"}
    # A contributes its building median (1.1m), not two independent votes.
    assert prediction.predicted_price == 1_550_000


def test_area_filter_is_explicitly_widened_when_too_few_clusters_match():
    rows = qa([
        sold(idx=1, when="2024-01-01", amount=1_000_000, area=70, address="A 1", lat=31.6800, lng=34.6000),
        sold(idx=2, when="2024-02-01", amount=1_800_000, area=120, address="B 1", lat=31.6810, lng=34.6000),
        sold(idx=3, when="2024-03-01", amount=1_400_000, area=70, address="C 1", lat=31.6820, lng=34.6000),
    ])
    policy = HistoricalValidationPolicy(name="area15", max_clusters=3, area_band_pct=0.15)
    result = validate_policy(rows, policy, target_start=date(2024, 3, 1))
    prediction = result.predictions[0]
    assert prediction.area_filter_fallback is True
    assert prediction.used_area_filter is False


def test_target_building_can_be_excluded_for_robustness_check():
    rows = qa([
        sold(idx=1, when="2024-01-01", amount=1_000_000, area=100, address="A 1", lat=31.6800, lng=34.6000),
        sold(idx=2, when="2024-01-15", amount=1_100_000, area=100, address="B 1", lat=31.6810, lng=34.6000),
        sold(idx=3, when="2024-02-01", amount=1_050_000, area=100, address="C 1", lat=31.6820, lng=34.6000),
        sold(idx=4, when="2024-03-01", amount=1_300_000, area=100, address="A 1", lat=31.6800, lng=34.6000),
    ])
    policy = HistoricalValidationPolicy(name="strict", max_clusters=3, exclude_target_building=True)
    result = validate_policy(rows, policy, target_start=date(2024, 3, 1))
    prediction = result.predictions[0]
    assert "A 1" not in prediction.selected_cluster_keys
    assert set(prediction.selected_cluster_keys) == {"B 1", "C 1"}


def test_best_policy_selection_uses_calibration_mdape_only():
    rows = qa([
        sold(idx=1, when="2024-01-01", amount=1_000_000, area=100, address="A 1", lat=31.6800, lng=34.6000),
        sold(idx=2, when="2024-02-01", amount=1_100_000, area=100, address="B 1", lat=31.6810, lng=34.6000),
        sold(idx=3, when="2024-03-01", amount=1_200_000, area=100, address="C 1", lat=31.6820, lng=34.6000),
        sold(idx=4, when="2024-04-01", amount=1_300_000, area=100, address="D 1", lat=31.6830, lng=34.6000),
    ])
    policies = [
        HistoricalValidationPolicy(name="two", max_clusters=2),
        HistoricalValidationPolicy(name="three", max_clusters=3),
    ]
    results = benchmark_policies(rows, policies, target_start=date(2024, 3, 1))
    best = choose_best_by_calibration_mdape(results)
    assert best is not None
    assert best.policy.name in {"two", "three"}
