"""Shared call connection models for phone and contact history."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID


class ForwardingTargetType(StrEnum):
    """Kind of destination used to forward a call."""

    PHONE = "phone"
    SIP = "sip"


class CallConnectionKind(StrEnum):
    """Whether the caller is handed off or a guest joins the conversation."""

    HANDOFF = "handoff"
    CONFERENCE = "conference"


class CallConnectionTrigger(StrEnum):
    """What initiated a destination connection."""

    INCOMING_ACTION = "incoming_action"
    AGENT_TOOL = "agent_tool"


class CallConnectionStatus(StrEnum):
    """Connection progress, separate from the original call's status."""

    REQUESTED = "requested"
    DIALING = "dialing"
    CONNECTED = "connected"
    FAILED = "failed"


@dataclass
class PhoneCallConnection:
    """One handoff or conference attempt, ordered oldest-first on a call."""

    id: UUID
    kind: CallConnectionKind
    trigger: CallConnectionTrigger
    status: CallConnectionStatus
    target_type: ForwardingTargetType
    target: str
    requested_at: datetime
    dialing_at: datetime | None
    connected_at: datetime | None
    ended_at: datetime | None
    failure_code: str | None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> PhoneCallConnection:
        return cls(
            id=UUID(d["id"]),
            kind=CallConnectionKind(d["kind"]),
            trigger=CallConnectionTrigger(d["trigger"]),
            status=CallConnectionStatus(d["status"]),
            target_type=ForwardingTargetType(d["target_type"]),
            target=d["target"],
            requested_at=datetime.fromisoformat(d["requested_at"]),
            dialing_at=datetime.fromisoformat(d["dialing_at"]) if d.get("dialing_at") else None,
            connected_at=datetime.fromisoformat(d["connected_at"]) if d.get("connected_at") else None,
            ended_at=datetime.fromisoformat(d["ended_at"]) if d.get("ended_at") else None,
            failure_code=d.get("failure_code"),
        )
