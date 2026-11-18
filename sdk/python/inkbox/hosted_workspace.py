"""Hosted conversations and workspace controls. Reads never start compute."""

from typing import Any, Literal, NotRequired, TypedDict
from urllib.parse import quote
from inkbox._http import HttpTransport
from inkbox.imessage.types import _validate_idempotency_key


class ChatCapabilities(TypedDict):
    permission_mode_selection: NotRequired[bool]
    model_selection: NotRequired[bool]
    send_message: bool
    cancel_turn: bool
    approvals: bool
    questions: bool
    attachments: bool
    tool_activity: bool


class ChatConversation(TypedDict):
    permission_mode: NotRequired[Literal["ask", "yolo"]]
    created_at: NotRequired[str | None]
    last_active_at: NotRequired[str | None]
    id: str
    identity_id: NotRequired[str | None]
    title: str
    origin: Literal["chat", "communication", "schedule"]
    capabilities: ChatCapabilities
    history_completeness: Literal["complete", "partial", "unavailable"]


class ChatTurn(TypedDict):
    id: str
    conversation_id: str
    status: Literal[
        "queued",
        "running",
        "waiting_for_input",
        "cancelling",
        "completed",
        "failed",
        "cancelled",
        "outcome_unknown",
    ]
    terminal: bool
    blocker: NotRequired[dict[str, Any] | None]


class ChatResource(TypedDict):
    id: str
    revision: NotRequired[int | None]
    created_sequence: NotRequired[int | None]
    turn_id: NotRequired[str | None]
    resource_type: NotRequired[str | None]


class ChatMessage(ChatResource):
    phase: NotRequired[Literal["commentary", "final_answer"] | None]
    role: Literal["user", "assistant"]
    content: NotRequired[list[dict[str, Any]]]
    completed: NotRequired[bool]


class ChatTool(ChatResource):
    title: str
    status: Literal["running", "completed", "failed"]
    detail: NotRequired[str | None]


class ChatQuestionField(TypedDict):
    id: str
    label: str
    required: bool
    type: Literal["text", "single_select", "multi_select"]
    choices: NotRequired[list[dict[str, str]]]
    allow_free_text: NotRequired[bool]


class ChatInteraction(ChatResource):
    auto_approve: NotRequired[bool]
    decision: NotRequired[Literal["approve_once", "deny"] | None]
    kind: Literal["approval", "question"]
    version: int
    status: Literal["pending", "submitted", "resolved", "expired", "cancelled"]
    expires_at: str
    title: str
    detail: NotRequired[str | None]
    effective_scope: NotRequired[Literal["operation", "turn"] | None]
    decisions: NotRequired[list[Literal["approve_once", "deny"]] | None]
    fields: NotRequired[list[ChatQuestionField] | None]


class ChatTurnUpdate(ChatResource):
    status: str
    terminal: bool
    blocker: NotRequired[dict[str, Any] | None]


class ChatArtifact(ChatResource):
    file_id: str
    name: str
    media_type: str
    size_bytes: int
    availability: Literal[
        "available", "computer_start_required", "unavailable", "deleted"
    ]


ChatProjection = (
    ChatMessage | ChatTool | ChatInteraction | ChatTurnUpdate | ChatArtifact
)


class ChatEvent(TypedDict):
    schema_version: Literal[1]
    id: str
    sequence: int
    conversation_id: str
    turn_id: str | None
    created_at: str
    type: str
    data: ChatProjection | dict[str, str]
    cursor: NotRequired[str | None]


class ChatEventPage(TypedDict):
    items: list[ChatEvent]
    next_cursor: str


class ChatSnapshot(ChatConversation):
    sequence: int
    snapshot_token: str
    event_cursor: str
    items: list[ChatProjection]
    pending_interactions: list[ChatInteraction]
    current_turn: ChatTurnUpdate | None
    next_cursor: str | None


class ChatText(TypedDict):
    type: Literal["text"]
    text: str


class ChatFileReference(TypedDict):
    type: Literal["file"]
    file_id: str


