"""Registry of the four market contexts the demo can evaluate the same
39-apartment inventory against: the existing Petah Tikva snapshot plus the
three frozen contexts in data/multi_city_integration_final/.

Mirrors project_launcher.py's SnapshotRegistration idea (an explicit,
inspectable list of registrations rather than a generic city-onboarding
pipeline) but keyed by a URL slug for direct lookup by the new
/api/v1/demo/market-contexts/{slug}/workspace route. project_launcher.py's
own (city, address) matching for /start is untouched -- this is a separate,
additive registry for the new demo market-context switcher only.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class MarketContextRegistration:
    slug: str
    display_name: str
    # Exact city string as it appears in the frozen data files (Petah Tikva
    # uses its own existing spelling; the multi-city contexts use the full
    # official Hebrew form, e.g. "תל אביב-יפו" -- never abbreviated).
    city: str
    submarket: str | None
    # Directory name under data/multi_city_integration_final/standard_market/
    # and .../special_full_v2/ (both happen to share the same directory name
    # per context). None for Petah Tikva, which has no equivalent -- it keeps
    # using its own data/frozen/*.json files untouched.
    standard_market_dir: str | None
    map_zoom: float
    is_petah_tikva: bool = False
    # Every city spelling this context's own frozen records are allowed to
    # carry -- for Petah Tikva this is a known, pre-existing, accepted pair
    # ("פתח תקווה"/"פתח תקוה", double vs single vav; see
    # petah_tikva_workspace.py's _sold_raw_rows docstring and the frontend's
    # own VALID_PETAH_TIKVA_CITY_SPELLINGS), not new contamination -- the
    # geography validator must be told about it explicitly rather than
    # guessing. Every other context defaults to exactly its own `city`.
    city_spellings: frozenset[str] = field(default_factory=frozenset)

    def __post_init__(self) -> None:
        if not self.city_spellings:
            object.__setattr__(self, "city_spellings", frozenset({self.city}))


MARKET_CONTEXTS: dict[str, MarketContextRegistration] = {
    "petah_tikva": MarketContextRegistration(
        slug="petah_tikva",
        display_name="פתח תקווה",
        city="פתח תקווה",
        submarket="המרכז השקט",
        standard_market_dir=None,
        map_zoom=13.0,
        is_petah_tikva=True,
        city_spellings=frozenset({"פתח תקווה", "פתח תקוה"}),
    ),
    "yad_eliyahu": MarketContextRegistration(
        slug="yad_eliyahu",
        display_name="תל אביב / יד אליהו",
        city="תל אביב-יפו",
        submarket="יד אליהו",
        standard_market_dir="tel_aviv",
        map_zoom=14.0,
    ),
    "kiryat_hasharon": MarketContextRegistration(
        slug="kiryat_hasharon",
        display_name="נתניה / קריית השרון",
        city="נתניה",
        submarket="קריית השרון",
        standard_market_dir="netanya",
        map_zoom=14.0,
    ),
    "barnea": MarketContextRegistration(
        slug="barnea",
        display_name="אשקלון / ברנע",
        city="אשקלון",
        submarket="ברנע",
        standard_market_dir="ashkelon",
        map_zoom=14.0,
    ),
}
