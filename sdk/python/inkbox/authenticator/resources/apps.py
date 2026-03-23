"""
inkbox/authenticator/resources/apps.py

Authenticator app CRUD operations.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.authenticator.types import AuthenticatorApp

if TYPE_CHECKING:
    from inkbox.authenticator._http import HttpTransport

_BASE = "/apps"


class AuthenticatorAppsResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def create(self, *, agent_handle: str | None = None) -> AuthenticatorApp:
        """Create a new authenticator app.

        Args:
            agent_handle: Optional agent identity handle to link this app to.
                If omitted, the app is created unbound.

        Returns:
            The created authenticator app.
        """
        body: dict[str, Any] = {}
        if agent_handle is not None:
            body["agent_handle"] = agent_handle
        data = self._http.post(_BASE, json=body)
        return AuthenticatorApp._from_dict(data)

    def list(self) -> list[AuthenticatorApp]:
        """List all non-deleted authenticator apps for your organisation."""
        data = self._http.get(_BASE)
        return [AuthenticatorApp._from_dict(a) for a in data]

    def get(self, authenticator_app_id: UUID | str) -> AuthenticatorApp:
        """Get a single authenticator app by ID.

        Args:
            authenticator_app_id: UUID of the authenticator app.
        """
        data = self._http.get(f"{_BASE}/{authenticator_app_id}")
        return AuthenticatorApp._from_dict(data)

    def delete(self, authenticator_app_id: UUID | str) -> None:
        """Delete an authenticator app.

        This also unlinks the app from its identity (if any) and
        deletes all child authenticator accounts.

        Args:
            authenticator_app_id: UUID of the authenticator app to delete.
        """
        self._http.delete(f"{_BASE}/{authenticator_app_id}")
