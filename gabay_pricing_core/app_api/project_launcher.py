"""Generic project-start launcher.

Today this only resolves one frozen snapshot -- Petah Tikva, no exact address
(the assignment never supplied one) -- so the existing Petah Tikva demo stays
fully deterministic. It is structured
so a future production flow can plug in real collectors without changing the
request/response contract the frontend already speaks:

    project request -> collectors -> normalization/QA -> frozen/current
    snapshot -> existing pricing engine (pricing_core) -> workspace

No second pricing engine is introduced here: the one registered snapshot
resolver below calls straight into
app_api.petah_tikva_workspace.build_petah_tikva_workspace_payload -- the same
function GET /api/v1/demo/petah-tikva/workspace already uses. Adding a second
city later means registering another (city, address) -> resolver entry, not
changing this contract.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Callable

from pricing_core import normalize_inventory_rows

from .inventory_preview import compute_inventory_fingerprint
from .petah_tikva_workspace import build_petah_tikva_workspace_payload

PROGRESS_STAGES = [
    "מאתר את הפרויקט",
    "אוסף עסקאות שבוצעו",
    "אוסף מחירי ביקוש",
    "מאתר פרויקטים מתחרים",
    "מנרמל ומסנן את הנתונים",
    "מבצע בדיקות איכות וכפילויות",
    "בונה טווחי שוק",
    "מייצר מחירון",
]

UNSUPPORTED_MESSAGE = (
    "פרויקט זה עדיין לא הוכן במצב הדגמה. "
    "במצב ייצור המערכת תאסוף נתוני שוק ותבנה Snapshot חדש."
)

# Shown when (city, address) matches a registered snapshot but the uploaded
# inventory's fingerprint does not match the exact inventory that snapshot's
# frozen evidence/pricing was built for. This is the frozen-demo protection
# guard: today's snapshot is not a general pricing engine for arbitrary
# uploads, so we refuse rather than silently serving the assignment
# inventory under a different, unrelated upload.
INVENTORY_MISMATCH_MESSAGE = (
    "התמהיל שהועלה אינו תואם לתמהיל שעבורו הוכן Snapshot ההדגמה."
)

# Both orthographic variants of "Petah Tikva" are accepted as the same city --
# the frozen data itself carries both spellings (see
# petah_tikva_pricing.py / petah_tikva_workspace.py's _sold_raw_rows docstring
# for why: פתח תקווה vs פתח תקוה, a known, already-handled quirk, not a typo).
_PETAH_TIKVA_CITY_SPELLINGS = frozenset({"פתח תקווה", "פתח תקוה"})
# The assignment never supplied an exact street address for the subject
# project. חפץ חיים 25 is a *competitor* record in the evidence data (see the
# competitor register) -- it was previously (wrongly) reused here as a
# project-identification key, which made the frontend default-fill it into
# the subject's own address field as if it were real. The registered key is
# now an empty address, matching the frontend's now-empty default; the
# inventory-fingerprint check remains the real safety net (see
# resolve_project_start's docstring).
_PETAH_TIKVA_ADDRESS = ""


def _normalize(value: str | None) -> str:
    return " ".join((value or "").split()).strip()


@dataclass(frozen=True, slots=True)
class SnapshotRegistration:
    """One (city, address) pair this demo already has a frozen snapshot for,
    plus the resolver that builds its workspace payload. A future multi-project
    version adds entries here (or looks them up from a real registry/DB) --
    resolve_project_start's request/response shape does not need to change."""

    city_spellings: frozenset[str]
    address: str
    resolve: Callable[[Path | None], dict]
    # None means "not inventory-bound" (a future live snapshot might accept
    # any inventory). The one registered snapshot today is bound to the exact
    # assignment inventory it was frozen from.
    expected_inventory_fingerprint: str | None = None


def _pricing_core_data_dir() -> Path:
    # app_api/project_launcher.py -> app_api -> gabay_pricing_core
    return Path(__file__).resolve().parents[1]


@lru_cache(maxsize=1)
def _assignment_inventory_fingerprint() -> str:
    """The fingerprint of the exact inventory the Petah Tikva snapshot's
    frozen evidence/pricing was built from (inventory_source_rows.json),
    computed with the same stable-field logic as any uploaded workbook so the
    two are directly comparable."""

    root = _pricing_core_data_dir()
    matrix = json.loads((root / "inventory_source_rows.json").read_text(encoding="utf-8"))
    normalized = normalize_inventory_rows(matrix)
    return compute_inventory_fingerprint(normalized)


_REGISTERED_SNAPSHOTS: list[SnapshotRegistration] = [
    SnapshotRegistration(
        city_spellings=_PETAH_TIKVA_CITY_SPELLINGS,
        address=_PETAH_TIKVA_ADDRESS,
        resolve=build_petah_tikva_workspace_payload,
        expected_inventory_fingerprint=_assignment_inventory_fingerprint(),
    ),
]


def resolve_project_start(
    city: str,
    address: str,
    data_dir: Path | None = None,
    inventory_fingerprint: str | None = None,
) -> dict:
    """Resolve one project-start request to a workspace payload.

    Never recomputes pricing itself and never calls a live collector -- it
    only decides which already-frozen snapshot (if any) matches the request,
    then delegates to that snapshot's own existing, unmodified builder.
    Unsupported (city, address) pairs are reported explicitly (data_mode =
    "unsupported") rather than silently falling back to a supported one.

    A matched snapshot that is bound to a specific inventory
    (expected_inventory_fingerprint set) additionally requires the caller's
    inventory_fingerprint to match. This is the smallest-safe guard against
    silently serving the frozen assignment workspace for an unrelated
    uploaded inventory: a mismatch is reported explicitly (data_mode =
    "unsupported") rather than the request being served against the wrong
    inventory. inventory_fingerprint=None (e.g. an older client, or the
    direct workspace API used for internal testing) is treated as "not
    provided" and skips this check -- it is a additive safety net on top of
    the (city, address) match, not the only gate.
    """

    city_n = _normalize(city)
    address_n = _normalize(address)

    for reg in _REGISTERED_SNAPSHOTS:
        if city_n in reg.city_spellings and address_n == reg.address:
            if (
                reg.expected_inventory_fingerprint is not None
                and inventory_fingerprint is not None
                and inventory_fingerprint != reg.expected_inventory_fingerprint
            ):
                return {
                    "data_mode": "unsupported",
                    "stages": PROGRESS_STAGES,
                    "message": INVENTORY_MISMATCH_MESSAGE,
                }
            return {
                "data_mode": "snapshot",
                "stages": PROGRESS_STAGES,
                "workspace": reg.resolve(data_dir),
            }

    return {
        "data_mode": "unsupported",
        "stages": PROGRESS_STAGES,
        "message": UNSUPPORTED_MESSAGE,
    }
