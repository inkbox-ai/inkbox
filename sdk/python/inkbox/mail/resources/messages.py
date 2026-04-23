"""
inkbox/mail/resources/messages.py

Message operations: list (auto-paginated), get, send, flag updates, delete.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Iterator
from uuid import UUID

from inkbox.mail.types import ForwardMode, Message, MessageDetail, MessageDirection

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_DEFAULT_PAGE_SIZE = 50


class MessagesResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        email_address: str,
        *,
        page_size: int = _DEFAULT_PAGE_SIZE,
        direction: MessageDirection | None = None,
    ) -> Iterator[Message]:
        """Iterator over all messages in a mailbox, newest first.

        Pagination is handled automatically -- just iterate.

        Args:
            email_address: Full email address of the mailbox.
            page_size: Number of messages fetched per API call (1-100).
            direction: Filter by direction.

        Example::

            for msg in client.messages.list(email_address):
                print(msg.subject, msg.from_address)
        """
        return self._paginate(
            email_address,
            page_size=page_size,
            direction=direction,
        )

    def _paginate(
        self,
        email_address: str,
        *,
        page_size: int,
        direction: MessageDirection | None = None,
    ) -> Iterator[Message]:
        cursor: str | None = None
        while True:
            params: dict[str, Any] = {"limit": page_size, "cursor": cursor}
            if direction is not None:
                params["direction"] = direction
            page = self._http.get(
                f"/mailboxes/{email_address}/messages",
                params=params,
            )
            for item in page["items"]:
                yield Message._from_dict(item)
            if not page["has_more"]:
                break
            cursor = page["next_cursor"]

    def get(self, email_address: str, message_id: UUID | str) -> MessageDetail:
        """Get a message with full body content.

        Args:
            email_address: Full email address of the owning mailbox.
            message_id: UUID of the message.

        Returns:
            Full message including ``body_text`` and ``body_html``.
        """
        data = self._http.get(f"/mailboxes/{email_address}/messages/{message_id}")
        return MessageDetail._from_dict(data)

    def send(
        self,
        email_address: str,
        *,
        to: list[str],
        subject: str,
        body_text: str | None = None,
        body_html: str | None = None,
        cc: list[str] | None = None,
        bcc: list[str] | None = None,
        in_reply_to_message_id: str | None = None,
        attachments: list[dict[str, str]] | None = None,
    ) -> Message:
        """Send an email from a mailbox.

        Args:
            email_address: Full email address of the sending mailbox.
            to: Primary recipient addresses (at least one required).
            subject: Email subject line.
            body_text: Plain-text body.
            body_html: HTML body.
            cc: Carbon-copy recipients.
            bcc: Blind carbon-copy recipients.
            in_reply_to_message_id: RFC 5322 Message-ID of the message being
                replied to. Threads the reply automatically.
            attachments: Optional list of file attachments. Each entry must have
                ``filename`` (str), ``content_type`` (MIME type str), and
                ``content_base64`` (base64-encoded file content str).
                Max total size: 25 MB. Blocked extensions: ``.exe``, ``.bat``, ``.scr``.

        Returns:
            The sent message metadata.
        """
        recipients: dict[str, Any] = {"to": to}
        if cc:
            recipients["cc"] = cc
        if bcc:
            recipients["bcc"] = bcc

        body: dict[str, Any] = {
            "recipients": recipients,
            "subject": subject,
        }
        if body_text is not None:
            body["body_text"] = body_text
        if body_html is not None:
            body["body_html"] = body_html
        if in_reply_to_message_id is not None:
            body["in_reply_to_message_id"] = in_reply_to_message_id
        if attachments is not None:
            body["attachments"] = attachments

        data = self._http.post(f"/mailboxes/{email_address}/messages", json=body)
        return Message._from_dict(data)

    def forward(
        self,
        email_address: str,
        message_id: UUID | str,
        *,
        to: list[str] | None = None,
        cc: list[str] | None = None,
        bcc: list[str] | None = None,
        mode: ForwardMode | str = ForwardMode.INLINE,
        subject: str | None = None,
        body_text: str | None = None,
        body_html: str | None = None,
        additional_attachments: list[dict[str, str]] | None = None,
        include_original_attachments: bool = True,
        reply_to: str | None = None,
    ) -> Message:
        """Forward a stored message out from this mailbox.

        Two modes are available — see :class:`ForwardMode`. Forwards start a
        brand-new thread.

        Args:
            email_address: Full email address of the forwarding mailbox.
            message_id: UUID of the message being forwarded.
            to: Primary recipient addresses.
            cc: Carbon-copy recipients.
            bcc: Blind carbon-copy recipients.
                At least one address is required across ``to``, ``cc``, and
                ``bcc``.
            mode: ``inline`` (default) or ``wrapped``. See :class:`ForwardMode`.
            subject: Optional override; defaults to ``"Fwd: " + original.subject``
                (idempotent — won't double-prefix if the original already
                starts with ``Fwd:``/``Fw:``).
            body_text: Optional caller note prepended above the original body
                (inline mode) or as a top-level note (wrapped mode).
            body_html: Optional HTML caller note.
            additional_attachments: Optional caller-authored attachments that
                ride alongside the forwarded content. Same shape as
                ``send(attachments=...)``: each entry must have ``filename``,
                ``content_type``, and ``content_base64`` keys. Subject to the
                same blocked-extension and 25 MB limits as ``send``.
            include_original_attachments: ``inline`` mode only — when ``True``
                (default) the original attachments are re-attached as direct
                outbound parts. Ignored in ``wrapped`` mode (originals live
                inside the wrapped ``.eml``).
            reply_to: Optional Reply-To address for the forward's outer
                envelope.

        Returns:
            The newly forwarded message metadata.
        """
        recipients: dict[str, Any] = {}
        if to:
            recipients["to"] = to
        if cc:
            recipients["cc"] = cc
        if bcc:
            recipients["bcc"] = bcc

        body: dict[str, Any] = {
            "recipients": recipients,
            "mode": ForwardMode(mode).value,
            "include_original_attachments": include_original_attachments,
        }
        if subject is not None:
            body["subject"] = subject
        if body_text is not None:
            body["body_text"] = body_text
        if body_html is not None:
            body["body_html"] = body_html
        if additional_attachments is not None:
            body["additional_attachments"] = additional_attachments
        if reply_to is not None:
            body["reply_to"] = reply_to

        data = self._http.post(
            f"/mailboxes/{email_address}/messages/{message_id}/forward",
            json=body,
        )
        return Message._from_dict(data)

    def update_flags(
        self,
        email_address: str,
        message_id: UUID | str,
        *,
        is_read: bool | None = None,
        is_starred: bool | None = None,
    ) -> Message:
        """Update read/starred flags on a message.

        Pass only the flags you want to change; omitted flags are left as-is.
        """
        body: dict[str, Any] = {}
        if is_read is not None:
            body["is_read"] = is_read
        if is_starred is not None:
            body["is_starred"] = is_starred
        data = self._http.patch(
            f"/mailboxes/{email_address}/messages/{message_id}", json=body
        )
        return Message._from_dict(data)

    def mark_read(self, email_address: str, message_id: UUID | str) -> Message:
        """Mark a message as read."""
        return self.update_flags(email_address, message_id, is_read=True)

    def mark_unread(self, email_address: str, message_id: UUID | str) -> Message:
        """Mark a message as unread."""
        return self.update_flags(email_address, message_id, is_read=False)

    def star(self, email_address: str, message_id: UUID | str) -> Message:
        """Star a message."""
        return self.update_flags(email_address, message_id, is_starred=True)

    def unstar(self, email_address: str, message_id: UUID | str) -> Message:
        """Unstar a message."""
        return self.update_flags(email_address, message_id, is_starred=False)

    def delete(self, email_address: str, message_id: UUID | str) -> None:
        """Delete a message."""
        self._http.delete(f"/mailboxes/{email_address}/messages/{message_id}")

    def get_attachment(
        self,
        email_address: str,
        message_id: UUID | str,
        filename: str,
        *,
        redirect: bool = False,
    ) -> dict[str, Any]:
        """Get a temporary signed URL for a message attachment.

        Args:
            email_address: Full email address of the owning mailbox.
            message_id: UUID of the message.
            filename: Attachment filename.
            redirect: If ``True``, follows the 302 redirect and returns the final
                URL as ``{"url": str}``. If ``False`` (default), returns
                ``{"url": str, "filename": str, "expires_in": int}``.

        Returns:
            Dict with ``url``, ``filename``, and ``expires_in`` (seconds).
        """
        return self._http.get(
            f"/mailboxes/{email_address}/messages/{message_id}/attachments/{filename}",
            params={"redirect": "true" if redirect else "false"},
        )
