from __future__ import annotations

from dataclasses import asdict, dataclass, field
from statistics import mean
from typing import Iterable

from .market_range import EvidenceConfidence, MarketRangeResult, RangeStatus
from .models import Unit
from .own_sales import OwnProjectSaleRecord, OwnProjectSupportSummary, summarize_own_project_sales
from .strategy import (
    PricingBasis,
    StrategyProfile,
    UnitPriceResult,
    UnitPricingStatus,
    price_unit,
)


@dataclass(slots=True)
class FamilyStrategyDecision:
    """One explicit Marketing decision for one repeated apartment family.

    There is deliberately no hidden project-wide fallback inside this object.
    If a family is omitted from the project plan, the engine returns
    ``strategy_required`` for otherwise priceable units in that family.
    """

    family_key: str
    strategy: StrategyProfile
    rationale: str
    source: str = "marketing_input"

    def validate(self) -> None:
        if not self.family_key or not self.family_key.strip():
            raise ValueError("family_key is required")
        if not self.rationale or not self.rationale.strip():
            raise ValueError("family strategy rationale is required")
        self.strategy.validate()


@dataclass(slots=True)
class ProjectDecisionPlan:
    name: str
    family_decisions: list[FamilyStrategyDecision]
    source: str = "marketing_input"
    note: str | None = None

    def validate(self) -> None:
        if not self.name or not self.name.strip():
            raise ValueError("project decision plan name is required")
        seen: set[str] = set()
        for decision in self.family_decisions:
            decision.validate()
            if decision.family_key in seen:
                raise ValueError(f"multiple active family decisions for {decision.family_key}")
            seen.add(decision.family_key)

    def by_family(self) -> dict[str, FamilyStrategyDecision]:
        self.validate()
        return {decision.family_key: decision for decision in self.family_decisions}


@dataclass(slots=True)
class CompetitorEvidenceMatch:
    source_id: str
    project_name: str | None
    evidence_role: str
    observed_price_ils: float | None
    area_normalized_indication_ils: float | None
    area: float | None
    neighborhood: str | None
    source_url: str | None

    def public_dict(self) -> dict:
        payload = asdict(self)
        # Deprecated alias: the already-built frontend reads this key today.
        payload["target_equivalent_indication_ils"] = payload["area_normalized_indication_ils"]
        return payload


@dataclass(slots=True)
class FamilyDecisionSummary:
    family_key: str
    unit_numbers: list[str]
    strategy_name: str | None
    strategy_basis: str | None
    rationale: str | None
    unit_count: int
    priced_unit_count: int
    review_unit_count: int
    strategy_required_count: int
    market_confidence_counts: dict[str, int]
    supported_range_envelope_ils: dict[str, float | None]
    average_proposed_price_ils: float | None
    total_proposed_list_value_ils: float
    competitor_reference: CompetitorEvidenceMatch | None = None

    def public_dict(self) -> dict:
        payload = asdict(self)
        if self.competitor_reference is not None:
            payload["competitor_reference"] = self.competitor_reference.public_dict()
        return payload


@dataclass(slots=True)
class ProjectDecisionResult:
    plan: ProjectDecisionPlan
    units: list[UnitPriceResult]
    family_summaries: list[FamilyDecisionSummary]
    project_metrics: dict

    def public_dict(self) -> dict:
        return {
            "plan": {
                "name": self.plan.name,
                "source": self.plan.source,
                "note": self.plan.note,
                "family_decisions": [
                    {
                        "family_key": d.family_key,
                        "rationale": d.rationale,
                        "source": d.source,
                        "strategy": _strategy_dict(d.strategy),
                    }
                    for d in self.plan.family_decisions
                ],
            },
            "project_metrics": self.project_metrics,
            "family_summaries": [summary.public_dict() for summary in self.family_summaries],
            "units": [unit.public_dict() for unit in self.units],
        }


@dataclass(slots=True)
class FamilyScenarioImpact:
    family_key: str
    changed_unit_count: int
    total_before_ils: float
    total_after_ils: float
    delta_ils: float
    average_before_ils: float | None
    average_after_ils: float | None


@dataclass(slots=True)
class DecisionScenarioImpact:
    baseline_plan_name: str
    scenario_plan_name: str
    changed_unit_count: int
    total_list_value_before_ils: float
    total_list_value_after_ils: float
    total_list_value_delta_ils: float
    review_units_before: int
    review_units_after: int
    strategy_required_before: int
    strategy_required_after: int
    family_impacts: list[FamilyScenarioImpact]
    unit_impacts: list[dict]

    def public_dict(self) -> dict:
        return {
            "baseline_plan_name": self.baseline_plan_name,
            "scenario_plan_name": self.scenario_plan_name,
            "changed_unit_count": self.changed_unit_count,
            "total_list_value_before_ils": self.total_list_value_before_ils,
            "total_list_value_after_ils": self.total_list_value_after_ils,
            "total_list_value_delta_ils": self.total_list_value_delta_ils,
            "review_units_before": self.review_units_before,
            "review_units_after": self.review_units_after,
            "strategy_required_before": self.strategy_required_before,
            "strategy_required_after": self.strategy_required_after,
            "family_impacts": [asdict(item) for item in self.family_impacts],
            "unit_impacts": self.unit_impacts,
        }


