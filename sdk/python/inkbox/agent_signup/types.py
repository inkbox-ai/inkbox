"""
inkbox/agent_signup/types.py

Dataclasses for the agent self-signup flow.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class AgentSignupResponse:
    """Response from ``POST /api/v1/agent-signup``."""

    email_address: str
    organization_id: str
    api_key: str
    agent_handle: str
    claim_status: str
    human_email: str
    message: str

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> AgentSignupResponse:
        return cls(
            email_address=d["email_address"],
            organization_id=d["organization_id"],
            api_key=d["api_key"],
            agent_handle=d["agent_handle"],
            claim_status=d["claim_status"],
            human_email=d["human_email"],
            message=d["message"],
        )


@dataclass
class AgentSignupVerifyResponse:
    """Response from ``POST /api/v1/agent-signup/verify``."""

    claim_status: str
    organization_id: str
    message: str

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> AgentSignupVerifyResponse:
        return cls(
            claim_status=d["claim_status"],
            organization_id=d["organization_id"],
            message=d["message"],
        )


@dataclass
class AgentSignupResendResponse:
    """Response from ``POST /api/v1/agent-signup/resend-verification``."""

    message: str

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> AgentSignupResendResponse:
        return cls(message=d["message"])


@dataclass
class SignupRestrictions:
    """Behavioral restrictions applied to an agent based on claim status."""

    max_sends_per_day: int
    allowed_recipients: list[str]
    can_receive: bool
    can_create_mailboxes: bool

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> SignupRestrictions:
        return cls(
            max_sends_per_day=d["max_sends_per_day"],
            allowed_recipients=d["allowed_recipients"],
            can_receive=d["can_receive"],
            can_create_mailboxes=d["can_create_mailboxes"],
        )


@dataclass
class AgentSignupStatusResponse:
    """Response from ``GET /api/v1/agent-signup/status``."""

    claim_status: str
    human_state: str
    human_email: str
    restrictions: SignupRestrictions

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> AgentSignupStatusResponse:
        return cls(
            claim_status=d["claim_status"],
            human_state=d["human_state"],
            human_email=d["human_email"],
            restrictions=SignupRestrictions._from_dict(d["restrictions"]),
        )
