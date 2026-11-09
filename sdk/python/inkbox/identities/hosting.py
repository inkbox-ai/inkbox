"""Hosted-agent settings for an Inkbox identity."""
from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict, NotRequired


class HostingUpdate(TypedDict):
    expected_generation: int
    enabled: NotRequired[bool]
    harness: NotRequired[Literal['codex', 'hermes']]
    tier: NotRequired[Literal['small', 'medium', 'large']]
    instructions: NotRequired[str]
    trigger_events: NotRequired[list[str]]
    follow_defaults: NotRequired[bool]
    credential_binding_id: NotRequired[str | None]
    idle_timeout_seconds: NotRequired[Literal[300, 600, 1800]]
    idle_stop_enabled: NotRequired[Literal[True]]
    reset_instructions: NotRequired[bool]


@dataclass
class HostingConfiguration:
    mode: str
    identity_id: str
    state: str = 'disabled'
    generation: int = 0
    applied_generation: int = 0
    machine_id: str | None = None
    harness: str | None = None
    tier: str | None = None
    instructions: str = ''
    trigger_events: list[str] = field(default_factory=list)
    follow_defaults: bool = True
    credential_binding_id: str | None = None
    idle_timeout_seconds: int = 600
    idle_stop_enabled: bool = True
    last_error: str | None = None
    updated_at: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> 'HostingConfiguration':
        return cls(**{key: value for key, value in data.items() if key in cls.__dataclass_fields__})


@dataclass
class HostingDelivery:
    id: str
    event: str
    state: str
    attempts: int
    received_at: str
    last_error: str | None
    retryable: bool

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> 'HostingDelivery':
        return cls(**{key: value for key, value in data.items() if key in cls.__dataclass_fields__})