def price_project_decision(
    unit_market_results: Iterable[tuple[Unit, MarketRangeResult]],
    plan: ProjectDecisionPlan,
    own_project_sales: Iterable[OwnProjectSaleRecord] = (),
) -> ProjectDecisionResult:
    """Apply explicit strategy per apartment family.

    This is intentionally stricter than ``price_project``. A standard family is
    not automatically given the strategy of another family. The omission is
    surfaced as ``strategy_required`` so the application can ask Marketing for a
    decision instead of silently assuming one.

    If a competitor-reference strategy is used, the selected source/value must
    exist in that unit's new-development evidence. This prevents a manually typed
    number from masquerading as a market evidence reference.

    ``own_project_sales`` is never passed into any market-evidence function -- it
    only resolves the (optional, opt-in) ``LATEST_OWN_PROJECT_SALE*`` bases and the
    ``minimum_not_below_last_realized_sale`` modifier. The default empty tuple
    reproduces prior behavior exactly.
    """

    pairs = list(unit_market_results)
    own_sales = list(own_project_sales)
    by_family = plan.by_family()
    results: list[UnitPriceResult] = []
    competitor_matches: dict[str, CompetitorEvidenceMatch] = {}
    own_sale_summaries: dict[str, OwnProjectSupportSummary] = {}

    for unit, market in pairs:
        family = family_key(unit)
        decision = by_family.get(family)

        if market.status is RangeStatus.MANUAL_REVIEW:
            results.append(_manual_market_result(unit, market))
            continue

        if decision is None:
            results.append(_strategy_required_result(unit, market))
            continue

        if decision.strategy.basis is PricingBasis.COMPETITOR_REFERENCE:
            match = validate_competitor_reference(decision.strategy, market)
            prior = competitor_matches.get(family)
            if prior is not None and prior.source_id != match.source_id:
                raise ValueError(f"competitor reference changes inside family {family}")
            competitor_matches[family] = match

        if family not in own_sale_summaries:
            own_sale_summaries[family] = summarize_own_project_sales(family, own_sales)
        resolved_latest_internal_sale = own_sale_summaries[family].latest_sale

        result = price_unit(unit, market, decision.strategy, resolved_latest_internal_sale=resolved_latest_internal_sale)
        result.decision_trace.insert(
            0,
            f"Family strategy '{decision.strategy.name}' selected for {family}. Rationale: {decision.rationale.strip()}",
        )
        results.append(result)

    summaries = _summarize_families(pairs, results, by_family, competitor_matches)
    metrics = _project_metrics(results, summaries)
    return ProjectDecisionResult(plan=plan, units=results, family_summaries=summaries, project_metrics=metrics)


def validate_competitor_reference(strategy: StrategyProfile, market: MarketRangeResult) -> CompetitorEvidenceMatch:
    """Prove that a competitor-reference strategy points to visible evidence.

    A value is accepted only if it equals either the exact observed competitor
    price or the transparent area-normalized indication produced from an
    explicitly priced offer with known area. No fuzzy price matching is used.
    """

    if strategy.basis is not PricingBasis.COMPETITOR_REFERENCE:
        raise ValueError("strategy is not competitor_reference")
    strategy.validate()

    source_id = str(strategy.competitor_reference_source_id)
    selected_value = float(strategy.competitor_reference_ils)

    for contribution in market.new_development.primary_contributors:
        if source_id not in contribution.source_ids:
            continue
        allowed = {
            _rounded_or_none(contribution.representative_observed_price),
            _rounded_or_none(contribution.area_normalized_indication_ils),
        }
        allowed.discard(None)
        if _rounded_or_none(selected_value) not in allowed:
            raise ValueError(
                "competitor_reference_ils does not equal the selected evidence record's observed price "
                "or area-normalized indication"
            )
        if strategy.competitor_reference_name and strategy.competitor_reference_name != contribution.group_key:
            raise ValueError("competitor_reference_name does not match selected evidence")
        return CompetitorEvidenceMatch(
            source_id=source_id,
            project_name=contribution.group_key,
            evidence_role="priced_offer_with_known_area",
            observed_price_ils=contribution.representative_observed_price,
            area_normalized_indication_ils=contribution.area_normalized_indication_ils,
            area=contribution.representative_observed_area,
            neighborhood=contribution.neighborhood,
            source_url=None,
        )

    for record in market.new_development.reference_records:
        if str(record.get("source_id")) != source_id:
            continue
        observed = _num(record.get("price"))
        if observed is None or _rounded_or_none(selected_value) != _rounded_or_none(observed):
            raise ValueError("competitor_reference_ils does not equal the selected reference offer price")
        project_name = record.get("project_name")
        if strategy.competitor_reference_name and strategy.competitor_reference_name != project_name:
            raise ValueError("competitor_reference_name does not match selected evidence")
        return CompetitorEvidenceMatch(
            source_id=source_id,
            project_name=project_name,
            evidence_role="priced_offer_reference_only",
            observed_price_ils=observed,
            area_normalized_indication_ils=None,
            area=_num(record.get("area")),
            neighborhood=record.get("neighborhood"),
            source_url=record.get("source_url"),
        )

    raise ValueError(f"competitor reference {source_id} is not present in the unit's new-development evidence")


