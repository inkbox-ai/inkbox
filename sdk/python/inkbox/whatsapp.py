"""Dedicated, approved WhatsApp messaging and owned attachments."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
import re
import unicodedata
from typing import Any, TYPE_CHECKING
from uuid import UUID

from inkbox._message_requests import post_message, send_key

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


class WhatsAppReactionType(StrEnum):
    LOVE = "love"
    LIKE = "like"
    DISLIKE = "dislike"
    LAUGH = "laugh"
    EMPHASIZE = "emphasize"
    QUESTION = "question"
    EYES = "eyes"
    CUSTOM = "custom"


class WhatsAppReactionStatus(StrEnum):
    QUEUED = "queued"
    SENDING = "sending"
    APPLIED = "applied"
    REMOVED = "removed"
    FAILED = "failed"
    UNCERTAIN = "uncertain"
    SUPERSEDED = "superseded"


class WhatsAppGroupCreationStatus(StrEnum):
    PENDING = "pending"
    CREATING = "creating"
    READY = "ready"
    UNCERTAIN = "uncertain"
    FAILED = "failed"


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
class WhatsAppReaction:
    """A versioned reaction receipt; queued and uncertain are not applied reactions."""

    id: UUID
    target_message_id: UUID
    conversation_id: UUID
    agent_identity_id: UUID
    direction: WhatsAppDirection
    remote_number: str | None
    reaction: WhatsAppReactionType
    custom_emoji: str | None
    emoji: str
    status: WhatsAppReactionStatus
    revision: int
    created_at: datetime
    updated_at: datetime
    removed_at: datetime | None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WhatsAppReaction:
        return cls(id=UUID(d["id"]), target_message_id=UUID(d["target_message_id"]),
            conversation_id=UUID(d["conversation_id"]), agent_identity_id=UUID(d["agent_identity_id"]),
            direction=WhatsAppDirection(d["direction"]), remote_number=d.get("remote_number"),
            reaction=WhatsAppReactionType(d["reaction"]), custom_emoji=d.get("custom_emoji"), emoji=d["emoji"],
            status=WhatsAppReactionStatus(d["status"]), revision=d["revision"],
            created_at=datetime.fromisoformat(d["created_at"]), updated_at=datetime.fromisoformat(d["updated_at"]),
            removed_at=_dt(d.get("removed_at")))


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
    reply_to_message_id: UUID | None = None
    thread_id: UUID | None = None
    thread_root_message_id: UUID | None = None
    reactions: list[WhatsAppReaction] = field(default_factory=list)

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
            reply_to_message_id=UUID(d["reply_to_message_id"]) if d.get("reply_to_message_id") else None,
            thread_id=UUID(d["thread_id"]) if d.get("thread_id") else None,
            thread_root_message_id=UUID(d["thread_root_message_id"]) if d.get("thread_root_message_id") else None,
            reactions=[WhatsAppReaction._from_dict(row) for row in d.get("reactions", [])],
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
    group_name: str | None = field(default=None, kw_only=True)
    group_creation_status: WhatsAppGroupCreationStatus | None = field(default=None, kw_only=True)
    unresolved_participant_count: int = field(default=0, kw_only=True)

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
            group_name=d.get("group_name"),
            group_creation_status=WhatsAppGroupCreationStatus(d["group_creation_status"]) if d.get("group_creation_status") else None,
            unresolved_participant_count=d.get("unresolved_participant_count", 0),
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
    """Direct and group WhatsApp on an approved dedicated number.

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
        reply_to_message_id: UUID | str | None = None,
        plain_reply_fallback: bool = True,
        group_name: str | None = None,
        text: str | None = None,
        media_ids: list[UUID | str] | None = None,
        agent_identity_id: UUID | str | None = None,
        idempotency_key: str | None = None,
    ) -> WhatsAppMessage:
        """Queue a direct/group message or native quoted reply, without assuming delivery.

        Use a conversation ID for existing groups of any supported size. A group
        name is only a creation hint; selecting a group never renames it. Preserve
        the logical key after uncertainty rather than starting another operation.
        plain_reply_fallback defaults to True; False explicitly requires a native
        quote. Current supported targets use native quotes; missing evidence or
        rejected/uncertain sends never trigger a plain replacement.
        """
        if not isinstance(plain_reply_fallback, bool):
            raise ValueError("plain_reply_fallback must be a boolean")
        if (to is None) == (conversation_id is None):
            raise ValueError("Specify exactly one of to or conversation_id")
        recipients = [to] if isinstance(to, str) else to
        if to is not None and (not isinstance(recipients, list) or not 1 <= len(recipients) <= 8
                or any(not isinstance(value, str) or not re.fullmatch(r"\+[1-9][0-9]{6,14}", value) for value in recipients)
                or len(set(recipients)) != len(recipients)):
            raise ValueError("Provide 1–8 unique E.164 recipients")
        if reply_to_message_id is not None:
            if conversation_id is None:
                raise ValueError("reply_to_message_id requires conversation_id")
            UUID(str(reply_to_message_id))
        if group_name is not None and (not isinstance(to, list) or len(to) < 2 or not group_name.strip() or len(group_name) > 100):
            raise ValueError("group_name requires a recipient-list group and 1–100 characters")
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
        if reply_to_message_id is not None:
            body["reply_to_message_id"] = str(reply_to_message_id)
            if not plain_reply_fallback:
                body["plain_reply_fallback"] = False
        if group_name is not None:
            body["group_name"] = group_name
        if text is not None:
            body["text"] = text
        if media_ids is not None:
            body["media_ids"] = [str(value) for value in media_ids]
        key = send_key(idempotency_key)
        data = post_message(
            self._http,
            "/messages",
            json=body,
            params=_owner(agent_identity_id),
            idempotency_key=key,
        )
        try:
            return WhatsAppMessage._from_dict(data["message"])
        except Exception as error:
            # A successful HTTP response may still be unreadable; keep its recovery key.
            error.idempotency_key = key
            raise

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
        thread_id: UUID | str | None = None,
        include_groups: bool | None = False,
        limit: int = 50,
        offset: int = 0,
        is_read: bool | None = None,
        is_blocked: bool | None = None,
        start_datetime: str | None = None,
        end_datetime: str | None = None,
        tz: str | None = None,
    ) -> list[WhatsAppMessage]:
        params: dict[str, Any] = {
            **_owner(agent_identity_id),
            "limit": limit,
            "offset": offset,
        }
        if conversation_id is not None:
            params["conversation_id"] = str(conversation_id)
        if thread_id is not None:
            if conversation_id is None:
                raise ValueError("thread_id requires conversation_id")
            params["thread_id"] = str(thread_id)
        for name, value in (("start_datetime", start_datetime), ("end_datetime", end_datetime), ("tz", tz)):
            if value is not None:
                params[name] = value
        if include_groups is not None:
            params["include_groups"] = include_groups
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
        include_groups: bool | None = False,
        limit: int = 50,
        offset: int = 0,
        is_blocked: bool | None = None,
        start_datetime: str | None = None,
        end_datetime: str | None = None,
        tz: str | None = None,
    ) -> list[WhatsAppConversationSummary]:
        params: dict[str, Any] = {
            **_owner(agent_identity_id),
            "limit": limit,
            "offset": offset,
        }
        for name, value in (("start_datetime", start_datetime), ("end_datetime", end_datetime), ("tz", tz)):
            if value is not None:
                params[name] = value
        if include_groups is not None:
            params["include_groups"] = include_groups
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

    def get_thread(self, message_id: UUID | str, *, limit: int = 50, cursor: str | None = None,
                   agent_identity_id: UUID | str | None = None) -> WhatsAppThread:
        """Read a chronological page of visible messages sharing a quote-chain root."""
        return self._thread_page(f"/messages/{message_id}/thread", limit, cursor, agent_identity_id)

    def get_conversation_thread(self, conversation_id: UUID | str, thread_id: UUID | str, *,
                                limit: int = 50, cursor: str | None = None,
                                agent_identity_id: UUID | str | None = None) -> WhatsAppThread:
        """Read the same bounded thread through its conversation and stable thread ID."""
        return self._thread_page(f"/conversations/{conversation_id}/threads/{thread_id}", limit, cursor, agent_identity_id)

    def _thread_page(self, path: str, limit: int, cursor: str | None, identity: UUID | str | None) -> WhatsAppThread:
        if type(limit) is not int or not 1 <= limit <= 200:
            raise ValueError("Thread limit must be 1–200")
        params = {**_owner(identity), "limit": limit}
        if cursor is not None:
            params["cursor"] = cursor
        return WhatsAppThread._from_dict(self._http.get(path, params=params))

    def send_reaction(self, *, message_id: UUID | str, reaction: WhatsAppReactionType | str | None = None,
                      custom_emoji: str | None = None, idempotency_key: str,
                      agent_identity_id: UUID | str | None = None) -> WhatsAppReaction:
        """Submit one versioned reaction, retaining its key after an uncertain response."""
        UUID(str(message_id))
        if (reaction is None) == (custom_emoji is None):
            raise ValueError("Provide exactly one of reaction or custom_emoji")
        if reaction is not None and (str(reaction) not in {item.value for item in WhatsAppReactionType} or str(reaction) == "custom"):
            raise ValueError("Unsupported named WhatsApp reaction")
        if custom_emoji is not None and (not isinstance(custom_emoji, str) or not 1 <= len(custom_emoji) <= 32
                or any(char.isspace() or unicodedata.category(char) in {"Cc", "Cs"} for char in custom_emoji)):
            raise ValueError("custom_emoji must contain 1–32 non-whitespace characters")
        body = {"message_id": str(message_id), **({"reaction": str(reaction)} if reaction is not None else {"custom_emoji": custom_emoji})}
        result = self._http.post("/reactions", json=body, params=_owner(agent_identity_id), headers=_reaction_headers(idempotency_key))
        return WhatsAppReaction._from_dict(result["reaction"])

    def get_reaction(self, reaction_id: UUID | str, *, agent_identity_id: UUID | str | None = None) -> WhatsAppReaction:
        """Read queued, applied or uncertain state without repeating the operation."""
        result = self._http.get(f"/reactions/{reaction_id}", params=_owner(agent_identity_id))
        return WhatsAppReaction._from_dict(result["reaction"])

    def remove_reaction(self, reaction_id: UUID | str, *, idempotency_key: str,
                        agent_identity_id: UUID | str | None = None) -> WhatsAppReaction:
        """Return the removal receipt; a stale receipt never removes a newer reaction."""
        result = self._http.delete_with_response(f"/reactions/{reaction_id}", params=_owner(agent_identity_id),
            headers=_reaction_headers(idempotency_key))
        return WhatsAppReaction._from_dict(result["reaction"])

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


@dataclass
class WhatsAppThread:
    conversation_id: UUID
    thread_id: UUID | None
    thread_root_message_id: UUID | None
    messages: list[WhatsAppMessage]
    next_cursor: str | None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WhatsAppThread:
        return cls(UUID(d["conversation_id"]), UUID(d["thread_id"]) if d.get("thread_id") else None,
            UUID(d["thread_root_message_id"]) if d.get("thread_root_message_id") else None,
            [WhatsAppMessage._from_dict(row) for row in d["messages"]], d["next_cursor"])


def _reaction_headers(key: str) -> dict[str, str]:
    if not isinstance(key, str) or not key.strip() or len(key) > 255:
        raise ValueError("A stable idempotency_key is required")
    return {"Idempotency-Key": key}
