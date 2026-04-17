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
    _AgentIdentityData,
    IdentityMailbox,
    IdentityPhoneNumber,
)
from inkbox.exceptions import InkboxError
from inkbox.mail.types import Message, MessageDetail, MessageDirection, ThreadDetail
from inkbox.phone.types import (
    PhoneCall,
    PhoneCallWithRateLimit,
    PhoneTranscript,
    TextConversationSummary,
    TextMessage,
)
from inkbox.wallet.types import (
    AgentWallet,
    AgentWalletBalance,
    WalletAuthSignature,
    WalletPayRequestResponse,
    WalletTransaction,
    WalletTransactionReceipt,
)

if TYPE_CHECKING:
    from inkbox.client import Inkbox


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
        self._wallet: AgentWallet | None = data.wallet
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
    def email_address(self) -> str | None:
        """The email address assigned to this identity at creation time.

        Always trust this value — do not derive it from ``agent_handle``.
        """
        return self._data.email_address

    @property
    def mailbox(self) -> IdentityMailbox | None:
        return self._mailbox

    @property
    def phone_number(self) -> IdentityPhoneNumber | None:
        return self._phone_number

    @property
    def wallet(self) -> AgentWallet | None:
        return self._wallet

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

    def create_mailbox(
        self,
        *,
        display_name: str | None = None,
        email_local_part: str | None = None,
    ) -> IdentityMailbox:
        """Create a new mailbox and link it to this identity."""
        mailbox = self._inkbox._mailboxes.create(
            agent_handle=self.agent_handle,
            display_name=display_name,
            email_local_part=email_local_part,
        )
        linked = IdentityMailbox(
            id=mailbox.id,
            email_address=mailbox.email_address,
            display_name=mailbox.display_name,
            created_at=mailbox.created_at,
            updated_at=mailbox.updated_at,
        )
        self._mailbox = linked
        self._data.email_address = mailbox.email_address
        return linked

    def assign_mailbox(self, mailbox_id: str) -> IdentityMailbox:
        """Link an existing mailbox to this identity.

        Args:
            mailbox_id: UUID of the mailbox to link. Obtain via
                ``inkbox.mailboxes.list()`` or ``inkbox.mailboxes.get()``.

        Returns:
            The linked mailbox.
        """
        data = self._inkbox._ids_resource.assign_mailbox(
            self.agent_handle, mailbox_id=mailbox_id
        )
        self._mailbox = data.mailbox
        self._data = data
        return self._mailbox  # type: ignore[return-value]

    def unlink_mailbox(self) -> None:
        """Unlink this identity's mailbox (does not delete the mailbox)."""
        self._require_mailbox()
        self._inkbox._ids_resource.unlink_mailbox(self.agent_handle)
        self._mailbox = None

    def provision_phone_number(
        self, *, type: str = "toll_free", state: str | None = None
    ) -> IdentityPhoneNumber:
        """Provision a new phone number and link it to this identity.

        Args:
            type: ``"toll_free"`` (default) or ``"local"``.
            state: US state abbreviation (e.g. ``"NY"``), valid for local numbers only.

        Returns:
            The newly provisioned and linked phone number.
        """
        self._inkbox._numbers.provision(agent_handle=self.agent_handle, type=type, state=state)
        data = self._inkbox._ids_resource.get(self.agent_handle)
        self._phone_number = data.phone_number
        self._data = data
        return self._phone_number  # type: ignore[return-value]

    def assign_phone_number(self, phone_number_id: str) -> IdentityPhoneNumber:
        """Link an existing phone number to this identity.

        Args:
            phone_number_id: UUID of the phone number to link. Obtain via
                ``inkbox.phone_numbers.list()`` or ``inkbox.phone_numbers.get()``.

        Returns:
            The linked phone number.
        """
        data = self._inkbox._ids_resource.assign_phone_number(
            self.agent_handle, phone_number_id=phone_number_id
        )
        self._phone_number = data.phone_number
        self._data = data
        return self._phone_number  # type: ignore[return-value]

    def unlink_phone_number(self) -> None:
        """Unlink this identity's phone number (does not release the number)."""
        self._require_phone()
        self._inkbox._ids_resource.unlink_phone_number(self.agent_handle)
        self._phone_number = None

    def create_wallet(self, *, chains: list[str] | None = None) -> AgentWallet:
        """Create a new custodial wallet and link it to this identity."""
        wallet = self._inkbox._wallets.create(
            agent_handle=self.agent_handle,
            chains=chains,
        )
        self._wallet = wallet
        self._data.wallet = wallet
        self._data.wallet_id = wallet.id
        return wallet

    def get_wallet_balance(self) -> AgentWalletBalance:
        """Fetch live on-chain balances for this identity's wallet."""
        self._require_wallet()
        return self._inkbox._wallets.get_balance(self._wallet.id)  # type: ignore[union-attr]

    def send_wallet(
        self,
        *,
        chain: str,
        to_address: str,
        token: str,
        amount: str,
        memo: str | None = None,
        idempotency_key: str | None = None,
    ) -> WalletTransaction:
        """Broadcast an outbound transaction from this identity's wallet."""
        self._require_wallet()
        return self._inkbox._wallets.send(
            self._wallet.id,  # type: ignore[union-attr]
            chain=chain,
            to_address=to_address,
            token=token,
            amount=amount,
            memo=memo,
            idempotency_key=idempotency_key,
        )

    def sign_wallet_auth(self, message: str) -> WalletAuthSignature:
        """Sign a SIWE-style authentication challenge with this identity's wallet."""
        self._require_wallet()
        return self._inkbox._wallets.sign_auth(
            self._wallet.id,  # type: ignore[union-attr]
            message=message,
        )

    def list_wallet_transactions(
        self,
        *,
        chain: str | None = None,
        status: str | None = None,
        limit: int | None = None,
    ) -> list[WalletTransaction]:
        """List server-side wallet transactions for this identity."""
        self._require_wallet()
        return self._inkbox._wallets.list_transactions(
            self._wallet.id,  # type: ignore[union-attr]
            chain=chain,
            status=status,
            limit=limit,
        )

    def get_wallet_transaction_receipt(
        self,
        transaction_id: UUID | str,
    ) -> WalletTransactionReceipt:
        """Fetch one wallet transaction receipt for this identity."""
        self._require_wallet()
        return self._inkbox._wallets.get_transaction_receipt(
            self._wallet.id,  # type: ignore[union-attr]
            transaction_id,
        )

    def pay_with_wallet(
        self,
        *,
        url: str,
        method: str | None = None,
        headers: dict[str, str] | None = None,
        body_base64: str | None = None,
        max_cost: str | int | float | None = None,
    ) -> WalletPayRequestResponse:
        """Make an HTTP request and automatically pay any supported 402 challenge."""
        self._require_wallet()
        return self._inkbox._wallets.pay_request(
            self._wallet.id,  # type: ignore[union-attr]
            url=url,
            method=method,
            headers=headers,
            body_base64=body_base64,
            max_cost=max_cost,
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
                ``content_type``, and ``content_base64`` keys.
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
        )

    def iter_emails(
        self,
        *,
        page_size: int = 50,
        direction: MessageDirection | None = None,
    ) -> Iterator[Message]:
        """Iterate over emails in this identity's inbox, newest first.

        Pagination is handled automatically.

        Args:
            page_size: Messages fetched per API call (1-100).
            direction: Filter by direction.
        """
        self._require_mailbox()
        return self._inkbox._messages.list(
            self._mailbox.email_address,  # type: ignore[union-attr]
            page_size=page_size,
            direction=direction,
        )

    def iter_unread_emails(
        self,
        *,
        page_size: int = 50,
        direction: MessageDirection | None = None,
    ) -> Iterator[Message]:
        """Iterate over unread emails in this identity's inbox, newest first.

        Fetches all messages and filters client-side. Pagination is handled
        automatically.

        Args:
            page_size: Messages fetched per API call (1-100).
            direction: Filter by direction.
        """
        return (
            msg for msg in self.iter_emails(
                page_size=page_size,
                direction=direction,
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
        client_websocket_url: str | None = None,
    ) -> PhoneCallWithRateLimit:
        """Place an outbound call from this identity's phone number.

        Args:
            to_number: E.164 destination number.
            client_websocket_url: WebSocket URL (wss://) for audio bridging.
        """
        self._require_phone()
        return self._inkbox._calls.place(
            from_number=self._phone_number.number,  # type: ignore[union-attr]
            to_number=to_number,
            client_websocket_url=client_websocket_url,
        )

    def list_calls(self, *, limit: int = 50, offset: int = 0) -> list[PhoneCall]:
        """List calls made to/from this identity's phone number.

        Args:
            limit: Maximum number of results (default 50).
            offset: Pagination offset (default 0).
        """
        self._require_phone()
        return self._inkbox._calls.list(
            self._phone_number.id,  # type: ignore[union-attr]
            limit=limit,
            offset=offset,
        )

    def list_transcripts(self, call_id: str) -> list[PhoneTranscript]:
        """List transcript segments for a specific call.

        Args:
            call_id: ID of the call to fetch transcripts for.
        """
        self._require_phone()
        return self._inkbox._transcripts.list(
            self._phone_number.id,  # type: ignore[union-attr]
            call_id,
        )

    ## Text message helpers

    def list_texts(
        self, *, limit: int = 50, offset: int = 0, is_read: bool | None = None
    ) -> list[TextMessage]:
        """List text messages for this identity's phone number.

        Args:
            limit: Maximum number of results (default 50).
            offset: Pagination offset (default 0).
            is_read: Filter by read state (``True``, ``False``, or ``None`` for all).
        """
        self._require_phone()
        return self._inkbox._texts.list(
            self._phone_number.id,  # type: ignore[union-attr]
            limit=limit,
            offset=offset,
            is_read=is_read,
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
        self, *, limit: int = 50, offset: int = 0
    ) -> list[TextConversationSummary]:
        """List text conversations (one row per remote number).

        Args:
            limit: Maximum number of results (default 50).
            offset: Pagination offset (default 0).
        """
        self._require_phone()
        return self._inkbox._texts.list_conversations(
            self._phone_number.id,  # type: ignore[union-attr]
            limit=limit,
            offset=offset,
        )

    def get_text_conversation(
        self, remote_number: str, *, limit: int = 50, offset: int = 0
    ) -> list[TextMessage]:
        """Get all messages with a specific remote number.

        Args:
            remote_number: E.164 remote phone number.
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
        self, remote_number: str
    ) -> dict[str, Any]:
        """Mark all messages in a conversation as read.

        Args:
            remote_number: E.164 remote phone number.

        Returns:
            Dict with ``remote_phone_number``, ``is_read``, and ``updated_count``.
        """
        self._require_phone()
        return self._inkbox._texts.update_conversation(
            self._phone_number.id,  # type: ignore[union-attr]
            remote_number,
            is_read=True,
        )

    ## Identity management

    def update(
        self,
        *,
        new_handle: str | None = None,
    ) -> None:
        """Update this identity's handle.

        Args:
            new_handle: New agent handle.
        """
        result = self._inkbox._ids_resource.update(
            self.agent_handle, new_handle=new_handle
        )
        self._data = _AgentIdentityData(
            id=result.id,
            organization_id=result.organization_id,
            agent_handle=result.agent_handle,
            email_address=result.email_address,
            wallet_id=result.wallet_id,
            created_at=result.created_at,
            updated_at=result.updated_at,
            mailbox=self._mailbox,
            phone_number=self._phone_number,
            wallet=self._wallet,
        )

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
        self._wallet = data.wallet
        self._credentials = None
        return self

    def delete(self) -> None:
        """Delete this identity (unlinks channels without deleting them)."""
        self._inkbox._ids_resource.delete(self.agent_handle)

    ## Internal guards

    def _require_mailbox(self) -> None:
        if not self._mailbox:
            raise InkboxError(
                f"Identity '{self.agent_handle}' has no mailbox assigned. "
                "Call identity.create_mailbox() or identity.assign_mailbox() first."
            )

    def _require_phone(self) -> None:
        if not self._phone_number:
            raise InkboxError(
                f"Identity '{self.agent_handle}' has no phone number assigned. "
                "Call identity.provision_phone_number() or identity.assign_phone_number() first."
            )

    def _require_wallet(self) -> None:
        if not self._wallet:
            raise InkboxError(
                f"Identity '{self.agent_handle}' has no wallet assigned. "
                "Call identity.create_wallet() first."
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
            f"phone={self._phone_number.number if self._phone_number else None!r}, "
            f"wallet={str(self._wallet.id) if self._wallet else None!r})"
        )
