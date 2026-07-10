"""
inkbox/agent_identity.py

AgentIdentity: a domain object representing one agent identity.
Returned by inkbox.create_identity() and inkbox.get_identity().

Convenience methods (send_email, place_call, etc.) are scoped to this
agent's assigned channels so callers never need to pass an email address
or phone number ID explicitly.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Iterator
from uuid import UUID

from inkbox.credentials import Credentials
from inkbox.vault.totp import TOTPCode, TOTPConfig
from inkbox.vault.types import DecryptedVaultSecret, SecretPayload, VaultSecret
from inkbox.identities.types import (
    _UNSET,
    _AgentIdentityData,
    IdentityAccess,
    IdentityMailbox,
    IdentityPhoneNumber,
)
from inkbox.tunnels.types import Tunnel
from inkbox.exceptions import InkboxError
from inkbox.imessage.types import (
    IMessage,
    IMessageAssignment,
    IMessageConversation,
    IMessageConversationSummary,
    IMessageMarkReadResult,
    IMessageMediaUpload,
    IMessageReaction,
    IMessageReactionType,
    IMessageSendStyle,
)
from inkbox.mail.types import (
    ContactRuleStatus,
    FilterMode,
    ForwardMode,
    MailIdentityContactRule,
    MailRuleAction,
    MailRuleMatchType,
    Message,
    MessageDetail,
    MessageDirection,
    ThreadDetail,
)
from inkbox.phone.types import (
    CallOrigin,
    IncomingCallAction,
    IncomingCallActionConfig,
    PhoneCall,
    PhoneCallWithRateLimit,
    PhoneIdentityContactRule,
    PhoneRuleAction,
    PhoneRuleMatchType,
    PhoneTranscript,
    TextConversationSummary,
    TextConversationUpdateResult,
    TextMessage,
)
from inkbox.signing_keys import SigningKey, SigningKeyStatus

if TYPE_CHECKING:
    from datetime import datetime

    from inkbox.client import Inkbox

# `_UNSET` is imported from inkbox.identities.types above. Identity-based
# `is not _UNSET` checks must compare against the SAME object across all
# layers; a module-local `object()` here would leak the sentinel through
# to the wire body and crash JSON encoding.


class AgentIdentity:
    """An agent identity with convenience methods for its assigned channels.

    Obtain an instance via::

        identity = inkbox.create_identity("support-bot")
        # or
        identity = inkbox.get_identity("support-bot")

    If the identity has a mailbox, you can communicate directly::

        identity.send_email(to=["user@example.com"], subject="Hi", body_text="Hello")
        identity.place_call(to_number="+15555550100", client_websocket_url="wss://my-app.com/ws")

        for msg in identity.iter_emails():
            print(msg.subject)
    """

    def __init__(self, data: _AgentIdentityData, inkbox: Inkbox) -> None:
        self._data = data
        self._inkbox = inkbox
        self._mailbox: IdentityMailbox | None = data.mailbox
        self._phone_number: IdentityPhoneNumber | None = data.phone_number
        self._tunnel: Tunnel | None = data.tunnel
        self._credentials: Credentials | None = None
        self._credentials_vault_ref: object | None = None  # tracks which _unlocked built the cache

    ## Identity properties

    @property
    def agent_handle(self) -> str:
        return self._data.agent_handle

    @property
    def id(self):
        return self._data.id

    @property
    def display_name(self) -> str | None:
        """Human-readable display name. Defaults server-side to ``agent_handle`` if unset."""
        return self._data.display_name

    @property
    def description(self) -> str | None:
        """Free-form org-internal description, or ``None`` if unset.

        Never surfaces in outbound mail / call audio / public payloads.
        """
        return self._data.description

    @property
    def email_address(self) -> str | None:
        """The email address assigned to this identity at creation time.

        Always trust this value — do not derive it from ``agent_handle``.
        """
        return self._data.email_address

    @property
    def imessage_enabled(self) -> bool:
        """Whether this identity can be reached over the shared iMessage service."""
        return self._data.imessage_enabled

    @property
    def imessage_filter_mode(self) -> FilterMode:
        """Whitelist/blacklist mode for this identity's iMessage contact rules."""
        return self._data.imessage_filter_mode

    @property
    def mail_filter_mode(self) -> FilterMode:
        """Whitelist/blacklist mode for this identity's mail contact rules."""
        return self._data.mail_filter_mode

    @property
    def phone_filter_mode(self) -> FilterMode:
        """Whitelist/blacklist mode for this identity's phone contact rules."""
        return self._data.phone_filter_mode

    @property
    def signing_key_configured(self) -> bool:
        """Whether this identity has a webhook signing key configured (status only)."""
        return self._data.signing_key_configured

    @property
    def signing_key_created_at(self) -> datetime | None:
        """When this identity's signing key was created, or ``None`` if unset."""
        return self._data.signing_key_created_at

    @property
    def mailbox(self) -> IdentityMailbox | None:
        """Mailbox linked to this identity. Non-null for live identities (1:1 invariant)."""
        return self._mailbox

    @property
    def phone_number(self) -> IdentityPhoneNumber | None:
        return self._phone_number

    @property
    def tunnel(self) -> Tunnel | None:
        """Tunnel linked to this identity. Non-null for live identities (1:1 invariant)."""
        return self._tunnel

    @property
    def credentials(self) -> Credentials:
        """Identity-scoped credential access.

        Returns a :class:`~inkbox.credentials.Credentials` object filtered
        to the secrets this identity has been granted access to.  The vault
        must be unlocked first via ``inkbox.vault.unlock(vault_key)``.

        The result is cached and automatically invalidated when the
        vault is re-unlocked.  Call :meth:`refresh` to manually clear
        the cache (e.g. after access-rule changes).

        Raises:
            InkboxError: If the vault has not been unlocked.
        """
        vault = self._inkbox._vault_resource
        # Invalidate cache if the vault was re-unlocked since we last built it.
        if self._credentials is not None and vault._unlocked is self._credentials_vault_ref:
            return self._credentials
        self._require_vault_unlocked()
        unlocked = vault._unlocked
        self._credentials = Credentials(unlocked.secrets)  # type: ignore[union-attr]
        self._credentials_vault_ref = unlocked
        return self._credentials

    def revoke_credential_access(self, secret_id: UUID | str) -> None:
        """
        Revoke this identity's access to a vault secret.

        Also clears the credentials cache so the next access to
        :attr:`credentials` reflects the change.

        Args:
            secret_id: UUID of the secret to revoke access from.
        """
        self._inkbox._vault_resource.revoke_access(
            secret_id,
            identity_id=self.id,
        )
        self._credentials = None

    ## Vault secret management

    def create_secret(
        self,
        name: str,
        payload: SecretPayload,
        *,
        description: str | None = None,
    ) -> VaultSecret:
        """Create a vault secret and grant this identity access to it.

        The vault must be unlocked first.

        Args:
            name: Display name (max 255 characters).
            payload: One of :class:`LoginPayload`, :class:`SSHKeyPayload`,
                :class:`APIKeyPayload`, or :class:`OtherPayload`.
            description: Optional description.

        Returns:
            :class:`~inkbox.vault.types.VaultSecret` metadata.
        """
        self._require_vault_unlocked()
        unlocked = self._inkbox._vault_resource._unlocked
        secret = unlocked.create_secret(name, payload, description=description)  # type: ignore[union-attr]
        self._inkbox._vault_resource.grant_access(
            str(secret.id), identity_id=str(self.id),
        )
        self._credentials = None  # invalidate cache
        return secret

    def get_secret(self, secret_id: UUID | str) -> DecryptedVaultSecret:
        """Fetch and decrypt a vault secret this identity has access to.

        Args:
            secret_id: UUID of the secret.

        Returns:
            :class:`~inkbox.vault.types.DecryptedVaultSecret`.
        """
        self._require_vault_unlocked()
        unlocked = self._inkbox._vault_resource._unlocked
        return unlocked.get_secret(secret_id)  # type: ignore[union-attr]

    def set_totp(
        self,
        secret_id: UUID | str,
        totp: TOTPConfig | str,
    ) -> VaultSecret:
        """Add or replace TOTP on a login secret this identity has access to.

        Args:
            secret_id: UUID of the login secret.
            totp: A :class:`~inkbox.vault.totp.TOTPConfig` or an
                ``otpauth://totp/...`` URI string.

        Returns:
            Updated :class:`~inkbox.vault.types.VaultSecret` metadata.
        """
        self._require_vault_unlocked()
        unlocked = self._inkbox._vault_resource._unlocked
        result = unlocked.set_totp(secret_id, totp)  # type: ignore[union-attr]
        self._credentials = None
        return result

    def remove_totp(self, secret_id: UUID | str) -> VaultSecret:
        """Remove TOTP from a login secret this identity has access to.

        Args:
            secret_id: UUID of the login secret.

        Returns:
            Updated :class:`~inkbox.vault.types.VaultSecret` metadata.
        """
        self._require_vault_unlocked()
        unlocked = self._inkbox._vault_resource._unlocked
        result = unlocked.remove_totp(secret_id)  # type: ignore[union-attr]
        self._credentials = None
        return result

    def get_totp_code(self, secret_id: UUID | str) -> TOTPCode:
        """Generate the current TOTP code for a login secret.

        Args:
            secret_id: UUID of the login secret.

        Returns:
            A :class:`~inkbox.vault.totp.TOTPCode`.
        """
        self._require_vault_unlocked()
        unlocked = self._inkbox._vault_resource._unlocked
        return unlocked.get_totp_code(secret_id)  # type: ignore[union-attr]

    def delete_secret(self, secret_id: UUID | str) -> None:
        """Delete a vault secret and revoke this identity's access.

        Args:
            secret_id: UUID of the secret to delete.
        """
        self._require_vault_unlocked()
        unlocked = self._inkbox._vault_resource._unlocked
        unlocked.delete_secret(secret_id)  # type: ignore[union-attr]
        self._credentials = None

    ## Channel management

    def provision_phone_number(
        self, *, type: str = "local", state: str | None = None
    ) -> IdentityPhoneNumber:
        """Provision a new phone number and link it to this identity.

        Args:
            type: Number type to provision. Only ``"local"`` is supported. Defaults to ``"local"``.
            state: US state abbreviation (e.g. ``"NY"``) to request a number in that state.

        Returns:
            The newly provisioned and linked phone number.
        """
        self._inkbox._numbers.provision(agent_handle=self.agent_handle, type=type, state=state)
        data = self._inkbox._ids_resource.get(self.agent_handle)
        self._phone_number = data.phone_number
        self._data = data
        return self._phone_number  # type: ignore[return-value]

    def release_phone_number(self) -> None:
        """Release this identity's phone number (vendor + local)."""
        self._require_phone()
        self._inkbox._ids_resource.release_phone_number(self.agent_handle)
        self._phone_number = None

    ## Identity access / visibility

    def list_access(self) -> list[IdentityAccess]:
        """List who can see this identity.

        See :meth:`IdentitiesResource.list_access`.
        """
        return self._inkbox._ids_resource.list_access(self.agent_handle)

    def grant_access(
        self, viewer_identity_id: UUID | str | None
    ) -> IdentityAccess:
        """Grant visibility on this identity.

        Args:
            viewer_identity_id: UUID of the viewer identity to grant, or
                ``None`` to reset this identity to the org-wide wildcard
                (every active identity in the org sees it).
        """
        return self._inkbox._ids_resource.grant_access(
            self.agent_handle, viewer_identity_id
        )

    def revoke_access(self, viewer_identity_id: UUID | str) -> None:
        """Revoke one viewer's visibility on this identity.

        Args:
            viewer_identity_id: UUID of the viewer identity to drop
                (the viewer identity's UUID, not an access-row id).
        """
        self._inkbox._ids_resource.revoke_access(
            self.agent_handle, viewer_identity_id
        )

    ## Mail helpers

    def send_email(
        self,
        *,
        to: list[str],
        subject: str,
        body_text: str | None = None,
        body_html: str | None = None,
        cc: list[str] | None = None,
        bcc: list[str] | None = None,
        in_reply_to_message_id: str | None = None,
        attachments: list[dict] | None = None,
        track_opens: bool = False,
    ) -> Message:
        """Send an email from this identity's mailbox.

        Args:
            to: Primary recipient addresses (at least one required).
            subject: Email subject line.
            body_text: Plain-text body.
            body_html: HTML body.
            cc: Carbon-copy recipients.
            bcc: Blind carbon-copy recipients.
            in_reply_to_message_id: RFC 5322 Message-ID to thread a reply.
            attachments: List of file attachment dicts with ``filename``,
                ``content_type``, and ``content_base64`` keys. Add ``content_id``
                to render an entry inline in the HTML body (``cid:<content_id>``);
                requires ``body_html`` and an ``image/*`` ``content_type``.
            track_opens: Embed an open-tracking pixel when ``body_html`` is
                present; opens surface as ``first_opened_at``/``open_count``.
        """
        self._require_mailbox()
        return self._inkbox._messages.send(
            self._mailbox.email_address,  # type: ignore[union-attr]
            to=to,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
            cc=cc,
            bcc=bcc,
            in_reply_to_message_id=in_reply_to_message_id,
            attachments=attachments,
            track_opens=track_opens,
        )

    def reply_all_email(
        self,
        message_id: str,
        *,
        subject: str | None = None,
        body_text: str | None = None,
        body_html: str | None = None,
        attachments: list[dict] | None = None,
        reply_to: str | None = None,
    ) -> Message:
        """Reply to everyone on a stored message from this identity's mailbox.

        Args:
            message_id: UUID of the message being replied to.
            subject: Optional subject override.
            body_text: Plain-text reply body.
            body_html: HTML reply body.
            attachments: List of file attachment dicts with ``filename``,
                ``content_type``, and ``content_base64`` keys. Add ``content_id``
                to render an entry inline in the HTML body (``cid:<content_id>``);
                requires ``body_html`` and an ``image/*`` ``content_type``.
            reply_to: Optional Reply-To address.
        """
        self._require_mailbox()
        return self._inkbox._messages.reply_all(
            self._mailbox.email_address,  # type: ignore[union-attr]
            message_id,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
            attachments=attachments,
            reply_to=reply_to,
        )

    def forward_email(
        self,
        message_id: str,
        *,
        to: list[str] | None = None,
        cc: list[str] | None = None,
        bcc: list[str] | None = None,
        mode: ForwardMode | str = ForwardMode.INLINE,
        subject: str | None = None,
        body_text: str | None = None,
        body_html: str | None = None,
        additional_attachments: list[dict] | None = None,
        include_original_attachments: bool = True,
        reply_to: str | None = None,
        track_opens: bool = False,
    ) -> Message:
        """Forward a stored message out from this identity's mailbox.

        Args:
            message_id: UUID of the message being forwarded.
            to: Primary recipient addresses.
            cc: Carbon-copy recipients.
            bcc: Blind carbon-copy recipients.
                At least one address is required across ``to``, ``cc``, and
                ``bcc``.
            mode: ``inline`` (default) or ``wrapped``. See :class:`ForwardMode`.
            subject: Optional override; defaults to ``"Fwd: " + original.subject``.
            body_text: Optional caller note prepended above the original body
                (inline mode) or as a top-level note (wrapped mode).
            body_html: Optional HTML caller note.
            additional_attachments: Optional caller-authored attachments
                alongside the forwarded content. Same shape as
                ``send_email(attachments=...)``.
            include_original_attachments: ``inline`` mode only. When ``True``
                (default), original attachments are re-attached as direct
                outbound parts. Ignored in ``wrapped`` mode.
            reply_to: Optional Reply-To address for the forward's outer
                envelope.
            track_opens: Embed an open-tracking pixel (requires an HTML part
                on the forward); opens surface as
                ``first_opened_at``/``open_count``.
        """
        self._require_mailbox()
        return self._inkbox._messages.forward(
            self._mailbox.email_address,  # type: ignore[union-attr]
            message_id,
            to=to,
            cc=cc,
            bcc=bcc,
            mode=mode,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
            additional_attachments=additional_attachments,
            include_original_attachments=include_original_attachments,
            reply_to=reply_to,
            track_opens=track_opens,
        )

    def iter_emails(
        self,
        *,
        page_size: int = 50,
        direction: MessageDirection | None = None,
        start_datetime: str | None = None,
        end_datetime: str | None = None,
        tz: str | None = None,
    ) -> Iterator[Message]:
        """Iterate over emails in this identity's inbox, newest first.

        Pagination is handled automatically.

        Args:
            page_size: Messages fetched per API call (1-100).
            direction: Filter by direction.
            start_datetime: Inclusive ``created_at`` lower bound (str). Bare dates
                cover the whole day; ``None`` leaves the side open. UTC unless
                ``tz`` is set.
            end_datetime: ``created_at`` upper bound (str), whole-day inclusive for
                bare dates; ``None`` leaves the side open.
            tz: IANA timezone name (str) for zone-less values; ``None`` is UTC.
        """
        self._require_mailbox()
        return self._inkbox._messages.list(
            self._mailbox.email_address,  # type: ignore[union-attr]
            page_size=page_size,
            direction=direction,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            tz=tz,
        )

    def iter_unread_emails(
        self,
        *,
        page_size: int = 50,
        direction: MessageDirection | None = None,
        start_datetime: str | None = None,
        end_datetime: str | None = None,
        tz: str | None = None,
    ) -> Iterator[Message]:
        """Iterate over unread emails in this identity's inbox, newest first.

        Fetches all messages and filters client-side. Pagination is handled
        automatically.

        Args:
            page_size: Messages fetched per API call (1-100).
            direction: Filter by direction.
            start_datetime: Inclusive ``created_at`` lower bound (str); ``None``
                leaves the side open. UTC unless ``tz`` is set.
            end_datetime: ``created_at`` upper bound (str), whole-day inclusive for
                bare dates; ``None`` leaves the side open.
            tz: IANA timezone name (str) for zone-less values; ``None`` is UTC.
        """
        return (
            msg for msg in self.iter_emails(
                page_size=page_size,
                direction=direction,
                start_datetime=start_datetime,
                end_datetime=end_datetime,
                tz=tz,
            ) if not msg.is_read
        )

    def mark_emails_read(self, message_ids: list[str]) -> None:
        """Mark a list of messages as read.

        Args:
            message_ids: IDs of the messages to mark as read.
        """
        self._require_mailbox()
        for mid in message_ids:
            self._inkbox._messages.mark_read(
                self._mailbox.email_address,  # type: ignore[union-attr]
                mid,
            )

    def mark_emails_unread(self, message_ids: list[str]) -> None:
        """Mark a list of messages as unread.

        Args:
            message_ids: IDs of the messages to mark as unread.
        """
        self._require_mailbox()
        for mid in message_ids:
            self._inkbox._messages.mark_unread(
                self._mailbox.email_address,  # type: ignore[union-attr]
                mid,
            )

    def get_message(self, message_id: str) -> MessageDetail:
        """Get a single message with full body content.

        Args:
            message_id: UUID of the message to fetch. Obtain via ``msg.id``
                on any :class:`~inkbox.mail.types.Message`.
        """
        self._require_mailbox()
        return self._inkbox._messages.get(
            self._mailbox.email_address,  # type: ignore[union-attr]
            message_id,
        )

    def get_thread(self, thread_id: str) -> ThreadDetail:
        """Get a thread with all its messages inlined (oldest-first).

        Args:
            thread_id: UUID of the thread to fetch. Obtain via ``msg.thread_id``
                on any :class:`~inkbox.mail.types.Message`.
        """
        self._require_mailbox()
        return self._inkbox._threads.get(
            self._mailbox.email_address,  # type: ignore[union-attr]
            thread_id,
        )

    ## Phone helpers

    def place_call(
        self,
        *,
        to_number: str,
        origination: CallOrigin | str = CallOrigin.DEDICATED_NUMBER,
        client_websocket_url: str | None = None,
    ) -> PhoneCallWithRateLimit:
        """Place an outbound call as this identity.

        For ``dedicated_number`` origination the call rides this identity's
        provisioned phone number (requires one). For
        ``shared_imessage_number`` it rides the shared line and is scoped
        by this identity's id instead.

        Args:
            to_number: E.164 destination number.
            origination: How to place the call. Defaults to
                ``dedicated_number``. See :class:`CallOrigin`.
            client_websocket_url: WebSocket URL (wss://) for audio bridging.
        """
        is_dedicated = (
            origination == CallOrigin.DEDICATED_NUMBER
            or origination == CallOrigin.DEDICATED_NUMBER.value
        )
        if is_dedicated:
            # Dedicated origination needs this identity's own number.
            self._require_phone()
            return self._inkbox._calls.place(
                to_number=to_number,
                origination=origination,
                from_number=self._phone_number.number,  # type: ignore[union-attr]
                client_websocket_url=client_websocket_url,
            )
        # Shared-line origination scopes by identity id, no from_number.
        return self._inkbox._calls.place(
            to_number=to_number,
            origination=origination,
            agent_identity_id=self.id,
            client_websocket_url=client_websocket_url,
        )

    def list_calls(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        is_blocked: bool | None = None,
        start_datetime: str | None = None,
        end_datetime: str | None = None,
        tz: str | None = None,
    ) -> list[PhoneCall]:
        """List calls made to/from this identity.

        Identity-scoped credentials never see contact-rule-blocked rows
        regardless of ``is_blocked`` (server-side access policy).

        Args:
            limit: Maximum number of results (default 50).
            offset: Pagination offset (default 0).
            is_blocked: Tri-state filter — ``True`` for only blocked,
                ``False`` for only non-blocked, ``None`` for all.
            start_datetime: Inclusive ``created_at`` lower bound (str); ``None``
                leaves the side open. UTC unless ``tz`` is set.
            end_datetime: ``created_at`` upper bound (str), whole-day inclusive for
                bare dates; ``None`` leaves the side open.
            tz: IANA timezone name (str) for zone-less values; ``None`` is UTC.
        """
        return self._inkbox._calls.list(
            agent_identity_id=self.id,
            limit=limit,
            offset=offset,
            is_blocked=is_blocked,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            tz=tz,
        )

    def list_transcripts(self, call_id: str) -> list[PhoneTranscript]:
        """List transcript segments for a specific call.

        Args:
            call_id: ID of the call to fetch transcripts for.
        """
        return self._inkbox._calls.transcripts(call_id)

    def hangup_call(self, call_id: str) -> PhoneCall:
        """Hang up one of this identity's live calls, from outside the call.

        Args:
            call_id: ID of the call to hang up.
        """
        return self._inkbox._calls.hangup(call_id)

    def get_incoming_call_action(self) -> IncomingCallActionConfig:
        """Get this identity's inbound-call handling config."""
        return self._inkbox._incoming_call_action.get(agent_identity_id=self.id)

    def set_incoming_call_action(
        self,
        *,
        incoming_call_action: IncomingCallAction | str,
        client_websocket_url: str | None = None,
        incoming_call_webhook_url: str | None = None,
    ) -> IncomingCallActionConfig:
        """Set this identity's inbound-call handling config.

        Args:
            incoming_call_action: Behaviour to apply. See
                :class:`IncomingCallAction`.
            client_websocket_url: WebSocket URL (wss://) for audio bridging.
            incoming_call_webhook_url: HTTPS receiver for the
                ``webhook`` action.
        """
        return self._inkbox._incoming_call_action.set(
            incoming_call_action=incoming_call_action,
            agent_identity_id=self.id,
            client_websocket_url=client_websocket_url,
            incoming_call_webhook_url=incoming_call_webhook_url,
        )

    ## Text message helpers

    def send_text(
        self,
        *,
        to: str | list[str] | None = None,
        conversation_id: UUID | str | None = None,
        text: str | None = None,
        media_urls: list[str] | None = None,
    ) -> TextMessage:
        """Send an outbound SMS/MMS from this identity's phone number.

        Args:
            to: E.164 destination number, or a list of numbers for a group send.
                Mutually exclusive with ``conversation_id``.
            conversation_id: Existing conversation UUID to reply into. The
                server resolves it to that conversation's participants.
            text: Message body.
            media_urls: MMS media URLs. Pass with ``text`` or by themselves.

        Returns:
            The queued ``TextMessage``. The full outbound lifecycle
            (``text.sent`` -> ``text.delivered`` / ``text.delivery_failed``
            / ``text.delivery_unconfirmed``) arrives via webhook
            subscriptions on the sender's phone number, not the return
            value
            (``inkbox.webhooks.subscriptions.create(phone_number_id=...,
            url=..., event_types=[...])``). See ``TextWebhookEventType``
            and ``TextWebhookPayload`` for the typed receiver-side
            shapes.

        Raises:
            InkboxError: when this identity has no phone number.
            RecipientBlockedError: when the destination is blocked by an
                outbound contact rule.
            InkboxAPIError: for other send failures.
        """
        self._require_phone()
        send_kwargs: dict[str, Any] = {}
        if to is not None:
            send_kwargs["to"] = to
        if conversation_id is not None:
            send_kwargs["conversation_id"] = conversation_id
        if text is not None:
            send_kwargs["text"] = text
        if media_urls is not None:
            send_kwargs["media_urls"] = media_urls
        return self._inkbox._texts.send(
            self._phone_number.id,  # type: ignore[union-attr]
            **send_kwargs,
        )

    def list_texts(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        is_read: bool | None = None,
        is_blocked: bool | None = None,
        start_datetime: str | None = None,
        end_datetime: str | None = None,
        tz: str | None = None,
    ) -> list[TextMessage]:
        """List text messages for this identity's phone number.

        Identity-scoped credentials never see contact-rule-blocked rows
        regardless of ``is_blocked`` (server-side access policy).

        Args:
            limit: Maximum number of results (default 50).
            offset: Pagination offset (default 0).
            is_read: Filter by read state (``True``, ``False``, or ``None`` for all).
            is_blocked: Tri-state filter — ``True`` for only blocked,
                ``False`` for only non-blocked, ``None`` for all.
            start_datetime: Inclusive ``created_at`` lower bound (str); ``None``
                leaves the side open. UTC unless ``tz`` is set.
            end_datetime: ``created_at`` upper bound (str), whole-day inclusive for
                bare dates; ``None`` leaves the side open.
            tz: IANA timezone name (str) for zone-less values; ``None`` is UTC.
        """
        self._require_phone()
        return self._inkbox._texts.list(
            self._phone_number.id,  # type: ignore[union-attr]
            limit=limit,
            offset=offset,
            is_read=is_read,
            is_blocked=is_blocked,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            tz=tz,
        )

    def get_text(self, text_id: str) -> TextMessage:
        """Get a single text message by ID.

        Args:
            text_id: UUID of the text message to fetch.
        """
        self._require_phone()
        return self._inkbox._texts.get(
            self._phone_number.id,  # type: ignore[union-attr]
            text_id,
        )

    def list_text_conversations(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        is_blocked: bool | None = None,
        include_groups: bool = False,
        start_datetime: str | None = None,
        end_datetime: str | None = None,
        tz: str | None = None,
    ) -> list[TextConversationSummary]:
        """List text conversations.

        Identity-scoped credentials never see blocked rows in
        conversation summaries; admin/JWT can use ``is_blocked=False``
        to hide spam-only counterparties or ``is_blocked=True`` to
        narrow to conversations made up of blocked rows.

        Args:
            limit: Maximum number of results (default 50).
            offset: Pagination offset (default 0).
            is_blocked: Tri-state filter — ``True`` for only blocked,
                ``False`` for only non-blocked, ``None`` for all.
            include_groups: Include group conversations. Defaults to
                ``False`` so old clients continue to see one-to-one rows only.
            start_datetime: Inclusive ``created_at`` lower bound (str); ``None``
                leaves the side open. UTC unless ``tz`` is set.
            end_datetime: ``created_at`` upper bound (str), whole-day inclusive for
                bare dates; ``None`` leaves the side open.
            tz: IANA timezone name (str) for zone-less values; ``None`` is UTC.
        """
        self._require_phone()
        return self._inkbox._texts.list_conversations(
            self._phone_number.id,  # type: ignore[union-attr]
            limit=limit,
            offset=offset,
            is_blocked=is_blocked,
            include_groups=include_groups,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            tz=tz,
        )

    def get_text_conversation(
        self, remote_number: UUID | str, *, limit: int = 50, offset: int = 0
    ) -> list[TextMessage]:
        """Get all messages in a conversation.

        Args:
            remote_number: E.164 one-to-one remote number, or conversation UUID.
            limit: Maximum number of results (default 50).
            offset: Pagination offset (default 0).
        """
        self._require_phone()
        return self._inkbox._texts.get_conversation(
            self._phone_number.id,  # type: ignore[union-attr]
            remote_number,
            limit=limit,
            offset=offset,
        )

    def mark_text_read(self, text_id: str) -> TextMessage:
        """Mark a single text message as read.

        Args:
            text_id: UUID of the text message.
        """
        self._require_phone()
        return self._inkbox._texts.update(
            self._phone_number.id,  # type: ignore[union-attr]
            text_id,
            is_read=True,
        )

    def mark_text_conversation_read(
        self, remote_number: UUID | str
    ) -> TextConversationUpdateResult:
        """Mark all messages in a conversation as read.

        Args:
            remote_number: E.164 one-to-one remote number, or conversation UUID.

        Returns:
            ``TextConversationUpdateResult`` with ``conversation_id``,
            ``remote_phone_number``, ``is_read``, and ``updated_count``.
        """
        self._require_phone()
        return self._inkbox._texts.update_conversation(
            self._phone_number.id,  # type: ignore[union-attr]
            remote_number,
            is_read=True,
        )

    ## iMessage helpers

    def send_imessage(
        self,
        *,
        to: str | None = None,
        conversation_id: UUID | str | None = None,
        text: str | None = None,
        media_urls: list[str] | None = None,
        send_style: IMessageSendStyle | str | None = None,
    ) -> IMessage:
        """Send an outbound iMessage as this identity.

        Sends only work toward recipients that triage has already
        connected to this identity over the shared iMessage service —
        there is no cold outreach.

        Args:
            to: E.164 recipient number. Mutually exclusive with
                ``conversation_id``.
            conversation_id: Existing conversation UUID to reply into.
            text: Message body.
            media_urls: Media URLs (at most one). Use
                :meth:`upload_imessage_media` to create one from bytes.
            send_style: Optional expressive send style
                (see ``IMessageSendStyle``).

        Raises:
            InkboxError: when this identity is not iMessage-enabled.
            InkboxAPIError: 403 when the recipient is blocked by a
                contact rule; other send failures.
        """
        self._require_imessage()
        return self._inkbox._imessages.send(
            to=to,
            conversation_id=conversation_id,
            text=text,
            media_urls=media_urls,
            send_style=send_style,
            agent_identity_id=self.id,
        )

    def list_imessages(
        self,
        *,
        conversation_id: UUID | str | None = None,
        limit: int = 50,
        offset: int = 0,
        is_read: bool | None = None,
        is_blocked: bool | None = None,
        start_datetime: str | None = None,
        end_datetime: str | None = None,
        tz: str | None = None,
    ) -> list[IMessage]:
        """List this identity's iMessages, newest first.

        Identity-scoped credentials never see contact-rule-blocked rows
        regardless of ``is_blocked`` (server-side access policy).

        Args:
            conversation_id: Narrow to one conversation.
            limit: Maximum number of results (default 50).
            offset: Pagination offset (default 0).
            is_read: Filter by read state (``True``, ``False``, or ``None`` for all).
            is_blocked: Tri-state filter — ``True`` for only blocked,
                ``False`` for only non-blocked, ``None`` for all.
            start_datetime: Inclusive ``created_at`` lower bound (str); ``None``
                leaves the side open. UTC unless ``tz`` is set.
            end_datetime: ``created_at`` upper bound (str), whole-day inclusive for
                bare dates; ``None`` leaves the side open.
            tz: IANA timezone name (str) for zone-less values; ``None`` is UTC.
        """
        self._require_imessage()
        return self._inkbox._imessages.list(
            agent_identity_id=self.id,
            conversation_id=conversation_id,
            limit=limit,
            offset=offset,
            is_read=is_read,
            is_blocked=is_blocked,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            tz=tz,
        )

    def list_imessage_assignments(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> list[IMessageAssignment]:
        """List recipients actively connected to this identity, newest first.

        Args:
            limit: Maximum number of results (default 50).
            offset: Pagination offset (default 0).
        """
        self._require_imessage()
        return self._inkbox._imessages.list_assignments(
            agent_identity_id=self.id,
            limit=limit,
            offset=offset,
        )

    def list_imessage_conversations(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        is_blocked: bool | None = None,
        start_datetime: str | None = None,
        end_datetime: str | None = None,
        tz: str | None = None,
    ) -> list[IMessageConversationSummary]:
        """List this identity's iMessage conversations.

        Args:
            limit: Maximum number of results (default 50).
            offset: Pagination offset (default 0).
            is_blocked: Tri-state filter applied to the underlying
                messages — ``True`` for only blocked, ``False`` for only
                non-blocked, ``None`` for all.
            start_datetime: Inclusive ``created_at`` lower bound (str); ``None``
                leaves the side open. UTC unless ``tz`` is set.
            end_datetime: ``created_at`` upper bound (str), whole-day inclusive for
                bare dates; ``None`` leaves the side open.
            tz: IANA timezone name (str) for zone-less values; ``None`` is UTC.
        """
        self._require_imessage()
        return self._inkbox._imessages.list_conversations(
            agent_identity_id=self.id,
            limit=limit,
            offset=offset,
            is_blocked=is_blocked,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            tz=tz,
        )

    def get_imessage_conversation(
        self, conversation_id: UUID | str
    ) -> IMessageConversation:
        """Get one of this identity's iMessage conversations by ID.

        Args:
            conversation_id: UUID of the conversation.
        """
        self._require_imessage()
        return self._inkbox._imessages.get_conversation(
            conversation_id,
            agent_identity_id=self.id,
        )

    def send_imessage_reaction(
        self,
        *,
        message_id: UUID | str,
        reaction: IMessageReactionType | str,
        part_index: int = 0,
    ) -> IMessageReaction:
        """Send a tapback reaction to a message in one of this
        identity's conversations.

        Args:
            message_id: UUID of the message being reacted to.
            reaction: Tapback kind (see ``IMessageReactionType``).
            part_index: Part of a multi-part message to react to.
        """
        self._require_imessage()
        return self._inkbox._imessages.send_reaction(
            message_id=message_id,
            reaction=reaction,
            part_index=part_index,
        )

    def mark_imessage_conversation_read(
        self, conversation_id: UUID | str
    ) -> IMessageMarkReadResult:
        """Send a read receipt and mark a conversation's inbound
        messages read.

        Args:
            conversation_id: UUID of the conversation.
        """
        self._require_imessage()
        return self._inkbox._imessages.mark_conversation_read(conversation_id)

    def send_imessage_typing(self, conversation_id: UUID | str) -> None:
        """Show a typing indicator to a conversation's recipient.

        Args:
            conversation_id: UUID of the conversation.
        """
        self._require_imessage()
        self._inkbox._imessages.send_typing(conversation_id)

    def upload_imessage_media(
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
            content_type: Optional MIME type.
        """
        self._require_imessage()
        return self._inkbox._imessages.upload_media(
            content=content,
            filename=filename,
            content_type=content_type,
        )

    ## Mail contact rules

    def list_mail_contact_rules(
        self,
        *,
        action: MailRuleAction | str | None = None,
        match_type: MailRuleMatchType | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[MailIdentityContactRule]:
        """List this identity's mail allow/block rules, newest first."""
        return self._inkbox._mail_identity_contact_rules.list(
            self.agent_handle,
            action=action,
            match_type=match_type,
            limit=limit,
            offset=offset,
        )

    def get_mail_contact_rule(self, rule_id: UUID | str) -> MailIdentityContactRule:
        """Get one of this identity's mail contact rules by id."""
        return self._inkbox._mail_identity_contact_rules.get(self.agent_handle, rule_id)

    def create_mail_contact_rule(
        self,
        *,
        action: MailRuleAction | str,
        match_type: MailRuleMatchType | str,
        match_target: str,
    ) -> MailIdentityContactRule:
        """Create a mail allow/block rule for this identity."""
        return self._inkbox._mail_identity_contact_rules.create(
            self.agent_handle,
            action=action,
            match_type=match_type,
            match_target=match_target,
        )

    def update_mail_contact_rule(
        self,
        rule_id: UUID | str,
        *,
        action: MailRuleAction | str = _UNSET,  # type: ignore[assignment]
        status: ContactRuleStatus | str = _UNSET,  # type: ignore[assignment]
    ) -> MailIdentityContactRule:
        """Update a mail rule's ``action`` or ``status`` (admin-only)."""
        kwargs: dict[str, Any] = {}
        if action is not _UNSET:
            kwargs["action"] = action
        if status is not _UNSET:
            kwargs["status"] = status
        return self._inkbox._mail_identity_contact_rules.update(
            self.agent_handle, rule_id, **kwargs,
        )

    def delete_mail_contact_rule(self, rule_id: UUID | str) -> None:
        """Delete one of this identity's mail contact rules (admin-only)."""
        self._inkbox._mail_identity_contact_rules.delete(self.agent_handle, rule_id)

    ## Phone contact rules

    def list_phone_contact_rules(
        self,
        *,
        action: PhoneRuleAction | str | None = None,
        match_type: PhoneRuleMatchType | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[PhoneIdentityContactRule]:
        """List this identity's phone allow/block rules, newest first.

        Returns ``[]`` for a phoneless identity; the server requires a phone
        only for create/get/update/delete, not for list.
        """
        return self._inkbox._phone_identity_contact_rules.list(
            self.agent_handle,
            action=action,
            match_type=match_type,
            limit=limit,
            offset=offset,
        )

    def get_phone_contact_rule(self, rule_id: UUID | str) -> PhoneIdentityContactRule:
        """Get one of this identity's phone contact rules by id."""
        self._require_phone()
        return self._inkbox._phone_identity_contact_rules.get(self.agent_handle, rule_id)

    def create_phone_contact_rule(
        self,
        *,
        action: PhoneRuleAction | str,
        match_target: str,
        match_type: PhoneRuleMatchType | str = PhoneRuleMatchType.EXACT_NUMBER,
    ) -> PhoneIdentityContactRule:
        """Create a phone allow/block rule for this identity.

        Raises ``InkboxError`` if this identity has no phone number.
        """
        self._require_phone()
        return self._inkbox._phone_identity_contact_rules.create(
            self.agent_handle,
            action=action,
            match_target=match_target,
            match_type=match_type,
        )

    def update_phone_contact_rule(
        self,
        rule_id: UUID | str,
        *,
        action: PhoneRuleAction | str = _UNSET,  # type: ignore[assignment]
        status: ContactRuleStatus | str = _UNSET,  # type: ignore[assignment]
    ) -> PhoneIdentityContactRule:
        """Update a phone rule's ``action`` or ``status`` (admin-only)."""
        self._require_phone()
        kwargs: dict[str, Any] = {}
        if action is not _UNSET:
            kwargs["action"] = action
        if status is not _UNSET:
            kwargs["status"] = status
        return self._inkbox._phone_identity_contact_rules.update(
            self.agent_handle, rule_id, **kwargs,
        )

    def delete_phone_contact_rule(self, rule_id: UUID | str) -> None:
        """Delete one of this identity's phone contact rules (admin-only)."""
        self._require_phone()
        self._inkbox._phone_identity_contact_rules.delete(self.agent_handle, rule_id)

    ## Signing key

    def get_signing_key_status(self) -> SigningKeyStatus:
        """Report whether this identity has a webhook signing key."""
        return self._inkbox._signing_keys.get_status(self.agent_handle)

    def create_signing_key(self) -> SigningKey:
        """Create or rotate this identity's webhook signing key.

        The plaintext ``signing_key`` is returned **once** — store it
        securely, it cannot be retrieved again.
        """
        return self._inkbox._signing_keys.create_or_rotate(self.agent_handle)

    ## Identity management

    def update(
        self,
        *,
        new_handle: str | None = None,
        display_name: Any = _UNSET,
        description: Any = _UNSET,
        imessage_enabled: bool | None = None,
        imessage_filter_mode: FilterMode | str | None = None,
        mail_filter_mode: FilterMode | str | None = None,
        phone_filter_mode: FilterMode | str | None = None,
        status: str | None = None,
    ) -> None:
        """Update this identity's handle, display name, description,
        iMessage reachability, contact-rule filter modes, and/or status.

        Only provided fields are applied; omitted fields are left
        unchanged. For ``display_name`` and ``description``, explicit
        ``None`` clears the column; omitting the keyword argument leaves
        it untouched.

        Args:
            new_handle: New agent handle.
            display_name: New display name, or ``None`` to clear.
            description: New description, or ``None`` to clear.
            imessage_enabled: Toggle shared-iMessage reachability.
            imessage_filter_mode: ``"whitelist"`` or ``"blacklist"`` for
                iMessage contact rules (admin-only).
            mail_filter_mode: ``"whitelist"`` or ``"blacklist"`` for this
                identity's mail contact rules (admin-only). Note: unlike the
                deprecated ``mailboxes.update(filter_mode=...)``, this does
                not return a ``FilterModeChangeNotice``.
            phone_filter_mode: ``"whitelist"`` or ``"blacklist"`` for this
                identity's phone contact rules (admin-only). Rejected with a
                422 when the identity has no phone number.
            status: ``"active"`` or ``"paused"``. Call :meth:`delete`
                to remove the identity; ``"deleted"`` is rejected here.
        """
        update_kwargs: dict[str, Any] = {}
        if new_handle is not None:
            update_kwargs["new_handle"] = new_handle
        if display_name is not _UNSET:
            update_kwargs["display_name"] = display_name
        if description is not _UNSET:
            update_kwargs["description"] = description
        if imessage_enabled is not None:
            update_kwargs["imessage_enabled"] = imessage_enabled
        if imessage_filter_mode is not None:
            update_kwargs["imessage_filter_mode"] = (
                imessage_filter_mode.value
                if isinstance(imessage_filter_mode, FilterMode)
                else imessage_filter_mode
            )
        if mail_filter_mode is not None:
            update_kwargs["mail_filter_mode"] = (
                mail_filter_mode.value
                if isinstance(mail_filter_mode, FilterMode)
                else mail_filter_mode
            )
        if phone_filter_mode is not None:
            update_kwargs["phone_filter_mode"] = (
                phone_filter_mode.value
                if isinstance(phone_filter_mode, FilterMode)
                else phone_filter_mode
            )
        if status is not None:
            update_kwargs["status"] = status
        result = self._inkbox._ids_resource.update(
            self.agent_handle, **update_kwargs,
        )
        self._data = _AgentIdentityData(
            id=result.id,
            organization_id=result.organization_id,
            agent_handle=result.agent_handle,
            display_name=result.display_name,
            description=result.description,
            email_address=result.email_address,
            created_at=result.created_at,
            updated_at=result.updated_at,
            imessage_enabled=result.imessage_enabled,
            imessage_filter_mode=result.imessage_filter_mode,
            mail_filter_mode=result.mail_filter_mode,
            phone_filter_mode=result.phone_filter_mode,
            mailbox=self._mailbox,
            phone_number=self._phone_number,
            tunnel=self._tunnel,
        )
        if new_handle is not None and self._tunnel is not None:
            # The server renames the linked tunnel in the same transaction
            # under the unified handle namespace; refresh to pick up the
            # new tunnel_name / public_host on the cached tunnel.
            self.refresh()

    def refresh(self) -> AgentIdentity:
        """Re-fetch this identity from the API and update cached channels.

        Also clears the credentials filter cache so the next access to
        :attr:`credentials` re-evaluates access rules.  (The cache is
        also automatically invalidated when the vault is re-unlocked.)

        Returns:
            ``self`` for chaining.
        """
        data = self._inkbox._ids_resource.get(self.agent_handle)
        self._data = data
        self._mailbox = data.mailbox
        self._phone_number = data.phone_number
        self._tunnel = data.tunnel
        self._credentials = None
        return self

    def delete(self) -> None:
        """Delete this identity.

        Cascades: flips the linked mailbox to ``deleted``, force-finalizes
        the linked tunnel to ``deleted``, revokes any identity-scoped
        API keys, and releases any linked phone number (vendor + local).
        """
        self._inkbox._ids_resource.delete(self.agent_handle)

    ## Internal guards

    def _require_mailbox(self) -> None:
        if not self._mailbox:
            raise InkboxError(
                f"Identity '{self.agent_handle}' has no mailbox — "
                "this should only be reachable on a deleted identity."
            )

    def _require_phone(self) -> None:
        if not self._phone_number:
            raise InkboxError(
                f"Identity '{self.agent_handle}' has no phone number assigned. "
                "Call identity.provision_phone_number() first, or pass phone_number to create_identity()."
            )

    def _require_imessage(self) -> None:
        if not self._data.imessage_enabled:
            raise InkboxError(
                f"Identity '{self.agent_handle}' is not iMessage-enabled. "
                "Call identity.update(imessage_enabled=True) first, or pass "
                "imessage_enabled=True to create_identity()."
            )

    def _require_vault_unlocked(self) -> None:
        if self._inkbox._vault_resource._unlocked is None:
            raise InkboxError(
                "Vault must be unlocked before accessing credentials. "
                "Call inkbox.vault.unlock(vault_key) first."
            )

    def __repr__(self) -> str:
        return (
            f"AgentIdentity(agent_handle={self.agent_handle!r}, "
            f"mailbox={self._mailbox.email_address if self._mailbox else None!r}, "
            f"phone={self._phone_number.number if self._phone_number else None!r})"
        )
