"""Live Slack connections and messaging. Use invitation URLs for browser onboarding."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, TypedDict
from urllib.parse import quote
from uuid import UUID

from inkbox._http import HttpTransport

SlackMessageKind = Literal["dm", "group_dm", "mention", "channel", "thread"]


class SlackWebhookFilter(TypedDict, total=False):
    """Selectors combine with AND; message kinds combine with OR. Null means all."""

    connection_ids: list[UUID | str] | None
    conversation_ids: list[str] | None
    message_kinds: list[SlackMessageKind] | None


@dataclass
class SlackConnection:
    id: UUID
    identity_id: UUID
    workspace_id: str
    workspace_name: str
    bot_user_id: str
    status: Literal["connected", "disconnected", "reauthorization_required"]
    scopes: list[str]
    created_at: datetime


@dataclass
class SlackConnectionsResponse:
    connections: list[SlackConnection]
    installation_available: bool


@dataclass
class SlackInvitation:
    id: UUID
    identity_id: UUID
    status: str
    expires_at: datetime
    invitation_url: str | None = None


@dataclass
class SlackAction:
    id: UUID
    connection_id: UUID
    status: Literal["sending", "sent", "failed", "unknown"]
    conversation_id: str
    message_ts: str | None = None
    thread_ts: str | None = None
    error_code: str | None = None


@dataclass
class SlackConversationsResponse:
    conversations: list[dict[str, Any]]
    next_cursor: str | None = None


@dataclass
class SlackMessagesResponse:
    messages: list[dict[str, Any]]
    next_cursor: str | None = None
    has_more: bool = False


@dataclass
class SlackFile:
    id: str
    name: str | None = None
    title: str | None = None
    mimetype: str | None = None
    size: int | None = None
    downloadable: bool = False


def _parse(cls, raw):
    data = {k: v for k, v in raw.items() if k in cls.__dataclass_fields__}
    for key in ("id", "identity_id", "connection_id"):
        if key in data and cls is not SlackFile:
            data[key] = UUID(data[key])
    for key in ("created_at", "expires_at"):
        if key in data:
            data[key] = datetime.fromisoformat(data[key])
    return cls(**data)


def _connection(connection_id: UUID | str) -> str:
    return f"/slack/connections/{quote(str(connection_id), safe='')}"


class SlackResource:
    """No eager pagination or automatic resend of ambiguous send outcomes."""

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list_connections(self, identity_id: UUID | str) -> SlackConnectionsResponse:
        data = self._http.get(
            "/slack/connections", params={"identity_id": str(identity_id)}
        )
        return SlackConnectionsResponse(
            [_parse(SlackConnection, r) for r in data["connections"]],
            data["installation_available"],
        )

    def create_invitation(
        self, identity_id: UUID | str, *, expires_in_seconds: int = 86400
    ) -> SlackInvitation:
        """Create a one-time invitation URL to open in a browser (organization management only).

        Direct installation/accept requests require a cookie in that browser, so
        these browser-only endpoints are intentionally not exposed here.
        """
        return _parse(
            SlackInvitation,
            self._http.post(
                "/slack/invitations",
                json={
                    "identity_id": str(identity_id),
                    "expires_in_seconds": expires_in_seconds,
                },
            ),
        )

    def list_invitations(self, identity_id: UUID | str) -> list[SlackInvitation]:
        return [
            _parse(SlackInvitation, r)
            for r in self._http.get(
                "/slack/invitations", params={"identity_id": str(identity_id)}
            )
        ]

    def revoke_invitation(self, invitation_id: UUID | str) -> SlackInvitation:
        return _parse(
            SlackInvitation,
            self._http.post(
                f"/slack/invitations/{quote(str(invitation_id), safe='')}/revoke"
            ),
        )

    def disconnect(self, connection_id: UUID | str) -> SlackConnection:
        """Remove Inkbox authority locally; this does not uninstall the Slack app."""
        return _parse(
            SlackConnection, self._http.post(f"{_connection(connection_id)}/disconnect")
        )

    def list_conversations(
        self, connection_id: UUID | str, *, limit: int = 100, cursor: str | None = None
    ) -> SlackConversationsResponse:
        return _parse(
            SlackConversationsResponse,
            self._http.get(
                f"{_connection(connection_id)}/conversations",
                params={"limit": limit, "cursor": cursor},
            ),
        )

    def open_conversation(
        self, connection_id: UUID | str, user_ids: list[str]
    ) -> dict[str, Any]:
        return self._http.post(
            f"{_connection(connection_id)}/conversations", json={"user_ids": user_ids}
        )

    def get_conversation(
        self, connection_id: UUID | str, conversation_id: str
    ) -> dict[str, Any]:
        return self._http.get(
            f"{_connection(connection_id)}/conversations/{quote(conversation_id, safe='')}"
        )

    def list_messages(
        self,
        connection_id: UUID | str,
        conversation_id: str,
        *,
        limit: int = 15,
        cursor: str | None = None,
        thread_ts: str | None = None,
    ) -> SlackMessagesResponse:
        if thread_ts is not None and not isinstance(thread_ts, str):
            raise ValueError("thread_ts must be a string")
        return _parse(
            SlackMessagesResponse,
            self._http.get(
                f"{_connection(connection_id)}/conversations/{quote(conversation_id, safe='')}/messages",
                params={"limit": limit, "cursor": cursor, "thread_ts": thread_ts},
            ),
        )

    def send_message(
        self,
        connection_id: UUID | str,
        *,
        conversation_id: str,
        text: str,
        idempotency_key: str,
        thread_ts: str | None = None,
    ) -> SlackAction:
        """Use a stable key for this exact message; poll get_action while sending; unknown is terminal uncertainty, never blindly resend."""
        if not isinstance(idempotency_key, str) or not re.fullmatch(
            r"[A-Za-z0-9._:-]{1,128}", idempotency_key
        ):
            raise ValueError(
                "idempotency_key must be 1..128 letters, digits, '.', '_', ':', or '-'"
            )
        body = {"conversation_id": conversation_id, "text": text}
        if thread_ts is not None:
            if not isinstance(thread_ts, str):
                raise ValueError("thread_ts must be a string")
            body["thread_ts"] = thread_ts
        return _parse(
            SlackAction,
            self._http.post(
                f"{_connection(connection_id)}/messages",
                json=body,
                headers={"Idempotency-Key": idempotency_key},
            ),
        )

    def get_action(
        self, connection_id: UUID | str, action_id: UUID | str
    ) -> SlackAction:
        return _parse(
            SlackAction,
            self._http.get(
                f"{_connection(connection_id)}/actions/{quote(str(action_id), safe='')}"
            ),
        )

    def get_file(self, connection_id: UUID | str, file_id: str) -> SlackFile:
        return _parse(
            SlackFile,
            self._http.get(
                f"{_connection(connection_id)}/files/{quote(file_id, safe='')}"
            ),
        )

    def download_file(self, connection_id: UUID | str, file_id: str) -> bytes:
        return self._http.get_bytes(
            f"{_connection(connection_id)}/files/{quote(file_id, safe='')}/content",
            accept="application/octet-stream",
        )
