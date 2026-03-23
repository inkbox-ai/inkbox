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
        OUTBOUND: Email sent by the mailbox via SES.
    """
    INBOUND = "inbound"
    OUTBOUND = "outbound"


def _dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


@dataclass
class Mailbox:
    """An Inkbox mailbox (an email address owned by your organisation)."""

    id: UUID
    email_address: str
    display_name: str | None
    webhook_url: str | None
    status: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> Mailbox:
        return cls(
            id=UUID(d["id"]),
            email_address=d["email_address"],
            display_name=d.get("display_name"),
            webhook_url=d.get("webhook_url"),
            status=d["status"],
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
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
    status: str
    message_count: int
    last_message_at: datetime
    created_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> Thread:
        return cls(
            id=UUID(d["id"]),
            mailbox_id=UUID(d["mailbox_id"]),
            subject=d.get("subject"),
            status=d["status"],
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


