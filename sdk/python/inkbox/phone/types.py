"""
inkbox/phone/types.py

Dataclasses mirroring the Inkbox Phone API response models.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from inkbox.mail.types import ContactRuleStatus, FilterMode, FilterModeChangeNotice


class PhoneRuleAction(StrEnum):
    """Whether a matching phone number is allowed through or blocked."""

    ALLOW = "allow"
    BLOCK = "block"


class PhoneRuleMatchType(StrEnum):
    """What a phone contact rule matches on."""

    EXACT_NUMBER = "exact_number"


class SmsStatus(StrEnum):
    """Outbound SMS provisioning readiness for a phone number.

    Drives whether ``send_text`` will be accepted by the server. ``pending``
    means the 10DLC campaign / TFV propagation is still running on the
    carrier side; ``ready`` means the number can send SMS;
    ``assignment_failed`` means provisioning retries were exhausted.
    """

    PENDING = "pending"
    READY = "ready"
    ASSIGNMENT_FAILED = "assignment_failed"


class SmsDeliveryStatus(StrEnum):
    """Carrier-facing outbound delivery lifecycle for a text message."""

    QUEUED = "queued"
    SENT = "sent"
    DELIVERED = "delivered"
    DELIVERY_FAILED = "delivery_failed"
    DELIVERY_UNCONFIRMED = "delivery_unconfirmed"
    SENDING_FAILED = "sending_failed"


class TextMessageOrigin(StrEnum):
    """Whether a text was user-initiated or an internal auto-reply."""

    USER_INITIATED = "user_initiated"
    AUTO_REPLY = "auto_reply"


def _dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


@dataclass
class PhoneNumber:
    """A phone number owned by your organisation.

    ``agent_identity_id`` is the UUID of the owning agent identity, or
    ``None`` if the phone number is standalone (not tied to any agent).
    Always populated on every phone-number response.

    SMS-readiness fields (``sms_status``, ``sms_error_code``,
    ``sms_error_detail``, ``sms_ready_at``) reflect 10DLC / TFV
    provisioning progress. A new local number starts at
    ``sms_status=PENDING`` and flips to ``READY`` once the carrier
    campaign assignment succeeds.
    """

    id: UUID
    number: str
    type: str
    status: str
    sms_status: SmsStatus
    incoming_call_action: str
    client_websocket_url: str | None
    incoming_call_webhook_url: str | None
    incoming_text_webhook_url: str | None
    filter_mode: FilterMode
    created_at: datetime
    updated_at: datetime
    sms_error_code: str | None = None
    sms_error_detail: str | None = None
    sms_ready_at: datetime | None = None
    agent_identity_id: UUID | None = None
    filter_mode_change_notice: FilterModeChangeNotice | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> PhoneNumber:
        notice = d.get("filter_mode_change_notice")
        agent_identity_id = d.get("agent_identity_id")
        # Default to READY for backwards compatibility with older server
        # responses that predate the sms_status field.
        raw_sms_status = d.get("sms_status")
        return cls(
            id=UUID(d["id"]),
            number=d["number"],
            type=d["type"],
            status=d["status"],
            sms_status=SmsStatus(raw_sms_status) if raw_sms_status else SmsStatus.READY,
            incoming_call_action=d["incoming_call_action"],
            client_websocket_url=d.get("client_websocket_url"),
            incoming_call_webhook_url=d.get("incoming_call_webhook_url"),
            incoming_text_webhook_url=d.get("incoming_text_webhook_url"),
            filter_mode=FilterMode(d.get("filter_mode", "blacklist")),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            sms_error_code=d.get("sms_error_code"),
            sms_error_detail=d.get("sms_error_detail"),
            sms_ready_at=_dt(d.get("sms_ready_at")),
            agent_identity_id=UUID(agent_identity_id) if agent_identity_id else None,
            filter_mode_change_notice=(
                FilterModeChangeNotice._from_dict(notice) if notice else None
            ),
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
    """Rate limit snapshot for an organisation."""

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
class TextMediaItem:
    """A single media attachment in an MMS message."""

    content_type: str
    size: int
    url: str

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> TextMediaItem:
        return cls(
            content_type=d["content_type"],
            size=d["size"],
            url=d["url"],
        )


@dataclass
class TextMessage:
    """A text message (SMS or MMS).

    Outbound-only lifecycle fields (``delivery_status``, ``error_code``,
    ``error_detail``, ``sent_at``, ``delivered_at``, ``failed_at``) are
    ``None`` on inbound rows.
    """

    id: UUID
    direction: str
    local_phone_number: str
    remote_phone_number: str
    text: str | None
    type: str
    media: list[TextMediaItem] | None
    is_read: bool
    created_at: datetime
    updated_at: datetime
    delivery_status: SmsDeliveryStatus | None = None
    origin: TextMessageOrigin = TextMessageOrigin.USER_INITIATED
    error_code: str | None = None
    error_detail: str | None = None
    sent_at: datetime | None = None
    delivered_at: datetime | None = None
    failed_at: datetime | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> TextMessage:
        raw_media = d.get("media")
        media = [TextMediaItem._from_dict(m) for m in raw_media] if raw_media else None
        # Server-shape fields are optional on inbound rows, so fall back gracefully.
        raw_delivery = d.get("delivery_status")
        raw_origin = d.get("origin")
        return cls(
            id=UUID(d["id"]),
            direction=d["direction"],
            local_phone_number=d["local_phone_number"],
            remote_phone_number=d["remote_phone_number"],
            text=d.get("text"),
            type=d["type"],
            media=media,
            is_read=d["is_read"],
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            delivery_status=SmsDeliveryStatus(raw_delivery) if raw_delivery else None,
            origin=(
                TextMessageOrigin(raw_origin)
                if raw_origin
                else TextMessageOrigin.USER_INITIATED
            ),
            error_code=d.get("error_code"),
            error_detail=d.get("error_detail"),
            sent_at=_dt(d.get("sent_at")),
            delivered_at=_dt(d.get("delivered_at")),
            failed_at=_dt(d.get("failed_at")),
        )


@dataclass
class TextConversationSummary:
    """One row per conversation — lightweight summary."""

    remote_phone_number: str
    latest_text: str | None
    latest_direction: str
    latest_type: str
    latest_message_at: datetime
    unread_count: int
    total_count: int

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> TextConversationSummary:
        return cls(
            remote_phone_number=d["remote_phone_number"],
            latest_text=d.get("latest_text"),
            latest_direction=d["latest_direction"],
            latest_type=d["latest_type"],
            latest_message_at=datetime.fromisoformat(d["latest_message_at"]),
            unread_count=d["unread_count"],
            total_count=d["total_count"],
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


@dataclass
class PhoneContactRule:
    """An inbound/outbound allow/block rule scoped to a phone number."""

    id: UUID
    phone_number_id: UUID
    action: PhoneRuleAction
    match_type: PhoneRuleMatchType
    match_target: str
    status: ContactRuleStatus
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> PhoneContactRule:
        return cls(
            id=UUID(d["id"]),
            phone_number_id=UUID(d["phone_number_id"]),
            action=PhoneRuleAction(d["action"]),
            match_type=PhoneRuleMatchType(d["match_type"]),
            match_target=d["match_target"],
            status=ContactRuleStatus(d.get("status", "active")),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )
