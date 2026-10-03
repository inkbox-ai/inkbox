"""Directional Slack contact and workspace rules."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID
from inkbox.contact_rules import ContactRuleDirection, _UNSET, _direction_fields, _rule_update

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from urllib.parse import quote
from inkbox.contacts.types import Contact
from inkbox.mail.types import ContactRuleStatus


class SlackRuleAction(StrEnum):
    ALLOW = "allow"
    BLOCK = "block"


class SlackRuleMatchType(StrEnum):
    EXACT_USER = "exact_user"
    WORKSPACE = "workspace"


@dataclass
class SlackContactRule:
    id: UUID
    agent_identity_id: UUID
    action: SlackRuleAction
    match_type: SlackRuleMatchType
    match_target: str
    status: ContactRuleStatus
    created_at: datetime
    updated_at: datetime
    contact: Contact | None = None
    direction: ContactRuleDirection = ContactRuleDirection.BOTH

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> SlackContactRule:
        return cls(
            id=UUID(d["id"]), agent_identity_id=UUID(d["agent_identity_id"]),
            action=SlackRuleAction(d["action"]), match_type=SlackRuleMatchType(d["match_type"]),
            match_target=d["match_target"], status=ContactRuleStatus(d["status"]),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            direction=ContactRuleDirection(d.get("direction", "both")),
            contact=Contact._from_dict(d["contact"]) if d.get("contact") is not None else None,
        )

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_ORG_BASE = "/slack/contact-rules"


def _rule_path(agent_handle: str, rule_id: UUID | str | None = None) -> str:
    base = f"/identities/{quote(agent_handle, safe='')}/slack-contact-rules"
    return base if rule_id is None else f"{base}/{quote(str(rule_id), safe='')}"


class SlackContactRulesResource:
    """Allow/block rules scoped to agent identities for Slack."""

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        agent_handle: str,
        *,
        action: SlackRuleAction | str | None = None,
        match_type: SlackRuleMatchType | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        direction: ContactRuleDirection | str = _UNSET,  # type: ignore[assignment]
    ) -> list[SlackContactRule]:
        params: dict[str, Any] = _direction_fields(direction)
        if action is not None:
            params["action"] = (
                action.value if isinstance(action, SlackRuleAction) else action
            )
        if match_type is not None:
            params["match_type"] = (
                match_type.value
                if isinstance(match_type, SlackRuleMatchType)
                else match_type
            )
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        data = self._http.get(_rule_path(agent_handle), params=params)
        return [SlackContactRule._from_dict(r) for r in data]

    def get(self, agent_handle: str, rule_id: UUID | str) -> SlackContactRule:
        data = self._http.get(_rule_path(agent_handle, rule_id))
        return SlackContactRule._from_dict(data)

    def create(
        self,
        agent_handle: str,
        *,
        action: SlackRuleAction | str,
        match_target: str,
        match_type: SlackRuleMatchType | str = SlackRuleMatchType.EXACT_USER,
        direction: ContactRuleDirection | str = _UNSET,  # type: ignore[assignment]
    ) -> SlackContactRule:
        """Save or extend coverage; omitted direction applies to both sides.

        Duplicate coverage raises :class:`DuplicateContactRuleError`.
        """
        body: dict[str, Any] = {
            **_direction_fields(direction),
            "action": action.value if isinstance(action, SlackRuleAction) else action,
            "match_type": (
                match_type.value
                if isinstance(match_type, SlackRuleMatchType)
                else match_type
            ),
            "match_target": match_target,
        }
        data = self._http.post(_rule_path(agent_handle), json=body)
        return SlackContactRule._from_dict(data)

    def update(
        self,
        agent_handle: str,
        rule_id: UUID | str,
        *,
        action: SlackRuleAction | str | None = None,
        direction: ContactRuleDirection | str = _UNSET,  # type: ignore[assignment]
        apply_to: ContactRuleDirection | str = _UNSET,  # type: ignore[assignment]
    ) -> SlackContactRule:
        """Update action or coverage; apply_to changes only one covered side."""
        body = _rule_update(action, direction, apply_to)
        data = self._http.patch(_rule_path(agent_handle, rule_id), json=body)
        return SlackContactRule._from_dict(data)

    def delete(self, agent_handle: str, rule_id: UUID | str) -> None:
        """Delete a rule (admin-only)."""
        self._http.delete(_rule_path(agent_handle, rule_id))

    def list_all(
        self,
        *,
        agent_identity_id: UUID | str | None = None,
        action: SlackRuleAction | str | None = None,
        match_type: SlackRuleMatchType | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        direction: ContactRuleDirection | str = _UNSET,  # type: ignore[assignment]
    ) -> list[SlackContactRule]:
        """Org-wide list of Slack contact rules (admin-only).

        Args:
            agent_identity_id: Narrow to a single agent identity by id.
            action: Filter by ``allow`` or ``block``.
            match_type: Filter by ``exact_user or workspace``.
        """
        params: dict[str, Any] = _direction_fields(direction)
        if agent_identity_id is not None:
            params["agent_identity_id"] = str(agent_identity_id)
        if action is not None:
            params["action"] = (
                action.value if isinstance(action, SlackRuleAction) else action
            )
        if match_type is not None:
            params["match_type"] = (
                match_type.value
                if isinstance(match_type, SlackRuleMatchType)
                else match_type
            )
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        data = self._http.get(_ORG_BASE, params=params)
        return [SlackContactRule._from_dict(r) for r in data]
