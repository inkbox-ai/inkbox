"""Organization-managed A2A invitation resource."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from inkbox._http import HttpTransport
from inkbox.a2a.types import parse_datetime

A2AInvitationStatus = Literal[
    "pending", "awaiting_verification", "accepted", "declined", "revoked", "expired"
]
A2AInvitationEmailStatus = Literal[
    "not_requested",
    "pending",
    "sent",
    "failed",
    "indeterminate",
]


@dataclass
class A2AInvitation:
    id: str
    issuer_organization_id: str
    peer_agent_handles: list[str]
    recipient_email: str | None
    status: A2AInvitationStatus
    email_status: A2AInvitationEmailStatus
    email_sent_at: datetime | None
    invitee_identity_id: str | None
    invitee_agent_handle: str | None
    invitee_organization_id: str | None
    expires_at: datetime
    accepted_at: datetime | None
    declined_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass
class A2AInvitationCreateResult(A2AInvitation):
    """Created invitation; secrets are present only for an unbound invitation."""

    invitation_token: str | None = None
    agent_handoff_prompt: str | None = None


@dataclass
class A2AInvitationPage:
    items: list[A2AInvitation]
    next_cursor: str | None


@dataclass
class A2AInvitationAcceptResult:
    invitation_id: str
    status: Literal["accepted"]
    invitee_identity_id: str
    invitee_agent_handle: str
    peer_agent_handles: list[str]
    accepted_at: datetime


def _parse_invitation(data: dict[str, Any]) -> A2AInvitation:
    return A2AInvitation(
        id=data["id"],
        issuer_organization_id=data["issuer_organization_id"],
        peer_agent_handles=list(data["peer_agent_handles"]),
        recipient_email=data.get("recipient_email"),
        status=data["status"],
        email_status=data["email_status"],
        email_sent_at=parse_datetime(data.get("email_sent_at")),
        invitee_identity_id=data.get("invitee_identity_id"),
        invitee_agent_handle=data.get("invitee_agent_handle"),
        invitee_organization_id=data.get("invitee_organization_id"),
        expires_at=parse_datetime(data["expires_at"]),  # type: ignore[arg-type]
        accepted_at=parse_datetime(data.get("accepted_at")),
        declined_at=parse_datetime(data.get("declined_at")),
        revoked_at=parse_datetime(data.get("revoked_at")),
        created_at=parse_datetime(data["created_at"]),  # type: ignore[arg-type]
        updated_at=parse_datetime(data["updated_at"]),  # type: ignore[arg-type]
    )


class A2AInvitationsResource:
    """Create, inspect, revoke, and accept A2A invitations."""

    _BASE = "/a2a/invitations"

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def create(
        self,
        peer_agent_handles: list[str],
        *,
        recipient_email: str | None = None,
        expires_in_seconds: int | None = None,
    ) -> A2AInvitationCreateResult:
        body: dict[str, Any] = {"peer_agent_handles": peer_agent_handles}
        if recipient_email is not None:
            body["recipient_email"] = recipient_email
        if expires_in_seconds is not None:
            body["expires_in_seconds"] = expires_in_seconds
        data = self._http.post(self._BASE, json=body)
        invitation = _parse_invitation(data)
        return A2AInvitationCreateResult(
            **invitation.__dict__,
            invitation_token=data.get("invitation_token"),
            agent_handoff_prompt=data.get("agent_handoff_prompt"),
        )

    def list(
        self,
        *,
        status: A2AInvitationStatus | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> A2AInvitationPage:
        data = self._http.get(
            self._BASE,
            params={"status": status, "cursor": cursor, "limit": limit},
        )
        return A2AInvitationPage(
            items=[_parse_invitation(item) for item in data["items"]],
            next_cursor=data.get("next_cursor"),
        )

    def get(self, invitation_id: str) -> A2AInvitation:
        return _parse_invitation(self._http.get(f"{self._BASE}/{invitation_id}"))

    def revoke(self, invitation_id: str) -> A2AInvitation:
        return _parse_invitation(
            self._http.post(f"{self._BASE}/{invitation_id}/revoke")
        )

    def accept(self, invitation_token: str) -> A2AInvitationAcceptResult:
        data = self._http.post(
            f"{self._BASE}/accept", json={"invitation_token": invitation_token}
        )
        return A2AInvitationAcceptResult(
            invitation_id=data["invitation_id"],
            status=data["status"],
            invitee_identity_id=data["invitee_identity_id"],
            invitee_agent_handle=data["invitee_agent_handle"],
            peer_agent_handles=list(data["peer_agent_handles"]),
            accepted_at=parse_datetime(data["accepted_at"]),  # type: ignore[arg-type]
        )
