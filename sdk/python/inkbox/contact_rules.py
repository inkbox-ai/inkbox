"""Shared direction for email, phone, and iMessage contact rules."""

from enum import StrEnum
from typing import Any


class ContactRuleDirection(StrEnum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"
    BOTH = "both"


_UNSET = object()


def _direction_fields(direction: Any = _UNSET) -> dict[str, str]:
    return {} if direction is _UNSET else {"direction": ContactRuleDirection(direction).value}


def _rule_update(action: Any, direction: Any = _UNSET, apply_to: Any = _UNSET) -> dict[str, str]:
    body = _direction_fields(direction)
    if action is not None:
        body["action"] = str(action)
    if apply_to is not _UNSET:
        if action is None or direction is not _UNSET:
            raise ValueError("apply_to requires action and cannot be combined with direction")
        if apply_to not in ("inbound", "outbound"):
            raise ValueError("apply_to must be inbound or outbound")
        body["apply_to"] = str(apply_to)
    if not body:
        raise ValueError("Provide action or direction")
    return body