class HostedWorkspace:
    def __init__(self, http: HttpTransport, handle: str):
        self._http = http
        self._base = f"/{quote(handle, safe='')}/hosting"

    @staticmethod
    def _key(key: str) -> dict[str, str]:
        _validate_idempotency_key(key)
        return {"Idempotency-Key": key}

    def status(self) -> dict[str, Any]:
        return self._http.get(self._base + "/workspace")

    def conversations(
        self, *, after: str | None = None, limit: int = 50,
        origin: Literal["chat", "communication", "schedule"] | None = None
    ) -> dict[str, Any]:
        return self._http.get(
            self._base + "/chat/conversations", params={"after": after, "limit": limit, **({"origin": origin} if origin is not None else {})}
        )

    def create_conversation(
        self, title: str = "", *, idempotency_key: str
    ) -> ChatConversation:
        return self._http.post(
            self._base + "/chat/conversations",
            json={"title": title},
            headers=self._key(idempotency_key),
        )

    def _conversation(self, identifier: str) -> str:
        return self._base + "/chat/conversations/" + quote(identifier, safe="")

    def snapshot(self, conversation_id: str) -> ChatSnapshot:
        return self._http.get(self._conversation(conversation_id))

    def rename_conversation(
        self, conversation_id: str, title: str, *, idempotency_key: str
    ) -> ChatConversation:
        return self._http.patch(
            self._conversation(conversation_id),
            json={"title": title},
            headers=self._key(idempotency_key),
        )

    def set_permission_mode(
        self, conversation_id: str, mode: Literal["ask", "yolo"], *, idempotency_key: str
    ) -> ChatConversation:
        """Set the tool permission policy for future turns in this chat."""
        if mode not in ("ask", "yolo"):
            raise ValueError("mode must be ask or yolo")
        return self._http.patch(
            self._conversation(conversation_id),
            json={"permission_mode": mode},
            headers=self._key(idempotency_key),
        )

    def messages(
        self,
        conversation_id: str,
        *,
        after: str | None = None,
        snapshot: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        return self._http.get(
            self._conversation(conversation_id) + "/messages",
            params={"after": after, "snapshot": snapshot, "limit": limit},
        )

    def events(
        self, conversation_id: str, *, after: str | None = None, limit: int = 50
    ) -> ChatEventPage:
        return self._http.get(
            self._conversation(conversation_id) + "/events",
            params={"after": after, "limit": limit},
        )

    def stream_events(self, conversation_id: str, *, after: str | None = None):
        """Iterate SSE updates. Close the iterator when leaving the conversation."""
        yield from self._http.iter_sse(
            self._conversation(conversation_id) + "/events", after=after
        )

    def send(
        self,
        conversation_id: str,
        content: list[ChatText | ChatFileReference],
        *,
        idempotency_key: str,
        model: str | None = None,
    ) -> ChatTurn:
        return self._http.post(
            self._conversation(conversation_id) + "/turns",
            json={"content": content, **({"model": model} if model is not None else {})},
            headers=self._key(idempotency_key),
        )

    def turn(self, conversation_id: str, turn_id: str) -> ChatTurn:
        return self._http.get(
            self._conversation(conversation_id) + "/turns/" + quote(turn_id, safe="")
        )

    def cancel(
        self, conversation_id: str, turn_id: str, *, idempotency_key: str
    ) -> dict[str, Any]:
        return self._http.post(
            self._conversation(conversation_id)
            + "/turns/"
            + quote(turn_id, safe="")
            + "/cancel",
            json={},
            headers=self._key(idempotency_key),
        )

    def respond(
        self,
        conversation_id: str,
        interaction_id: str,
        expected_version: int,
        response: dict[str, Any],
        *,
        idempotency_key: str,
    ) -> dict[str, Any]:
        return self._http.post(
            self._conversation(conversation_id)
            + "/interactions/"
            + quote(interaction_id, safe="")
            + "/response",
            json={"expected_version": expected_version, "response": response},
            headers=self._key(idempotency_key),
        )

    def upload_file(
        self,
        name: str,
        data_base64: str,
        *,
        media_type: str = "application/octet-stream",
        idempotency_key: str,
    ) -> dict[str, Any]:
        return self._http.post(
            self._base + "/chat/files",
            json={"name": name, "media_type": media_type, "data_base64": data_base64},
            headers=self._key(idempotency_key),
        )

    def file(self, file_id: str) -> dict[str, Any]:
        return self._http.get(self._base + "/chat/files/" + quote(file_id, safe=""))

    def download_file(self, file_id: str) -> dict[str, Any]:
        return self._http.get(
            self._base + "/chat/files/" + quote(file_id, safe="") + "/content"
        )

    def start(self, *, idempotency_key: str) -> dict[str, Any]:
        return self._http.post(
            self._base + "/workspace/actions/start",
            json={},
            headers=self._key(idempotency_key),
        )

    def stop(self, *, idempotency_key: str) -> dict[str, Any]:
        return self._http.post(
            self._base + "/workspace/actions/stop",
            json={},
            headers=self._key(idempotency_key),
        )

    def pause(self, *, idempotency_key: str) -> dict[str, Any]:
        """Save a continuation and keep the agent paused until explicit resume."""
        return self._http.post(
            self._base + "/workspace/actions/pause",
            json={}, headers=self._key(idempotency_key),
        )

    def resume(self, *, idempotency_key: str) -> dict[str, Any]:
        """Continue a paused agent; incompatible state fails without a cold start."""
        return self._http.post(
            self._base + "/workspace/actions/resume",
            json={}, headers=self._key(idempotency_key),
        )

    def resize(
        self, shape_id: str, *, expected_version: int,
        idempotency_key: str, disk_bytes: int | None = None,
    ) -> dict[str, Any]:
        """Resize a stopped computer using its current workspace version."""
        body: dict[str, Any] = {"shape_id": shape_id, "expected_version": expected_version}
        if disk_bytes is not None:
            body["disk_bytes"] = disk_bytes
        return self._http.post(
            self._base + "/workspace/resize", json=body,
            headers=self._key(idempotency_key),
        )

    def operation(self, operation_id: str) -> dict[str, Any]:
        return self._http.get(
            self._base + "/workspace/operations/" + quote(operation_id, safe="")
        )

    def environment(self) -> dict[str, Any]:
        return self._http.get(self._base + "/workspace/environment")

    def update_environment(self, options: dict[str, Any]) -> dict[str, Any]:
        return self._http.put(self._base + "/workspace/environment", json=options)

    def usage(self) -> dict[str, Any]:
        return self._http.get(self._base + "/workspace/usage")

    def usage_history(
        self, window: Literal["1h", "24h", "7d", "30d"] = "24h"
    ) -> dict[str, Any]:
        return self._http.get(
            self._base + "/workspace/usage/history", params={"window": window}
        )

    def terminals(self, *, after: str | None = None, limit: int = 50) -> dict[str, Any]:
        return self._http.get(
            self._base + "/workspace/terminals", params={"after": after, "limit": limit}
        )

    def create_terminal(
        self, options: dict[str, Any], *, idempotency_key: str
    ) -> dict[str, Any]:
        return self._http.post(
            self._base + "/workspace/terminals",
            json=options,
            headers=self._key(idempotency_key),
        )

    def terminal_ticket(self, terminal_id: str) -> dict[str, Any]:
        return self._http.post(
            self._base
            + "/workspace/terminals/"
            + quote(terminal_id, safe="")
            + "/ticket",
            json={},
        )

    def close_terminal(
        self, terminal_id: str, *, idempotency_key: str
    ) -> dict[str, Any]:
        return self._http.post(
            self._base
            + "/workspace/terminals/"
            + quote(terminal_id, safe="")
            + "/close",
            json={},
            headers=self._key(idempotency_key),
        )

    def schedules(self, *, after: str | None = None, limit: int = 50) -> dict[str, Any]:
        return self._http.get(
            self._base + "/workspace/schedules", params={"after": after, "limit": limit}
        )

    def create_schedule(
        self, fields: dict[str, Any], *, idempotency_key: str
    ) -> dict[str, Any]:
        return self._http.post(
            self._base + "/workspace/schedules",
            json={"expected_revision": 0, "fields": fields},
            headers=self._key(idempotency_key),
        )

    def update_schedule(
        self,
        schedule_id: str,
        expected_revision: int,
        fields: dict[str, Any],
        *,
        idempotency_key: str,
    ) -> dict[str, Any]:
        return self._http.put(
            self._base + "/workspace/schedules/" + quote(schedule_id, safe=""),
            json={"expected_revision": expected_revision, "fields": fields},
            headers=self._key(idempotency_key),
        )

    def delete_schedule(
        self, schedule_id: str, expected_revision: int, *, idempotency_key: str
    ) -> dict[str, Any]:
        return self._http.delete_with_response(
            self._base + "/workspace/schedules/" + quote(schedule_id, safe=""),
            json={"expected_revision": expected_revision, "fields": {}},
            headers=self._key(idempotency_key),
        )

    def preview_schedule(self, timing: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(
            self._base + "/workspace/schedules/preview", json={"timing": timing}
        )

    def schedule_history(self, schedule_id: str) -> dict[str, Any]:
        return self._http.get(
            self._base
            + "/workspace/schedules/"
            + quote(schedule_id, safe="")
            + "/occurrences"
        )
