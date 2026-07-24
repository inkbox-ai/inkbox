"""
inkbox/imessage/resources/contact_rules.py

iMessage contact rules (per-identity allow/block rules + org-wide list).

Shared iMessage pool numbers are global infrastructure, so the policy
owner is the agent identity being reached — rules are addressed by
``agent_handle``, not by a phone-number id.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.imessage.types import (
    IMessageContactRule,
    IMessageRuleAction,
    IMessageRuleMatchType,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_ORG_BASE = "/contact-rules"


def _rule_path(agent_handle: str, rule_id: UUID | str | None = None) -> str:
    base = f"/identities/{agent_handle}/contact-rules"
    return base if rule_id is None else f"{base}/{rule_id}"


class IMessageContactRulesResource:
    """Allow/block rules scoped to agent identities for iMessage."""

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        agent_handle: str,
        *,
        action: IMessageRuleAction | str | None = None,
        match_type: IMessageRuleMatchType | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[IMessageContactRule]:
        params: dict[str, Any] = {}
        if action is not None:
            params["action"] = (
                action.value if isinstance(action, IMessageRuleAction) else action
            )
        if match_type is not None:
            params["match_type"] = (
                match_type.value
                if isinstance(match_type, IMessageRuleMatchType)
                else match_type
            )
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        data = self._http.get(_rule_path(agent_handle), params=params)
        return [IMessageContactRule._from_dict(r) for r in data]

    def get(self, agent_handle: str, rule_id: UUID | str) -> IMessageContactRule:
        data = self._http.get(_rule_path(agent_handle, rule_id))
        return IMessageContactRule._from_dict(data)

    def create(
        self,
        agent_handle: str,
        *,
        action: IMessageRuleAction | str,
        match_target: str,
        match_type: IMessageRuleMatchType | str = IMessageRuleMatchType.EXACT_NUMBER,
    ) -> IMessageContactRule:
        """Create a rule. Use :meth:`update` to change its allow/block action.

        Raises :class:`DuplicateContactRuleError` on 409 when a non-deleted
        rule with the same ``(match_type, match_target)`` already exists.
        """
        body: dict[str, Any] = {
            "action": action.value if isinstance(action, IMessageRuleAction) else action,
            "match_type": (
                match_type.value
                if isinstance(match_type, IMessageRuleMatchType)
                else match_type
            ),
            "match_target": match_target,
        }
        data = self._http.post(_rule_path(agent_handle), json=body)
        return IMessageContactRule._from_dict(data)

    def update(
        self,
        agent_handle: str,
        rule_id: UUID | str,
        *,
        action: IMessageRuleAction | str,
    ) -> IMessageContactRule:
        """Update ``action`` (admin-only)."""
        body = {
            "action": action.value if isinstance(action, IMessageRuleAction) else action,
        }
        data = self._http.patch(_rule_path(agent_handle, rule_id), json=body)
        return IMessageContactRule._from_dict(data)

    def delete(self, agent_handle: str, rule_id: UUID | str) -> None:
        """Delete a rule (admin-only)."""
        self._http.delete(_rule_path(agent_handle, rule_id))

    def list_all(
        self,
        *,
        agent_identity_id: UUID | str | None = None,
        action: IMessageRuleAction | str | None = None,
        match_type: IMessageRuleMatchType | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[IMessageContactRule]:
        """Org-wide list of iMessage contact rules (admin-only).

        Args:
            agent_identity_id: Narrow to a single agent identity by id.
            action: Filter by ``allow`` or ``block``.
            match_type: Filter by ``exact_number``.
        """
        params: dict[str, Any] = {}
        if agent_identity_id is not None:
            params["agent_identity_id"] = str(agent_identity_id)
        if action is not None:
            params["action"] = (
                action.value if isinstance(action, IMessageRuleAction) else action
            )
        if match_type is not None:
            params["match_type"] = (
                match_type.value
                if isinstance(match_type, IMessageRuleMatchType)
                else match_type
            )
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        data = self._http.get(_ORG_BASE, params=params)
        return [IMessageContactRule._from_dict(r) for r in data]
