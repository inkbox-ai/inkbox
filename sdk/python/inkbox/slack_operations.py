"""Scoped Slack utilities, durable actions, and explicitly retained history."""

from dataclasses import dataclass
from datetime import datetime
import re
from typing import Any, Literal
from urllib.parse import quote
from uuid import UUID

from inkbox._http import HttpTransport

SlackProcessingStatus = Literal["active", "processing", "suspended", "closed"]
SlackOperationKind = Literal[
    "reaction_add",
    "reaction_remove",
    "pin_add",
    "pin_remove",
    "message_update",
    "message_delete",
    "file_upload",
    "conversation_join",
    "conversation_leave",
    "processing_status",
]


@dataclass
class SlackOperation:
    id: UUID
    connection_id: UUID
    operation: SlackOperationKind
    status: Literal["in_progress", "succeeded", "failed", "unknown"]
    conversation_id: str
    message_ts: str | None = None
    file_id: str | None = None
    error_code: str | None = None
    retry_after: int | None = None
    processing_status: SlackProcessingStatus | None = None
    agent_status: SlackProcessingStatus | None = None


@dataclass
class SlackCapability:
    required_scopes: list[str]
    missing_scopes: list[str]
    scopes_satisfied: bool


@dataclass
class SlackCapabilitiesResponse:
    connection_id: UUID
    scopes: list[str]
    missing_scopes: list[str]
    capabilities: dict[str, SlackCapability]
    native_processing_status: Literal["unknown", "missing_scope"]
    max_upload_bytes: int


@dataclass
class SlackUsersResponse:
    users: list[dict[str, Any]]
    next_cursor: str | None = None


@dataclass
class SlackMembersResponse:
    members: list[str]
    next_cursor: str | None = None


@dataclass
class SlackPinsResponse:
    items: list[dict[str, Any]]
    truncated: bool = False


@dataclass
class SlackReactionsResponse:
    conversation_id: str
    message_ts: str
    reactions: list[dict[str, Any]]


@dataclass
class SlackMessageContextResponse:
    messages: list[dict[str, Any]]
    next_cursor: str | None = None
    has_more: bool = False
    window: Literal["messages_at_or_before_timestamp"] = (
        "messages_at_or_before_timestamp"
    )
    complete: Literal[False] = False


@dataclass
class SlackPermalinkResponse:
    conversation_id: str
    message_ts: str
    permalink: str


@dataclass
class SlackArchiveSettings:
    capture_enabled: bool
    retention_days: int | None
    conversation_ids: list[str]
    revision: int


@dataclass
class SlackArchivedMessage:
    id: UUID
    connection_id: UUID
    conversation_id: str
    message_ts: str
    thread_ts: str | None
    user_id: str | None
    text: str
    files: list[dict[str, Any]]
    mentioned: bool
    source: Literal["event", "backfill", "action"]
    captured_at: datetime
    source_url: str | None = None


@dataclass
class SlackArchiveMessagesResponse:
    messages: list[SlackArchivedMessage]
    next_cursor: str | None = None
    source: Literal["archive"] = "archive"


@dataclass
class SlackArchiveCoverage:
    conversation_id: str
    thread_ts: str | None
    status: Literal["observed", "pending", "running", "complete", "failed", "paused"]
    imported_count: int
    oldest_ts: str | None
    newest_ts: str | None
    error_code: str | None
    updated_at: datetime
    includes_all_threads: bool = False
    access_revoked: bool = False


@dataclass
class SlackArchiveCoverageResponse:
    coverage: list[SlackArchiveCoverage]
    next_cursor: str | None = None


def _parse(cls, raw):
    values = {
        key: value for key, value in raw.items() if key in cls.__dataclass_fields__
    }
    for key in ("id", "connection_id"):
        if key in values:
            values[key] = UUID(values[key])
    for key in ("captured_at", "updated_at"):
        if key in values:
            values[key] = datetime.fromisoformat(values[key])
    return cls(**values)


def _base(value: UUID | str) -> str:
    return f"/slack/connections/{quote(str(value), safe='')}"


