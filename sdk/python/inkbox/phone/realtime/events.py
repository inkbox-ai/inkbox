"""
inkbox/phone/realtime/events.py

Typed observe events the platform emits on the call WebSocket when an
identity runs on platform-hosted voice. Field names match the wire JSON
(snake_case); the ``event`` field is the discriminator. These frames ride
the one existing per-call WebSocket, so they carry no ``call_id`` — the
socket *is* the call.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class TranscriptTurn:
    """One turn in a transcript tail / post-call transcript."""

    speaker: str
    text: str

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> TranscriptTurn:
        return cls(speaker=d["speaker"], text=d["text"])


@dataclass
class PostCallAction:
    """An action the agent registered during the call."""

    action: str
    details: Any

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> PostCallAction:
        return cls(action=d["action"], details=d.get("details"))


@dataclass
class RealtimeEvent:
    """Base for observe events. ``event`` is the wire discriminator.

    ``raw`` retains the full decoded payload so unknown/extra fields stay
    reachable across server versions.
    """

    event: str
    raw: dict[str, Any] = field(repr=False)


@dataclass
class CallStarted(RealtimeEvent):
    call_id: str
    agent_identity_id: str
    direction: str  # "inbound" | "outbound"
    phone_number: str | None  # absent on some inbound legs


@dataclass
class CallAnswered(RealtimeEvent):
    call_id: str


@dataclass
class Transcript(RealtimeEvent):
    party: str  # "local" (agent) | "remote" (caller)
    text: str
    is_final: bool
    turn_id: str | None


@dataclass
class BargeIn(RealtimeEvent):
    trigger: str
    text: str
    tts_interrupted: bool
    turn_id: str | None


@dataclass
class ModelToolCall(RealtimeEvent):
    tool_call_id: str
    tool_name: str
    arguments: dict[str, Any]
    requires_approval: bool


@dataclass
class ConsultRequested(RealtimeEvent):
    consult_id: str
    query: str
    transcript_tail: list[TranscriptTurn]


@dataclass
class CallEnded(RealtimeEvent):
    reason: str | None
    post_call_actions: list[PostCallAction]
    transcript: list[TranscriptTurn]


@dataclass
class UnknownEvent(RealtimeEvent):
    """An event whose ``event`` tag this SDK version does not model."""


def parse_event(d: dict[str, Any]) -> RealtimeEvent:
    """Decode one wire message into its typed observe event."""
    kind = d.get("event", "")
    if kind == "call.started":
        return CallStarted(
            event=kind, raw=d, call_id=d["call_id"],
            agent_identity_id=d["agent_identity_id"],
            direction=d["direction"], phone_number=d.get("phone_number"),
        )
    if kind == "call.answered":
        return CallAnswered(event=kind, raw=d, call_id=d["call_id"])
    if kind == "transcript":
        return Transcript(
            event=kind, raw=d, party=d["party"], text=d["text"],
            is_final=bool(d["is_final"]), turn_id=d.get("turn_id"),
        )
    if kind == "barge_in":
        return BargeIn(
            event=kind, raw=d, trigger=d.get("trigger", ""), text=d.get("text", ""),
            tts_interrupted=bool(d.get("tts_interrupted", False)),
            turn_id=d.get("turn_id"),
        )
    if kind == "model.tool_call":
        return ModelToolCall(
            event=kind, raw=d, tool_call_id=d["tool_call_id"],
            tool_name=d["tool_name"], arguments=d.get("arguments") or {},
            requires_approval=bool(d["requires_approval"]),
        )
    if kind == "consult.requested":
        return ConsultRequested(
            event=kind, raw=d, consult_id=d["consult_id"], query=d["query"],
            transcript_tail=[
                TranscriptTurn._from_dict(t) for t in d.get("transcript_tail", [])
            ],
        )
    if kind == "call.ended":
        return CallEnded(
            event=kind, raw=d, reason=d.get("reason"),
            post_call_actions=[
                PostCallAction._from_dict(a) for a in d.get("post_call_actions", [])
            ],
            transcript=[TranscriptTurn._from_dict(t) for t in d.get("transcript", [])],
        )
    return UnknownEvent(event=kind, raw=d)
