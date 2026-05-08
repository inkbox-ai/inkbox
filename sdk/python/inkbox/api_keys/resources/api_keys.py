"""
inkbox/api_keys/resources/api_keys.py

API key creation surface.

The Inkbox server admits two auth types on ``POST /api/v1/api-keys``:
JWT (console) and admin-scoped API keys. Admin-scoped callers may only
mint identity-scoped keys (``scoped_identity_id`` required); attempting
to mint another admin-scoped key returns HTTP 403.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.api_keys.types import CreatedApiKey

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_BASE = "/api-keys"


class ApiKeysResource:
    """Create API keys for the caller's organization."""

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def create(
        self,
        *,
        label: str,
        description: str | None = None,
        scoped_identity_id: UUID | str | None = None,
    ) -> CreatedApiKey:
        """Create a new API key for the caller's organization.

        Admin-scoped API key callers must pass ``scoped_identity_id`` — the
        server rejects attempts to mint another admin-scoped key from an
        admin-scoped caller with HTTP 403.

        Args:
            label: Required human-readable name for the key (1–255 chars).
            description: Optional free-text description (≤1000 chars).
            scoped_identity_id: Scope this key to a specific agent identity.
                Omit or pass ``None`` for an admin (unscoped) key with full
                org-wide authority — only allowed for JWT (console) callers.

        Returns:
            A :class:`CreatedApiKey` containing the full key string (shown
            once) and the public metadata record.
        """
        # Build request body, omitting unset fields so the server sees the
        # documented defaults rather than explicit nulls
        body: dict[str, Any] = {"label": label}
        if description is not None:
            body["description"] = description
        if scoped_identity_id is not None:
            body["scoped_identity_id"] = str(scoped_identity_id)
        data = self._http.post(_BASE, json=body)
        return CreatedApiKey._from_dict(data)
