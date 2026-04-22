"""
inkbox/mail/types.py

Dataclasses mirroring the Inkbox Mail API response models.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID


class MessageDirection(StrEnum):
    """
    Whether a message was received by or sent from a mailbox.

    Attributes:
        INBOUND: Email received from an external sender.
        OUTBOUND: Email sent by the mailbox.
    """
    INBOUND = "inbound"
    OUTBOUND = "outbound"


class FilterMode(StrEnum):
    """
    Contact-rule filter mode on a mailbox or phone number.

    Attributes:
        WHITELIST: Only contacts matching an ``allow`` rule are delivered;
            everything else is blocked.
        BLACKLIST: Everything is delivered except contacts matching a
            ``block`` rule. This is the default.
    """

    WHITELIST = "whitelist"
    BLACKLIST = "blacklist"


class ThreadFolder(StrEnum):
    """
    Logical folder a thread lives in.

    ``BLOCKED`` is server-assigned; clients cannot move a thread into
    ``BLOCKED``.
    """

    INBOX = "inbox"
    SPAM = "spam"
    BLOCKED = "blocked"
    ARCHIVE = "archive"


class MailRuleAction(StrEnum):
    """Whether a matching address is allowed through or blocked."""

    ALLOW = "allow"
    BLOCK = "block"


class MailRuleMatchType(StrEnum):
    """What a mail contact rule matches on."""

    EXACT_EMAIL = "exact_email"
    DOMAIN = "domain"


class ContactRuleStatus(StrEnum):
    """Whether a contact rule is currently enforced."""

    ACTIVE = "active"
    PAUSED = "paused"


@dataclass
class FilterModeChangeNotice:
    """Summary returned on PATCH when ``filter_mode`` actually changed.

    Reports how many existing active rules are now redundant under the
    new mode so the caller can prompt for cleanup. The blacklist <-> whitelist
    flip does not touch the contact-rules table — redundant rules still
    evaluate correctly, they just match the new default verdict.

    Attributes:
        new_filter_mode: The mode the resource was just flipped to.
        redundant_rule_action: The action whose rules are now redundant —
            ``"block"`` under whitelist, ``"allow"`` under blacklist. Typed as
            a free-form string to tolerate new server values; match against
            :class:`MailRuleAction` / :class:`PhoneRuleAction` values.
        redundant_rule_count: Count of active rules whose action equals
            ``redundant_rule_action``. ``0`` is a clean flip. Paused and
            deleted rules are not counted.
    """

    new_filter_mode: FilterMode
    redundant_rule_action: str
    redundant_rule_count: int

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> FilterModeChangeNotice:
        return cls(
            new_filter_mode=FilterMode(d["new_filter_mode"]),
            redundant_rule_action=str(d["redundant_rule_action"]),
            redundant_rule_count=int(d["redundant_rule_count"]),
        )


def _dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


@dataclass
class Mailbox:
    """An Inkbox mailbox (an email address owned by your organisation).

    ``agent_identity_id`` is the UUID of the owning agent identity, or
    ``None`` if the mailbox is standalone (not tied to any agent).
    Always populated on every mailbox response.
    """

    id: UUID
    email_address: str
    display_name: str | None
    webhook_url: str | None
    filter_mode: FilterMode
    created_at: datetime
    updated_at: datetime
    agent_identity_id: UUID | None = None
    filter_mode_change_notice: FilterModeChangeNotice | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> Mailbox:
        notice = d.get("filter_mode_change_notice")
        agent_identity_id = d.get("agent_identity_id")
        return cls(
            id=UUID(d["id"]),
            email_address=d["email_address"],
            display_name=d.get("display_name"),
            webhook_url=d.get("webhook_url"),
            filter_mode=FilterMode(d.get("filter_mode", "blacklist")),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            agent_identity_id=UUID(agent_identity_id) if agent_identity_id else None,
            filter_mode_change_notice=(
                FilterModeChangeNotice._from_dict(notice) if notice else None
            ),
        )


@dataclass
class Message:
    """
    Email message metadata.

    Body content is excluded from list responses.
    Call ``client.messages.get()`` to retrieve the full message with body.
    """

    id: UUID
    mailbox_id: UUID
    thread_id: UUID | None
    message_id: str
    from_address: str
    to_addresses: list[str]
    cc_addresses: list[str] | None
    subject: str | None
    snippet: str | None
    direction: MessageDirection
    status: str
    is_read: bool
    is_starred: bool
    has_attachments: bool
    created_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> Message:
        return cls(
            id=UUID(d["id"]),
            mailbox_id=UUID(d["mailbox_id"]),
            thread_id=UUID(d["thread_id"]) if d.get("thread_id") else None,
            message_id=d["message_id"],
            from_address=d["from_address"],
            to_addresses=d["to_addresses"],
            cc_addresses=d.get("cc_addresses"),
            subject=d.get("subject"),
            snippet=d.get("snippet"),
            direction=MessageDirection(d["direction"]),
            status=d["status"],
            is_read=d["is_read"],
            is_starred=d["is_starred"],
            has_attachments=d["has_attachments"],
            created_at=datetime.fromisoformat(d["created_at"]),
        )


@dataclass
class MessageDetail(Message):
    """Full message including body content."""

    body_text: str | None = None
    body_html: str | None = None
    bcc_addresses: list[str] | None = None
    in_reply_to: str | None = None
    references: list[str] | None = None
    attachment_metadata: list[dict[str, Any]] | None = None
    ses_message_id: str | None = None
    updated_at: datetime | None = None  # type: ignore[assignment]

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> MessageDetail:  # type: ignore[override]
        base = Message._from_dict(d)
        return cls(
            **base.__dict__,
            body_text=d.get("body_text"),
            body_html=d.get("body_html"),
            bcc_addresses=d.get("bcc_addresses"),
            in_reply_to=d.get("in_reply_to"),
            references=d.get("references"),
            attachment_metadata=d.get("attachment_metadata"),
            ses_message_id=d.get("ses_message_id"),
            updated_at=_dt(d.get("updated_at")),
        )


@dataclass
class Thread:
    """A conversation thread grouping related messages."""

    id: UUID
    mailbox_id: UUID
    subject: str | None
    folder: ThreadFolder
    message_count: int
    last_message_at: datetime
    created_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> Thread:
        return cls(
            id=UUID(d["id"]),
            mailbox_id=UUID(d["mailbox_id"]),
            subject=d.get("subject"),
            folder=ThreadFolder(d.get("folder", "inbox")),
            message_count=d["message_count"],
            last_message_at=datetime.fromisoformat(d["last_message_at"]),
            created_at=datetime.fromisoformat(d["created_at"]),
        )


@dataclass
class ThreadDetail(Thread):
    """Thread with all messages inlined, ordered oldest-first."""

    messages: list[Message] = field(default_factory=list)

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ThreadDetail:  # type: ignore[override]
        base = Thread._from_dict(d)
        return cls(
            **base.__dict__,
            messages=[Message._from_dict(m) for m in d.get("messages", [])],
        )


@dataclass
class MailContactRule:
    """An inbound/outbound allow/block rule scoped to a mailbox."""

    id: UUID
    mailbox_id: UUID
    action: MailRuleAction
    match_type: MailRuleMatchType
    match_target: str
    status: ContactRuleStatus
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> MailContactRule:
        return cls(
            id=UUID(d["id"]),
            mailbox_id=UUID(d["mailbox_id"]),
            action=MailRuleAction(d["action"]),
            match_type=MailRuleMatchType(d["match_type"]),
            match_target=d["match_target"],
            status=ContactRuleStatus(d.get("status", "active")),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )
