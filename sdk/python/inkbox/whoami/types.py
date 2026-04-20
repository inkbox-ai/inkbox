"""
inkbox/whoami/types.py

Dataclasses for the ``GET /api/whoami`` endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Named constants for the ``auth_subtype`` values returned on API-key responses.
# The field itself is typed as a free-form ``str`` because the server may add
# more variants over time; these constants are the current set.
AUTH_SUBTYPE_API_KEY_ADMIN_SCOPED = "api_key.admin_scoped"
AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_CLAIMED = "api_key.agent_scoped.claimed"
AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_UNCLAIMED = "api_key.agent_scoped.unclaimed"


@dataclass
class WhoamiApiKeyResponse:
    """Returned when the caller authenticates with an API key."""

    auth_type: str
    auth_subtype: str | None
    organization_id: str | None
    created_by: str | None
    creator_type: str | None
    key_id: str | None
    label: str | None
    description: str | None
    created_at: float | None
    last_used_at: float | None
    expires_at: float | None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WhoamiApiKeyResponse:
        return cls(
            auth_type=d["auth_type"],
            auth_subtype=d.get("auth_subtype"),
            organization_id=d.get("organization_id"),
            created_by=d.get("created_by"),
            creator_type=d.get("creator_type"),
            key_id=d.get("key_id"),
            label=d.get("label"),
            description=d.get("description"),
            created_at=d.get("created_at"),
            last_used_at=d.get("last_used_at"),
            expires_at=d.get("expires_at"),
        )


@dataclass
class WhoamiJwtResponse:
    """Returned when the caller authenticates with a JWT."""

    auth_type: str
    auth_subtype: str | None
    user_id: str | None
    email: str | None
    name: str | None
    organization_id: str | None
    org_role: str | None
    org_slug: str | None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WhoamiJwtResponse:
        return cls(
            auth_type=d["auth_type"],
            auth_subtype=d.get("auth_subtype"),
            user_id=d.get("user_id"),
            email=d.get("email"),
            name=d.get("name"),
            organization_id=d.get("organization_id"),
            org_role=d.get("org_role"),
            org_slug=d.get("org_slug"),
        )


WhoamiResponse = WhoamiApiKeyResponse | WhoamiJwtResponse


def _parse_whoami(d: dict[str, Any]) -> WhoamiResponse:
    """Dispatch to the correct dataclass based on ``auth_type``."""
    if d.get("auth_type") == "api_key":
        return WhoamiApiKeyResponse._from_dict(d)
    return WhoamiJwtResponse._from_dict(d)
