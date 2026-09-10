"""One outbound integration: send a unit's current pricing decision to the
already-created "אישור מחירון – פרויקט פתח תקווה" Monday.com board as a real
item, so approval continues on the board Marketing/leadership already use.

Server-side only -- MONDAY_API_TOKEN is read from the environment and never
returned in any response, logged, or otherwise exposed to the browser (see
task item 3). No OAuth, no webhooks, no inbound sync: a personal API token
is enough for this private demo (task item 16); production would swap in a
company-controlled integration with proper permissions.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass

import httpx

from .schemas import MondayPricingApprovalRequest

logger = logging.getLogger(__name__)

MONDAY_API_URL = "https://api.monday.com/v2"
MONDAY_BOARD_URL = "https://achzaka100s-team.monday.com/boards/{board_id}"

# The three status labels that already exist on the board -- never invented
# here (task item 2/10). "insufficient" has no dedicated Monday label; it is
# conservatively mapped to the lowest existing confidence label rather than
# adding a new one.
CONFIDENCE_LABELS: dict[str, str] = {
    "high": "גבוהה",
    "medium": "בינונית",
    "low": "נמוכה",
    "insufficient": "נמוכה",
}

# Matches frontend/lib/marketingStrategy.ts's ProjectPhase values exactly
# (task item 11) -- kept as its own small table here rather than shared code
# since the frontend module is TypeScript-only and this is the one place the
# backend needs the same four labels.
PHASE_LABELS: dict[str, str] = {
    "presale": "פריסייל",
    "launch": "השקה",
    "regular_sales": "מכירה שוטפת",
    "final_inventory": "מלאי סופי",
}

STATUS_PENDING_APPROVAL = "ממתין לאישור"
NO_RATIONALE_TEXT = "לא הוזן נימוק נוסף."


class MondayConfigError(Exception):
    """MONDAY_API_TOKEN (or board/group id) is missing -- a controlled,
    expected condition (task item 18), not a crash."""


class MondayApiError(Exception):
    """The Monday GraphQL call itself failed (network, auth, or a GraphQL
    error). The message on this exception is safe to show to Marketing;
    full technical detail is logged server-side only (task item 13)."""


@dataclass(frozen=True)
class MondayConfig:
    token: str
    board_id: str
    group_id: str
    api_version: str


def load_monday_config() -> MondayConfig:
    token = os.getenv("MONDAY_API_TOKEN")
    board_id = os.getenv("MONDAY_BOARD_ID")
    group_id = os.getenv("MONDAY_GROUP_ID")
    if not token or not board_id or not group_id:
        raise MondayConfigError("monday_not_configured")
    api_version = os.getenv("MONDAY_API_VERSION") or "2026-07"
    return MondayConfig(token=token, board_id=board_id, group_id=group_id, api_version=api_version)


def board_url(config: MondayConfig) -> str:
    return MONDAY_BOARD_URL.format(board_id=config.board_id)


def market_gap_pct(market_indication: float, proposed_price: float) -> float | None:
    """((proposed / market) - 1) * 100 -- task item 7. None only when the
    market indication is not a valid, positive number (MondayPricingApprovalRequest
    already enforces market_indication > 0, so this is effectively always a number)."""
    if not market_indication:
        return None
    return ((proposed_price / market_indication) - 1) * 100


def sell_through_gap_points(actual_pct: float | None, target_pct: float | None) -> float | None:
    """Plain actual-minus-target, mirroring frontend/lib/marketingStrategy.ts's
    sellThroughGapPoints -- never a price adjustment, purely descriptive."""
    if not target_pct or actual_pct is None:
        return None
    return actual_pct - target_pct


def rationale_text(rationales: list[str]) -> str:
    lines = [line.strip() for line in rationales if line and line.strip()]
    return "\n".join(lines) if lines else NO_RATIONALE_TEXT


def _confidence_label(confidence: str) -> str:
    return CONFIDENCE_LABELS.get(confidence.strip().lower(), CONFIDENCE_LABELS["low"])


def _phase_label(phase: str) -> str:
    return PHASE_LABELS.get(phase.strip().lower(), phase)


def _format_number(value: float) -> str:
    # Monday numeric columns take a plain numeric string. Rounded to 4dp
    # first to absorb float division noise (e.g. proposed/market ratios
    # landing on 1.4999999999999902 instead of 1.5) before deciding whether
    # it prints as a clean integer or a decimal -- never a formatted string
    # like "₪6,180,000" or "3%" (task item 6).
    rounded = round(float(value), 4)
    return str(int(rounded)) if rounded.is_integer() else str(rounded)


def build_column_values(payload: MondayPricingApprovalRequest) -> dict:
    gap_pct = market_gap_pct(payload.market_indication, payload.proposed_price)
    target_gap = sell_through_gap_points(payload.sell_through_actual_pct, payload.sell_through_target_pct)

    column_values: dict = {
        "text_mm72egjr": payload.property_type,
        "numeric_mm72xt9a": _format_number(payload.market_indication),
        "numeric_mm72mhwm": _format_number(payload.proposed_price),
        "color_mm728v19": {"label": _confidence_label(payload.confidence)},
        "color_mm72ad5y": {"label": _phase_label(payload.project_phase)},
        "numeric_mm726whg": _format_number(payload.strategy_effect_pct),
        "long_text_mm72p44q": {"text": rationale_text(payload.rationales)},
        "color_mm72ts9n": {"label": STATUS_PENDING_APPROVAL},
    }
    if payload.rooms is not None:
        column_values["numeric_mm72c5hq"] = _format_number(payload.rooms)
    if gap_pct is not None:
        column_values["numeric_mm72ywg6"] = _format_number(gap_pct)
    if payload.sell_through_actual_pct is not None:
        column_values["numeric_mm72hc7e"] = _format_number(payload.sell_through_actual_pct)
    if payload.sell_through_target_pct is not None:
        column_values["numeric_mm72x8cc"] = _format_number(payload.sell_through_target_pct)
    if target_gap is not None:
        column_values["numeric_mm72rrkv"] = _format_number(target_gap)
    return column_values


_CREATE_ITEM_MUTATION = """
mutation CreatePricingApprovalItem($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
  create_item(
    board_id: $boardId
    group_id: $groupId
    item_name: $itemName
    column_values: $columnValues
  ) {
    id
  }
}
"""


def create_pricing_approval_item(payload: MondayPricingApprovalRequest) -> dict:
    config = load_monday_config()
    item_name = f"דירה {payload.unit_number}"
    column_values = build_column_values(payload)

    variables = {
        "boardId": config.board_id,
        "groupId": config.group_id,
        "itemName": item_name,
        "columnValues": json.dumps(column_values, ensure_ascii=False),
    }

    try:
        response = httpx.post(
            MONDAY_API_URL,
            headers={
                "Authorization": config.token,
                "Content-Type": "application/json",
                "API-Version": config.api_version,
            },
            json={"query": _CREATE_ITEM_MUTATION, "variables": variables},
            timeout=15.0,
        )
    except httpx.HTTPError as exc:
        logger.error("monday create_item request failed: %s", exc)
        raise MondayApiError("monday_request_failed") from exc

    body: dict = {}
    try:
        body = response.json()
    except ValueError:
        logger.error("monday create_item returned non-JSON response: status=%s body=%r", response.status_code, response.text[:500])
        raise MondayApiError("monday_request_failed")

    if response.status_code >= 400 or body.get("errors"):
        logger.error("monday create_item failed: status=%s body=%s", response.status_code, body)
        raise MondayApiError("monday_request_failed")

    item_id = (body.get("data") or {}).get("create_item", {}).get("id")
    if not item_id:
        logger.error("monday create_item returned no item id: body=%s", body)
        raise MondayApiError("monday_request_failed")

    return {
        "status": "sent",
        "monday_item_id": item_id,
        "approval_status": STATUS_PENDING_APPROVAL,
        "board_url": board_url(config),
    }
