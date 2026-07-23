"""Types for the Inkbox A2A inbox and the standard A2A 1.0 wire."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal


class ForwardCompatibleStrEnum(StrEnum):
    """String enum that preserves values added by newer servers."""

    @classmethod
    def _missing_(cls, value: object):
        if not isinstance(value, str):
            return None
        member = str.__new__(cls, value)
        member._name_ = f"UNKNOWN_{value.upper()}"
        member._value_ = value
        return member


class A2ATaskState(ForwardCompatibleStrEnum):
    SUBMITTED = "submitted"
    WORKING = "working"
    INPUT_REQUIRED = "input_required"
    AUTH_REQUIRED = "auth_required"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"
    REJECTED = "rejected"


class A2AWireTaskState(ForwardCompatibleStrEnum):
    UNSPECIFIED = "TASK_STATE_UNSPECIFIED"
    SUBMITTED = "TASK_STATE_SUBMITTED"
    WORKING = "TASK_STATE_WORKING"
    COMPLETED = "TASK_STATE_COMPLETED"
    FAILED = "TASK_STATE_FAILED"
    CANCELED = "TASK_STATE_CANCELED"
    INPUT_REQUIRED = "TASK_STATE_INPUT_REQUIRED"
    REJECTED = "TASK_STATE_REJECTED"
    AUTH_REQUIRED = "TASK_STATE_AUTH_REQUIRED"


class A2ARuleAction(ForwardCompatibleStrEnum):
    ALLOW = "allow"
    BLOCK = "block"


class A2ARuleDirection(ForwardCompatibleStrEnum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"
    BOTH = "both"


class A2AReplyIntent(StrEnum):
    ASK_CALLER = "ask_caller"
    COMPLETE = "complete"
    FAIL = "fail"


@dataclass(frozen=True)
class A2ASkill:
    id: str
    name: str
    description: str
    tags: list[str]
    examples: list[str] = field(default_factory=list)
    input_modes: list[str] = field(default_factory=list)
    output_modes: list[str] = field(default_factory=list)

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "tags": self.tags,
            "examples": self.examples,
            "inputModes": self.input_modes,
            "outputModes": self.output_modes,
        }


@dataclass(frozen=True)
class A2ASettings:
    enabled: bool
    filter_mode: str
    skills: list[A2ASkill] | None
    card_url: str
    updated_at: datetime | None


@dataclass(frozen=True)
class A2AContactRule:
    id: str
    action: A2ARuleAction
    match_type: str
    match_target: str
    direction: A2ARuleDirection
    status: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class A2ACaller:
    identity_id: str
    organization_id: str
    handle: str | None
    trust_tier: str = "inkbox_verified"


@dataclass(frozen=True)
class A2AMessage:
    id: str
    message_id: str
    role: str
    parts: list[dict[str, Any]]
    metadata: dict[str, Any] | None
    extensions: list[str] | None
    reference_task_ids: list[str] | None
    created_at: datetime


@dataclass(frozen=True)
class A2ATransition:
    id: str
    from_state: A2ATaskState | None
    to_state: A2ATaskState
    actor: str
    reason: str | None
    created_at: datetime


@dataclass(frozen=True)
class A2ATask:
    id: str
    context_id: str
    state: A2ATaskState
    caller: A2ACaller
    messages: list[A2AMessage]
    transitions: list[A2ATransition]
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class A2ATaskPage:
    items: list[A2ATask]
    next_cursor: str | None


@dataclass(frozen=True)
class A2AContext:
    id: str
    caller: A2ACaller
    tasks: list[A2ATask]
    created_at: datetime
    last_activity_at: datetime


@dataclass(frozen=True)
class A2AContextPage:
    items: list[A2AContext]
    next_cursor: str | None


@dataclass(frozen=True)
class A2ACard:
    raw: dict[str, Any]

    @property
    def name(self) -> str:
        return str(self.raw.get("name", ""))


@dataclass(frozen=True)
class A2AResolvedTarget:
    card_url: str
    rpc_url: str
    protocol_version: str
    card: A2ACard
    credential: str | None = field(default=None, repr=False)


@dataclass(frozen=True)
class A2AWireMessage:
    raw: dict[str, Any]

    @property
    def message_id(self) -> str:
        return str(self.raw.get("messageId", ""))


@dataclass(frozen=True)
class A2AWireTask:
    raw: dict[str, Any]

    @property
    def id(self) -> str:
        return str(self.raw["id"])

    @property
    def context_id(self) -> str:
        return str(self.raw["contextId"])

    @property
    def state(self) -> A2AWireTaskState:
        return A2AWireTaskState(self.raw["status"]["state"])


@dataclass(frozen=True)
class A2ASendResult:
    kind: Literal["task", "message"]
    task: A2AWireTask | None = None
    message: A2AWireMessage | None = None


@dataclass(frozen=True)
class A2AWireTaskPage:
    tasks: list[A2AWireTask]
    next_page_token: str | None
    page_size: int
    total_size: int


def parse_datetime(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def parse_skill(data: dict[str, Any]) -> A2ASkill:
    return A2ASkill(
        id=data["id"],
        name=data["name"],
        description=data["description"],
        tags=list(data.get("tags", [])),
        examples=list(data.get("examples", [])),
        input_modes=list(data.get("inputModes", [])),
        output_modes=list(data.get("outputModes", [])),
    )


def parse_caller(data: dict[str, Any]) -> A2ACaller:
    return A2ACaller(
        identity_id=data["identity_id"],
        organization_id=data["organization_id"],
        handle=data.get("handle"),
        trust_tier=data.get("trust_tier", "inkbox_verified"),
    )


def parse_message(data: dict[str, Any]) -> A2AMessage:
    return A2AMessage(
        id=data["id"],
        message_id=data["message_id"],
        role=data["role"],
        parts=list(data.get("parts", [])),
        metadata=data.get("metadata"),
        extensions=data.get("extensions"),
        reference_task_ids=data.get("reference_task_ids"),
        created_at=parse_datetime(data["created_at"]),  # type: ignore[arg-type]
    )


def parse_task(data: dict[str, Any]) -> A2ATask:
    return A2ATask(
        id=data["id"],
        context_id=data["context_id"],
        state=A2ATaskState(data["state"]),
        caller=parse_caller(data["caller"]),
        messages=[parse_message(item) for item in data.get("messages", [])],
        transitions=[
            A2ATransition(
                id=item["id"],
                from_state=(
                    A2ATaskState(item["from_state"])
                    if item.get("from_state")
                    else None
                ),
                to_state=A2ATaskState(item["to_state"]),
                actor=item["actor"],
                reason=item.get("reason"),
                created_at=parse_datetime(item["created_at"]),  # type: ignore[arg-type]
            )
            for item in data.get("transitions", [])
        ],
        completed_at=parse_datetime(data.get("completed_at")),
        created_at=parse_datetime(data["created_at"]),  # type: ignore[arg-type]
        updated_at=parse_datetime(data["updated_at"]),  # type: ignore[arg-type]
    )


def parse_context(data: dict[str, Any]) -> A2AContext:
    return A2AContext(
        id=data["id"],
        caller=parse_caller(data["caller"]),
        tasks=[parse_task(item) for item in data.get("tasks", [])],
        created_at=parse_datetime(data["created_at"]),  # type: ignore[arg-type]
        last_activity_at=parse_datetime(data["last_activity_at"]),  # type: ignore[arg-type]
    )
