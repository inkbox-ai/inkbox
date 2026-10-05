"""Optional cached context for retained Slack messages."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

SlackArchiveInclude = Literal["conversation", "sender", "reactions", "files"]
SlackCachedMediaKind = Literal["user", "bot", "emoji"]


@dataclass
class SlackCachedActor:
    id: str
    kind: Literal["user", "bot"]
    name: str | None = None
    avatar_url: str | None = None
    avatar_cached: bool = False
    deleted: bool | None = None
    status: str = "pending"
    fetched_at: datetime | None = None


@dataclass
class SlackCachedConversation:
    id: str
    name: str | None = None
    title: str | None = None
    type: Literal["im", "mpim", "channel"] | None = None
    topic: str | None = None
    purpose: str | None = None
    counterpart_user_id: str | None = None
    member_ids: list[str] | None = None
    members_complete: bool | None = None
    is_archived: bool | None = None
    is_private: bool | None = None
    status: str = "pending"
    fetched_at: datetime | None = None


@dataclass
class SlackCachedEmoji:
    name: str
    alias_of: str | None = None
    image_url: str | None = None
    image_cached: bool = False
    status: str = "pending"


@dataclass
class SlackCachedFile:
    id: str
    name: str | None = None
    title: str | None = None
    mimetype: str | None = None
    size: int | None = None
    content_cached: bool = False
    preview_cached: bool = False
    preview_url: str | None = None
    status: str = "pending"
    error_code: str | None = None


@dataclass
class SlackCachedReaction:
    """An unknown total is None; known users need not be the complete actor set."""

    name: str
    count: int | None = None
    users: list[str] = field(default_factory=list)
    users_complete: bool = False
    reacted: bool | None = None


@dataclass
class SlackArchiveIncluded:
    conversations: dict[str, SlackCachedConversation] = field(default_factory=dict)
    actors: dict[str, SlackCachedActor] = field(default_factory=dict)
    emoji: dict[str, SlackCachedEmoji] = field(default_factory=dict)
    files: dict[str, SlackCachedFile] = field(default_factory=dict)


@dataclass
class SlackCachedEmojiPage:
    emoji: list[SlackCachedEmoji]
    status: str
    next_cursor: str | None = None
    error_code: str | None = None


def _cached(cls, raw):
    values = {k: v for k, v in raw.items() if k in cls.__dataclass_fields__}
    if values.get("fetched_at") is not None:
        values["fetched_at"] = datetime.fromisoformat(values["fetched_at"])
    return cls(**values)


def _included(raw):
    return SlackArchiveIncluded(**{
        name: {key: _cached(cls, value) for key, value in raw.get(name, {}).items()}
        for name, cls in (("conversations", SlackCachedConversation), ("actors", SlackCachedActor),
                          ("emoji", SlackCachedEmoji), ("files", SlackCachedFile))
    })
