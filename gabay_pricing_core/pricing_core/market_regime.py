from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class MarketRegime(str, Enum):
    MARKET_LIKE = "market_like"
    PROGRAM_LIKE = "program_like"
    AMBIGUOUS = "ambiguous"
    UNRESOLVED = "unresolved"


@dataclass(slots=True)
class OfficialProgramProject:
    """One official government-program project record on a parcel, exactly mirroring
    the frozen GIS diagnostic files' schema. Never fabricated -- a field the source
    data didn't give stays None."""

    active_project_id: int | None
    project_name: str | None
    marketing_method: str | None
    neighborhood: str | None
    lamas_name: str | None
    provider_name: str | None
    price_for_meter: float | None
    lottery_ids: list[int] = field(default_factory=list)

    def public_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ParcelProgramContext:
    """Frozen official cadastral/program context for one (gush, helka) parcel.

    ``resolved=False`` means the cadastral/GIS lookup itself failed or was never
    attempted -- distinct from ``resolved=True, program_overlap=False`` which means
    the lookup succeeded and positively confirmed no program overlap. Confusing
    these two would silently turn "we don't know" into "we know it's market-like".
    """

    gush: int
    helka: int
    resolved: bool
    program_overlap: bool | None
    projects: list[OfficialProgramProject] = field(default_factory=list)

    def public_dict(self) -> dict[str, Any]:
        return {
            "gush": self.gush,
            "helka": self.helka,
            "resolved": self.resolved,
            "program_overlap": self.program_overlap,
            "projects": [p.public_dict() for p in self.projects],
        }


@dataclass(slots=True)
class RegimePolicy:
    """A versioned, demo-market-calibrated classification policy.

    These thresholds are specific to one frozen demo market AND one specific
    standard-apartment family (room count + internal area) -- never a generic
    Israeli-housing or citywide rule. Applying a family's policy to a differently
    sized apartment of the same room count is a misuse of this object.
    """

    version: str
    program_like_max_delta_pct: float
    market_like_min_delta_pct: float


# Demo-market calibrations. See CHECKPOINT.md / the market-regime investigation for
# how these were derived. Each is scoped to exactly one standard family.
CITY_WINE_STANDARD_3ROOM_69M2_PROGRAM_REGIME_V1 = RegimePolicy(
    version="city_wine_standard_3room_69m2_program_regime_v1",
    program_like_max_delta_pct=8.26179267054371,
    market_like_min_delta_pct=68.72427983539094,
)

CITY_WINE_STANDARD_5ROOM_111M2_PROGRAM_REGIME_V1 = RegimePolicy(
    version="city_wine_standard_5room_111m2_program_regime_v1",
    program_like_max_delta_pct=18.82202304737516,
    market_like_min_delta_pct=65.03991291727141,
)


@dataclass(slots=True)
class MarketRegimeAssessment:
    regime: MarketRegime
    program_overlap: bool | None
    official_reference_ppsm_values: list[float]
    nearest_official_reference_ppsm: float | None
    observed_ppsm: float | None
    delta_to_official_pct: float | None
    policy_version: str
    reasoning: list[str]
    source: str

    def public_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["regime"] = self.regime.value
        return payload


def assessment_from_dict(raw: dict[str, Any]) -> MarketRegimeAssessment:
    """Pure reconstruction from ``MarketRegimeAssessment.public_dict()`` -- used to
    replay a frozen, already-computed assessment. Never re-derives/reclassifies."""

    return MarketRegimeAssessment(
        regime=MarketRegime(raw["regime"]),
        program_overlap=raw.get("program_overlap"),
        official_reference_ppsm_values=list(raw.get("official_reference_ppsm_values") or []),
        nearest_official_reference_ppsm=raw.get("nearest_official_reference_ppsm"),
        observed_ppsm=raw.get("observed_ppsm"),
        delta_to_official_pct=raw.get("delta_to_official_pct"),
        policy_version=raw["policy_version"],
        reasoning=list(raw.get("reasoning") or []),
        source=raw["source"],
    )


def parcel_context_from_dict(raw: dict[str, Any]) -> ParcelProgramContext:
    """Pure parser for one entry of a frozen `*_program_overlap_parcels.json` file's
    ``parcels`` array. File I/O itself stays in app_api -- this module never touches
    the filesystem or network."""

    projects = [
        OfficialProgramProject(
            active_project_id=p.get("ActiveProjectId"),
            project_name=p.get("ProjectName"),
            marketing_method=p.get("MarketingMethod"),
            neighborhood=p.get("Neighborhood"),
            lamas_name=p.get("LamasName"),
            provider_name=p.get("ProviderName"),
            price_for_meter=p.get("PriceForMeter"),
            lottery_ids=list(p.get("LotteryIds") or []),
        )
        for p in raw.get("projects") or []
    ]
    return ParcelProgramContext(
        gush=int(raw["gush"]),
        helka=int(raw["helka"]),
        resolved=True,
        program_overlap=raw.get("program_overlap"),
        projects=projects,
    )


