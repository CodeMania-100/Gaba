from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any


class GeographicScopeStatus(str, Enum):
    VERIFIED_LOCAL = "verified_local_by_official_parcel_scope"
    OUTSIDE_VERIFIED_SCOPE = "outside_verified_scope"
    UNRESOLVED = "unresolved"


@dataclass(frozen=True, slots=True)
class FrozenLocalScope:
    """A frozen, price-independent geographic whitelist for one room family's
    completed-sale evidence.

    Parcels enter ``included_parcels`` only via official GIS/project ``Neighborhood``
    context (see the diagnostic file this is parsed from) -- never by price, sample
    count, or a desired final result. Runtime must use this frozen list rather than
    re-inferring locality from a Hebrew label every time pricing runs.
    """

    version: str
    source_file: str
    city: str
    assignment_location_assumption: str
    verified_official_zone: str
    scope_basis: str
    coordinates_available: bool
    exact_target_neighborhood_verified: bool
    included_parcels: frozenset[tuple[int, int]]


def local_scope_from_dict(raw: dict[str, Any]) -> FrozenLocalScope:
    parcels = frozenset((int(g), int(h)) for g, h in raw.get("included_parcels", []))
    return FrozenLocalScope(
        version=raw["version"],
        source_file=raw["source_file"],
        city=raw["city"],
        assignment_location_assumption=raw["assignment_location_assumption"],
        verified_official_zone=raw["verified_official_zone"],
        scope_basis=raw["scope_basis"],
        coordinates_available=bool(raw.get("coordinates_available", False)),
        exact_target_neighborhood_verified=bool(raw.get("exact_target_neighborhood_verified", False)),
        included_parcels=parcels,
    )


@dataclass(slots=True)
class GeographicScopeAssessment:
    """Geography is an independent evidence property -- orthogonal to QA, market
    regime, and price. This assessment never looks at any of those.

    Two different classification vocabularies can both be preserved for the same
    record without one overriding the other: a tax-authority statistical zone name
    (``source_neighborhood_label``) and an official GIS/housing-program project zone
    (``official_scope_label``) are different systems describing overlapping or
    adjacent geography. A string mismatch between them is not, by itself, evidence
    of geographic conflict -- admission is decided solely by whether the record's
    cadastral parcel is in the frozen whitelist.
    """

    scope_version: str
    scope_status: GeographicScopeStatus
    official_scope_label: str | None = None
    official_scope_source: str | None = None
    source_neighborhood_label: str | None = None
    source_neighborhood_system: str | None = None
    gush: int | None = None
    helka: int | None = None
    coordinates_available: bool = False
    exact_target_neighborhood_verified: bool = False

    @property
    def is_verified_local(self) -> bool:
        return self.scope_status is GeographicScopeStatus.VERIFIED_LOCAL

    def public_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["scope_status"] = self.scope_status.value
        return payload


def geographic_assessment_from_dict(raw: dict[str, Any]) -> GeographicScopeAssessment:
    payload = dict(raw)
    payload["scope_status"] = GeographicScopeStatus(payload["scope_status"])
    return GeographicScopeAssessment(**payload)


def assess_geographic_scope(
    *,
    gush: int | None,
    helka: int | None,
    source_neighborhood: str | None,
    scope: FrozenLocalScope,
) -> GeographicScopeAssessment:
    source_system = "tax_authority_source" if source_neighborhood else None

    if gush is None or helka is None:
        return GeographicScopeAssessment(
            scope_version=scope.version,
            scope_status=GeographicScopeStatus.UNRESOLVED,
            source_neighborhood_label=source_neighborhood,
            source_neighborhood_system=source_system,
            coordinates_available=scope.coordinates_available,
            exact_target_neighborhood_verified=scope.exact_target_neighborhood_verified,
        )

    in_whitelist = (int(gush), int(helka)) in scope.included_parcels
    return GeographicScopeAssessment(
        scope_version=scope.version,
        scope_status=GeographicScopeStatus.VERIFIED_LOCAL if in_whitelist else GeographicScopeStatus.OUTSIDE_VERIFIED_SCOPE,
        official_scope_label=scope.verified_official_zone if in_whitelist else None,
        official_scope_source="housing_program_gis_project_context" if in_whitelist else None,
        source_neighborhood_label=source_neighborhood,
        source_neighborhood_system=source_system,
        gush=int(gush),
        helka=int(helka),
        coordinates_available=scope.coordinates_available,
        exact_target_neighborhood_verified=scope.exact_target_neighborhood_verified,
    )
