"""Deterministic, additive special-unit market-indication engine (v2 --
tightened eligibility per the "do not publish v1 prices" correction).

Produces a transparent, reproducible suggested price for one special unit
(garden/duplex/triplex) from special-unit evidence only. Never touches the
standard 3R/5R market-range engine (market_range.py) and is never imported by
it -- a completely separate, additive calculation path.

Methodology (v2):

  A. Current-asking / new-development "direct" evidence (near_exact_*,
     direct_*, including direct_current_rich) enters the automatic
     calculation via area normalization:
         normalized_value = comparable_price * subject_internal_area / comparable_area
     Label: "התאמת שטח פנימי בלבד" (internal-area adjustment only -- never
     prices yard/balcony/floor/orientation/parking/storage/view).

  B. Size-relaxed / broadened / low-confidence evidence (size_relaxed_*,
     direct_typology_size_relaxed, broadened_*, premium_context, and any
     evidence_class containing "lower_confidence" or "low_confidence_
     activity") remains visible as supporting/context evidence but does NOT
     enter the automatic lane median by default. It is used only as a last
     resort when a lane would otherwise have zero numeric evidence -- and
     when used that way, the lane is marked provisional and forces overall
     confidence to LOW (see classify_confidence).

  C. The curated registered-sale ("sold") lane is always Tier B. The sold
     lane contains type-relaxed and mixed-certainty multi-level transactions;
     high-confidence typology links exist for selected records (see
     second_researcher_context_v1's HIGH_CONFIDENCE_UNIT_LINK entries,
     surfaced as metadata on the relevant basket records), but the lane as a
     whole is not uniformly exact-unit typology proven -- no single record
     carries a stable listing-unit/subparcel identifier connecting it to an
     exact special product, so the lane keeps its Tier B / non-direct-
     quality classification (see classify_sold_tier). Its lane reference is
     the median of the ACCEPTED
     comparables' raw observed transaction prices -- never an area-
     normalized extrapolation. Each comparable's area difference from the
     subject is still recorded/displayed, but is never called an "adjusted
     subject value". Label: "חציון עסקאות רב-מפלסיות שנבחרו".

  D. New-development numeric eligibility requires the exact same special
     product type, an appropriate room match, an explicit unit-specific
     price, and a usable area -- a different product type or a materially
     different special product remains context only. project_start_price is
     never used as a numeric anchor (enforced upstream, in
     app_api/special_market_indication_data.py's parser, which never reads
     that field at all).

  F. Confidence is lane-based, never a pooled comparable count:
       LOW    if only one usable lane, OR no lane is "direct quality", OR
              any lane had to fall back to size-relaxed/broadened evidence
              (a "provisional" lane) to produce a result at all.
       MEDIUM if 2+ usable lanes with at least one direct-quality lane, and
              no lane is provisional (some relaxation may still exist inside
              a lane's own median, e.g. sold-typology uncertainty, but no
              lane was *forced* to use fallback evidence).
       HIGH   only with 3 usable lanes, at least 2 of them direct-quality,
              AND the sold lane (if present) does not participate -- because
              the sold lane is not uniformly exact-unit typology proven (see
              C above), a unit with a populated sold lane can never reach
              HIGH (explicit additional cap in the task). In practice, HIGH
              is therefore unreachable by any of the 7 assignment special
              units: garden units never have a sold lane but also never have
              3 lanes (no basket), and duplex/triplex units always have a
              sold lane.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from statistics import median as _median
from typing import Literal

Tier = Literal["tier_a_direct", "tier_b_size_relaxed", "tier_c_broadened"]
Lane = Literal["sold", "current_asking", "new_development"]
Confidence = Literal["high", "medium", "low"]
CalculationMethod = Literal["area_normalized_median", "raw_price_median"]

AREA_TOLERANCE_PCT = 0.15

SAME_CATEGORY = {"garden": {"garden"}, "duplex": {"duplex", "roof_duplex"}, "triplex": set()}
BROADENED_CATEGORY = {
    "garden": set(),
    "duplex": {"penthouse"},
    "triplex": {"duplex", "roof_duplex", "penthouse"},
}

_LOW_CONFIDENCE_MARKERS = ("lower_confidence", "low_confidence_activity")


@dataclass(slots=True)
class NormalizedComparable:
    lane: Lane
    tier: Tier
    label: str
    comparable_price_ils: float
    comparable_area_sqm: float
    subject_area_sqm: float
    normalized_value_ils: float
    note: str = ""
    raw: dict = field(default_factory=dict)

    @property
    def area_diff_pct(self) -> float:
        return (self.comparable_area_sqm - self.subject_area_sqm) / self.subject_area_sqm

    @property
    def auto_eligible(self) -> bool:
        """True only for Tier A -- the sole tier that enters a lane's
        automatic calculation by default (see module docstring A/B)."""
        return self.tier == "tier_a_direct"

    @staticmethod
    def build(lane: Lane, tier: Tier, label: str, price: float, area: float, subject_area: float, note: str = "", raw: dict | None = None) -> "NormalizedComparable":
        return NormalizedComparable(
            lane=lane, tier=tier, label=label, comparable_price_ils=price, comparable_area_sqm=area,
            subject_area_sqm=subject_area, normalized_value_ils=area_normalize(price, area, subject_area),
            note=note, raw=raw or {},
        )


@dataclass(slots=True)
class ExcludedRecord:
    lane: Lane
    label: str
    reason: str
    raw: dict = field(default_factory=dict)


@dataclass(slots=True)
class LaneResult:
    lane: Lane
    calculation_method: CalculationMethod
    comps_used: list[NormalizedComparable]
    comps_context_only: list[NormalizedComparable]
    reference_ils: float
    is_provisional: bool  # True only if comps_used had to fall back to non-Tier-A evidence
    is_direct_quality: bool  # sold lane is always False regardless of provisional status
    label: str

    def used_raw_values(self) -> list[float]:
        return sorted(c.comparable_price_ils for c in self.comps_used)

    def used_normalized_values(self) -> list[float]:
        return sorted(c.normalized_value_ils for c in self.comps_used)


@dataclass(slots=True)
class SpecialUnitIndication:
    unit_number: str
    category: str
    subject_internal_area_sqm: float
    lanes: dict[str, LaneResult]  # every lane with any numeric evidence, including non-voting ones
    voting_lane_names: list[str]  # the subset of `lanes` that actually fed suggested_price/indicative range
    excluded: list[ExcludedRecord]
    suggested_price_ils: float | None
    indicative_lower_ils: float | None
    indicative_upper_ils: float | None
    confidence: Confidence
    confidence_reason: str


def area_normalize(comparable_price: float, comparable_area: float, subject_area: float) -> float:
    if comparable_area <= 0:
        raise ValueError("comparable_area must be positive")
    return comparable_price * subject_area / comparable_area


def classify_asking_tier(evidence_class: str) -> Tier:
    """Source-native evidence_class -> tier. Any class containing a
    low-confidence marker is routed to Tier B regardless of a "direct_"
    prefix (see module docstring B/E) -- e.g. direct_current_lower_
    confidence is NOT auto-eligible despite starting with "direct_"."""

    if any(marker in evidence_class for marker in _LOW_CONFIDENCE_MARKERS):
        return "tier_b_size_relaxed"
    if evidence_class in ("direct_typology_size_relaxed", "size_relaxed_current"):
        return "tier_b_size_relaxed"
    if evidence_class.startswith("direct_") or evidence_class.startswith("near_exact_"):
        return "tier_a_direct"
    return "tier_c_broadened"  # broadened_*, premium_context


def classify_sold_eligibility(numeric_status: str) -> tuple[bool, str | None]:
    if numeric_status == "usable":
        return True, None
    if numeric_status == "usable_with_public_mirror_conflict_flag":
        return True, "cross-source mirror price conflict flagged; kept per QA rule"
    return False, f"numeric_status={numeric_status} -- excluded from numeric use"


def classify_sold_tier() -> Tier:
    """Always Tier B -- see module docstring section C for why (mixed-
    certainty lane; high-confidence typology links exist for selected
    records but none carries a stable exact-unit identifier)."""
    return "tier_b_size_relaxed"


def classify_new_development_variant(
    subject_category: str, subject_rooms: float, subject_area: float, variant_category: str, variant_rooms: float, variant_area: float
) -> Tier | None:
    same_category = variant_category in SAME_CATEGORY.get(subject_category, set())
    broadened_category = variant_category in BROADENED_CATEGORY.get(subject_category, set())
    if not same_category and not broadened_category:
        return None
    if same_category:
        area_diff_pct = abs(variant_area - subject_area) / subject_area
        if variant_rooms == subject_rooms and area_diff_pct <= AREA_TOLERANCE_PCT:
            return "tier_a_direct"
        return "tier_b_size_relaxed"
    return "tier_c_broadened"


def _build_area_normalized_lane(lane: Lane, comparables: list[NormalizedComparable], label: str) -> LaneResult | None:
    """Shared logic for current_asking / new_development: prefer Tier A
    (auto_eligible) comparables; fall back to Tier B/C only if no Tier A
    evidence exists at all, and flag the lane provisional when that happens."""

    direct = [c for c in comparables if c.auto_eligible]
    fallback = [c for c in comparables if not c.auto_eligible]

    if direct:
        used, context_only, is_provisional = direct, fallback, False
    elif fallback:
        used, context_only, is_provisional = fallback, [], True
    else:
        return None

    reference = _median(c.normalized_value_ils for c in used)
    return LaneResult(
        lane=lane, calculation_method="area_normalized_median", comps_used=used, comps_context_only=context_only,
        reference_ils=reference, is_provisional=is_provisional, is_direct_quality=not is_provisional, label=label,
    )


def build_asking_lane(comparables: list[NormalizedComparable]) -> LaneResult | None:
    return _build_area_normalized_lane("current_asking", comparables, "התאמת שטח פנימי בלבד")


def build_new_development_lane(comparables: list[NormalizedComparable]) -> LaneResult | None:
    return _build_area_normalized_lane("new_development", comparables, "התאמת שטח פנימי בלבד")


def build_sold_lane(comparables: list[NormalizedComparable]) -> LaneResult | None:
    """Median of RAW observed prices -- never area-normalized (see module
    docstring C). Always non-direct-quality: sold typology is never proven
    in this dataset, so this lane is never eligible to count toward the HIGH
    confidence bar, and never marked "provisional" either (that flag is
    reserved for asking/new_development falling back to weaker evidence --
    sold's uncertainty is handled by the separate confidence cap instead)."""

    if not comparables:
        return None
    reference = _median(c.comparable_price_ils for c in comparables)
    return LaneResult(
        lane="sold", calculation_method="raw_price_median", comps_used=comparables, comps_context_only=[],
        reference_ils=reference, is_provisional=False, is_direct_quality=False, label="חציון עסקאות רב-מפלסיות שנבחרו",
    )


def classify_confidence(lanes: dict[str, LaneResult]) -> tuple[Confidence, str]:
    if not lanes:
        return "low", "אין כרגע אף ערוץ ראיות נומרי זמין ליחידה זו."
    if len(lanes) == 1:
        return "low", "מקור נומרי בערוץ ראיות אחד בלבד — אינדיקציה ראשונית בלבד."
    if any(lane.is_provisional for lane in lanes.values()):
        provisional_names = [name for name, lane in lanes.items() if lane.is_provisional]
        return "low", f"הערוצים {provisional_names} נאלצו להסתמך על ראיות מורחבות/ברמת ביטחון נמוכה בלבד (fallback אחרון) — התוצאה תלויה מהותית בהשוואה מורחבת."
    direct_lanes = [name for name, lane in lanes.items() if lane.is_direct_quality]
    if not direct_lanes:
        return "low", "אין אף ערוץ נומרי באיכות ישירה (direct-quality)."
    # The sold lane mixes type-relaxed and mixed-certainty multi-level
    # transactions; selected records carry a high-confidence typology link
    # (see second_researcher_context_v1), but the lane as a whole is not
    # uniformly exact-unit typology proven -- so it still caps confidence
    # below HIGH whenever it participates (see classify_sold_tier).
    sold_participates = "sold" in lanes
    if len(lanes) >= 3 and len(direct_lanes) >= 2 and not sold_participates:
        return "high", "שלושה ערוצי ראיות זמינים, לפחות שניים מהם באיכות ישירה, וללא בעיית טיפוס בלתי פתורה."
    if sold_participates:
        return "medium", "שני ערוצים נומריים לפחות עם לפחות ערוץ ישיר אחד, אך ערוץ העסקאות שבוצעו (רב-מפלסי) כולל טיפוסים מעורבים ואינו מאומת באופן אחיד ליחידה מדויקת — הביטחון אינו יכול להגיע לגבוה."
    return "medium", "שני ערוצים נומריים לפחות עם לפחות ערוץ ישיר אחד, וקיימת הרחבה מהותית כלשהי."


def compute_special_unit_indication(
    unit_number: str,
    category: str,
    subject_internal_area_sqm: float,
    sold_comparables: list[NormalizedComparable],
    asking_comparables: list[NormalizedComparable],
    new_development_comparables: list[NormalizedComparable],
    excluded: list[ExcludedRecord],
) -> SpecialUnitIndication:
    lanes: dict[str, LaneResult] = {}
    for name, result in (
        ("sold", build_sold_lane(sold_comparables)),
        ("current_asking", build_asking_lane(asking_comparables)),
        ("new_development", build_new_development_lane(new_development_comparables)),
    ):
        if result is not None:
            lanes[name] = result

    if not lanes:
        return SpecialUnitIndication(
            unit_number=unit_number, category=category, subject_internal_area_sqm=subject_internal_area_sqm,
            lanes={}, voting_lane_names=[], excluded=excluded, suggested_price_ils=None, indicative_lower_ils=None,
            indicative_upper_ils=None, confidence="low", confidence_reason="אין כרגע אף ערוץ ראיות נומרי זמין ליחידה זו.",
        )

    # Provisional lanes (forced to fall back to non-Tier-A evidence) remain
    # fully visible/displayed but do not vote in the final suggested price
    # or indicative range whenever at least one non-provisional lane exists
    # -- see module docstring / task correction. Only when EVERY available
    # lane is provisional (no better evidence exists at all) do provisional
    # lanes vote, since there is nothing else to anchor on.
    non_provisional = {name: lane for name, lane in lanes.items() if not lane.is_provisional}
    voting_lanes = non_provisional if non_provisional else lanes

    lane_references = [lane.reference_ils for lane in voting_lanes.values()]
    suggested = _median(lane_references)
    # Confidence is judged from the lanes that actually feed the suggested
    # price -- a provisional lane that was excluded from voting can no
    # longer be the reason the recommendation is judged low-confidence.
    confidence, reason = classify_confidence(voting_lanes)

    return SpecialUnitIndication(
        unit_number=unit_number, category=category, subject_internal_area_sqm=subject_internal_area_sqm,
        lanes=lanes, voting_lane_names=sorted(voting_lanes.keys()), excluded=excluded, suggested_price_ils=suggested,
        indicative_lower_ils=min(lane_references), indicative_upper_ils=max(lane_references),
        confidence=confidence, confidence_reason=reason,
    )
