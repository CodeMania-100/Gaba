from __future__ import annotations

import re


STANDARD_APARTMENT_TYPES = {
    "דירה בבית קומות": "standard_apartment",
    "דירה": "standard_apartment",
}

NONSTANDARD_PROPERTY_TYPES = {
    "דירת גן": "garden_apartment",
    "דירת גג": "roof_apartment",
    "קוטג' חד משפחתי": "detached_house",
    "קוטג' דו משפחתי": "semi_detached_house",
    "קוטג' טורי": "row_house",
}


def normalize_address(value: str | None) -> str | None:
    if not value:
        return None
    text = re.sub(r"\s+", " ", value).strip()
    text = text.replace('״', '"').replace("׳", "'")
    return text or None


def normalize_property_type(value: str | None) -> str | None:
    if not value:
        return None
    value = re.sub(r"\s+", " ", value).strip()
    if value in STANDARD_APARTMENT_TYPES:
        return STANDARD_APARTMENT_TYPES[value]
    if value in NONSTANDARD_PROPERTY_TYPES:
        return NONSTANDARD_PROPERTY_TYPES[value]
    return "other"
