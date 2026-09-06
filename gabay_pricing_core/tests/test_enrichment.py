from pricing_core.enrichment import match_tax_enrichment


def base(**overrides):
    row = {
        "dealDate": "2026-05-19",
        "dealAmount": 2180000,
        "rooms": 5,
        "floor": "7",
        "area": 128,
        "propertyType": "דירה בבית קומות",
        "gush": "1196",
        "helka": "100",
        "tatHelka": "49",
        "assetId": "ABC",
    }
    row.update(overrides)
    return row


def enriched(**overrides):
    row = {
        "dealDate": "2026-05-19",
        "dealAmount": 2180000,
        "rooms": 5,
        "floor": "שביעית",
        "area": 128,
        "propertyType": "דירה בבית קומות",
        "gush": "1196",
        "helka": "100",
        "tatHelka": "39",
        "assetId": "ABC",
        "yearBuilt": 2028,
        "buildingFloors": None,
        "isFirstHand": None,
        "prevDeals": None,
        "trend": None,
    }
    row.update(overrides)
    return row


def test_exact_asset_match_can_expose_attributes_without_overwriting_conflict():
    result = match_tax_enrichment([base()], [enriched()])[0]
    assert result.status == "matched_direct"
    assert result.match_basis == "asset_id"
    assert result.can_use_attributes is True
    assert result.year_built == 2028
    assert result.future_completion_context is True
    assert "tatHelka_conflict" in result.conflicts


def test_registered_unit_match_can_expose_direct_first_hand_flag():
    b = base(assetId="BASE", tatHelka="19", dealDate="2026-06-20", dealAmount=2256980, area=124)
    e = enriched(assetId="ENRICHED", tatHelka="19", dealDate="2026-06-20", dealAmount=2256980, area=124, isFirstHand=True, yearBuilt=None)
    result = match_tax_enrichment([b], [e])[0]
    assert result.status == "matched_direct"
    assert result.match_basis == "registered_unit"
    assert result.is_first_hand is True
    assert "assetId_conflict" in result.conflicts


def test_near_parcel_match_is_diagnostic_only():
    e = enriched(assetId=None, tatHelka="1", dealDate="2026-05-20", dealAmount=2180500)
    result = match_tax_enrichment([base(assetId=None)], [e])[0]
    assert result.status == "diagnostic_near_match"
    assert result.can_use_attributes is False
    assert result.year_built is None


def test_same_day_prev_deal_is_complexity_flag_not_price_adjustment():
    e = enriched(prevDeals=[{"dealDate": "2026-05-19", "dealAmount": 1500000}])
    result = match_tax_enrichment([base()], [e])[0]
    assert result.same_day_prev_deal_complexity is True
    assert result.can_use_attributes is True


def test_future_year_does_not_synthesize_first_hand():
    result = match_tax_enrichment([base()], [enriched(yearBuilt=2030, isFirstHand=None)])[0]
    assert result.future_completion_context is True
    assert result.is_first_hand is None


def test_reverse_collision_disables_attribute_use():
    rows = [base(), base(tatHelka="48")]
    e = [enriched(tatHelka="39")]
    results = match_tax_enrichment(rows, e)
    assert all(r.status == "ambiguous_reverse_collision" for r in results)
    assert all(r.can_use_attributes is False for r in results)
    assert all(r.year_built is None for r in results)
