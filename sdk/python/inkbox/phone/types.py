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


class CallOrigin(StrEnum):
    """How a call is placed / which line it rides.

    ``dedicated_number`` uses the identity's own provisioned phone number;
    ``shared_imessage_number`` rides the shared iMessage service line, in
    which case the call has no dedicated ``local_phone_number``.
    """

    DEDICATED_NUMBER = "dedicated_number"
    SHARED_IMESSAGE_NUMBER = "shared_imessage_number"


class IncomingCallAction(StrEnum):
    """What to do when an inbound call arrives for an identity."""

    AUTO_ACCEPT = "auto_accept"
    AUTO_REJECT = "auto_reject"
    WEBHOOK = "webhook"


def _dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


@dataclass
class PhoneNumber:
    """A phone number owned by your organisation.

    ``agent_identity_id`` is the UUID of the owning agent identity, or
    ``None`` only for the pool / released states. Active org-owned
    numbers are always bound to an identity. Always populated on
    every phone-number response.

    **Webhooks** split across two surfaces:

    - **Text events** (``text.received``, ``text.sent``,
      ``text.delivered``, ``text.delivery_failed``,
      ``text.delivery_unconfirmed``) are managed via
      ``inkbox.webhooks.subscriptions.create(phone_number_id=..., url=..., event_types=[...])``.
      Up to 20 active subscriptions per number.
    - **Incoming-call event** (``phone.incoming_call``) is managed via
      the ``incoming_call_webhook_url`` field on this resource
      (synchronous control plane: the response body decides
      answer/reject/ignore, so it can't fan out).

    See Also:
        :class:`inkbox.WebhookSubscriptionsResource` on
        ``inkbox.webhooks.subscriptions`` for text events.

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
    filter_mode: FilterMode
    created_at: datetime
    updated_at: datetime
    sms_error_code: str | None = None
    sms_error_detail: str | None = None
    sms_ready_at: datetime | None = None
    # 2-letter US state abbreviation (e.g. "NY"); null if not set.
    state: str | None = None
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
            filter_mode=FilterMode(d.get("filter_mode", "blacklist")),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            sms_error_code=d.get("sms_error_code"),
            sms_error_detail=d.get("sms_error_detail"),
            sms_ready_at=_dt(d.get("sms_ready_at")),
            state=d.get("state"),
            agent_identity_id=UUID(agent_identity_id) if agent_identity_id else None,
            filter_mode_change_notice=(
                FilterModeChangeNotice._from_dict(notice) if notice else None
            ),
        )


@dataclass
class PhoneCall:
    """A phone call record.

    ``is_blocked`` is ``True`` when this call was rejected by a contact rule
    or default-block before connect. Identity-scoped (agent) API keys never
    observe ``is_blocked=True`` rows — the server filters them at the
    access-policy layer. Admin-scoped API keys and JWT humans see both
    values mixed by default and can narrow with ``is_blocked`` on
    ``CallsResource.list``.
    """

    id: UUID
    # Null when ``origin`` is ``shared_imessage_number`` — a shared-line call
    # has no dedicated local number.
    local_phone_number: str | None
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
    # Default False — older server responses without this field were always
    # non-blocked (predicate hid blocked rows from every caller).
    is_blocked: bool = False
    # Which line the call rode. Older responses without this field predate
    # shared-iMessage calls and are always dedicated.
    origin: CallOrigin = CallOrigin.DEDICATED_NUMBER

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> PhoneCall:
        return cls(
            id=UUID(d["id"]),
            local_phone_number=d.get("local_phone_number"),
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
            is_blocked=bool(d.get("is_blocked", False)),
            # Coerce a null/missing origin to dedicated for back-compat.
            origin=CallOrigin(d["origin"]) if d.get("origin") else CallOrigin.DEDICATED_NUMBER,
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
class TextMessageRecipient:
    """Per-recipient delivery state for an outbound text message."""

    recipient_phone_number: str
    delivery_status: SmsDeliveryStatus | None
    carrier: str | None = None
    line_type: str | None = None
    error_code: str | None = None
    error_detail: str | None = None
    sent_at: datetime | None = None
    delivered_at: datetime | None = None
    failed_at: datetime | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> TextMessageRecipient:
        raw_delivery = d.get("delivery_status")
        return cls(
            recipient_phone_number=d["recipient_phone_number"],
            delivery_status=SmsDeliveryStatus(raw_delivery) if raw_delivery else None,
            carrier=d.get("carrier"),
            line_type=d.get("line_type"),
            error_code=d.get("error_code"),
            error_detail=d.get("error_detail"),
            sent_at=_dt(d.get("sent_at")),
            delivered_at=_dt(d.get("delivered_at")),
            failed_at=_dt(d.get("failed_at")),
        )


@dataclass
class TextMessage:
    """A text message (SMS or MMS).

    Outbound-only lifecycle fields (``delivery_status``, ``error_code``,
    ``error_detail``, ``sent_at``, ``delivered_at``, ``failed_at``) are
    ``None`` on inbound rows.

    ``is_blocked`` is ``True`` when this text was rejected by a contact rule
    or default-block. Identity-scoped (agent) API keys never observe
    ``is_blocked=True`` rows — the server filters them at the
    access-policy layer. Admin-scoped API keys and JWT humans see both
    values mixed by default and can narrow with ``is_blocked`` on
    ``TextsResource.list`` / ``search`` / ``list_conversations``.
    """

    id: UUID
    direction: str
    local_phone_number: str
    remote_phone_number: str | None
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
    # Default False for older server responses that predate the field.
    is_blocked: bool = False
    conversation_id: UUID | None = None
    sender_phone_number: str | None = None
    recipients: list[TextMessageRecipient] | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> TextMessage:
        raw_media = d.get("media")
        media = [TextMediaItem._from_dict(m) for m in raw_media] if raw_media else None
        raw_recipients = d.get("recipients")
        recipients = (
            [TextMessageRecipient._from_dict(r) for r in raw_recipients]
            if raw_recipients
            else None
        )
        # Server-shape fields are optional on inbound rows, so fall back gracefully.
        raw_delivery = d.get("delivery_status")
        raw_origin = d.get("origin")
        raw_conversation_id = d.get("conversation_id")
        return cls(
            id=UUID(d["id"]),
            direction=d["direction"],
            local_phone_number=d["local_phone_number"],
            remote_phone_number=d.get("remote_phone_number"),
            text=d.get("text"),
            type=d["type"],
            media=media,
            is_read=d["is_read"],
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            conversation_id=UUID(raw_conversation_id) if raw_conversation_id else None,
            sender_phone_number=d.get("sender_phone_number"),
            recipients=recipients,
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
            is_blocked=bool(d.get("is_blocked", False)),
        )


@dataclass
class TextConversationSummary:
    """One row per text conversation."""

    remote_phone_number: str | None
    latest_text: str | None
    latest_direction: str
    latest_type: str
    latest_message_at: datetime
    unread_count: int
    total_count: int
    id: UUID | None = None
    participants: list[str] | None = None
    is_group: bool = False
    latest_has_media: bool = False

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> TextConversationSummary:
        raw_id = d.get("id")
        return cls(
            remote_phone_number=d.get("remote_phone_number"),
            latest_text=d.get("latest_text"),
            latest_direction=d["latest_direction"],
            latest_type=d["latest_type"],
            latest_message_at=datetime.fromisoformat(d["latest_message_at"]),
            unread_count=d["unread_count"],
            total_count=d["total_count"],
            id=UUID(raw_id) if raw_id else None,
            participants=d.get("participants"),
            is_group=bool(d.get("is_group", False)),
            latest_has_media=bool(d.get("latest_has_media", False)),
        )


@dataclass
class TextConversationUpdateResult:
    """Result from updating a text conversation."""

    remote_phone_number: str | None
    conversation_id: UUID | None
    is_read: bool
    updated_count: int

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> TextConversationUpdateResult:
        raw_conversation_id = d.get("conversation_id")
        return cls(
            remote_phone_number=d.get("remote_phone_number"),
            conversation_id=UUID(raw_conversation_id) if raw_conversation_id else None,
            is_read=d["is_read"],
            updated_count=d["updated_count"],
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
class IncomingCallActionConfig:
    """Per-identity inbound-call handling configuration.

    ``incoming_call_action`` selects the behaviour; ``client_websocket_url``
    is populated for the client-bridge case and ``incoming_call_webhook_url``
    for the ``webhook`` action.
    """

    agent_identity_id: UUID
    incoming_call_action: IncomingCallAction
    client_websocket_url: str | None
    incoming_call_webhook_url: str | None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IncomingCallActionConfig:
        return cls(
            agent_identity_id=UUID(d["agent_identity_id"]),
            incoming_call_action=IncomingCallAction(d["incoming_call_action"]),
            client_websocket_url=d.get("client_websocket_url"),
            incoming_call_webhook_url=d.get("incoming_call_webhook_url"),
        )


@dataclass
class HostedRealtimeConfig:
    """Per-identity platform-hosted realtime voice configuration.

    When ``enabled``, inbound calls for the identity are answered by the
    platform's realtime voice agent instead of bridging audio to a
    client-hosted socket. ``voice`` / ``model`` / ``instructions`` are
    null when the server default applies.
    """

    agent_identity_id: UUID
    enabled: bool
    voice: str | None
    model: str | None
    instructions: str | None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> HostedRealtimeConfig:
        return cls(
            agent_identity_id=UUID(d["agent_identity_id"]),
            enabled=bool(d["enabled"]),
            voice=d.get("voice"),
            model=d.get("model"),
            instructions=d.get("instructions"),
        )


class SmsOptInStatus(StrEnum):
    """Consent state of a receiver number for the calling org."""

    OPTED_IN = "opted_in"
    OPTED_OUT = "opted_out"


class SmsOptInSource(StrEnum):
    """Channel that recorded the consent transition.

    ``api`` rows came from an org with its own active, customer-managed 10DLC
    campaign calling the opt-in / opt-out endpoints directly.
    ``sms`` rows came from inbound STOP/START.
    """

    SMS = "sms"
    API = "api"


@dataclass
class SmsOptIn:
    """A per-(org, receiver) SMS consent row.

    ``receiver_number`` is E.164 (``+15551234567``). Only one of
    ``opted_in_at`` / ``opted_out_at`` is populated at a time — the
    one matching the current ``status``.
    """

    id: UUID
    organization_id: str
    receiver_number: str
    status: SmsOptInStatus
    source: SmsOptInSource
    opted_in_at: datetime | None
    opted_out_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> SmsOptIn:
        return cls(
            id=UUID(d["id"]),
            organization_id=d["organization_id"],
            receiver_number=d["receiver_number"],
            status=SmsOptInStatus(d["status"]),
            source=SmsOptInSource(d["source"]),
            opted_in_at=_dt(d.get("opted_in_at")),
            opted_out_at=_dt(d.get("opted_out_at")),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )


@dataclass
class PhoneContactRule:
    """An inbound/outbound allow/block rule scoped to a phone number.

    Returned by the **legacy** per-number routes
    (``inkbox.phone_contact_rules``). The forward-looking, identity-keyed
    shape is :class:`PhoneIdentityContactRule`.
    """

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


@dataclass
class PhoneIdentityContactRule:
    """A phone allow/block rule scoped to an **agent identity**.

    Returned by the identity-keyed routes
    (``inkbox.phone_identity_contact_rules`` /
    ``identity.list_phone_contact_rules()``). Same shape as
    :class:`PhoneContactRule` but keyed by ``agent_identity_id`` instead
    of ``phone_number_id``.
    """

    id: UUID
    agent_identity_id: UUID
    action: PhoneRuleAction
    match_type: PhoneRuleMatchType
    match_target: str
    status: ContactRuleStatus
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> PhoneIdentityContactRule:
        return cls(
            id=UUID(d["id"]),
            agent_identity_id=UUID(d["agent_identity_id"]),
            action=PhoneRuleAction(d["action"]),
            match_type=PhoneRuleMatchType(d["match_type"]),
            match_target=d["match_target"],
            status=ContactRuleStatus(d.get("status", "active")),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )
