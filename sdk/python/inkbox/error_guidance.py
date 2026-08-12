"""Typed Support Agent information included with API errors."""

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
class A2ASettingsVerification:
    method: str
    url_template: str
    required_values: dict[str, bool]
    policy_fields: tuple[str, ...]


@dataclass(frozen=True)
class A2AContactRulesVerification:
    method: str
    url_template: str
    peer_handle: str
    relevant_directions: tuple[str, ...]
    blocking_action: str


@dataclass(frozen=True)
class AgentSupportVerification:
    a2a_settings: A2ASettingsVerification
    contact_rules: A2AContactRulesVerification


@dataclass(frozen=True)
class AgentSupport:
    message: str
    agent_card_url: str
    agent_card_authentication_required: bool
    conversation_requirements: SupportConversationRequirements
    verification: AgentSupportVerification


def _nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value)


def parse_agent_support(value: Any) -> AgentSupport | None:
    """Parse support data strictly without making an API error fail."""
    try:
        if not isinstance(value, dict):
            return None
        requirements = value["conversation_requirements"]
        verification = value["verification"]
        settings = verification["a2a_settings"]
        rules = verification["contact_rules"]
        if not all(
            isinstance(item, dict)
            for item in (requirements, verification, settings, rules)
        ):
            return None
        required_values = settings["required_values"]
        policy_fields = settings["policy_fields"]
        directions = rules["relevant_directions"]
        if (
            not _nonempty_string(value["message"])
            or not _nonempty_string(value["agent_card_url"])
            or not value["agent_card_url"].startswith("https://")
            or value["agent_card_authentication_required"] is not False
            or requirements["authentication"] != "agent_scoped_api_key"
            or requirements["claimed_identity"] is not True
            or requirements["a2a_enabled"] is not True
            or requirements["support_contact_allowed"] is not True
            or settings["method"] != "GET"
            or not _nonempty_string(settings["url_template"])
            or rules["method"] != "GET"
            or not _nonempty_string(rules["url_template"])
            or rules["peer_handle"] != "support"
            or rules["blocking_action"] != "block"
            or not isinstance(required_values, dict)
            or required_values.get("enabled") is not True
            or not isinstance(policy_fields, list)
            or not all(_nonempty_string(item) for item in policy_fields)
            or not isinstance(directions, list)
            or not all(_nonempty_string(item) for item in directions)
        ):
            return None
        return AgentSupport(
            message=value["message"],
            agent_card_url=value["agent_card_url"],
            agent_card_authentication_required=False,
            conversation_requirements=SupportConversationRequirements(
                authentication="agent_scoped_api_key",
                claimed_identity=True,
                a2a_enabled=True,
                support_contact_allowed=True,
            ),
            verification=AgentSupportVerification(
                a2a_settings=A2ASettingsVerification(
                    method=settings["method"],
                    url_template=settings["url_template"],
                    required_values=required_values,
                    policy_fields=tuple(policy_fields),
                ),
                contact_rules=A2AContactRulesVerification(
                    method=rules["method"],
                    url_template=rules["url_template"],
                    peer_handle=rules["peer_handle"],
                    relevant_directions=tuple(directions),
                    blocking_action=rules["blocking_action"],
                ),
            ),
        )
    except (KeyError, TypeError):
        return None
