"""
inkbox/mail/resources/contact_rules.py

Mail contact rules (per-mailbox allow/block rules + org-wide list).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.mail.types import (
    ContactRuleStatus,
    MailContactRule,
    MailRuleAction,
    MailRuleMatchType,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_BASE = "/mailboxes"
_ORG_BASE = "/contact-rules"
_UNSET = object()


def _rule_path(email_address: str, rule_id: UUID | str | None = None) -> str:
    base = f"{_BASE}/{email_address}/contact-rules"
    return base if rule_id is None else f"{base}/{rule_id}"


class MailContactRulesResource:
    """Allow/block rules scoped to mail mailboxes."""

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        email_address: str,
        *,
        action: MailRuleAction | str | None = None,
        match_type: MailRuleMatchType | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[MailContactRule]:
        params: dict[str, Any] = {}
        if action is not None:
            params["action"] = action.value if isinstance(action, MailRuleAction) else action
        if match_type is not None:
            params["match_type"] = (
                match_type.value if isinstance(match_type, MailRuleMatchType) else match_type
            )
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        data = self._http.get(_rule_path(email_address), params=params)
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        return [MailContactRule._from_dict(r) for r in items]

    def get(self, email_address: str, rule_id: UUID | str) -> MailContactRule:
        data = self._http.get(_rule_path(email_address, rule_id))
        return MailContactRule._from_dict(data)

    def create(
        self,
        email_address: str,
        *,
        action: MailRuleAction | str,
        match_type: MailRuleMatchType | str,
        match_target: str,
        status: ContactRuleStatus | str | None = None,
    ) -> MailContactRule:
        """Create a rule.

        Raises :class:`DuplicateContactRuleError` on 409 when a non-deleted
        rule with the same ``(match_type, match_target)`` already exists.
        """
        body: dict[str, Any] = {
            "action": action.value if isinstance(action, MailRuleAction) else action,
            "match_type": (
                match_type.value if isinstance(match_type, MailRuleMatchType) else match_type
            ),
            "match_target": match_target,
        }
        if status is not None:
            body["status"] = status.value if isinstance(status, ContactRuleStatus) else status
        data = self._http.post(_rule_path(email_address), json=body)
        return MailContactRule._from_dict(data)

    def update(
        self,
        email_address: str,
        rule_id: UUID | str,
        *,
        action: MailRuleAction | str = _UNSET,  # type: ignore[assignment]
        status: ContactRuleStatus | str = _UNSET,  # type: ignore[assignment]
    ) -> MailContactRule:
        """Update ``action`` or ``status`` (admin-only).

        ``match_type`` and ``match_target`` are immutable — delete + re-create
        to change them.
        """
        body: dict[str, Any] = {}
        if action is not _UNSET:
            body["action"] = (
                action.value if isinstance(action, MailRuleAction) else action
            )
        if status is not _UNSET:
            body["status"] = (
                status.value if isinstance(status, ContactRuleStatus) else status
            )
        data = self._http.patch(_rule_path(email_address, rule_id), json=body)
        return MailContactRule._from_dict(data)

    def delete(self, email_address: str, rule_id: UUID | str) -> None:
        """Soft-delete a rule (admin-only)."""
        self._http.delete(_rule_path(email_address, rule_id))

    def list_all(
        self,
        *,
        mailbox_id: UUID | str | None = None,
        action: MailRuleAction | str | None = None,
        match_type: MailRuleMatchType | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[MailContactRule]:
        """Org-wide list of mail contact rules (admin-only).

        Args:
            mailbox_id: Narrow to a single mailbox by id.
            action: Filter by ``allow`` or ``block``.
            match_type: Filter by ``exact_email`` or ``domain``.
        """
        params: dict[str, Any] = {}
        if mailbox_id is not None:
            params["mailbox_id"] = str(mailbox_id)
        if action is not None:
            params["action"] = action.value if isinstance(action, MailRuleAction) else action
        if match_type is not None:
            params["match_type"] = (
                match_type.value if isinstance(match_type, MailRuleMatchType) else match_type
            )
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        data = self._http.get(_ORG_BASE, params=params)
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        return [MailContactRule._from_dict(r) for r in items]
