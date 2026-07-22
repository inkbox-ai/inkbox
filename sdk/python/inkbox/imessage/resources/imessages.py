"""
inkbox/imessage/resources/imessages.py

iMessage operations: send, list, conversations, reactions, read
receipts, typing indicators, media upload.

iMessage messaging operations are identity-scoped, so they key off
``conversation_id`` / ``agent_identity_id`` rather than a local number ID.
One-to-one conversations may carry assignment state; groups require a dedicated
outbound number. This resource also lists and claims dedicated numbers.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.imessage.types import (
    IMessage,
    IMessageAssignment,
    IMessageConversation,
    IMessageConversationSummary,
    IMessageNumber,
    IMessageNumberType,
    IMessageMarkReadResult,
    IMessageMediaUpload,
    IMessageReaction,
    IMessageReactionType,
    IMessageSendStyle,
    IMessageTriageNumber,
    _dedicated_number_type,
    _validate_idempotency_key,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class IMessagesResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def get_triage_number(self) -> IMessageTriageNumber:
        """Return the active triage number and the connect command.

        Recipients text the returned ``connect_command`` (e.g.
        ``connect @your-handle``) to the triage ``number`` to get
        connected to an agent identity. Resolve this at runtime instead
        of hardcoding the number — it can change.

        Raises:
            InkboxAPIError: 404 when no triage number is active.
        """
        data = self._http.get("/triage-number")
        return IMessageTriageNumber._from_dict(data)

    def list_numbers(self) -> list[IMessageNumber]:
        """List the organization's dedicated iMessage numbers.

        Attached and unattached numbers are both returned. Released numbers are
        excluded by the server.
        """
        data = self._http.get("/numbers")
        return [IMessageNumber._from_dict(number) for number in data]

    def claim_number(
        self,
        *,
        type: IMessageNumberType | str,
        idempotency_key: str,
    ) -> IMessageNumber:
        """Claim a new dedicated iMessage number for the organization.

        ``idempotency_key`` must be stable across retries of the same logical
        claim. Dedicated inbound numbers require the recipient to message first.
        Dedicated outbound numbers may start new conversations, subject to
        server-side consent, contact-rule, and rate-limit checks.

        Raises:
            DedicatedIMessageNumberQuotaExceededError: The organization has
                reached its plan limit for the requested number type.
            DedicatedIMessageNumberInventoryPendingError: No matching number is
                currently available; retry after the reported interval.
            IdempotencyKeyReusedError: The key was previously used for
                a different claim.
        """
        number_type = _dedicated_number_type(type).value
        key = _validate_idempotency_key(idempotency_key)
        data = self._http.post(
            "/numbers",
            json={"type": number_type},
            headers={"Idempotency-Key": key},
        )
        return IMessageNumber._from_dict(data)

    def send(
        self,
        *,
        to: str | list[str] | None = None,
        conversation_id: UUID | str | None = None,
        text: str | None = None,
        media_urls: list[str] | None = None,
        send_style: IMessageSendStyle | str | None = None,
        agent_identity_id: UUID | str | None = None,
    ) -> IMessage:
        """Send an outbound iMessage.

        Shared and dedicated inbound service require an existing assignment.
        An identity attached to a dedicated outbound number may start a new
        conversation, subject to server-side policy checks.

        Args:
            to: One E.164 recipient or 1–8 distinct recipients. Two or more
                recipients select or create a dedicated-outbound group.
                Mutually exclusive with ``conversation_id``.
            conversation_id: Existing conversation UUID to reply into.
            text: Message body.
            media_urls: Media URLs (at most one). Pass with ``text`` or
                by themselves. Use :meth:`upload_media` to turn raw
                bytes into a sendable URL first.
            send_style: Optional expressive send style
                (see ``IMessageSendStyle``).
            agent_identity_id: Identity to send as. Required for
                org-wide API keys when sending by ``to``; ignored for
                identity-scoped keys (the key's identity wins).

        Returns:
            The queued ``IMessage`` row. Inbound replies and reactions
            arrive via identity-owned webhook subscriptions
            (``inkbox.webhooks.subscriptions.create(agent_identity_id=...,
            url=..., event_types=["imessage.received", ...])``).

        Raises:
            InkboxAPIError: 400 when the identity is not iMessage-enabled;
                404 when no assignment exists (shared service includes the
                connect command and router number, while dedicated inbound
                directs the recipient to the attached number); 409 when an
                existing conversation is inactive or a recipient-first line
                has not received a message yet, with setup-appropriate next
                steps in the detail; 429 when the identity's rolling 24-hour
                send cap is reached.
            RecipientBlockedError: 403 when the recipient is blocked by a
                contact rule.
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
        if send_style is not None:
            body["send_style"] = (
                send_style.value if isinstance(send_style, IMessageSendStyle) else send_style
            )

        params: dict[str, Any] | None = None
        if agent_identity_id is not None:
            params = {"agent_identity_id": str(agent_identity_id)}
        data = self._http.post("/messages", json=body, params=params)
        return IMessage._from_dict(data["message"])

    def list(
        self,
        *,
        agent_identity_id: UUID | str | None = None,
        conversation_id: UUID | str | None = None,
        limit: int = 50,
        offset: int = 0,
        is_read: bool | None = None,
        is_blocked: bool | None = None,
        include_groups: bool = False,
        start_datetime: str | None = None,
        end_datetime: str | None = None,
        tz: str | None = None,
    ) -> list[IMessage]:
        """List iMessages visible to the caller, newest first.

        Identity-scoped API keys never see contact-rule-blocked rows
        regardless of ``is_blocked`` — the server filters them at the
        access-policy layer. Admin-scoped keys and JWT humans see
        everything by default.

        Args:
            agent_identity_id: Narrow to one agent identity. Ignored
                for identity-scoped keys (always their own identity).
            conversation_id: Narrow to one conversation.
            limit: Max results to return (1–200).
            offset: Pagination offset.
            is_read: Filter by read state (``True``, ``False``, or ``None`` for all).
            is_blocked: Tri-state filter — ``True`` for only blocked,
                ``False`` for only non-blocked, ``None`` for all.
            include_groups: Include group messages. Defaults to ``False`` for
                backwards-compatible one-to-one listings. A specific
                ``conversation_id`` is returned even when this is ``False``.
            start_datetime: Inclusive lower bound on ``created_at`` (str). Bare
                dates resolve to the start of that day; naive datetimes are
                interpreted in ``tz``; zoned datetimes are exact instants.
                ``None`` leaves the range open on this side.
            end_datetime: Upper bound on ``created_at`` (str). A bare date is
                whole-day inclusive. ``None`` leaves the range open.
            tz: IANA timezone name (str) governing zone-less values;
                ``None`` means UTC.
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if agent_identity_id is not None:
            params["agent_identity_id"] = str(agent_identity_id)
        if conversation_id is not None:
            params["conversation_id"] = str(conversation_id)
        if is_read is not None:
            params["is_read"] = is_read
        if is_blocked is not None:
            params["is_blocked"] = is_blocked
        if include_groups:
            params["include_groups"] = True
        if start_datetime is not None:
            params["start_datetime"] = start_datetime
        if end_datetime is not None:
            params["end_datetime"] = end_datetime
        if tz is not None:
            params["tz"] = tz
        data = self._http.get("/messages", params=params)
        return [IMessage._from_dict(m) for m in data]

    def list_assignments(
        self,
        *,
        agent_identity_id: UUID | str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[IMessageAssignment]:
        """List active iMessage connections, newest first.

        One row per recipient currently connected to an agent identity
        through triage. Released connections are not returned.

        Args:
            agent_identity_id: Narrow to one agent identity. Ignored
                for identity-scoped keys (always their own identity).
            limit: Max results to return (1–200).
            offset: Pagination offset.
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if agent_identity_id is not None:
            params["agent_identity_id"] = str(agent_identity_id)
        data = self._http.get("/assignments", params=params)
        return [IMessageAssignment._from_dict(a) for a in data]

    def list_conversations(
        self,
        *,
        agent_identity_id: UUID | str | None = None,
        limit: int = 50,
        offset: int = 0,
        is_blocked: bool | None = None,
        include_groups: bool = False,
        start_datetime: str | None = None,
        end_datetime: str | None = None,
        tz: str | None = None,
    ) -> list[IMessageConversationSummary]:
        """List iMessage conversations with latest-message preview.

        Args:
            agent_identity_id: Narrow to one agent identity. Ignored
                for identity-scoped keys (always their own identity).
            limit: Max results to return (1–200).
            offset: Pagination offset.
            is_blocked: Tri-state filter applied to the underlying
                messages — ``True`` for only blocked, ``False`` for only
                non-blocked, ``None`` for all.
            include_groups: Include group conversations. Defaults to ``False``.
            start_datetime: Inclusive lower bound on ``created_at`` (str). Bare
                dates resolve to the start of that day; naive datetimes are
                interpreted in ``tz``; zoned datetimes are exact instants.
                ``None`` leaves the range open on this side.
            end_datetime: Upper bound on ``created_at`` (str). A bare date is
                whole-day inclusive. ``None`` leaves the range open.
            tz: IANA timezone name (str) governing zone-less values;
                ``None`` means UTC.
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if agent_identity_id is not None:
            params["agent_identity_id"] = str(agent_identity_id)
        if is_blocked is not None:
            params["is_blocked"] = is_blocked
        if include_groups:
            params["include_groups"] = True
        if start_datetime is not None:
            params["start_datetime"] = start_datetime
        if end_datetime is not None:
            params["end_datetime"] = end_datetime
        if tz is not None:
            params["tz"] = tz
        data = self._http.get("/conversations", params=params)
        return [IMessageConversationSummary._from_dict(c) for c in data]

    def get_conversation(
        self,
        conversation_id: UUID | str,
        *,
        agent_identity_id: UUID | str | None = None,
    ) -> IMessageConversation:
        """Get one iMessage conversation by ID.

        Args:
            conversation_id: UUID of the conversation.
            agent_identity_id: Optional identity assertion; 404s when
                the conversation belongs to a different identity.
        """
        params: dict[str, Any] = {}
        if agent_identity_id is not None:
            params["agent_identity_id"] = str(agent_identity_id)
        data = self._http.get(f"/conversations/{conversation_id}", params=params)
        return IMessageConversation._from_dict(data)

    def send_reaction(
        self,
        *,
        message_id: UUID | str,
        reaction: IMessageReactionType | str,
        part_index: int = 0,
    ) -> IMessageReaction:
        """Send a tapback reaction to a message.

        Args:
            message_id: UUID of the message being reacted to.
            reaction: Tapback kind. Sends accept the classic six;
                ``custom`` is inbound-only and rejected with 422.
            part_index: Part of a multi-part message to react to.
        """
        body: dict[str, Any] = {
            "message_id": str(message_id),
            "reaction": (
                reaction.value if isinstance(reaction, IMessageReactionType) else reaction
            ),
            "part_index": part_index,
        }
        data = self._http.post("/reactions", json=body)
        return IMessageReaction._from_dict(data)

    def mark_conversation_read(
        self,
        conversation_id: UUID | str,
    ) -> IMessageMarkReadResult:
        """Send a read receipt and mark inbound messages read locally.

        Args:
            conversation_id: UUID of the conversation.

        Returns:
            ``IMessageMarkReadResult`` with the count of rows updated.
        """
        data = self._http.post(
            "/mark-read",
            json={"conversation_id": str(conversation_id)},
        )
        return IMessageMarkReadResult._from_dict(data)

    def send_typing(self, conversation_id: UUID | str) -> None:
        """Show a typing indicator to the conversation's recipient.

        Args:
            conversation_id: UUID of the conversation.
        """
        self._http.post(
            "/typing",
            json={"conversation_id": str(conversation_id)},
        )

    def upload_media(
        self,
        *,
        content: bytes,
        filename: str,
        content_type: str | None = None,
    ) -> IMessageMediaUpload:
        """Upload media and get back a URL usable in ``media_urls``.

        Args:
            content: Raw file bytes (max 10 MiB).
            filename: Original filename, used for type inference.
            content_type: Optional MIME type; defaults server-side to
                ``application/octet-stream``.

        Returns:
            ``IMessageMediaUpload`` with the reusable ``media_url``.
        """
        data = self._http.post_multipart(
            "/media",
            field_name="file",
            filename=filename,
            content=content,
            content_type=content_type or "application/octet-stream",
        )
        return IMessageMediaUpload._from_dict(data)
