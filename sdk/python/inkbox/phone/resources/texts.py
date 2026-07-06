"""
inkbox/phone/resources/texts.py

Text message (SMS/MMS) operations: list, get, update, search, conversations.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.phone.types import (
    TextConversationSummary,
    TextConversationUpdateResult,
    TextMessage,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class TextsResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def send(
        self,
        phone_number_id: UUID | str,
        *,
        to: str | list[str] | None = None,
        conversation_id: UUID | str | None = None,
        text: str | None = None,
        media_urls: list[str] | None = None,
    ) -> TextMessage:
        """Send an outbound SMS/MMS from a phone number.

        Args:
            phone_number_id: UUID of the sending phone number.
            to: E.164 destination number, or a list of numbers for a
                conversation-centric group send. Mutually exclusive with
                ``conversation_id``.
            conversation_id: Existing conversation UUID to reply into. The
                server resolves it to that conversation's participants.
            text: Message body.
            media_urls: MMS media URLs. Pass with ``text`` or by themselves.

        Returns:
            The queued ``TextMessage`` row. The full outbound lifecycle
            (``text.sent`` -> ``text.delivered`` / ``text.delivery_failed``
            / ``text.delivery_unconfirmed``) -- and inbound
            ``text.received`` events -- arrive via webhook subscriptions
            on the sender's phone number
            (``inkbox.webhooks.subscriptions.create(phone_number_id=...,
            url=..., event_types=[...])``). See ``TextWebhookEventType``
            and ``TextWebhookPayload`` for the typed receiver-side
            shapes.

        Raises:
            RecipientBlockedError: when the destination is blocked by an
                outbound contact rule on the sender.
            InkboxAPIError: for other 4xx/5xx errors. Stable ``error`` codes
                live in ``error.detail["error"]`` (e.g. ``recipient_not_opted_in``,
                ``sender_sms_pending``, ``sender_rate_limited``,
                ``carrier_rate_limit``).
        """
        body: dict[str, Any] = {}
        if to is not None:
            body["to"] = to
        if conversation_id is not None:
            body["conversation_id"] = str(conversation_id)
        if text is not None:
            body["text"] = text
        if media_urls is not None:
            body["media_urls"] = media_urls

        data = self._http.post(
            f"/numbers/{phone_number_id}/texts",
            json=body,
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
        start_date: str | None = None,
        end_date: str | None = None,
        tz: str | None = None,
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
            start_date: Inclusive lower bound on ``created_at`` (str). Bare
                dates resolve to the start of that day; naive datetimes are
                interpreted in ``tz``; zoned datetimes are exact instants.
                ``None`` leaves the range open on this side.
            end_date: Upper bound on ``created_at`` (str). A bare date is
                whole-day inclusive. ``None`` leaves the range open.
            tz: IANA timezone name (str) governing zone-less values;
                ``None`` means UTC.
        """
        params: dict[str, Any] = {
            "limit": limit,
            "offset": offset,
        }
        if is_read is not None:
            params["is_read"] = is_read
        if is_blocked is not None:
            params["is_blocked"] = is_blocked
        if start_date is not None:
            params["start_date"] = start_date
        if end_date is not None:
            params["end_date"] = end_date
        if tz is not None:
            params["tz"] = tz
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
        include_groups: bool = False,
        start_date: str | None = None,
        end_date: str | None = None,
        tz: str | None = None,
    ) -> list[TextConversationSummary]:
        """List conversation summaries with latest message preview.

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
            include_groups: Include group conversations. Defaults to
                ``False`` so old clients continue to see one-to-one rows only.
            start_date: Inclusive lower bound on ``created_at`` (str). Bare
                dates resolve to the start of that day; naive datetimes are
                interpreted in ``tz``; zoned datetimes are exact instants.
                ``None`` leaves the range open on this side.
            end_date: Upper bound on ``created_at`` (str). A bare date is
                whole-day inclusive. ``None`` leaves the range open.
            tz: IANA timezone name (str) governing zone-less values;
                ``None`` means UTC.
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if is_blocked is not None:
            params["is_blocked"] = is_blocked
        if include_groups:
            params["include_groups"] = True
        if start_date is not None:
            params["start_date"] = start_date
        if end_date is not None:
            params["end_date"] = end_date
        if tz is not None:
            params["tz"] = tz
        data = self._http.get(
            f"/numbers/{phone_number_id}/texts/conversations",
            params=params,
        )
        return [TextConversationSummary._from_dict(c) for c in data]

    def get_conversation(
        self,
        phone_number_id: UUID | str,
        remote_number: UUID | str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> list[TextMessage]:
        """Get all messages in a conversation, newest first.

        Args:
            phone_number_id: UUID of the phone number.
            remote_number: E.164 one-to-one remote number, or conversation UUID.
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
        remote_number: UUID | str,
        *,
        is_read: bool,
    ) -> TextConversationUpdateResult:
        """Update the read state for all messages in a conversation.

        Args:
            phone_number_id: UUID of the phone number.
            remote_number: E.164 one-to-one remote number, or conversation UUID.
            is_read: Mark all messages as read (``True``) or unread (``False``).

        Returns:
            ``TextConversationUpdateResult`` with ``conversation_id``,
            ``remote_phone_number``, ``is_read``, and ``updated_count``.
        """
        data = self._http.patch(
            f"/numbers/{phone_number_id}/texts/conversations/{remote_number}",
            json={"is_read": is_read},
        )
        return TextConversationUpdateResult._from_dict(data)
