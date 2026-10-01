"""Directional Slack rules; people use verified workspace:user identifiers."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any
from urllib.parse import quote
from uuid import UUID

from inkbox._http import HttpTransport
from inkbox.contact_rules import ContactRuleDirection, _UNSET, _direction_fields, _rule_update
from inkbox.mail.types import ContactRuleStatus, FilterMode


class SlackRuleAction(StrEnum):
    """Allow or block a matching Slack account."""
    ALLOW = "allow"
    BLOCK = "block"


class SlackRuleMatchType(StrEnum):
    """An exact account (T123:U456) or verified home workspace (T123)."""
    EXACT_USER = "exact_user"
    WORKSPACE = "workspace"


@dataclass
class SlackContactRule:
    """Identity-owned rule with independently editable directional coverage."""
    id: UUID
    agent_identity_id: UUID
    action: SlackRuleAction
    match_type: SlackRuleMatchType
    match_target: str
    direction: ContactRuleDirection
    status: ContactRuleStatus
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> SlackContactRule:
        """Decode the canonical rule response."""
        return cls(
            id=UUID(data["id"]), agent_identity_id=UUID(data["agent_identity_id"]),
            action=SlackRuleAction(data["action"]), match_type=SlackRuleMatchType(data["match_type"]),
            match_target=data["match_target"], direction=ContactRuleDirection(data["direction"]),
            status=ContactRuleStatus(data["status"]),
            created_at=datetime.fromisoformat(data["created_at"]),
            updated_at=datetime.fromisoformat(data["updated_at"]),
        )


@dataclass
class SlackContactRuleSettings:
    """Independent inbound and outbound blacklist/whitelist defaults."""
    inbound_filter_mode: FilterMode
    outbound_filter_mode: FilterMode

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> SlackContactRuleSettings:
        """Decode directional defaults."""
        return cls(FilterMode(data["inbound_filter_mode"]), FilterMode(data["outbound_filter_mode"]))


def _path(handle: str, suffix: UUID | str | None = None) -> str:
    """Encode identity and rule references as individual path segments."""
    path = f"/slack/identities/{quote(handle.removeprefix('@'), safe='')}/contact-rules"
    return path if suffix is None else f"{path}/{quote(str(suffix), safe='')}"


class SlackContactRulesResource:
    """Read own rules with a claimed agent key; writes require a human JWT or org-management key."""
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(self, agent_handle: str, *, action: SlackRuleAction | str | None = None,
             match_type: SlackRuleMatchType | str | None = None,
             direction: ContactRuleDirection | str = _UNSET,  # type: ignore[assignment]
             limit: int | None = None, offset: int | None = None) -> list[SlackContactRule]:
        """List one page; inbound/outbound filters also include both-direction rules."""
        params = {**_direction_fields(direction), **{k: str(v) for k, v in {
            "action": action, "match_type": match_type, "limit": limit, "offset": offset,
        }.items() if v is not None}}
        return [SlackContactRule._from_dict(r) for r in self._http.get(_path(agent_handle), params=params)]

    def get(self, agent_handle: str, rule_id: UUID | str) -> SlackContactRule:
        """Read a rule by its stable identifier."""
        return SlackContactRule._from_dict(self._http.get(_path(agent_handle, rule_id)))

    def create(self, agent_handle: str, *, action: SlackRuleAction | str,
               match_type: SlackRuleMatchType | str, match_target: str,
               direction: ContactRuleDirection | str = _UNSET) -> SlackContactRule:  # type: ignore[assignment]
        """Create/extend coverage. A person target is verified home workspace:user, not email."""
        return SlackContactRule._from_dict(self._http.post(_path(agent_handle), json={
            "action": str(action), "match_type": str(match_type), "match_target": match_target,
            **_direction_fields(direction),
        }))

    def update(self, agent_handle: str, rule_id: UUID | str, *, action: SlackRuleAction | str | None = None,
               direction: ContactRuleDirection | str = _UNSET,  # type: ignore[assignment]
               apply_to: ContactRuleDirection | str = _UNSET) -> SlackContactRule:  # type: ignore[assignment]
        """Change coverage or one side's action without changing the other side."""
        return SlackContactRule._from_dict(self._http.patch(
            _path(agent_handle, rule_id), json=_rule_update(action, direction, apply_to)))

    def delete(self, agent_handle: str, rule_id: UUID | str) -> None:
        """Delete a rule; does not delete messages or contacts."""
        self._http.delete(_path(agent_handle, rule_id))

    def get_settings(self, agent_handle: str) -> SlackContactRuleSettings:
        """Read independent directional defaults."""
        return SlackContactRuleSettings._from_dict(self._http.get(_path(agent_handle, "settings")))

    def update_settings(self, agent_handle: str, *, inbound_filter_mode: FilterMode | str = _UNSET,
                        outbound_filter_mode: FilterMode | str = _UNSET) -> SlackContactRuleSettings:  # type: ignore[assignment]
        """Change provided defaults; omission preserves the other direction."""
        body = {key: FilterMode(value).value for key, value in {
            "inbound_filter_mode": inbound_filter_mode, "outbound_filter_mode": outbound_filter_mode,
        }.items() if value is not _UNSET}
        if not body:
            raise ValueError("Provide at least one directional filter mode")
        return SlackContactRuleSettings._from_dict(self._http.patch(_path(agent_handle, "settings"), json=body))
