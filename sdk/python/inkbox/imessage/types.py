"""
inkbox/imessage/types.py

Dataclasses mirroring the Inkbox iMessage API response models.

iMessage records are keyed by ``conversation_id``. One-to-one rows also expose
assignment and remote-number state; dedicated-outbound groups instead expose
participant snapshots. Dedicated-number ownership and attachment are represented
separately by ``IMessageNumber``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from inkbox.mail.types import ContactRuleStatus


class IMessageService(StrEnum):
    """Transport a message actually went over (iMessage may downgrade)."""

    IMESSAGE = "imessage"
    SMS = "sms"
    RCS = "rcs"


class IMessageDeliveryStatus(StrEnum):
    """Provider-facing delivery lifecycle for an iMessage."""

    REGISTERED = "registered"
    PENDING = "pending"
    QUEUED = "queued"
    ACCEPTED = "accepted"
    SENT = "sent"
    DELIVERED = "delivered"
    DECLINED = "declined"
    ERROR = "error"
    RECEIVED = "received"


class IMessageReactionType(StrEnum):
    """Tapback reaction kinds.

    ``CUSTOM`` is inbound-only: recipients can react with any emoji
    (carried in ``custom_emoji``), but sends accept the classic six.
    """

    LOVE = "love"
    LIKE = "like"
    DISLIKE = "dislike"
    LAUGH = "laugh"
    EMPHASIZE = "emphasize"
    QUESTION = "question"
    CUSTOM = "custom"


class IMessageSendStyle(StrEnum):
    """Expressive send style applied to an outbound iMessage."""

    CELEBRATION = "celebration"
    SHOOTING_STAR = "shooting_star"
    FIREWORKS = "fireworks"
    LASERS = "lasers"
    LOVE = "love"
    CONFETTI = "confetti"
    BALLOONS = "balloons"
    SPOTLIGHT = "spotlight"
    ECHO = "echo"
    INVISIBLE = "invisible"
    GENTLE = "gentle"
    LOUD = "loud"
    SLAM = "slam"


class IMessageAssignmentStatus(StrEnum):
    """Lifecycle of a recipient's triage-created connection to an agent."""

    ACTIVE = "active"
    RELEASED = "released"


class IMessageNumberType(StrEnum):
    """Type of an organization-owned dedicated iMessage number."""

    DEDICATED_INBOUND = "dedicated_inbound"
    DEDICATED_OUTBOUND = "dedicated_outbound"


class IMessageNumberStatus(StrEnum):
    """Lifecycle status of an iMessage service number."""

    ACTIVE = "active"
    PAUSED = "paused"


def _dedicated_number_type(value: IMessageNumberType | str) -> IMessageNumberType:
    """Validate a number role accepted by claim and identity provisioning."""
    return IMessageNumberType(value)


def _validate_idempotency_key(value: str) -> str:
    """Validate a caller-generated idempotency key before sending it."""
    if not 1 <= len(value) <= 255:
        raise ValueError("idempotency_key must be between 1 and 255 characters")
    return value


class IMessageRuleAction(StrEnum):
    """Whether a matching remote number is allowed through or blocked."""

    ALLOW = "allow"
    BLOCK = "block"


class IMessageRuleMatchType(StrEnum):
    """What an iMessage contact rule matches on."""

    EXACT_NUMBER = "exact_number"


def _dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


@dataclass
class IMessageNumber:
    """An organization-owned dedicated iMessage number.

    ``agent_identity_id`` and ``agent_handle`` are both ``None`` while the
    number is unattached. Only dedicated outbound numbers may start a new
    conversation before the recipient messages first.
    """

    id: UUID
    number: str
    type: IMessageNumberType
    status: IMessageNumberStatus
    agent_identity_id: UUID | None
    agent_handle: str | None

    @property
    def can_start_conversations(self) -> bool:
        """Whether this number may initiate a conversation."""
        return self.type is IMessageNumberType.DEDICATED_OUTBOUND

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IMessageNumber:
        raw_identity_id = d["agent_identity_id"]
        number_type = IMessageNumberType(d["type"])
        return cls(
            id=UUID(d["id"]),
            number=d["number"],
            type=number_type,
            status=IMessageNumberStatus(d["status"]),
            agent_identity_id=(
                UUID(raw_identity_id) if raw_identity_id is not None else None
            ),
            agent_handle=d["agent_handle"],
        )


@dataclass
class IMessageMediaItem:
    """Media attachment on an iMessage."""

    url: str
    content_type: str | None = None
    size: int | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IMessageMediaItem:
        return cls(
            url=d["url"],
            content_type=d.get("content_type"),
            size=d.get("size"),
        )