def compare_decision_scenarios(
    baseline: ProjectDecisionResult,
    scenario: ProjectDecisionResult,
) -> DecisionScenarioImpact:
    before = {u.unit_number: u for u in baseline.units}
    after = {u.unit_number: u for u in scenario.units}
    unit_numbers = sorted(set(before) | set(after), key=_unit_sort_key)

    unit_impacts: list[dict] = []
    changed = 0
    for unit_number in unit_numbers:
        b = before.get(unit_number)
        a = after.get(unit_number)
        bp = b.proposed_list_price_ils if b else None
        ap = a.proposed_list_price_ils if a else None
        if bp != ap:
            changed += 1
        unit_impacts.append({
            "unit_number": unit_number,
            "family_key": a.family_key if a else (b.family_key if b else None),
            "before_ils": bp,
            "after_ils": ap,
            "delta_ils": None if bp is None or ap is None else float(round(ap - bp)),
            "before_requires_review": b.requires_review if b else True,
            "after_requires_review": a.requires_review if a else True,
        })

    before_summaries = {x.family_key: x for x in baseline.family_summaries}
    after_summaries = {x.family_key: x for x in scenario.family_summaries}
    families = sorted(set(before_summaries) | set(after_summaries))
    family_impacts: list[FamilyScenarioImpact] = []
    for family in families:
        b = before_summaries.get(family)
        a = after_summaries.get(family)
        b_total = b.total_proposed_list_value_ils if b else 0.0
        a_total = a.total_proposed_list_value_ils if a else 0.0
        family_changed = sum(
            1 for x in unit_impacts if x["family_key"] == family and x["before_ils"] != x["after_ils"]
        )
        family_impacts.append(FamilyScenarioImpact(
            family_key=family,
            changed_unit_count=family_changed,
            total_before_ils=b_total,
            total_after_ils=a_total,
            delta_ils=float(round(a_total - b_total)),
            average_before_ils=b.average_proposed_price_ils if b else None,
            average_after_ils=a.average_proposed_price_ils if a else None,
        ))

    before_total = float(baseline.project_metrics["total_proposed_list_value_ils"])
    after_total = float(scenario.project_metrics["total_proposed_list_value_ils"])
    return DecisionScenarioImpact(
        baseline_plan_name=baseline.plan.name,
        scenario_plan_name=scenario.plan.name,
        changed_unit_count=changed,
        total_list_value_before_ils=before_total,
        total_list_value_after_ils=after_total,
        total_list_value_delta_ils=float(round(after_total - before_total)),
        review_units_before=int(baseline.project_metrics["requires_review_count"]),
        review_units_after=int(scenario.project_metrics["requires_review_count"]),
        strategy_required_before=int(baseline.project_metrics["strategy_required_count"]),
        strategy_required_after=int(scenario.project_metrics["strategy_required_count"]),
        family_impacts=family_impacts,
        unit_impacts=unit_impacts,
    )


def family_key(unit: Unit) -> str:
    area = "unknown" if unit.internal_area is None else f"{unit.internal_area:g}sqm"
    rooms = "unknown" if unit.rooms is None else f"{unit.rooms:g}r"
    return f"{unit.unit_type or 'unknown'}|{rooms}|{area}"


def _manual_market_result(unit: Unit, market: MarketRangeResult) -> UnitPriceResult:
    return UnitPriceResult(
        unit_number=unit.unit_number,
        family_key=family_key(unit),
        status=UnitPricingStatus.MANUAL_REVIEW,
        market_confidence=market.confidence,
        supported_lower=market.supported_lower,
        supported_upper=market.supported_upper,
        commercial_base_price_ils=None,
        proposed_list_price_ils=None,
        adjustments=[],
        warnings=list(market.warnings) + ["family_strategy_not_applied_to_manual_review_unit"],
        decision_trace=["Market evidence routes this unit to individual pricing review; family strategy was not applied."],
        requires_review=True,
    )


