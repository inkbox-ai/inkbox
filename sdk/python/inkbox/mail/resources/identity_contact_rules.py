"""
inkbox/mail/resources/identity_contact_rules.py

Identity-keyed mail contact rules (per-agent-identity allow/block rules
+ org-wide list).

Mail rules live on the **agent identity**, addressed by ``agent_handle``,
mirroring the iMessage rule shape. The legacy per-mailbox resource
(``inkbox.mail_contact_rules``) is kept as a deprecated wrapper.

Transport note: this resource rides the api-root transport
(``{base}/api/v1``) so it can address both the per-identity routes
(``/identities/{handle}/mail-contact-rules``) and the org-wide list
(``/mail/contact-rules``) with full paths. It must NOT ride the
``/mail``-prefixed transport, which would mangle the identity paths.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.mail.types import (
    MailIdentityContactRule,
    MailRuleAction,
    MailRuleMatchType,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_ORG_BASE = "/mail/contact-rules"


def _rule_path(agent_handle: str, rule_id: UUID | str | None = None) -> str:
    base = f"/identities/{agent_handle}/mail-contact-rules"
    return base if rule_id is None else f"{base}/{rule_id}"


class MailIdentityContactRulesResource:
    """Allow/block mail rules scoped to agent identities."""

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        agent_handle: str,
        *,
        action: MailRuleAction | str | None = None,
        match_type: MailRuleMatchType | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[MailIdentityContactRule]:
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
        data = self._http.get(_rule_path(agent_handle), params=params)
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        return [MailIdentityContactRule._from_dict(r) for r in items]

    def get(self, agent_handle: str, rule_id: UUID | str) -> MailIdentityContactRule:
        data = self._http.get(_rule_path(agent_handle, rule_id))
        return MailIdentityContactRule._from_dict(data)

    def create(
        self,
        agent_handle: str,
        *,
        action: MailRuleAction | str,
        match_type: MailRuleMatchType | str,
        match_target: str,
    ) -> MailIdentityContactRule:
        """Create a rule for an agent identity. New rules are always
        ``active``.

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
        data = self._http.post(_rule_path(agent_handle), json=body)
        return MailIdentityContactRule._from_dict(data)

    def update(
        self,
        agent_handle: str,
        rule_id: UUID | str,
        *,
        action: MailRuleAction | str,
    ) -> MailIdentityContactRule:
        """Update ``action`` (admin-only).

        ``match_type`` and ``match_target`` are immutable — delete + re-create
        to change them.
        """
        body = {
            "action": action.value if isinstance(action, MailRuleAction) else action,
        }
        data = self._http.patch(_rule_path(agent_handle, rule_id), json=body)
        return MailIdentityContactRule._from_dict(data)

    def delete(self, agent_handle: str, rule_id: UUID | str) -> None:
        """Delete a rule (admin-only)."""
        self._http.delete(_rule_path(agent_handle, rule_id))

    def list_all(
        self,
        *,
        agent_identity_id: UUID | str | None = None,
        action: MailRuleAction | str | None = None,
        match_type: MailRuleMatchType | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[MailIdentityContactRule]:
        """Org-wide list of mail contact rules (admin-only).

        Args:
            agent_identity_id: Narrow to a single agent identity by id.
            action: Filter by ``allow`` or ``block``.
            match_type: Filter by ``exact_email`` or ``domain``.
        """
        params: dict[str, Any] = {}
        if agent_identity_id is not None:
            params["agent_identity_id"] = str(agent_identity_id)
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
        return [MailIdentityContactRule._from_dict(r) for r in items]
