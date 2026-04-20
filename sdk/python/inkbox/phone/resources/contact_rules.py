"""
inkbox/phone/resources/contact_rules.py

Phone contact rules (per-number allow/block rules + org-wide list).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.mail.types import ContactRuleStatus
from inkbox.phone.types import (
    PhoneContactRule,
    PhoneRuleAction,
    PhoneRuleMatchType,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_BASE = "/numbers"
_ORG_BASE = "/contact-rules"
_UNSET = object()


def _rule_path(phone_number_id: UUID | str, rule_id: UUID | str | None = None) -> str:
    base = f"{_BASE}/{phone_number_id}/contact-rules"
    return base if rule_id is None else f"{base}/{rule_id}"


class PhoneContactRulesResource:
    """Allow/block rules scoped to phone numbers (voice + SMS)."""

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        phone_number_id: UUID | str,
        *,
        action: PhoneRuleAction | str | None = None,
        match_type: PhoneRuleMatchType | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[PhoneContactRule]:
        params: dict[str, Any] = {}
        if action is not None:
            params["action"] = action.value if isinstance(action, PhoneRuleAction) else action
        if match_type is not None:
            params["match_type"] = (
                match_type.value if isinstance(match_type, PhoneRuleMatchType) else match_type
            )
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        data = self._http.get(_rule_path(phone_number_id), params=params)
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        return [PhoneContactRule._from_dict(r) for r in items]

    def get(self, phone_number_id: UUID | str, rule_id: UUID | str) -> PhoneContactRule:
        data = self._http.get(_rule_path(phone_number_id, rule_id))
        return PhoneContactRule._from_dict(data)

    def create(
        self,
        phone_number_id: UUID | str,
        *,
        action: PhoneRuleAction | str,
        match_target: str,
        match_type: PhoneRuleMatchType | str = PhoneRuleMatchType.EXACT_NUMBER,
        status: ContactRuleStatus | str | None = None,
    ) -> PhoneContactRule:
        """Create a rule.

        Raises :class:`DuplicateContactRuleError` on 409 when a non-deleted
        rule with the same ``(match_type, match_target)`` already exists.
        """
        body: dict[str, Any] = {
            "action": action.value if isinstance(action, PhoneRuleAction) else action,
            "match_type": (
                match_type.value if isinstance(match_type, PhoneRuleMatchType) else match_type
            ),
            "match_target": match_target,
        }
        if status is not None:
            body["status"] = status.value if isinstance(status, ContactRuleStatus) else status
        data = self._http.post(_rule_path(phone_number_id), json=body)
        return PhoneContactRule._from_dict(data)

    def update(
        self,
        phone_number_id: UUID | str,
        rule_id: UUID | str,
        *,
        action: PhoneRuleAction | str = _UNSET,  # type: ignore[assignment]
        status: ContactRuleStatus | str = _UNSET,  # type: ignore[assignment]
    ) -> PhoneContactRule:
        """Update ``action`` or ``status`` (admin-only)."""
        body: dict[str, Any] = {}
        if action is not _UNSET:
            body["action"] = (
                action.value if isinstance(action, PhoneRuleAction) else action
            )
        if status is not _UNSET:
            body["status"] = (
                status.value if isinstance(status, ContactRuleStatus) else status
            )
        data = self._http.patch(_rule_path(phone_number_id, rule_id), json=body)
        return PhoneContactRule._from_dict(data)

    def delete(self, phone_number_id: UUID | str, rule_id: UUID | str) -> None:
        """Soft-delete a rule (admin-only)."""
        self._http.delete(_rule_path(phone_number_id, rule_id))

    def list_all(
        self,
        *,
        phone_number_id: UUID | str | None = None,
        action: PhoneRuleAction | str | None = None,
        match_type: PhoneRuleMatchType | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[PhoneContactRule]:
        """Org-wide list of phone contact rules (admin-only).

        Args:
            phone_number_id: Narrow to a single phone number by id.
            action: Filter by ``allow`` or ``block``.
            match_type: Filter by ``exact_number``.
        """
        params: dict[str, Any] = {}
        if phone_number_id is not None:
            params["phone_number_id"] = str(phone_number_id)
        if action is not None:
            params["action"] = action.value if isinstance(action, PhoneRuleAction) else action
        if match_type is not None:
            params["match_type"] = (
                match_type.value if isinstance(match_type, PhoneRuleMatchType) else match_type
            )
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        data = self._http.get(_ORG_BASE, params=params)
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        return [PhoneContactRule._from_dict(r) for r in items]