def _strategy_required_result(unit: Unit, market: MarketRangeResult) -> UnitPriceResult:
    return UnitPriceResult(
        unit_number=unit.unit_number,
        family_key=family_key(unit),
        status=UnitPricingStatus.STRATEGY_REQUIRED,
        market_confidence=market.confidence,
        supported_lower=market.supported_lower,
        supported_upper=market.supported_upper,
        commercial_base_price_ils=None,
        proposed_list_price_ils=None,
        adjustments=[],
        warnings=list(market.warnings) + ["explicit_family_strategy_required"],
        decision_trace=["Market evidence is available, but no explicit company strategy was supplied for this apartment family."],
        requires_review=True,
    )


def _summarize_families(
    pairs: list[tuple[Unit, MarketRangeResult]],
    results: list[UnitPriceResult],
    decisions: dict[str, FamilyStrategyDecision],
    competitor_matches: dict[str, CompetitorEvidenceMatch],
) -> list[FamilyDecisionSummary]:
    market_by_unit = {unit.unit_number: market for unit, market in pairs}
    grouped: dict[str, list[UnitPriceResult]] = {}
    for result in results:
        grouped.setdefault(result.family_key, []).append(result)

    summaries: list[FamilyDecisionSummary] = []
    for family in sorted(grouped):
        members = sorted(grouped[family], key=lambda x: _unit_sort_key(x.unit_number))
        decision = decisions.get(family)
        priced = [x for x in members if x.proposed_list_price_ils is not None]
        lowers = [x.supported_lower for x in members if x.supported_lower is not None]
        uppers = [x.supported_upper for x in members if x.supported_upper is not None]
        confidence_counts: dict[str, int] = {}
        for member in members:
            confidence_counts[member.market_confidence.value] = confidence_counts.get(member.market_confidence.value, 0) + 1

        # Preserve family-level evidence variability rather than collapsing it to a
        # fake single precise interval. This is an envelope across member ranges.
        envelope = {
            "lower_min": min(lowers) if lowers else None,
            "lower_max": max(lowers) if lowers else None,
            "upper_min": min(uppers) if uppers else None,
            "upper_max": max(uppers) if uppers else None,
        }
        summaries.append(FamilyDecisionSummary(
            family_key=family,
            unit_numbers=[x.unit_number for x in members],
            strategy_name=decision.strategy.name if decision else None,
            strategy_basis=decision.strategy.basis.value if decision else None,
            rationale=decision.rationale if decision else None,
            unit_count=len(members),
            priced_unit_count=len(priced),
            review_unit_count=sum(x.requires_review for x in members),
            strategy_required_count=sum(x.status is UnitPricingStatus.STRATEGY_REQUIRED for x in members),
            market_confidence_counts=confidence_counts,
            supported_range_envelope_ils=envelope,
            average_proposed_price_ils=(float(round(mean(float(x.proposed_list_price_ils) for x in priced))) if priced else None),
            total_proposed_list_value_ils=float(round(sum(float(x.proposed_list_price_ils) for x in priced))),
            competitor_reference=competitor_matches.get(family),
        ))

    return summaries


def _project_metrics(results: list[UnitPriceResult], summaries: list[FamilyDecisionSummary]) -> dict:
    priced = [x for x in results if x.proposed_list_price_ils is not None]
    return {
        "unit_count": len(results),
        "priced_unit_count": len(priced),
        "manual_review_count": sum(x.status is UnitPricingStatus.MANUAL_REVIEW for x in results),
        "strategy_required_count": sum(x.status is UnitPricingStatus.STRATEGY_REQUIRED for x in results),
        "requires_review_count": sum(x.requires_review for x in results),
        "units_outside_supported_range": sum("proposed_list_price_outside_supported_market_range" in x.warnings for x in results),
        "total_proposed_list_value_ils": float(round(sum(float(x.proposed_list_price_ils) for x in priced))),
        "family_count": len(summaries),
        "families_with_explicit_strategy": sum(x.strategy_name is not None for x in summaries),
    }


def _strategy_dict(strategy: StrategyProfile) -> dict:
    payload = asdict(strategy)
    payload["basis"] = strategy.basis.value
    return payload


def _rounded_or_none(value: float | None) -> float | None:
    return None if value is None else float(round(value))


def _num(value) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def _unit_sort_key(value: str) -> tuple[int, str]:
    try:
        return (0, f"{int(value):09d}")
    except (TypeError, ValueError):
        return (1, str(value))
