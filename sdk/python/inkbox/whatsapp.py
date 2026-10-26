"""Dedicated, approved WhatsApp messaging and owned attachments."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, TYPE_CHECKING
from uuid import UUID

from inkbox._message_requests import post_message

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class WhatsAppDirection(StrEnum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"


class WhatsAppMessageStatus(StrEnum):
    RECEIVED = "received"
    QUEUED = "queued"
    SENDING = "sending"
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"
    UNCERTAIN = "uncertain"
    CANCELLED = "cancelled"


class WhatsAppDeliveryState(StrEnum):
    PENDING = "pending"
    DELIVERED = "delivered"
    UNKNOWN = "unknown"


class WhatsAppMediaStatus(StrEnum):
    PENDING = "pending"
    READY = "ready"
    UNAVAILABLE = "unavailable"


def _dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


@dataclass
class WhatsAppMedia:
    id: UUID
    filename: str
    content_type: str
    size: int | None
    status: WhatsAppMediaStatus
    url: str | None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WhatsAppMedia:
        return cls(
            UUID(d["id"]),
            d["filename"],
            d["content_type"],
            d.get("size"),
            WhatsAppMediaStatus(d["status"]),
            d.get("url"),
        )


@dataclass
class WhatsAppRecipient:
    remote_number: str
    delivery_status: WhatsAppMessageStatus
    delivery_state: WhatsAppDeliveryState
    error_code: str | None
    error_detail: str | None
    sent_at: datetime | None
    delivered_at: datetime | None
    failed_at: datetime | None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WhatsAppRecipient:
        return cls(
            d["remote_number"],
            WhatsAppMessageStatus(d["delivery_status"]),
            WhatsAppDeliveryState(d["delivery_state"]),
            d.get("error_code"),
            d.get("error_detail"),
            _dt(d.get("sent_at")),
            _dt(d.get("delivered_at")),
            _dt(d.get("failed_at")),
        )


@dataclass
class WhatsAppMessage:
    id: UUID
    agent_identity_id: UUID
    conversation_id: UUID
    direction: WhatsAppDirection
    local_number: str
    remote_number: str | None
    sender_number: str
    participants: list[str]
    is_group: bool
    content: str | None
    media: list[WhatsAppMedia]
    status: WhatsAppMessageStatus
    delivery_state: WhatsAppDeliveryState | None
    recipients: list[WhatsAppRecipient]
    is_read: bool
    is_blocked: bool
    error_code: str | None
    error_detail: str | None
    source_at: datetime | None
    created_at: datetime
    updated_at: datetime
    sent_at: datetime | None
    delivered_at: datetime | None
    failed_at: datetime | None
    status_observed_at: datetime | None
    status_refresh_pending: bool

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WhatsAppMessage:
        return cls(
            id=UUID(d["id"]),
            agent_identity_id=UUID(d["agent_identity_id"]),
            conversation_id=UUID(d["conversation_id"]),
            direction=WhatsAppDirection(d["direction"]),
            local_number=d["local_number"],
            remote_number=d.get("remote_number"),
            sender_number=d["sender_number"],
            participants=d["participants"],
            is_group=d["is_group"],
            content=d.get("content"),
            media=[WhatsAppMedia._from_dict(x) for x in d["media"]],
            status=WhatsAppMessageStatus(d["status"]),
            delivery_state=WhatsAppDeliveryState(d["delivery_state"])
            if d.get("delivery_state")
            else None,
            recipients=[WhatsAppRecipient._from_dict(x) for x in d["recipients"]],
            is_read=d["is_read"],
            is_blocked=d.get("is_blocked", False),
            error_code=d.get("error_code"),
            error_detail=d.get("error_detail"),
            source_at=_dt(d.get("source_at")),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            sent_at=_dt(d.get("sent_at")),
            delivered_at=_dt(d.get("delivered_at")),
            failed_at=_dt(d.get("failed_at")),
            status_observed_at=_dt(d.get("status_observed_at")),
            status_refresh_pending=d.get("status_refresh_pending", False),
        )


@dataclass
class WhatsAppConversation:
    id: UUID
    agent_identity_id: UUID
    local_number: str
    remote_number: str | None
    participants: list[str]
    is_group: bool
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WhatsAppConversation:
        return cls(
            UUID(d["id"]),
            UUID(d["agent_identity_id"]),
            d["local_number"],
            d.get("remote_number"),
            d["participants"],
            d["is_group"],
            datetime.fromisoformat(d["created_at"]),
            datetime.fromisoformat(d["updated_at"]),
        )


@dataclass
class WhatsAppConversationSummary(WhatsAppConversation):
    latest_text: str | None
    latest_message_at: datetime | None
    latest_direction: WhatsAppDirection | None
    latest_has_media: bool
    unread_count: int
    total_count: int

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WhatsAppConversationSummary:
        return cls(
            **vars(WhatsAppConversation._from_dict(d)),
            latest_text=d.get("latest_text"),
            latest_message_at=_dt(d.get("latest_message_at")),
            latest_direction=WhatsAppDirection(d["latest_direction"])
            if d.get("latest_direction")
            else None,
            latest_has_media=d["latest_has_media"],
            unread_count=d["unread_count"],
            total_count=d["total_count"],
        )


@dataclass
class WhatsAppMarkReadResult:
    conversation_id: UUID
    updated_count: int


@dataclass
class WhatsAppChannelStatus:
    enabled: bool
    number: str | None
    status: str

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WhatsAppChannelStatus:
        return cls(d["enabled"], d.get("number"), d["status"])


def _owner(value: UUID | str | None) -> dict[str, str]:
    return {"agent_identity_id": str(value)} if value is not None else {}


@dataclass
class WhatsAppLimits:
    agent_identity_id: UUID
    limits: dict[str, int]
    usage: dict[str, int]

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WhatsAppLimits:
        return cls(UUID(d["agent_identity_id"]), dict(d["limits"]), dict(d["usage"]))


class WhatsAppResource:
    """One-to-one WhatsApp on an approved dedicated number.

    Send acceptance is not delivery confirmation. Reuse a logical send's key
    and owned media IDs after an uncertain outcome; never re-upload to retry it.
    """

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def send(
        self,
        *,
        to: str | list[str] | None = None,
        conversation_id: UUID | str | None = None,
        text: str | None = None,
        media_ids: list[UUID | str] | None = None,
        agent_identity_id: UUID | str | None = None,
        idempotency_key: str | None = None,
    ) -> WhatsAppMessage:
        """Queue a message by one E.164 recipient or an existing conversation.

        Text is optional with one owned media ID. Groups are not supported.
        Approval is checked by the API, not a cached identity capability.
        """
        if (to is None) == (conversation_id is None):
            raise ValueError("Specify exactly one of to or conversation_id")
        if isinstance(to, list) and len(to) != 1:
            raise ValueError("WhatsApp supports exactly one recipient")
        if media_ids is not None and len(media_ids) > 1:
            raise ValueError("WhatsApp supports at most one attachment")
        if not (text and text.strip()) and not media_ids:
            raise ValueError("Provide text or one media ID")
        if text is not None and len(text) > 4000:
            raise ValueError("WhatsApp text must be at most 4000 characters")
        body: dict[str, Any] = {}
        if to is not None:
            body["to"] = to
        if conversation_id is not None:
            body["conversation_id"] = str(conversation_id)
        if text is not None:
            body["text"] = text
        if media_ids is not None:
            body["media_ids"] = [str(value) for value in media_ids]
        data = post_message(
            self._http,
            "/messages",
            json=body,
            params=_owner(agent_identity_id),
            idempotency_key=idempotency_key,
        )
        return WhatsAppMessage._from_dict(data["message"])

    def get(
        self, message_id: UUID | str, *, agent_identity_id: UUID | str | None = None
    ) -> WhatsAppMessage:
        """Read current status; unknown delivery never means a safe resend."""
        return WhatsAppMessage._from_dict(
            self._http.get(f"/messages/{message_id}", params=_owner(agent_identity_id))
        )

    def list(
        self,
        *,
        agent_identity_id: UUID | str | None = None,
        conversation_id: UUID | str | None = None,
        limit: int = 50,
        offset: int = 0,
        is_read: bool | None = None,
        is_blocked: bool | None = None,
    ) -> list[WhatsAppMessage]:
        params: dict[str, Any] = {
            **_owner(agent_identity_id),
            "limit": limit,
            "offset": offset,
        }
        if conversation_id is not None:
            params["conversation_id"] = str(conversation_id)
        if is_read is not None:
            params["is_read"] = is_read
        if is_blocked is not None:
            params["is_blocked"] = is_blocked
        return [
            WhatsAppMessage._from_dict(d)
            for d in self._http.get("/messages", params=params)
        ]

    def list_conversations(
        self,
        *,
        agent_identity_id: UUID | str | None = None,
        limit: int = 50,
        offset: int = 0,
        is_blocked: bool | None = None,
    ) -> list[WhatsAppConversationSummary]:
        params: dict[str, Any] = {
            **_owner(agent_identity_id),
            "limit": limit,
            "offset": offset,
        }
        if is_blocked is not None:
            params["is_blocked"] = is_blocked
        return [
            WhatsAppConversationSummary._from_dict(d)
            for d in self._http.get("/conversations", params=params)
        ]

    def get_conversation(
        self,
        conversation_id: UUID | str,
        *,
        agent_identity_id: UUID | str | None = None,
    ) -> WhatsAppConversation:
        return WhatsAppConversation._from_dict(
            self._http.get(
                f"/conversations/{conversation_id}", params=_owner(agent_identity_id)
            )
        )

    def upload_media(
        self,
        *,
        content: bytes,
        filename: str,
        content_type: str | None = None,
        agent_identity_id: UUID | str | None = None,
    ) -> WhatsAppMedia:
        """Upload at most 20 MiB and retain the returned media ID for send."""
        if len(content) > 20 * 1024 * 1024:
            raise ValueError("WhatsApp media must be at most 20 MiB")
        data = self._http.post_multipart(
            "/media",
            field_name="file",
            filename=filename,
            content=content,
            content_type=content_type or "application/octet-stream",
            params=_owner(agent_identity_id),
        )
        return WhatsAppMedia._from_dict(data)

    def get_media(
        self, media_id: UUID | str, *, agent_identity_id: UUID | str | None = None
    ) -> WhatsAppMedia:
        """Get authorized metadata and a fresh temporary download URL."""
        return WhatsAppMedia._from_dict(
            self._http.get(f"/media/{media_id}", params=_owner(agent_identity_id))
        )

    def mark_read(
        self,
        conversation_id: UUID | str,
        through_message_id: UUID | str,
        *,
        agent_identity_id: UUID | str | None = None,
    ) -> WhatsAppMarkReadResult:
        """Mark local inbound history read through a visible message; no remote receipt."""
        data = self._http.post(
            "/mark-read",
            json={
                "conversation_id": str(conversation_id),
                "through_message_id": str(through_message_id),
            },
            params=_owner(agent_identity_id),
        )
        return WhatsAppMarkReadResult(
            UUID(data["conversation_id"]), data["updated_count"]
        )

    def get_limits(self, *, agent_identity_id: UUID | str | None = None) -> WhatsAppLimits:
        """Read effective server limits and independent usage; transport maxima are not entitlements."""
        return WhatsAppLimits._from_dict(self._http.get("/limits", params=_owner(agent_identity_id)))
