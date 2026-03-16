"""
inkbox/phone/types.py

Dataclasses mirroring the Inkbox Phone API response models.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID


def _dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


@dataclass
class PhoneNumber:
    """A phone number owned by your organisation."""

    id: UUID
    number: str
    type: str
    status: str
    incoming_call_action: str
    client_websocket_url: str | None
    incoming_call_webhook_url: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> PhoneNumber:
        return cls(
            id=UUID(d["id"]),
            number=d["number"],
            type=d["type"],
            status=d["status"],
            incoming_call_action=d["incoming_call_action"],
            client_websocket_url=d.get("client_websocket_url"),
            incoming_call_webhook_url=d.get("incoming_call_webhook_url"),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )


@dataclass
class PhoneCall:
    """A phone call record."""

    id: UUID
    local_phone_number: str
    remote_phone_number: str
    direction: str
    status: str
    client_websocket_url: str | None
    use_inkbox_tts: bool | None
    use_inkbox_stt: bool | None
    hangup_reason: str | None
    started_at: datetime | None
    ended_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> PhoneCall:
        return cls(
            id=UUID(d["id"]),
            local_phone_number=d["local_phone_number"],
            remote_phone_number=d["remote_phone_number"],
            direction=d["direction"],
            status=d["status"],
            client_websocket_url=d.get("client_websocket_url"),
            use_inkbox_tts=d.get("use_inkbox_tts"),
            use_inkbox_stt=d.get("use_inkbox_stt"),
            hangup_reason=d.get("hangup_reason"),
            started_at=_dt(d.get("started_at")),
            ended_at=_dt(d.get("ended_at")),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )


@dataclass
class RateLimitInfo:
    """Rolling 24-hour rate limit snapshot for an organisation."""

    calls_used: int
    calls_remaining: int
    calls_limit: int
    minutes_used: float
    minutes_remaining: float
    minutes_limit: int

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> RateLimitInfo:
        return cls(
            calls_used=d["calls_used"],
            calls_remaining=d["calls_remaining"],
            calls_limit=d["calls_limit"],
            minutes_used=d["minutes_used"],
            minutes_remaining=d["minutes_remaining"],
            minutes_limit=d["minutes_limit"],
        )


@dataclass
class PhoneCallWithRateLimit(PhoneCall):
    """PhoneCall extended with the caller's current rate limit snapshot.

    Returned by the place-call endpoint.
    """

    rate_limit: RateLimitInfo = None  # type: ignore[assignment]

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> PhoneCallWithRateLimit:  # type: ignore[override]
        base = PhoneCall._from_dict(d)
        return cls(
            **base.__dict__,
            rate_limit=RateLimitInfo._from_dict(d["rate_limit"]) if d.get("rate_limit") else None,
        )


@dataclass
class PhoneTranscript:
    """A transcript segment from a phone call."""

    id: UUID
    call_id: UUID
    seq: int
    ts_ms: int
    party: str
    text: str
    created_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> PhoneTranscript:
        return cls(
            id=UUID(d["id"]),
            call_id=UUID(d["call_id"]),
            seq=d["seq"],
            ts_ms=d["ts_ms"],
            party=d["party"],
            text=d["text"],
            created_at=datetime.fromisoformat(d["created_at"]),
        )


