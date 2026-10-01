"""Slack workspace setup, live connections, and messaging."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from urllib.parse import quote
from uuid import UUID

from inkbox._http import HttpTransport
from inkbox.slack_operations import SlackOperationsMixin

SlackMessageKind = Literal["dm", "group_dm", "mention", "channel", "thread"]


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
class SlackSetupStatus:
    status: Literal["not_started", "pending", "ready", "failed", "unavailable", "needs_credentials"]
    retry_at: datetime | None = None
    error_code: Literal["setup_failed", "outcome_unknown", "quota_exceeded", "credentials_required"] | None = None
    provisioning_workspace_id: UUID | None = None


@dataclass
class SlackConnectionsResponse:
    connections: list[SlackConnection]
    installation_available: bool
    setup: SlackSetupStatus | None = None
    application_created: bool = False
    provisioning_workspace: SlackProvisioningWorkspace | None = None


@dataclass
class SlackProvisioningWorkspace:
    id: UUID
    workspace_id: str
    workspace_name: str
    user_id: str
    status: Literal["ready", "reauthorization_required"]
    token_expires_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass
class SlackInstallation:
    authorization_url: str
    expires_at: datetime


@dataclass
class SlackAction:
    """Send outcome; retry_after is an immediate, non-persisted rate-limit hint."""

    id: UUID
    connection_id: UUID
    status: Literal["sending", "sent", "failed", "unknown"]
    conversation_id: str
    message_ts: str | None = None
    thread_ts: str | None = None
    error_code: str | None = None
    retry_after: int | None = None


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
    for key in ("id", "identity_id", "connection_id", "provisioning_workspace_id"):
        if data.get(key) is not None and cls is not SlackFile:
            data[key] = UUID(data[key])
    for key in ("created_at", "updated_at", "expires_at", "token_expires_at"):
        if data.get(key) is not None:
            data[key] = datetime.fromisoformat(data[key])
    if data.get("retry_at") is not None:
        data["retry_at"] = datetime.fromisoformat(data["retry_at"])
    return cls(**data)


def _connection(connection_id: UUID | str) -> str:
    return f"/slack/connections/{quote(str(connection_id), safe='')}"


class SlackResource(SlackOperationsMixin):
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
            _parse(SlackSetupStatus, data["setup"]) if data.get("setup") is not None else None,
            application_created=data.get("application_created", False),
            provisioning_workspace=_parse(SlackProvisioningWorkspace, data["provisioning_workspace"])
            if data.get("provisioning_workspace") is not None else None,
        )

    def list_provisioning_workspaces(self) -> list[SlackProvisioningWorkspace]:
        """List saved workspace metadata; credentials are never returned."""
        return [_parse(SlackProvisioningWorkspace, row) for row in self._http.get(
            "/slack/provisioning-workspaces"
        )["workspaces"]]

    def save_provisioning_workspace(
        self, *, access_token: str, refresh_token: str
    ) -> SlackProvisioningWorkspace:
        """Verify and save configuration credentials for your organization. Claimed agent keys are supported."""
        return _parse(SlackProvisioningWorkspace, self._http.post(
            "/slack/provisioning-workspaces",
            json={"access_token": access_token, "refresh_token": refresh_token},
        ))

    def start_setup(
        self, identity_id: UUID | str, provisioning_workspace_id: UUID | str
    ) -> SlackSetupStatus:
        """Prepare the identity app in a saved workspace; read list_connections for status."""
        return _parse(SlackSetupStatus, self._http.post(
            "/slack/applications/setup", json={
                "identity_id": str(identity_id),
                "provisioning_workspace_id": str(provisioning_workspace_id),
            }
        ))

    def start_installation(
        self,
        identity_id: UUID | str,
        *,
        workspace_id: str | None = None,
        return_url: str | None = None,
    ) -> SlackInstallation:
        """Start installation; claimed agent keys can install only their own identity.

        Open the short-lived authorization URL in a browser; do not log it.

        ``return_url`` optionally selects an approved Console completion URL.
        Omit it to use the default completion page.
        """
        body = {"identity_id": str(identity_id)}
        if workspace_id is not None:
            body["workspace_id"] = workspace_id
        if return_url is not None:
            body["return_url"] = return_url
        return _parse(
            SlackInstallation, self._http.post("/slack/installations", json=body)
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

    def get_action_by_key(
        self, connection_id: UUID | str, idempotency_key: str
    ) -> SlackAction:
        """Read a send without resending; a 404 does not prove no send occurred."""
        return _parse(
            SlackAction,
            self._http.get(
                f"{_connection(connection_id)}/actions/by-key",
                headers={"Idempotency-Key": idempotency_key},
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
