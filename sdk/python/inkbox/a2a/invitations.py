"""Organization-managed A2A invitation resource."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import re
from typing import Any, Literal
from urllib.parse import parse_qsl, urlsplit

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
    inviter_email: str | None
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
    invitation_url: str | None = None
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
        inviter_email=data.get("inviter_email"),
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


class A2AInvitationParseError(ValueError):
    """Raised when an A2A invitation link is invalid for the configured site."""


_TOKEN_PATTERN = re.compile(r"^a2ai_[A-Za-z0-9_-]{43}$")
_MAX_INVITATION_INPUT_BYTES = 2048


def _origin(value: str) -> tuple[str, str, int]:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise A2AInvitationParseError("The A2A invitation link is invalid.")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as exc:
        raise A2AInvitationParseError("The A2A invitation link is invalid.") from exc
    return parsed.scheme, parsed.hostname.lower(), port


def extract_a2a_invitation_token(
    value: str, *, base_url: str = "https://inkbox.ai"
) -> str:
    """Return the raw token from an A2A invitation link or raw token.

    Links must use HTTPS (HTTP only for localhost/127.0.0.1), the configured
    site's exact origin, and the public invitation acceptance path. Error
    messages never include the capability value.
    """

    if not value or len(value.encode("utf-8")) > _MAX_INVITATION_INPUT_BYTES:
        raise A2AInvitationParseError("The A2A invitation link or token is invalid.")
    candidate = value.strip()
    if _TOKEN_PATTERN.fullmatch(candidate):
        return candidate
    if "://" not in candidate and not candidate.lower().startswith(("http:", "https:")):
        raise A2AInvitationParseError("The A2A invitation link or token is invalid.")

    try:
        parsed = urlsplit(candidate)
        expected_origin = _origin(base_url)
        actual_origin = _origin(candidate)
    except (TypeError, ValueError) as exc:
        if isinstance(exc, A2AInvitationParseError):
            raise
        raise A2AInvitationParseError("The A2A invitation link is invalid.") from exc
    if expected_origin[0] == "http" and expected_origin[1] not in {
        "localhost",
        "127.0.0.1",
    }:
        raise A2AInvitationParseError("The configured site URL is invalid.")
    if parsed.username is not None or parsed.password is not None:
        raise A2AInvitationParseError("The A2A invitation link is invalid.")
    if actual_origin != expected_origin:
        raise A2AInvitationParseError(
            "The A2A invitation link does not match the configured site."
        )
    before_fragment = candidate.partition("#")[0]
    if parsed.path != "/console/a2a/invitations/accept" or "?" in before_fragment:
        raise A2AInvitationParseError("The A2A invitation link is invalid.")
    fragment = parsed.fragment
    if re.search(r"%(?![0-9A-Fa-f]{2})", fragment):
        raise A2AInvitationParseError("The A2A invitation link is invalid.")
    try:
        fields = parse_qsl(fragment, keep_blank_values=True, strict_parsing=True)
    except ValueError as exc:
        raise A2AInvitationParseError("The A2A invitation link is invalid.") from exc
    if (
        len(fields) != 1
        or fields[0][0] != "token"
        or _TOKEN_PATTERN.fullmatch(fields[0][1]) is None
    ):
        raise A2AInvitationParseError("The A2A invitation link is invalid.")
    return fields[0][1]


class A2AInvitationsResource:
    """Create, inspect, revoke, and accept A2A invitations."""

    _BASE = "/a2a/invitations"

    def __init__(
        self, http: HttpTransport, base_url: str = "https://inkbox.ai"
    ) -> None:
        self._http = http
        self._base_url = base_url

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
            invitation_url=data.get("invitation_url"),
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
        invitation_token = extract_a2a_invitation_token(
            invitation_token, base_url=self._base_url
        )
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
