"""Typed, machine-actionable guidance included with API errors."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SupportConversationRequirements:
    authentication: str
    claimed_identity: bool
    a2a_enabled: bool
    support_contact_allowed: bool


@dataclass(frozen=True)
class AgentErrorSupport:
    message: str
    agent_card_url: str
    agent_card_authentication_required: bool
    conversation_requirements: SupportConversationRequirements


@dataclass(frozen=True)
class AgentErrorGuidance:
    reason: str
    next_steps: tuple[str, ...]
    support: AgentErrorSupport


def parse_agent_error_guidance(value: Any) -> AgentErrorGuidance | None:
    """Parse guidance strictly without making an otherwise valid error fail."""
    try:
        if not isinstance(value, dict):
            return None
        reason = value["reason"]
        steps = value["next_steps"]
        support = value["support"]
        if not isinstance(reason, str) or not reason or not isinstance(steps, list):
            return None
        if not all(isinstance(step, str) and step for step in steps):
            return None
        if not isinstance(support, dict):
            return None
        requirements = support["conversation_requirements"]
        if not isinstance(requirements, dict):
            return None
        message = support["message"]
        card_url = support["agent_card_url"]
        card_auth = support["agent_card_authentication_required"]
        authentication = requirements["authentication"]
        booleans = (
            requirements["claimed_identity"],
            requirements["a2a_enabled"],
            requirements["support_contact_allowed"],
        )
        if (
            not isinstance(message, str)
            or not message
            or not isinstance(card_url, str)
            or not card_url.startswith("https://")
            or not isinstance(card_auth, bool)
            or not isinstance(authentication, str)
            or not authentication
            or not all(isinstance(item, bool) for item in booleans)
        ):
            return None
        return AgentErrorGuidance(
            reason=reason,
            next_steps=tuple(steps),
            support=AgentErrorSupport(
                message=message,
                agent_card_url=card_url,
                agent_card_authentication_required=card_auth,
                conversation_requirements=SupportConversationRequirements(
                    authentication=authentication,
                    claimed_identity=booleans[0],
                    a2a_enabled=booleans[1],
                    support_contact_allowed=booleans[2],
                ),
            ),
        )
    except (KeyError, TypeError):
        return None