@dataclass
class IMessageRecipient:
    """Per-recipient outbound delivery state for an iMessage."""

    remote_number: str
    delivery_status: IMessageDeliveryStatus | None = None
    service: IMessageService | None = None
    error_code: str | None = None
    error_message: str | None = None
    error_reason: str | None = None
    error_detail: str | None = None
    sent_at: datetime | None = None
    delivered_at: datetime | None = None
    failed_at: datetime | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IMessageRecipient:
        raw_status = d.get("delivery_status")
        raw_service = d.get("service")
        return cls(
            remote_number=d["remote_number"],
            delivery_status=IMessageDeliveryStatus(raw_status) if raw_status else None,
            service=IMessageService(raw_service) if raw_service else None,
            error_code=d.get("error_code"),
            error_message=d.get("error_message"),
            error_reason=d.get("error_reason"),
            error_detail=d.get("error_detail"),
            sent_at=_dt(d.get("sent_at")),
            delivered_at=_dt(d.get("delivered_at")),
            failed_at=_dt(d.get("failed_at")),
        )


@dataclass
class IMessageMessageReaction:
    """A live tapback attached to a message in read responses."""

    id: UUID
    direction: str  # "inbound" | "outbound"
    reaction: IMessageReactionType
    remote_number: str
    created_at: datetime
    custom_emoji: str | None = None
    part_index: int = 0

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IMessageMessageReaction:
        return cls(
            id=UUID(d["id"]),
            direction=d["direction"],
            reaction=IMessageReactionType(d["reaction"]),
            remote_number=d["remote_number"],
            created_at=datetime.fromisoformat(d["created_at"]),
            custom_emoji=d.get("custom_emoji"),
            part_index=d.get("part_index", 0),
        )


@dataclass
class IMessage:
    """An iMessage in a one-to-one or group conversation.

    Group rows have ``is_group=True``, no assignment, a best-known participant
    snapshot, and per-recipient outbound delivery state.
    """

    id: UUID
    conversation_id: UUID
    assignment_id: UUID | None
    direction: str  # "inbound" | "outbound"
    remote_number: str | None
    content: str | None
    message_type: str  # "message" | "carousel"
    service: IMessageService
    is_read: bool
    created_at: datetime
    updated_at: datetime
    send_style: IMessageSendStyle | None = None
    media: list[IMessageMediaItem] | None = None
    was_downgraded: bool | None = None
    status: IMessageDeliveryStatus | None = None
    error_code: str | None = None
    error_message: str | None = None
    error_reason: str | None = None
    error_detail: str | None = None
    is_blocked: bool = False
    recipients: list[IMessageRecipient] | None = None
    # Live (non-removed) tapbacks targeting this message, oldest first.
    reactions: list[IMessageMessageReaction] | None = None
    # Additive group fields stay at the end to preserve positional dataclass
    # construction for callers using the pre-group field order.
    sender_number: str | None = None
    participants: list[str] | None = None
    is_group: bool = False

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IMessage:
        raw_media = d.get("media")
        raw_recipients = d.get("recipients")
        raw_reactions = d.get("reactions")
        raw_send_style = d.get("send_style")
        raw_status = d.get("status")
        return cls(
            id=UUID(d["id"]),
            conversation_id=UUID(d["conversation_id"]),
            assignment_id=(UUID(d["assignment_id"]) if d.get("assignment_id") else None),
            direction=d["direction"],
            remote_number=d.get("remote_number"),
            sender_number=d.get("sender_number"),
            participants=d.get("participants"),
            is_group=d.get("is_group", False),
            content=d.get("content"),
            message_type=d["message_type"],
            service=IMessageService(d["service"]),
            is_read=d["is_read"],
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            send_style=IMessageSendStyle(raw_send_style) if raw_send_style else None,
            media=(
                [IMessageMediaItem._from_dict(m) for m in raw_media]
                if raw_media else None
            ),
            was_downgraded=d.get("was_downgraded"),
            status=IMessageDeliveryStatus(raw_status) if raw_status else None,
            error_code=d.get("error_code"),
            error_message=d.get("error_message"),
            error_reason=d.get("error_reason"),
            error_detail=d.get("error_detail"),
            is_blocked=d.get("is_blocked", False),
            recipients=(
                [IMessageRecipient._from_dict(r) for r in raw_recipients]
                if raw_recipients else None
            ),
            reactions=(
                [IMessageMessageReaction._from_dict(r) for r in raw_reactions]
                if raw_reactions else None
            ),
        )


@dataclass
class IMessageConversation:
    """One iMessage conversation.

    One-to-one rows expose assignment state. Group rows have no assignment and
    expose a best-known participant snapshot instead.
    """

    id: UUID
    assignment_id: UUID | None
    remote_number: str | None
    created_at: datetime
    updated_at: datetime
    assignment_status: IMessageAssignmentStatus | None = IMessageAssignmentStatus.ACTIVE
    participants: list[str] | None = None
    is_group: bool = False

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IMessageConversation:
        return cls(
            id=UUID(d["id"]),
            assignment_id=(UUID(d["assignment_id"]) if d.get("assignment_id") else None),
            remote_number=d.get("remote_number"),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            assignment_status=(
                IMessageAssignmentStatus(d["assignment_status"])
                if d.get("assignment_status")
                else (IMessageAssignmentStatus.ACTIVE if d.get("assignment_id") else None)
            ),
            participants=d.get("participants"),
            is_group=d.get("is_group", False),
        )


