"""
inkbox/mail/resources/mailboxes.py

Mailbox read + update + full-text search. Mailboxes are created and
deleted exclusively via identity-create / identity-delete cascades —
there is no standalone mailbox create or delete surface.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from inkbox.mail.types import FilterMode, Mailbox, Message
from inkbox.mail.resources.imports import MailboxImportsResource

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_BASE = "/mailboxes"
_UNSET = object()


class MailboxesResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http
        self.imports = MailboxImportsResource(http)

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
        filter_mode: FilterMode | str = _UNSET,  # type: ignore[assignment]
        signature_html: str | None = _UNSET,  # type: ignore[assignment]
        signature_text: str | None = _UNSET,  # type: ignore[assignment]
        signature_enabled: bool = _UNSET,  # type: ignore[assignment]
    ) -> Mailbox:
        """Update mutable mailbox fields.

        Only provided fields are applied; omitted fields are left
        unchanged. To attach a webhook receiver, use
        ``inkbox.webhooks.subscriptions.create(mailbox_id=..., url=...,
        event_types=[...])``.

        Note: ``display_name`` has moved to the agent identity. To change
        the human-readable name, call ``identity.update(display_name=...)``
        — the mailbox PATCH endpoint will 422 if ``display_name`` is sent.

        Args:
            email_address: Full email address of the mailbox to update.
            filter_mode: ``"whitelist"`` or ``"blacklist"``. Admin-only on
                the server — agent-scoped keys will receive 403.
            signature_html: HTML fragment (up to 16,384 characters). None clears it.
                Updating HTML without text generates a plain-text fallback.
            signature_text: Plain text (up to 16,384 characters). None clears it;
                sending then derives text from saved HTML, when present.
            signature_enabled: Insert the saved signature on outgoing mail.
                Setting content or enabling requires an eligible paid plan.
                Disabling and clearing remain available on every plan.

        Returns:
            The updated mailbox. When ``filter_mode`` was supplied and the
            value actually changed, ``mailbox.filter_mode_change_notice`` is
            populated; otherwise it's ``None``.
        """
        body: dict[str, Any] = {}
        if filter_mode is not _UNSET:
            body["filter_mode"] = (
                filter_mode.value
                if isinstance(filter_mode, FilterMode)
                else filter_mode
            )
        for key, value in (
            ("signature_html", signature_html),
            ("signature_text", signature_text),
            ("signature_enabled", signature_enabled),
        ):
            if value is not _UNSET:
                body[key] = value
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
