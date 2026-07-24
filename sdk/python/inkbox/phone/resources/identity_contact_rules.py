"""
inkbox/phone/resources/identity_contact_rules.py

Identity-keyed phone contact rules (per-agent-identity allow/block rules
+ org-wide list).

Phone (voice + SMS) rules live on the **agent identity**, addressed by
``agent_handle``, mirroring the iMessage rule shape. The legacy
per-number resource (``inkbox.phone_contact_rules``) is kept as a
deprecated wrapper.

The identity must have a phone number: ``create`` returns 422 and the
identity helpers guard with ``_require_phone()`` before the request.
Listing an identity with no number returns an empty list.

Transport note: rides the api-root transport (``{base}/api/v1``) so it
addresses both ``/identities/{handle}/phone-contact-rules`` and the
org-wide ``/phone/contact-rules`` with full paths. It must NOT ride the
``/phone``-prefixed transport.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.phone.types import (
    PhoneIdentityContactRule,
    PhoneRuleAction,
    PhoneRuleMatchType,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_ORG_BASE = "/phone/contact-rules"


def _rule_path(agent_handle: str, rule_id: UUID | str | None = None) -> str:
    base = f"/identities/{agent_handle}/phone-contact-rules"
    return base if rule_id is None else f"{base}/{rule_id}"


class PhoneIdentityContactRulesResource:
    """Allow/block phone rules scoped to agent identities (voice + SMS)."""

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        agent_handle: str,
        *,
        action: PhoneRuleAction | str | None = None,
        match_type: PhoneRuleMatchType | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[PhoneIdentityContactRule]:
        """List rules for an identity. Returns an empty list when the
        identity has no phone number."""
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
        data = self._http.get(_rule_path(agent_handle), params=params)
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        return [PhoneIdentityContactRule._from_dict(r) for r in items]

    def get(self, agent_handle: str, rule_id: UUID | str) -> PhoneIdentityContactRule:
        data = self._http.get(_rule_path(agent_handle, rule_id))
        return PhoneIdentityContactRule._from_dict(data)

    def create(
        self,
        agent_handle: str,
        *,
        action: PhoneRuleAction | str,
        match_target: str,
        match_type: PhoneRuleMatchType | str = PhoneRuleMatchType.EXACT_NUMBER,
    ) -> PhoneIdentityContactRule:
        """Create a rule for an agent identity.

        The identity must have a phone number — otherwise the server
        returns 422.

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
        data = self._http.post(_rule_path(agent_handle), json=body)
        return PhoneIdentityContactRule._from_dict(data)

    def update(
        self,
        agent_handle: str,
        rule_id: UUID | str,
        *,
        action: PhoneRuleAction | str,
    ) -> PhoneIdentityContactRule:
        """Update ``action`` (admin-only)."""
        body = {
            "action": action.value if isinstance(action, PhoneRuleAction) else action,
        }
        data = self._http.patch(_rule_path(agent_handle, rule_id), json=body)
        return PhoneIdentityContactRule._from_dict(data)

    def delete(self, agent_handle: str, rule_id: UUID | str) -> None:
        """Delete a rule (admin-only)."""
        self._http.delete(_rule_path(agent_handle, rule_id))

    def list_all(
        self,
        *,
        agent_identity_id: UUID | str | None = None,
        action: PhoneRuleAction | str | None = None,
        match_type: PhoneRuleMatchType | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[PhoneIdentityContactRule]:
        """Org-wide list of phone contact rules (admin-only).

        Args:
            agent_identity_id: Narrow to a single agent identity by id.
            action: Filter by ``allow`` or ``block``.
            match_type: Filter by ``exact_number``.
        """
        params: dict[str, Any] = {}
        if agent_identity_id is not None:
            params["agent_identity_id"] = str(agent_identity_id)
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
        return [PhoneIdentityContactRule._from_dict(r) for r in items]