def _conversation(connection_id: UUID | str, conversation_id: str) -> str:
    return f"{_base(connection_id)}/conversations/{quote(conversation_id, safe='')}"


def _timestamp(value: str | None) -> str | None:
    if value is not None and not isinstance(value, str):
        raise ValueError("Slack timestamps must be strings")
    return value


def _message(connection_id: UUID | str, conversation_id: str, message_ts: str) -> str:
    _timestamp(message_ts)
    return f"{_conversation(connection_id, conversation_id)}/messages/{quote(message_ts, safe='')}"


class SlackOperationsMixin:
    _http: HttpTransport

    def _operation(
        self, method: str, path: str, key: str, body: dict | None = None
    ) -> SlackOperation:
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", key):
            raise ValueError(
                "idempotency_key must be 1..128 letters, digits, '.', '_', ':', or '-'"
            )
        kwargs = {"headers": {"Idempotency-Key": key}}
        if method != "delete_with_response":
            kwargs["json"] = body
        return _parse(SlackOperation, getattr(self._http, method)(path, **kwargs))

    def capabilities(self, connection_id: UUID | str) -> SlackCapabilitiesResponse:
        raw = self._http.get(f"{_base(connection_id)}/capabilities")
        raw["capabilities"] = {
            name: _parse(SlackCapability, value)
            for name, value in raw["capabilities"].items()
        }
        return _parse(SlackCapabilitiesResponse, raw)

    def list_users(
        self, connection_id: UUID | str, *, limit: int = 100, cursor: str | None = None
    ) -> SlackUsersResponse:
        return _parse(
            SlackUsersResponse,
            self._http.get(
                f"{_base(connection_id)}/users",
                params={"limit": limit, "cursor": cursor},
            ),
        )

    def get_user(self, connection_id: UUID | str, user_id: str) -> dict[str, Any]:
        return self._http.get(f"{_base(connection_id)}/users/{quote(user_id, safe='')}")

    def list_members(
        self,
        connection_id: UUID | str,
        conversation_id: str,
        *,
        limit: int = 100,
        cursor: str | None = None,
    ) -> SlackMembersResponse:
        return _parse(
            SlackMembersResponse,
            self._http.get(
                f"{_conversation(connection_id, conversation_id)}/members",
                params={"limit": limit, "cursor": cursor},
            ),
        )

    def get_message(
        self,
        connection_id: UUID | str,
        conversation_id: str,
        message_ts: str,
        *,
        thread_ts: str | None = None,
    ) -> dict[str, Any]:
        return self._http.get(
            _message(connection_id, conversation_id, message_ts),
            params={"thread_ts": _timestamp(thread_ts)},
        )

    def message_context(
        self,
        connection_id: UUID | str,
        conversation_id: str,
        message_ts: str,
        *,
        limit: int = 5,
        thread_ts: str | None = None,
    ) -> SlackMessageContextResponse:
        return _parse(
            SlackMessageContextResponse,
            self._http.get(
                f"{_message(connection_id, conversation_id, message_ts)}/context",
                params={"limit": limit, "thread_ts": _timestamp(thread_ts)},
            ),
        )

    def get_permalink(
        self, connection_id: UUID | str, conversation_id: str, message_ts: str
    ) -> SlackPermalinkResponse:
        return _parse(
            SlackPermalinkResponse,
            self._http.get(
                f"{_message(connection_id, conversation_id, message_ts)}/permalink"
            ),
        )

    def get_reactions(
        self, connection_id: UUID | str, conversation_id: str, message_ts: str
    ) -> SlackReactionsResponse:
        return _parse(
            SlackReactionsResponse,
            self._http.get(
                f"{_message(connection_id, conversation_id, message_ts)}/reactions"
            ),
        )

    def list_pins(
        self, connection_id: UUID | str, conversation_id: str
    ) -> SlackPinsResponse:
        return _parse(
            SlackPinsResponse,
            self._http.get(f"{_conversation(connection_id, conversation_id)}/pins"),
        )

    def get_operation(
        self, connection_id: UUID | str, operation_id: UUID | str
    ) -> SlackOperation:
        """Poll only in_progress; unknown is terminal uncertainty, not a retry instruction."""
        return _parse(
            SlackOperation,
            self._http.get(
                f"{_base(connection_id)}/operations/{quote(str(operation_id), safe='')}"
            ),
        )

    def add_reaction(
        self,
        connection_id: UUID | str,
        conversation_id: str,
        message_ts: str,
        name: str,
        *,
        idempotency_key: str,
    ) -> SlackOperation:
        return self._operation(
            "post",
            f"{_message(connection_id, conversation_id, message_ts)}/reactions",
            idempotency_key,
            {"name": name},
        )

    def remove_reaction(
        self,
        connection_id: UUID | str,
        conversation_id: str,
        message_ts: str,
        name: str,
        *,
        idempotency_key: str,
    ) -> SlackOperation:
        return self._operation(
            "delete_with_response",
            f"{_message(connection_id, conversation_id, message_ts)}/reactions/{quote(name, safe='')}",
            idempotency_key,
        )

    def add_pin(
        self,
        connection_id: UUID | str,
        conversation_id: str,
        message_ts: str,
        *,
        idempotency_key: str,
    ) -> SlackOperation:
        return self._operation(
            "post",
            f"{_conversation(connection_id, conversation_id)}/pins",
            idempotency_key,
            {"message_ts": _timestamp(message_ts)},
        )

    def remove_pin(
        self,
        connection_id: UUID | str,
        conversation_id: str,
        message_ts: str,
        *,
        idempotency_key: str,
    ) -> SlackOperation:
        _timestamp(message_ts)
        return self._operation(
            "delete_with_response",
            f"{_conversation(connection_id, conversation_id)}/pins/{quote(message_ts, safe='')}",
            idempotency_key,
        )

    def update_message(
        self,
        connection_id: UUID | str,
        conversation_id: str,
        message_ts: str,
        text: str,
        *,
        idempotency_key: str,
    ) -> SlackOperation:
        """Edit only the connected agent's own message; Slack enforces authorship."""
        return self._operation(
            "patch",
            _message(connection_id, conversation_id, message_ts),
            idempotency_key,
            {"text": text},
        )

    def delete_message(
        self,
        connection_id: UUID | str,
        conversation_id: str,
        message_ts: str,
        *,
        idempotency_key: str,
    ) -> SlackOperation:
        return self._operation(
            "delete_with_response",
            _message(connection_id, conversation_id, message_ts),
            idempotency_key,
        )

    def join_conversation(
        self, connection_id: UUID | str, conversation_id: str, *, idempotency_key: str
    ) -> SlackOperation:
        return self._operation(
            "post",
            f"{_conversation(connection_id, conversation_id)}/join",
            idempotency_key,
        )

    def leave_conversation(
        self, connection_id: UUID | str, conversation_id: str, *, idempotency_key: str
    ) -> SlackOperation:
        return self._operation(
            "post",
            f"{_conversation(connection_id, conversation_id)}/leave",
            idempotency_key,
        )

    def set_processing_status(
        self,
        connection_id: UUID | str,
        conversation_id: str,
        thread_ts: str,
        status: SlackProcessingStatus,
        *,
        idempotency_key: str,
    ) -> SlackOperation:
        """Native feature availability is workspace-dependent; no reaction fallback."""
        return self._operation(
            "post",
            f"{_conversation(connection_id, conversation_id)}/processing-status",
            idempotency_key,
            {"thread_ts": _timestamp(thread_ts), "status": status},
        )

    def upload_file(
        self,
        connection_id: UUID | str,
        *,
        conversation_id: str,
        filename: str,
        content_base64: str,
        idempotency_key: str,
        title: str | None = None,
        initial_comment: str | None = None,
        thread_ts: str | None = None,
    ) -> SlackOperation:
        """Upload 1 byte..10 MiB of general file content encoded as standard base64."""
        body = {
            "conversation_id": conversation_id,
            "filename": filename,
            "content_base64": content_base64,
        }
        body.update(
            {
                key: value
                for key, value in {
                    "title": title,
                    "initial_comment": initial_comment,
                    "thread_ts": _timestamp(thread_ts),
                }.items()
                if value is not None
            }
        )
        return self._operation(
            "post", f"{_base(connection_id)}/files", idempotency_key, body
        )

    def get_archive_settings(self, connection_id: UUID | str) -> SlackArchiveSettings:
        return _parse(
            SlackArchiveSettings,
            self._http.get(f"{_base(connection_id)}/archive/settings"),
        )

    def update_archive_settings(
        self,
        connection_id: UUID | str,
        *,
        capture_enabled: bool,
        retention_days: int | None = None,
        conversation_ids: list[str] | None = None,
    ) -> SlackArchiveSettings:
        """Organization management only; replaces capture settings. Null retention has no time limit."""
        return _parse(
            SlackArchiveSettings,
            self._http.patch(
                f"{_base(connection_id)}/archive/settings",
                json={
                    "capture_enabled": capture_enabled,
                    "retention_days": retention_days,
                    "conversation_ids": conversation_ids
                    if conversation_ids is not None
                    else [],
                },
            ),
        )

    def _archive_messages(
        self, connection_id: UUID | str, path: str, params: dict
    ) -> SlackArchiveMessagesResponse:
        for key in ("thread_ts", "before_ts", "after_ts"):
            _timestamp(params.get(key))
        raw = self._http.get(f"{_base(connection_id)}/archive/{path}", params=params)
        raw["messages"] = [
            _parse(SlackArchivedMessage, item) for item in raw["messages"]
        ]
        return _parse(SlackArchiveMessagesResponse, raw)

    def list_archived_messages(
        self,
        connection_id: UUID | str,
        *,
        conversation_id: str | None = None,
        thread_ts: str | None = None,
        before_ts: str | None = None,
        after_ts: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> SlackArchiveMessagesResponse:
        return self._archive_messages(
            connection_id,
            "messages",
            {
                "conversation_id": conversation_id,
                "thread_ts": thread_ts,
                "before_ts": before_ts,
                "after_ts": after_ts,
                "cursor": cursor,
                "limit": limit,
            },
        )

    def search_archived_messages(
        self,
        connection_id: UUID | str,
        q: str,
        *,
        conversation_id: str | None = None,
        user_id: str | None = None,
        before_ts: str | None = None,
        after_ts: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> SlackArchiveMessagesResponse:
        return self._archive_messages(
            connection_id,
            "search",
            {
                "q": q,
                "conversation_id": conversation_id,
                "user_id": user_id,
                "before_ts": before_ts,
                "after_ts": after_ts,
                "cursor": cursor,
                "limit": limit,
            },
        )

    def archive_backfill(
        self,
        connection_id: UUID | str,
        conversation_id: str,
        *,
        thread_ts: str | None = None,
        restart: bool = False,
    ) -> SlackArchiveCoverage:
        body = {"conversation_id": conversation_id, "restart": restart}
        if thread_ts is not None:
            body["thread_ts"] = _timestamp(thread_ts)
        return _parse(
            SlackArchiveCoverage,
            self._http.post(f"{_base(connection_id)}/archive/backfill", json=body),
        )

    def list_archive_coverage(
        self, connection_id: UUID | str, *, limit: int = 100, cursor: str | None = None
    ) -> SlackArchiveCoverageResponse:
        raw = self._http.get(
            f"{_base(connection_id)}/archive/coverage",
            params={"limit": limit, "cursor": cursor},
        )
        raw["coverage"] = [
            _parse(SlackArchiveCoverage, item) for item in raw["coverage"]
        ]
        return _parse(SlackArchiveCoverageResponse, raw)

    def purge_archive(self, connection_id: UUID | str) -> dict[str, Any]:
        """Organization management only; disables capture and queues retained-content deletion."""
        return self._http.delete_with_response(f"{_base(connection_id)}/archive")
