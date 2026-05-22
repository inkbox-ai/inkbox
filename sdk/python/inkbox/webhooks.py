"""
inkbox/webhooks.py

Receiver-side webhook payload types.

Wire-shape only: every field is snake_case so
``cast(MailWebhookPayload, json.loads(body))`` round-trips without a
transformer. Enum-valued fields are ``Literal[...]`` string unions
(e.g. ``Literal["inbound", "outbound"]``) rather than ``StrEnum``s,
since ``json.loads`` produces bare strings.
"""

from __future__ import annotations

from typing import Literal, TypedDict


# ---- Wire union types ____________________________________________________

MessageDirectionWire = Literal["inbound", "outbound"]

MessageStatus = Literal[
    "queued",
    "sent",
    "delivered",
    "bounced",
    "failed",
    "received",
    "deleted",
]

TextDirectionWire = Literal["inbound", "outbound"]

TextTypeWire = Literal["sms", "mms"]

SmsDeliveryStatusWire = Literal[
    "queued",
    "sent",
    "delivered",
    "delivery_failed",
    "delivery_unconfirmed",
    "sending_failed",
]

TextMessageOriginWire = Literal["user_initiated", "auto_reply"]

CallDirectionWire = Literal["outbound", "inbound"]

CallStatusWire = Literal[
    "initiated",
    "ringing",
    "answered",
    "completed",
    "failed",
    "canceled",
]

HangupReasonWire = Literal[
    "local",
    "remote",
    "max_duration",
    "voicemail",
    "rejected",
]


# ---- Nested wire shapes __________________________________________________

class TextMediaItemWire(TypedDict):
    """MMS media attachment (snake_case wire shape)."""
    content_type: str
    size: int
    url: str


class TextMessageRecipientWire(TypedDict):
    """Per-recipient outbound SMS/MMS delivery state."""
    recipient_phone_number: str
    delivery_status: SmsDeliveryStatusWire | None
    carrier: str | None
    line_type: str | None
    error_code: str | None
    error_detail: str | None
    sent_at: str | None
    delivered_at: str | None
    failed_at: str | None


class RateLimitInfoWire(TypedDict):
    """Org rate-limit snapshot on inbound-call payloads."""
    calls_used: int
    calls_remaining: int
    calls_limit: int
    minutes_used: float
    minutes_remaining: float
    minutes_limit: int


# ---- Shared ______________________________________________________________

class WebhookContact(TypedDict):
    """
    Address-book match for the single remote party on a phone or text
    webhook event. Optional -- ``None`` means no contact visible to the
    receiving identity. Pass ``id`` to ``inkbox.contacts.get()`` to
    hydrate.
    """
    id: str
    name: str


# ---- Mail ________________________________________________________________

MailWebhookEventType = Literal[
    "message.received",
    "message.sent",
    "message.forwarded",
    "message.delivered",
    "message.bounced",
    "message.failed",
]

MailContactBucket = Literal["from", "to", "cc", "bcc"]
"""Which recipient list a mail webhook contact was matched from."""


class WebhookMailContact(TypedDict):
    """
    Per-recipient address-book match on a mail webhook event.

    Mail events resolve every relevant recipient (inbound: sender + CC;
    outbound: every To + CC + BCC) and surface each match as its own
    entry. Pair to the source field by ``(bucket, address)``, not by
    ``address`` alone -- the same address may appear in multiple
    buckets on a single send, producing one entry per bucket.
    ``address`` echoes the original wire-form casing on
    ``data["message"]["{from,to,cc,bcc}_addresses"]``, so naive ``==``
    against that bucket array works for messages your platform sent.
    The list is sparse: only matched recipients appear.
    """
    bucket: MailContactBucket
    address: str
    id: str
    name: str


class MailWebhookMessage(TypedDict):
    """
    Stored mail message. ``message_id`` is the RFC 5322 ``Message-ID``
    header value (not Inkbox's row id -- that's ``id``).
    ``bcc_addresses`` is only populated on outbound events; inbound
    payloads carry ``None`` (BCC is not visible to recipients).
    """
    id: str
    mailbox_id: str
    thread_id: str | None
    message_id: str | None
    from_address: str
    to_addresses: list[str]
    cc_addresses: list[str] | None
    bcc_addresses: list[str] | None
    subject: str | None
    snippet: str | None
    direction: MessageDirectionWire
    status: MessageStatus
    has_attachments: bool
    created_at: str | None


class MailWebhookData(TypedDict):
    """
    Wrapper under ``MailWebhookPayload.data``.

    ``contacts`` is always present, possibly empty. Wire order is
    ``from`` -> ``to`` -> ``cc`` -> ``bcc``, then within each bucket by
    source-field order; receivers should pair by ``(bucket, address)``
    rather than relying on the order. Up to 50 distinct normalized
    addresses are resolved per event; over-cap inputs and resolver
    failures both fall back to an empty list.
    """
    message: MailWebhookMessage
    contacts: list[WebhookMailContact]


class MailWebhookPayload(TypedDict):
    event_type: MailWebhookEventType
    timestamp: str
    data: MailWebhookData


# ---- Text ________________________________________________________________

TextWebhookEventType = Literal[
    "text.received",
    "text.sent",
    "text.delivered",
    "text.delivery_failed",
    "text.delivery_unconfirmed",
]


class TextWebhookMessage(TypedDict):
    """
    Stored text message. ``is_blocked`` is not part of the wire body --
    blocked texts never reach the webhook.
    """
    id: str
    direction: TextDirectionWire
    local_phone_number: str
    remote_phone_number: str | None
    text: str | None
    type: TextTypeWire
    media: list[TextMediaItemWire] | None
    is_read: bool
    delivery_status: SmsDeliveryStatusWire | None
    origin: TextMessageOriginWire
    error_code: str | None
    error_detail: str | None
    sent_at: str | None
    delivered_at: str | None
    failed_at: str | None
    conversation_id: str | None
    sender_phone_number: str | None
    recipients: list[TextMessageRecipientWire] | None
    created_at: str
    updated_at: str


class TextWebhookData(TypedDict):
    text_message: TextWebhookMessage
    contact: WebhookContact | None
    recipient_phone_number: str | None


class TextWebhookPayload(TypedDict):
    event_type: TextWebhookEventType
    timestamp: str
    data: TextWebhookData


# ---- Inbound call (FLAT - no envelope) ___________________________________

class PhoneIncomingCallWebhookPayload(TypedDict):
    """
    Inbound call payload. **Flat** -- no ``{event_type, timestamp,
    data}`` envelope; ``contact`` sits at the top level. ``is_blocked``
    is not part of the wire body -- blocked calls never reach the
    webhook.
    """
    id: str
    local_phone_number: str
    remote_phone_number: str
    direction: Literal["inbound"]
    status: CallStatusWire
    client_websocket_url: str | None
    use_inkbox_tts: bool | None
    use_inkbox_stt: bool | None
    hangup_reason: HangupReasonWire | None
    started_at: str | None
    ended_at: str | None
    created_at: str
    updated_at: str
    rate_limit: RateLimitInfoWire | None
    contact: WebhookContact | None