def compute_observed_ppsm(
    price_per_sqm: float | None, deal_amount: float | None, area: float | None
) -> float | None:
    """1) source pricePerSqm when valid; 2) otherwise dealAmount/area. Never mutates
    the raw transaction -- this is a read-only derived value."""

    if price_per_sqm is not None and price_per_sqm > 0:
        return price_per_sqm
    if deal_amount is not None and deal_amount > 0 and area is not None and area > 0:
        return deal_amount / area
    return None


def assess_market_regime(
    *,
    parcel: ParcelProgramContext | None,
    observed_ppsm: float | None,
    policy: RegimePolicy,
    source: str,
) -> MarketRegimeAssessment:
    """Deterministic, pure classification. No network/GIS calls -- ``parcel`` must
    already be the frozen, previously-resolved context for this transaction's
    (gush, helka). QA quality is a completely separate concept from this function's
    output: a QA-USABLE transaction can be PROGRAM_LIKE, and this function never
    touches QualityStatus."""

    if parcel is None or not parcel.resolved:
        return MarketRegimeAssessment(
            regime=MarketRegime.UNRESOLVED,
            program_overlap=None,
            official_reference_ppsm_values=[],
            nearest_official_reference_ppsm=None,
            observed_ppsm=observed_ppsm,
            delta_to_official_pct=None,
            policy_version=policy.version,
            reasoning=["cadastral_parcel_context_not_resolved"],
            source=source,
        )

    if parcel.program_overlap is False:
        return MarketRegimeAssessment(
            regime=MarketRegime.MARKET_LIKE,
            program_overlap=False,
            official_reference_ppsm_values=[],
            nearest_official_reference_ppsm=None,
            observed_ppsm=observed_ppsm,
            delta_to_official_pct=None,
            policy_version=policy.version,
            reasoning=["official_cadastral_resolution_no_program_overlap"],
            source=source,
        )

    # program_overlap is True from here on.
    reference_values = sorted({
        float(p.price_for_meter)
        for p in parcel.projects
        if p.price_for_meter is not None and p.price_for_meter > 0
    })

    if not reference_values:
        return MarketRegimeAssessment(
            regime=MarketRegime.UNRESOLVED,
            program_overlap=True,
            official_reference_ppsm_values=[],
            nearest_official_reference_ppsm=None,
            observed_ppsm=observed_ppsm,
            delta_to_official_pct=None,
            policy_version=policy.version,
            reasoning=["program_overlap_confirmed_but_no_usable_official_price_for_meter_values"],
            source=source,
        )

    if observed_ppsm is None:
        return MarketRegimeAssessment(
            regime=MarketRegime.UNRESOLVED,
            program_overlap=True,
            official_reference_ppsm_values=reference_values,
            nearest_official_reference_ppsm=None,
            observed_ppsm=None,
            delta_to_official_pct=None,
            policy_version=policy.version,
            reasoning=["observed_price_per_sqm_unavailable"],
            source=source,
        )

    nearest = min(reference_values, key=lambda v: abs(v - observed_ppsm))
    # Signed, never abs(): a transaction priced below the official reference must
    # stay on the program-like side of the boundary, not be folded into
    # ambiguous/market-like purely by the magnitude of the (negative) gap.
    delta_pct = (observed_ppsm - nearest) / nearest * 100

    if delta_pct <= policy.program_like_max_delta_pct:
        regime = MarketRegime.PROGRAM_LIKE
        reasoning = ["official_program_context_found", "delta_at_or_below_program_like_boundary"]
    elif delta_pct >= policy.market_like_min_delta_pct:
        regime = MarketRegime.MARKET_LIKE
        reasoning = ["official_program_context_found", "delta_at_or_above_market_like_boundary"]
    else:
        regime = MarketRegime.AMBIGUOUS
        reasoning = ["official_program_context_found", "delta_between_program_and_market_boundaries"]

    return MarketRegimeAssessment(
        regime=regime,
        program_overlap=True,
        official_reference_ppsm_values=reference_values,
        nearest_official_reference_ppsm=nearest,
        observed_ppsm=observed_ppsm,
        delta_to_official_pct=delta_pct,
        policy_version=policy.version,
        reasoning=reasoning,
        source=source,
    )
