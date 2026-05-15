"""
inkbox/mail/resources/mailboxes.py

Mailbox read + update + full-text search. Mailboxes are created and
deleted exclusively via identity-create / identity-delete cascades —
there is no standalone mailbox create or delete surface.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from inkbox.mail.types import FilterMode, Mailbox, Message

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

    def update(
        self,
        email_address: str,
        *,
        webhook_url: str | None = _UNSET,  # type: ignore[assignment]
        filter_mode: FilterMode | str = _UNSET,  # type: ignore[assignment]
    ) -> Mailbox:
        """Update mutable mailbox fields.

        Only provided fields are applied; omitted fields are left unchanged.
        Pass ``webhook_url=None`` to unsubscribe from webhooks.

        Note: ``display_name`` has moved to the agent identity. To change
        the human-readable name, call ``identity.update(display_name=...)``
        — the mailbox PATCH endpoint will 422 if ``display_name`` is sent.

        Args:
            email_address: Full email address of the mailbox to update.
            webhook_url: HTTPS URL to receive webhook events, or ``None``
                to unsubscribe.
            filter_mode: ``"whitelist"`` or ``"blacklist"``. Admin-only on
                the server — agent-scoped keys will receive 403.

        Returns:
            The updated mailbox. When ``filter_mode`` was supplied and the
            value actually changed, ``mailbox.filter_mode_change_notice`` is
            populated; otherwise it's ``None``.
        """
        body: dict[str, Any] = {}
        if webhook_url is not _UNSET:
            body["webhook_url"] = webhook_url
        if filter_mode is not _UNSET:
            body["filter_mode"] = (
                filter_mode.value
                if isinstance(filter_mode, FilterMode)
                else filter_mode
            )
        data = self._http.patch(
            f"{_BASE}/{email_address}",
            json=body,
        )
        return Mailbox._from_dict(data)

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
