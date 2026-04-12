"""
inkbox/mail/resources/mailboxes.py

Mailbox CRUD and full-text search.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from inkbox.mail.types import Mailbox, Message

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_BASE = "/mailboxes"
_UNSET = object()


class MailboxesResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(self) -> list[Mailbox]:
        """List all mailboxes for your organisation."""
        data = self._http.get(_BASE)
        return [Mailbox._from_dict(m) for m in data]

    def get(self, email_address: str) -> Mailbox:
        """Get a mailbox by its email address.

        Args:
            email_address: Full email address of the mailbox
                (e.g. ``"abc-xyz@inkboxmail.com"``).
        """
        data = self._http.get(f"{_BASE}/{email_address}")
        return Mailbox._from_dict(data)

    def create(
        self,
        *,
        agent_handle: str,
        display_name: str | None = None,
        email_local_part: str | None = None,
    ) -> Mailbox:
        """Create and link a mailbox to an existing identity.

        Args:
            agent_handle: Handle of the identity that should own the mailbox.
            display_name: Optional human-readable sender name.
            email_local_part: Optional requested local part. If omitted, the
                server generates a random address.
        """
        body: dict[str, Any] = {"agent_handle": agent_handle}
        if display_name is not None:
            body["display_name"] = display_name
        if email_local_part is not None:
            body["email_local_part"] = email_local_part
        data = self._http.post(_BASE, json=body)
        return Mailbox._from_dict(data)

    def update(
        self,
        email_address: str,
        *,
        display_name: str | None = _UNSET,  # type: ignore[assignment]
        webhook_url: str | None = _UNSET,  # type: ignore[assignment]
    ) -> Mailbox:
        """Update mutable mailbox fields.

        Only provided fields are applied; omitted fields are left unchanged.
        Pass ``webhook_url=None`` to unsubscribe from webhooks.

        Args:
            email_address: Full email address of the mailbox to update.
            display_name: New human-readable sender name.
            webhook_url: HTTPS URL to receive webhook events, or ``None`` to unsubscribe.

        Returns:
            The updated mailbox.
        """
        body: dict[str, Any] = {}
        if display_name is not _UNSET:
            body["display_name"] = display_name
        if webhook_url is not _UNSET:
            body["webhook_url"] = webhook_url
        data = self._http.patch(
            f"{_BASE}/{email_address}",
            json=body,
        )
        return Mailbox._from_dict(data)

    def delete(self, email_address: str) -> None:
        """Delete a mailbox.

        Args:
            email_address: Full email address of the mailbox to delete.
        """
        self._http.delete(f"{_BASE}/{email_address}")

    def search(
        self,
        email_address: str,
        *,
        q: str,
        limit: int = 50,
    ) -> list[Message]:
        """Full-text search across messages in a mailbox.

        Args:
            email_address: Full email address of the mailbox to search.
            q: Search query string.
            limit: Maximum number of results (1–100).

        Returns:
            Matching messages ranked by relevance.
        """
        data = self._http.get(
            f"{_BASE}/{email_address}/search",
            params={
                "q": q,
                "limit": limit,
            },
        )
        return [Message._from_dict(m) for m in data["items"]]
