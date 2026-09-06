from pricing_core.market_regime import (
    CITY_WINE_STANDARD_3ROOM_69M2_PROGRAM_REGIME_V1,
    CITY_WINE_STANDARD_5ROOM_111M2_PROGRAM_REGIME_V1,
    MarketRegime,
    OfficialProgramProject,
    ParcelProgramContext,
    assess_market_regime,
    assessment_from_dict,
    compute_observed_ppsm,
    parcel_context_from_dict,
)

SOURCE = "test"


def _parcel(*price_for_meters, gush=1196, helka=70, program_overlap=True, resolved=True):
    projects = [
        OfficialProgramProject(
            active_project_id=100 + i,
            project_name=f"p{i}",
            marketing_method="מחיר מטרה",
            neighborhood=None,
            lamas_name=None,
            provider_name=None,
            price_for_meter=v,
            lottery_ids=[],
        )
        for i, v in enumerate(price_for_meters)
    ]
    return ParcelProgramContext(gush=gush, helka=helka, resolved=resolved, program_overlap=program_overlap, projects=projects)


def _delta(observed, nearest):
    return (observed - nearest) / nearest * 100


def _observed_for_delta(nearest, delta_pct):
    return nearest * (1 + delta_pct / 100)


def test_3room_boundaries_exact():
    # Values are constructed a hair inside each zone rather than at the literal
    # float-reconstructed boundary, since observed = nearest*(1+pct/100) followed by
    # delta = (observed-nearest)/nearest*100 is not guaranteed to round-trip to the
    # exact same float as `pct` (this is a floating-point-arithmetic property of the
    # *test's* round trip, not evidence of rounding inside assess_market_regime,
    # which never rounds before comparing). A 1e-6 margin is ~1800x tighter than the
    # gap a rounded-to-8.26 comparison would introduce, so this still catches that
    # regression class.
    policy = CITY_WINE_STANDARD_3ROOM_69M2_PROGRAM_REGIME_V1
    parcel = _parcel(10000)

    just_inside_program = _observed_for_delta(10000, policy.program_like_max_delta_pct - 1e-6)
    result = assess_market_regime(parcel=parcel, observed_ppsm=just_inside_program, policy=policy, source=SOURCE)
    assert result.regime is MarketRegime.PROGRAM_LIKE

    mid = _observed_for_delta(10000, (policy.program_like_max_delta_pct + policy.market_like_min_delta_pct) / 2)
    result = assess_market_regime(parcel=parcel, observed_ppsm=mid, policy=policy, source=SOURCE)
    assert result.regime is MarketRegime.AMBIGUOUS

    just_inside_market = _observed_for_delta(10000, policy.market_like_min_delta_pct + 1e-6)
    result = assess_market_regime(parcel=parcel, observed_ppsm=just_inside_market, policy=policy, source=SOURCE)
    assert result.regime is MarketRegime.MARKET_LIKE


def test_5room_boundaries_exact():
    policy = CITY_WINE_STANDARD_5ROOM_111M2_PROGRAM_REGIME_V1
    parcel = _parcel(11024)

    just_inside_program = _observed_for_delta(11024, policy.program_like_max_delta_pct - 1e-6)
    assert assess_market_regime(parcel=parcel, observed_ppsm=just_inside_program, policy=policy, source=SOURCE).regime is MarketRegime.PROGRAM_LIKE

    mid = _observed_for_delta(11024, (policy.program_like_max_delta_pct + policy.market_like_min_delta_pct) / 2)
    assert assess_market_regime(parcel=parcel, observed_ppsm=mid, policy=policy, source=SOURCE).regime is MarketRegime.AMBIGUOUS

    just_inside_market = _observed_for_delta(11024, policy.market_like_min_delta_pct + 1e-6)
    assert assess_market_regime(parcel=parcel, observed_ppsm=just_inside_market, policy=policy, source=SOURCE).regime is MarketRegime.MARKET_LIKE


def test_boundary_comparison_is_inclusive_and_unrounded():
    # Proves <=/>= (not </>): delta constructed via a single subtraction from 100
    # (matching what assess_market_regime computes internally to within float
    # rounding of the last significant digit -- far tighter than the 0.0018 gap a
    # rounded-to-8.26/18.82 comparison would introduce, so still catches that
    # regression class).
    policy = CITY_WINE_STANDARD_5ROOM_111M2_PROGRAM_REGIME_V1
    parcel = _parcel(100)

    observed_at_program_max = 100 + policy.program_like_max_delta_pct
    result = assess_market_regime(parcel=parcel, observed_ppsm=observed_at_program_max, policy=policy, source=SOURCE)
    assert abs(result.delta_to_official_pct - policy.program_like_max_delta_pct) < 1e-9
    assert result.regime is MarketRegime.PROGRAM_LIKE  # <=, inclusive

    observed_at_market_min = 100 + policy.market_like_min_delta_pct
    result = assess_market_regime(parcel=parcel, observed_ppsm=observed_at_market_min, policy=policy, source=SOURCE)
    assert abs(result.delta_to_official_pct - policy.market_like_min_delta_pct) < 1e-9
    assert result.regime is MarketRegime.MARKET_LIKE  # >=, inclusive


def test_nearest_official_reference_chosen_among_multiple():
    parcel = _parcel(10877, 10941, 11024)
    result = assess_market_regime(
        parcel=parcel, observed_ppsm=10950, policy=CITY_WINE_STANDARD_5ROOM_111M2_PROGRAM_REGIME_V1, source=SOURCE
    )
    assert result.nearest_official_reference_ppsm == 10941
    assert sorted(result.official_reference_ppsm_values) == [10877, 10941, 11024]


def test_signed_delta_not_absolute_value():
    # Observed price well BELOW the official reference must stay on the program-like
    # side via the signed <= boundary, never get folded into ambiguous by abs().
    policy = CITY_WINE_STANDARD_5ROOM_111M2_PROGRAM_REGIME_V1
    parcel = _parcel(11024)
    observed = 11024 * 0.5  # 50% below -> abs() would read as a huge magnitude
    result = assess_market_regime(parcel=parcel, observed_ppsm=observed, policy=policy, source=SOURCE)
    assert result.delta_to_official_pct < 0
    assert result.regime is MarketRegime.PROGRAM_LIKE


def test_resolved_parcel_with_no_program_overlap_is_market_like_with_explicit_reasoning():
    parcel = _parcel(program_overlap=False)
    result = assess_market_regime(
        parcel=parcel, observed_ppsm=15000, policy=CITY_WINE_STANDARD_5ROOM_111M2_PROGRAM_REGIME_V1, source=SOURCE
    )
    assert result.regime is MarketRegime.MARKET_LIKE
    assert result.program_overlap is False
    assert "official_cadastral_resolution_no_program_overlap" in result.reasoning


def test_unresolved_parcel_is_unresolved_not_market_like():
    result = assess_market_regime(
        parcel=None, observed_ppsm=15000, policy=CITY_WINE_STANDARD_5ROOM_111M2_PROGRAM_REGIME_V1, source=SOURCE
    )
    assert result.regime is MarketRegime.UNRESOLVED
    assert result.regime is not MarketRegime.MARKET_LIKE
    assert "cadastral_parcel_context_not_resolved" in result.reasoning

    unresolved_parcel = _parcel(resolved=False)
    result2 = assess_market_regime(
        parcel=unresolved_parcel, observed_ppsm=15000, policy=CITY_WINE_STANDARD_5ROOM_111M2_PROGRAM_REGIME_V1, source=SOURCE
    )
    assert result2.regime is MarketRegime.UNRESOLVED


def test_program_overlap_true_but_no_usable_price_for_meter_is_unresolved():
    parcel = _parcel(0)  # the one real zero-price sentinel we found in the real file
    result = assess_market_regime(
        parcel=parcel, observed_ppsm=15000, policy=CITY_WINE_STANDARD_5ROOM_111M2_PROGRAM_REGIME_V1, source=SOURCE
    )
    assert result.regime is MarketRegime.UNRESOLVED
    assert "no_usable_official_price_for_meter" in result.reasoning[0]


def test_compute_observed_ppsm_precedence():
    assert compute_observed_ppsm(12000, 999999, 999999) == 12000
    assert compute_observed_ppsm(None, 1_500_000, 100) == 15000
    assert compute_observed_ppsm(0, 1_500_000, 100) == 15000
    assert compute_observed_ppsm(None, None, 100) is None
    assert compute_observed_ppsm(None, 1_500_000, None) is None


def test_round_trip_through_public_dict():
    parcel = _parcel(11024)
    result = assess_market_regime(
        parcel=parcel, observed_ppsm=18194, policy=CITY_WINE_STANDARD_5ROOM_111M2_PROGRAM_REGIME_V1, source=SOURCE
    )
    restored = assessment_from_dict(result.public_dict())
    assert restored == result


def test_parcel_context_from_dict_matches_frozen_file_schema():
    raw = {
        "gush": 1196,
        "helka": 70,
        "program_overlap": True,
        "projects": [
            {
                "ActiveProjectId": 77301,
                "ProjectName": "א",
                "MarketingMethod": "מחיר מטרה - ר.מ.י",
                "Neighborhood": "אשקלון מזרח",
                "LamasName": "אשקלון",
                "ProviderName": "זוהר וצפריר שרבט בע\"מ",
                "PriceForMeter": 10877,
                "LotteryIds": [2531],
            }
        ],
    }
    parcel = parcel_context_from_dict(raw)
    assert parcel.gush == 1196
    assert parcel.helka == 70
    assert parcel.resolved is True
    assert parcel.program_overlap is True
    assert parcel.projects[0].price_for_meter == 10877
    assert parcel.projects[0].active_project_id == 77301
