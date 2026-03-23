"""
inkbox/agent_identity.py

AgentIdentity: a domain object representing one agent identity.
Returned by inkbox.create_identity() and inkbox.get_identity().

Convenience methods (send_email, place_call, etc.) are scoped to this
agent's assigned channels so callers never need to pass an email address
or phone number ID explicitly.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Iterator

from inkbox.authenticator.types import AuthenticatorAccount, AuthenticatorApp, OTPCode
from inkbox.credentials import Credentials
from inkbox.identities.types import (
    _AgentIdentityData,
    IdentityAuthenticatorApp,
    IdentityMailbox,
    IdentityPhoneNumber,
)
from inkbox.exceptions import InkboxError
from inkbox.mail.types import Message, MessageDetail, ThreadDetail
from inkbox.phone.types import PhoneCall, PhoneCallWithRateLimit, PhoneTranscript

if TYPE_CHECKING:
    from inkbox.client import Inkbox


class AgentIdentity:
    """An agent identity with convenience methods for its assigned channels.

    Obtain an instance via::

        identity = inkbox.create_identity("support-bot")
        # or
        identity = inkbox.get_identity("support-bot")

    After assigning channels you can communicate directly::

        identity.create_mailbox(display_name="Support Bot")
        identity.provision_phone_number(type="toll_free")

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
        self._authenticator_app: IdentityAuthenticatorApp | None = data.authenticator_app
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
    def status(self) -> str:
        return self._data.status

    @property
    def mailbox(self) -> IdentityMailbox | None:
        return self._mailbox

    @property
    def phone_number(self) -> IdentityPhoneNumber | None:
        return self._phone_number

    @property
    def authenticator_app(self) -> IdentityAuthenticatorApp | None:
        return self._authenticator_app

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
        # Filter secrets by identity access rules (same logic as
        # VaultResource.unlock with identity_id).
        id_str = str(self.id)
        filtered = []
        for secret in unlocked.secrets:  # type: ignore[union-attr]
            access_rules = vault._http.get(f"/secrets/{secret.id}/access")
            if any(r["identity_id"] == id_str for r in access_rules):
                filtered.append(secret)
        self._credentials = Credentials(filtered)
        self._credentials_vault_ref = unlocked
        return self._credentials

    ## Channel management

    def create_mailbox(self, *, display_name: str | None = None) -> IdentityMailbox:
        """Create a new mailbox and link it to this identity.

        Args:
            display_name: Optional human-readable sender name.

        Returns:
            The newly created and linked mailbox.
        """
        mailbox = self._inkbox._mailboxes.create(
            agent_handle=self.agent_handle,
            display_name=display_name,
        )
        linked = IdentityMailbox(
            id=mailbox.id,
            email_address=mailbox.email_address,
            display_name=mailbox.display_name,
            status=mailbox.status,
            created_at=mailbox.created_at,
            updated_at=mailbox.updated_at,
        )
        self._mailbox = linked
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

    def create_authenticator_app(self) -> AuthenticatorApp:
        """Create a new authenticator app and link it to this identity.

        Returns:
            The newly created authenticator app.
        """
        app = self._inkbox._auth_apps.create(agent_handle=self.agent_handle)
        self._authenticator_app = IdentityAuthenticatorApp(
            id=app.id,
            organization_id=app.organization_id,
            identity_id=app.identity_id,
            status=app.status,
            created_at=app.created_at,
            updated_at=app.updated_at,
        )
        return app

    def assign_authenticator_app(self, authenticator_app_id: str) -> IdentityAuthenticatorApp:
        """Link an existing authenticator app to this identity.

        Args:
            authenticator_app_id: UUID of the authenticator app to link. Obtain
                via ``inkbox.authenticator_apps.list()`` or
                ``inkbox.authenticator_apps.get()``.

        Returns:
            The linked authenticator app.
        """
        data = self._inkbox._ids_resource.assign_authenticator_app(
            self.agent_handle, authenticator_app_id=authenticator_app_id
        )
        self._authenticator_app = data.authenticator_app
        self._data = data
        return self._authenticator_app  # type: ignore[return-value]

    def unlink_authenticator_app(self) -> None:
        """Unlink this identity's authenticator app (does not delete the app)."""
        self._require_authenticator_app()
        self._inkbox._ids_resource.unlink_authenticator_app(self.agent_handle)
        self._authenticator_app = None

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
        direction: str | None = None,
    ) -> Iterator[Message]:
        """Iterate over emails in this identity's inbox, newest first.

        Pagination is handled automatically.

        Args:
            page_size: Messages fetched per API call (1–100).
            direction: Filter by ``"inbound"`` or ``"outbound"``.
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
        direction: str | None = None,
    ) -> Iterator[Message]:
        """Iterate over unread emails in this identity's inbox, newest first.

        Fetches all messages and filters client-side. Pagination is handled
        automatically.

        Args:
            page_size: Messages fetched per API call (1–100).
            direction: Filter by ``"inbound"`` or ``"outbound"``.
        """
        return (
            msg for msg in self.iter_emails(page_size=page_size, direction=direction) if not msg.is_read
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

    ## Authenticator helpers

    def create_authenticator_account(
        self,
        *,
        otpauth_uri: str,
        display_name: str | None = None,
        description: str | None = None,
    ) -> AuthenticatorAccount:
        """Create a new authenticator account from an ``otpauth://`` URI.

        Args:
            otpauth_uri: ``otpauth://totp/...`` or ``otpauth://hotp/...`` URI.
            display_name: Optional user-managed label (max 255 characters).
            description: Optional free-form notes.
        """
        self._require_authenticator_app()
        return self._inkbox._auth_accounts.create(
            self._authenticator_app.id,  # type: ignore[union-attr]
            otpauth_uri=otpauth_uri,
            display_name=display_name,
            description=description,
        )

    def list_authenticator_accounts(self) -> list[AuthenticatorAccount]:
        """List all authenticator accounts in this identity's app."""
        self._require_authenticator_app()
        return self._inkbox._auth_accounts.list(
            self._authenticator_app.id,  # type: ignore[union-attr]
        )

    def get_authenticator_account(self, account_id: str) -> AuthenticatorAccount:
        """Get a single authenticator account by ID.

        Args:
            account_id: UUID of the authenticator account.
        """
        self._require_authenticator_app()
        return self._inkbox._auth_accounts.get(
            self._authenticator_app.id,  # type: ignore[union-attr]
            account_id,
        )

    def update_authenticator_account(
        self,
        account_id: str,
        *,
        display_name: str | None = None,
        description: str | None = None,
    ) -> AuthenticatorAccount:
        """Update user-managed metadata on an authenticator account.

        Args:
            account_id: UUID of the authenticator account to update.
            display_name: New label (max 255 characters).
            description: New notes.
        """
        self._require_authenticator_app()
        return self._inkbox._auth_accounts.update(
            self._authenticator_app.id,  # type: ignore[union-attr]
            account_id,
            display_name=display_name,
            description=description,
        )

    def delete_authenticator_account(self, account_id: str) -> None:
        """Delete an authenticator account.

        Args:
            account_id: UUID of the authenticator account to delete.
        """
        self._require_authenticator_app()
        self._inkbox._auth_accounts.delete(
            self._authenticator_app.id,  # type: ignore[union-attr]
            account_id,
        )

    def generate_otp(self, account_id: str) -> OTPCode:
        """Generate the current OTP code for an authenticator account.

        Args:
            account_id: UUID of the authenticator account.

        Returns:
            The generated OTP code with metadata.
        """
        self._require_authenticator_app()
        return self._inkbox._auth_accounts.generate_otp(
            self._authenticator_app.id,  # type: ignore[union-attr]
            account_id,
        )

    ## Identity management

    def update(
        self,
        *,
        new_handle: str | None = None,
        status: str | None = None,
    ) -> None:
        """Update this identity's handle or status.

        Args:
            new_handle: New agent handle.
            status: New lifecycle status: ``"active"`` or ``"paused"``.
        """
        result = self._inkbox._ids_resource.update(
            self.agent_handle, new_handle=new_handle, status=status
        )
        self._data = _AgentIdentityData(
            id=result.id,
            organization_id=result.organization_id,
            agent_handle=result.agent_handle,
            status=result.status,
            created_at=result.created_at,
            updated_at=result.updated_at,
            mailbox=self._mailbox,
            phone_number=self._phone_number,
            authenticator_app=self._authenticator_app,
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
        self._authenticator_app = data.authenticator_app
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

    def _require_vault_unlocked(self) -> None:
        if self._inkbox._vault_resource._unlocked is None:
            raise InkboxError(
                "Vault must be unlocked before accessing credentials. "
                "Call inkbox.vault.unlock(vault_key) first."
            )

    def _require_authenticator_app(self) -> None:
        if not self._authenticator_app:
            raise InkboxError(
                f"Identity '{self.agent_handle}' has no authenticator app assigned. "
                "Call identity.create_authenticator_app() or identity.assign_authenticator_app() first."
            )

    def __repr__(self) -> str:
        return (
            f"AgentIdentity(agent_handle={self.agent_handle!r}, "
            f"mailbox={self._mailbox.email_address if self._mailbox else None!r}, "
            f"phone={self._phone_number.number if self._phone_number else None!r}, "
            f"authenticator_app={str(self._authenticator_app.id) if self._authenticator_app else None!r})"
        )