@dataclass
class IMessageConversationSummary:
    """Conversation list row with latest-message preview."""

    id: UUID
    assignment_id: UUID | None
    remote_number: str | None
    latest_text: str | None = None
    latest_message_at: datetime | None = None
    latest_direction: str | None = None
    latest_has_media: bool = False
    unread_count: int = 0
    total_count: int = 0
    assignment_status: IMessageAssignmentStatus | None = IMessageAssignmentStatus.ACTIVE
    participants: list[str] | None = None
    is_group: bool = False

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IMessageConversationSummary:
        return cls(
            id=UUID(d["id"]),
            assignment_id=(UUID(d["assignment_id"]) if d.get("assignment_id") else None),
            remote_number=d.get("remote_number"),
            latest_text=d.get("latest_text"),
            latest_message_at=_dt(d.get("latest_message_at")),
            latest_direction=d.get("latest_direction"),
            latest_has_media=d.get("latest_has_media", False),
            unread_count=d.get("unread_count", 0),
            total_count=d.get("total_count", 0),
            assignment_status=(
                IMessageAssignmentStatus(d["assignment_status"])
                if d.get("assignment_status")
                else (IMessageAssignmentStatus.ACTIVE if d.get("assignment_id") else None)
            ),
            participants=d.get("participants"),
            is_group=d.get("is_group", False),
        )


@dataclass
class IMessageReaction:
    """A tapback reaction on an iMessage."""

    id: UUID
    conversation_id: UUID
    assignment_id: UUID
    target_message_id: UUID
    direction: str  # "inbound" | "outbound"
    reaction: IMessageReactionType
    remote_number: str
    created_at: datetime
    updated_at: datetime
    # Literal emoji when reaction is "custom"; None for the classic six.
    custom_emoji: str | None = None
    part_index: int = 0

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IMessageReaction:
        return cls(
            id=UUID(d["id"]),
            conversation_id=UUID(d["conversation_id"]),
            assignment_id=UUID(d["assignment_id"]),
            target_message_id=UUID(d["target_message_id"]),
            direction=d["direction"],
            reaction=IMessageReactionType(d["reaction"]),
            remote_number=d["remote_number"],
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            custom_emoji=d.get("custom_emoji"),
            part_index=d.get("part_index", 0),
        )


@dataclass
class IMessageMarkReadResult:
    """Result of marking a conversation's inbound messages read."""

    conversation_id: UUID
    updated_count: int

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IMessageMarkReadResult:
        return cls(
            conversation_id=UUID(d["conversation_id"]),
            updated_count=d["updated_count"],
        )


@dataclass
class IMessageMediaUpload:
    """A reusable media URL returned by the iMessage media upload."""

    media_url: str
    content_type: str | None = None
    size: int | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IMessageMediaUpload:
        return cls(
            media_url=d["media_url"],
            content_type=d.get("content_type"),
            size=d.get("size"),
        )


@dataclass
class IMessageAssignment:
    """An active connection between one recipient and one agent identity."""

    id: UUID
    remote_number: str
    agent_identity_id: UUID
    organization_id: str
    status: IMessageAssignmentStatus
    created_at: datetime
    updated_at: datetime
    released_at: datetime | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IMessageAssignment:
        return cls(
            id=UUID(d["id"]),
            remote_number=d["remote_number"],
            agent_identity_id=UUID(d["agent_identity_id"]),
            organization_id=d["organization_id"],
            status=IMessageAssignmentStatus(d["status"]),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            released_at=_dt(d.get("released_at")),
        )


@dataclass
class IMessageTriageNumber:
    """The active triage number and how recipients start a connection."""

    number: str
    connect_command: str

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IMessageTriageNumber:
        return cls(
            number=d["number"],
            connect_command=d["connect_command"],
        )


@dataclass
class IMessageContactRule:
    """An allow/block rule scoped to an agent identity for iMessage."""

    id: UUID
    agent_identity_id: UUID
    action: IMessageRuleAction
    match_type: IMessageRuleMatchType
    match_target: str
    status: ContactRuleStatus
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IMessageContactRule:
        return cls(
            id=UUID(d["id"]),
            agent_identity_id=UUID(d["agent_identity_id"]),
            action=IMessageRuleAction(d["action"]),
            match_type=IMessageRuleMatchType(d["match_type"]),
            match_target=d["match_target"],
            status=ContactRuleStatus(d["status"]),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )
