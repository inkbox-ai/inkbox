"""
inkbox/phone/resources/texts.py

Text message (SMS/MMS) operations: list, get, update, search, conversations.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.phone.types import TextConversationSummary, TextMessage

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class TextsResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def send(
        self,
        phone_number_id: UUID | str,
        *,
        to: str,
        text: str,
    ) -> TextMessage:
        """Send an outbound SMS from a phone number.

        Args:
            phone_number_id: UUID of the sending phone number.
            to: E.164 destination number.
            text: Message body (1-1600 chars, non-whitespace required).

        Returns:
            The queued ``TextMessage`` row. Final delivery state arrives via
            the ``incoming_text_webhook_url`` configured on the sender.

        Raises:
            RecipientBlockedError: when the destination is blocked by an
                outbound contact rule on the sender.
            InkboxAPIError: for other 4xx/5xx errors. Stable ``error`` codes
                live in ``error.detail["error"]`` (e.g. ``recipient_not_opted_in``,
                ``sender_sms_pending``, ``toll_free_verification_pending``,
                ``sender_rate_limited``, ``carrier_rate_limit``).
        """
        # Server selects the sender by path param, not body.
        data = self._http.post(
            f"/numbers/{phone_number_id}/texts",
            json={"to": to, "text": text},
        )
        return TextMessage._from_dict(data)

    def list(
        self,
        phone_number_id: UUID | str,
        *,
        limit: int = 50,
        offset: int = 0,
        is_read: bool | None = None,
        is_blocked: bool | None = None,
    ) -> list[TextMessage]:
        """List text messages for a phone number, newest first.

        Identity-scoped API keys never see contact-rule-blocked rows
        regardless of ``is_blocked`` — the server filters them at the
        access-policy layer. Admin-scoped keys and JWT humans see
        everything by default; pass ``is_blocked=True`` to surface the
        blocked-only listing or ``is_blocked=False`` to exclude blocked
        rows.

        Args:
            phone_number_id: UUID of the phone number.
            limit: Max results to return (1–200).
            offset: Pagination offset.
            is_read: Filter by read state (``True``, ``False``, or ``None`` for all).
            is_blocked: Tri-state filter — ``True`` for only blocked,
                ``False`` for only non-blocked, ``None`` for all.
        """
        params: dict[str, Any] = {
            "limit": limit,
            "offset": offset,
        }
        if is_read is not None:
            params["is_read"] = is_read
        if is_blocked is not None:
            params["is_blocked"] = is_blocked
        data = self._http.get(
            f"/numbers/{phone_number_id}/texts",
            params=params,
        )
        return [TextMessage._from_dict(t) for t in data]

    def get(
        self,
        phone_number_id: UUID | str,
        text_id: UUID | str,
    ) -> TextMessage:
        """Get a single text message by ID.

        Args:
            phone_number_id: UUID of the phone number.
            text_id: UUID of the text message.
        """
        data = self._http.get(f"/numbers/{phone_number_id}/texts/{text_id}")
        return TextMessage._from_dict(data)

    def update(
        self,
        phone_number_id: UUID | str,
        text_id: UUID | str,
        *,
        is_read: bool | None = None,
    ) -> TextMessage:
        """Update a text message (mark as read).

        Args:
            phone_number_id: UUID of the phone number.
            text_id: UUID of the text message.
            is_read: Mark as read (``True``) or unread (``False``).
        """
        body: dict[str, Any] = {}
        if is_read is not None:
            body["is_read"] = is_read
        data = self._http.patch(
            f"/numbers/{phone_number_id}/texts/{text_id}",
            json=body,
        )
        return TextMessage._from_dict(data)

    def search(
        self,
        phone_number_id: UUID | str,
        *,
        q: str,
        limit: int = 50,
        is_blocked: bool | None = None,
    ) -> list[TextMessage]:
        """Full-text search across text messages for a phone number.

        Identity-scoped API keys never see contact-rule-blocked rows in
        results regardless of ``is_blocked``. Admin/JWT callers see
        everything by default; pass ``is_blocked=False`` to keep search
        clean of blocked spam, or ``is_blocked=True`` to search only the
        blocked folder.

        Args:
            phone_number_id: UUID of the phone number.
            q: Search query string.
            limit: Max results to return (1–200).
            is_blocked: Tri-state filter — ``True`` for only blocked,
                ``False`` for only non-blocked, ``None`` for all.
        """
        params: dict[str, Any] = {"q": q, "limit": limit}
        if is_blocked is not None:
            params["is_blocked"] = is_blocked
        data = self._http.get(
            f"/numbers/{phone_number_id}/texts/search",
            params=params,
        )
        return [TextMessage._from_dict(t) for t in data]

    def list_conversations(
        self,
        phone_number_id: UUID | str,
        *,
        limit: int = 50,
        offset: int = 0,
        is_blocked: bool | None = None,
    ) -> list[TextConversationSummary]:
        """List conversations (one row per remote number) with latest message preview.

        Identity-scoped API keys never see blocked rows — both the
        conversation list and the latest-message previews exclude them
        automatically. Admin-scoped keys and JWT humans see everything
        by default; ``is_blocked=False`` hides spam-only counterparties
        and stops blocked rows from bumping quiet conversations to the
        top, while ``is_blocked=True`` narrows to conversations made up
        of blocked rows.

        Args:
            phone_number_id: UUID of the phone number.
            limit: Max results to return (1–200).
            offset: Pagination offset.
            is_blocked: Tri-state filter applied to the underlying
                messages — ``True`` for only blocked, ``False`` for only
                non-blocked, ``None`` for all.
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if is_blocked is not None:
            params["is_blocked"] = is_blocked
        data = self._http.get(
            f"/numbers/{phone_number_id}/texts/conversations",
            params=params,
        )
        return [TextConversationSummary._from_dict(c) for c in data]

    def get_conversation(
        self,
        phone_number_id: UUID | str,
        remote_number: str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> list[TextMessage]:
        """Get all messages with a specific remote number, newest first.

        Args:
            phone_number_id: UUID of the phone number.
            remote_number: E.164 remote phone number.
            limit: Max results to return (1–200).
            offset: Pagination offset.
        """
        data = self._http.get(
            f"/numbers/{phone_number_id}/texts/conversations/{remote_number}",
            params={"limit": limit, "offset": offset},
        )
        return [TextMessage._from_dict(t) for t in data]

    def update_conversation(
        self,
        phone_number_id: UUID | str,
        remote_number: str,
        *,
        is_read: bool,
    ) -> dict[str, Any]:
        """Update the read state for all messages in a conversation.

        Args:
            phone_number_id: UUID of the phone number.
            remote_number: E.164 remote phone number.
            is_read: Mark all messages as read (``True``) or unread (``False``).

        Returns:
            Dict with ``remote_phone_number``, ``is_read``, and ``updated_count``.
        """
        data = self._http.patch(
            f"/numbers/{phone_number_id}/texts/conversations/{remote_number}",
            json={"is_read": is_read},
        )
        return data
