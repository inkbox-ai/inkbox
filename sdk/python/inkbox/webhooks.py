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

from typing import Literal, NotRequired, TypedDict


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
    Address-book match for a remote party on a phone or text webhook
    event. Surfaced as a list -- pass ``id`` to
    ``inkbox.contacts.get()`` to hydrate.
    """
    id: str
    name: str


class WebhookAgentIdentity(TypedDict):
    """
    Identity match for a remote party on a phone or text webhook
    event. Set when the remote party is an active agent identity in
    the same org that is visible to the receiver.
    """
    id: str
    agent_handle: str
    display_name: str | None


# ---- Conversation context ________________________________________________

WebhookContextScopeWire = Literal["thread", "conversation", "contact"]
WebhookContextModeWire = Literal["count", "window"]
WebhookContextSkipReasonWire = Literal["no_contact", "no_resource", "unavailable"]
WebhookContextTextChannelWire = Literal["sms", "imessage"]


class WebhookContextTextMediaWire(TypedDict):
    """Media metadata for a context text item: a count only, never URLs."""
    count: int


class WebhookContextMailItemWire(TypedDict):
    """Slim mail context item: metadata + snippet only; bodies are omitted.

    Item-level nullable fields are **present with a ``null`` value** on the
    wire, not omitted — so ``subject``/``snippet`` are required keys typed
    ``str | None``, not ``NotRequired``.
    """
    id: str
    direction: str
    from_address: str
    to_addresses: list[str]
    created_at: str
    subject: str | None
    snippet: str | None
    # Owning mailbox address; with ``id`` fetches the full body via
    # messages.get(). NotRequired: payloads predating the feature omit it.
    email_address: NotRequired[str | None]


class WebhookContextTextItemWire(TypedDict):
    """One merged texts-class item (SMS or iMessage).

    ``media`` is metadata only (``{"count": N}``), never URLs. Item-level
    nullable fields are present-with-``null`` on the wire, not omitted.
    """
    id: str
    channel: WebhookContextTextChannelWire
    direction: str
    text: str
    text_truncated: bool
    created_at: str
    sender: str | None
    status: str | None
    media: WebhookContextTextMediaWire | None


class WebhookTranscriptEntryWire(TypedDict, total=False):
    """One transcript entry: a turn or the abridgment marker.

    Optional keys are omitted when unset. A turn has ``party``/``text``/
    ``ts_ms`` (plus ``truncated`` when char-cut), the marker has
    ``marker``/``omitted_turns``/``omitted_ms``. Discriminate on
    ``"marker" in entry``.
    """
    party: str
    text: str
    ts_ms: int
    truncated: bool
    marker: Literal["abridged"]
    omitted_turns: int
    omitted_ms: int


class WebhookContextCallItemWire(TypedDict):
    """One calls-class item: metadata plus its (possibly abridged) transcript.

    ``remote_number`` is the far-end number (from the call's
    ``remote_phone_number``); ``duration`` is the call length in whole
    seconds. Item-level nullable fields are present-with-``null`` on the
    wire, not omitted.
    """
    call_id: str
    abridged: bool
    transcript: list[WebhookTranscriptEntryWire]
    direction: str | None
    remote_number: str | None
    duration: int | None
    started_at: str | None


class WebhookContextBlockWire(TypedDict):
    """One delivered context class under ``data.context``.

    Block-level optional keys (``mode``/``requested``/``hours``/``skipped``)
    are absent when unset, not null — hence ``NotRequired``. This does NOT
    apply to item-level fields, which are present-with-``null`` (see the
    item types). ``items`` is chronological oldest-first and excludes the
    trigger; a skipped class ships ``items: []`` plus ``skipped``.
    """
    scope: WebhookContextScopeWire
    items: list[
        WebhookContextMailItemWire | WebhookContextTextItemWire | WebhookContextCallItemWire
    ]
    truncated: bool
    mode: NotRequired[WebhookContextModeWire]
    requested: NotRequired[int]
    hours: NotRequired[int]
    skipped: NotRequired[WebhookContextSkipReasonWire]


class WebhookContextWire(TypedDict, total=False):
    """``data.context`` value — only configured classes appear.

    Present only on received events whose subscription opted in via
    ``context_config``. Capped at 256 KB; over-cap classes drop oldest
    items and set ``truncated: true``.
    """
    email: WebhookContextBlockWire
    texts: WebhookContextBlockWire
    calls: WebhookContextBlockWire


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
"""Which recipient list a mail webhook contact/identity was matched from."""


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


class WebhookMailAgentIdentity(TypedDict):
    """
    Per-recipient identity match on a mail webhook event. Same shape
    as ``WebhookMailContact`` but with ``agent_handle`` /
    ``display_name`` instead of ``name``.
    """
    bucket: MailContactBucket
    address: str
    id: str
    agent_handle: str
    display_name: str | None


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
    # Body fields: NotRequired because payloads predating the feature omit
    # them. Present-with-``null`` on live payloads; populated (body_state
    # ``complete``/``truncated``) only on inbound ``message.received``.
    # ``email_address`` + ``id`` fetch the full body via messages.get().
    email_address: NotRequired[str | None]
    body: NotRequired[str | None]
    body_state: NotRequired[Literal["complete", "truncated", "unavailable"] | None]
    body_truncated: NotRequired[bool | None]
    body_total_chars: NotRequired[int | None]
    body_included_chars: NotRequired[int | None]
    direction: MessageDirectionWire
    status: MessageStatus
    has_attachments: bool
    created_at: str | None


class MailWebhookData(TypedDict):
    """
    Wrapper under ``MailWebhookPayload.data``.

    ``contacts`` and ``agent_identities`` are both always present,
    possibly empty. Wire order is ``from`` -> ``to`` -> ``cc`` ->
    ``bcc``, then within each bucket by source-field order; receivers
    should pair by ``(bucket, address)`` rather than relying on the
    order. A peer can match both a contact and an agent identity --
    two rows are emitted; receivers decide precedence.
    """
    message: MailWebhookMessage
    contacts: list[WebhookMailContact]
    agent_identities: list[WebhookMailAgentIdentity]
    # Present only on the channel's ``*.received`` event, and only when the
    # subscription opted into it via ``context_config``. Absent on sent /
    # delivery-status / reaction events even though this shared data type
    # permits the key.
    context: NotRequired[WebhookContextWire]


class MailWebhookPayload(TypedDict):
    id: str  # stable per-event id (evt_...); idempotency key, stable across replays
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
    Stored text message. ``is_blocked`` is not part of the wire body
    -- blocked texts never reach the webhook.

    Field population by traffic shape:
      * ``remote_phone_number``: populated on inbound and on outbound
        1:1; ``None`` on group outbound (per-recipient state lives in
        ``recipients``).
      * ``delivery_status``: populated on outbound. On group outbound this
        is the message-level rollup across ``recipients``; on inbound it
        is ``None``.
      * Legacy top-level lifecycle details (``error_code``,
        ``error_detail``, ``sent_at``, ``delivered_at``, ``failed_at``):
        populated only on outbound 1:1. On group outbound the
        per-recipient values live in ``recipients``; on inbound there
        is no carrier lifecycle to track, so all five are ``None``.
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
    contacts: list[WebhookContact]
    agent_identities: list[WebhookAgentIdentity]
    recipient_phone_number: str | None
    # Present only on the channel's ``*.received`` event, and only when the
    # subscription opted into it via ``context_config``. Absent on sent /
    # delivery-status / reaction events even though this shared data type
    # permits the key.
    context: NotRequired[WebhookContextWire]


class TextWebhookPayload(TypedDict):
    id: str  # stable per-event id (evt_...); idempotency key, stable across replays
    event_type: TextWebhookEventType
    timestamp: str
    data: TextWebhookData


# ---- iMessage ____________________________________________________________

IMessageWebhookEventType = Literal[
    "imessage.received",
    "imessage.reaction_received",
    "imessage.sent",
    "imessage.delivered",
    "imessage.delivery_failed",
]

IMessageDirectionWire = Literal["inbound", "outbound"]

IMessageServiceWire = Literal["imessage", "sms", "rcs"]

IMessageTypeWire = Literal["message", "carousel"]

IMessageDeliveryStatusWire = Literal[
    "registered",
    "pending",
    "queued",
    "accepted",
    "sent",
    "delivered",
    "declined",
    "error",
    "received",
]

IMessageReactionTypeWire = Literal[
    "love",
    "like",
    "dislike",
    "laugh",
    "emphasize",
    "question",
    "custom",
]

IMessageSendStyleWire = Literal[
    "celebration",
    "shooting_star",
    "fireworks",
    "lasers",
    "love",
    "confetti",
    "balloons",
    "spotlight",
    "echo",
    "invisible",
    "gentle",
    "loud",
    "slam",
]


class IMessageMediaItemWire(TypedDict):
    """iMessage media attachment (snake_case wire shape)."""
    content_type: str | None
    size: int | None
    url: str


class IMessageRecipientWire(TypedDict):
    """Per-recipient outbound iMessage delivery state."""
    remote_number: str
    delivery_status: IMessageDeliveryStatusWire | None
    service: IMessageServiceWire | None
    error_code: str | None
    error_message: str | None
    error_reason: str | None
    error_detail: str | None
    sent_at: str | None
    delivered_at: str | None
    failed_at: str | None


class IMessageMessageReactionWire(TypedDict):
    """A live tapback attached to a message (snake_case wire shape)."""
    id: str
    direction: IMessageDirectionWire
    reaction: IMessageReactionTypeWire
    custom_emoji: str | None
    remote_number: str
    part_index: int
    created_at: str


class IMessageWebhookMessage(TypedDict):
    """
    Stored iMessage. ``is_blocked`` is not part of the wire body --
    blocked messages never reach the webhook. There is no local-number
    field: shared pool lines are hidden from agents, so the message is
    identified by ``conversation_id`` and the counterparty
    ``remote_number`` only.
    """
    id: str
    conversation_id: str
    assignment_id: str
    direction: IMessageDirectionWire
    remote_number: str
    content: str | None
    message_type: IMessageTypeWire
    service: IMessageServiceWire
    send_style: IMessageSendStyleWire | None
    media: list[IMessageMediaItemWire] | None
    was_downgraded: bool | None
    status: IMessageDeliveryStatusWire | None
    error_code: str | None
    error_message: str | None
    error_reason: str | None
    error_detail: str | None
    is_read: bool
    recipients: list[IMessageRecipientWire] | None
    reactions: list[IMessageMessageReactionWire] | None
    created_at: str
    updated_at: str


class IMessageWebhookReaction(TypedDict):
    """A tapback reaction on an iMessage (snake_case wire shape).

    ``custom_emoji`` carries the literal emoji when ``reaction`` is
    ``"custom"``; ``None`` for the classic six.
    """
    id: str
    conversation_id: str
    assignment_id: str
    target_message_id: str
    direction: IMessageDirectionWire
    reaction: IMessageReactionTypeWire
    custom_emoji: str | None
    remote_number: str
    part_index: int
    created_at: str
    updated_at: str


class IMessageWebhookData(TypedDict):
    """
    Wrapper under ``IMessageWebhookPayload.data``.

    Exactly one of ``message`` (``imessage.received`` and the delivery
    lifecycle events ``imessage.sent`` / ``imessage.delivered`` /
    ``imessage.delivery_failed``) or ``reaction``
    (``imessage.reaction_received``) is populated. ``contacts`` and
    ``agent_identities`` resolve the remote number against the assigned
    identity's visible contact book and identity graph; both are always
    present, possibly empty.
    """
    message: IMessageWebhookMessage | None
    reaction: IMessageWebhookReaction | None
    contacts: list[WebhookContact]
    agent_identities: list[WebhookAgentIdentity]
    # Present only on the channel's ``*.received`` event, and only when the
    # subscription opted into it via ``context_config``. Absent on sent /
    # delivery-status / reaction events even though this shared data type
    # permits the key.
    context: NotRequired[WebhookContextWire]


class IMessageWebhookPayload(TypedDict):
    id: str  # stable per-event id (evt_...); idempotency key, stable across replays
    event_type: IMessageWebhookEventType
    timestamp: str
    data: IMessageWebhookData


# ---- Inbound call (FLAT - no envelope) ___________________________________

class PhoneIncomingCallWebhookPayload(TypedDict):
    """
    Inbound call payload. **Flat** -- no ``{event_type, timestamp,
    data}`` envelope; ``contacts`` / ``agent_identities`` sit at the
    top level. ``is_blocked`` is not part of the wire body -- blocked
    calls never reach the webhook.
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
    contacts: list[WebhookContact]
    agent_identities: list[WebhookAgentIdentity]
