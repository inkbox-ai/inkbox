"""
inkbox/api_keys/types.py

Dataclasses mirroring the Inkbox API-key response models.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID


class ApiKeyStatus(StrEnum):
    """Lifecycle state of an API key."""

    ACTIVE = "active"
    REVOKED = "revoked"


def _parse_dt_or_none(value: Any) -> datetime | None:
    """Parse an optional ISO-8601 timestamp."""
    if value is None:
        return None
    return datetime.fromisoformat(str(value))


@dataclass(frozen=True)
class ApiKey:
    """Public representation of an API key (no secret material).

    Attributes:
        id: API key identifier in ``ApiKey_<uuid4>`` format.
        organization_id: Owning organization's Clerk ID.
        created_by: Creator identifier (Clerk user ID for humans, identity
            UUID for agents).
        creator_type: ``"human"`` or ``"agent"``.
        scoped_identity_id: UUID of the agent identity this key is scoped
            to, or ``None`` for an admin (unscoped) key with full org-wide
            authority.
        label: Human-readable name for the key.
        description: Optional free-text description.
        status: Current lifecycle status (active or revoked).
        last4: Last 4 characters of the secret, for display.
        display_prefix: Truncated key ID prefix for display.
        last_used_at: Timestamp of last successful authentication, or ``None``.
        expires_at: Expiration timestamp, or ``None`` for non-expiring keys.
        revoked_at: Revocation timestamp, or ``None`` if still active.
        created_at: Row creation timestamp.
        updated_at: Row last-modified timestamp.
    """

    id: str
    organization_id: str
    created_by: str
    creator_type: str
    scoped_identity_id: UUID | None
    label: str
    description: str | None
    status: ApiKeyStatus
    last4: str
    display_prefix: str
    last_used_at: datetime | None
    expires_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ApiKey:
        # scoped_identity_id is optional on the wire; coerce only when present
        sid = d.get("scoped_identity_id")
        return cls(
            id=str(d["id"]),
            organization_id=str(d["organization_id"]),
            created_by=str(d["created_by"]),
            creator_type=str(d["creator_type"]),
            scoped_identity_id=UUID(str(sid)) if sid is not None else None,
            label=str(d["label"]),
            description=d.get("description"),
            status=ApiKeyStatus(d["status"]),
            last4=str(d["last4"]),
            display_prefix=str(d["display_prefix"]),
            last_used_at=_parse_dt_or_none(d.get("last_used_at")),
            expires_at=_parse_dt_or_none(d.get("expires_at")),
            revoked_at=_parse_dt_or_none(d.get("revoked_at")),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )


@dataclass(frozen=True)
class CreatedApiKey:
    """Result of :meth:`ApiKeysResource.create`.

    The ``api_key`` secret is shown ONCE — persist it immediately; it cannot
    be retrieved later.

    Attributes:
        api_key: Full API key string (use as ``X-API-Key``).
        record: Public metadata for the newly created key.
    """

    api_key: str
    record: ApiKey

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> CreatedApiKey:
        return cls(
            api_key=str(d["api_key"]),
            record=ApiKey._from_dict(d["record"]),
        )
