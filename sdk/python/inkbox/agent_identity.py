"""
inkbox/agent_identity.py

AgentIdentity — a domain object representing one agent identity.
Returned by inkbox.create_identity() and inkbox.get_identity().

Convenience methods (send_email, place_call, etc.) are scoped to this
agent's assigned channels so callers never need to pass an email address
or phone number ID explicitly.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Iterator

from inkbox.identities.types import _AgentIdentityData, IdentityMailbox, IdentityPhoneNumber
from inkbox.mail.exceptions import InkboxError
from inkbox.mail.types import Message, ThreadDetail
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

    # ------------------------------------------------------------------
    # Identity properties
    # ------------------------------------------------------------------

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

    # ------------------------------------------------------------------
    # Channel management
    # ------------------------------------------------------------------

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

    # ------------------------------------------------------------------
    # Mail helpers
    # ------------------------------------------------------------------

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
        return (msg for msg in self.iter_emails(page_size=page_size, direction=direction) if not msg.is_read)

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

    # ------------------------------------------------------------------
    # Phone helpers
    # ------------------------------------------------------------------

    def place_call(
        self,
        *,
        to_number: str,
        client_websocket_url: str | None = None,
        webhook_url: str | None = None,
    ) -> PhoneCallWithRateLimit:
        """Place an outbound call from this identity's phone number.

        Args:
            to_number: E.164 destination number.
            client_websocket_url: WebSocket URL (wss://) for audio bridging.
            webhook_url: Custom webhook URL for call lifecycle events.
        """
        self._require_phone()
        return self._inkbox._calls.place(
            from_number=self._phone_number.number,  # type: ignore[union-attr]
            to_number=to_number,
            client_websocket_url=client_websocket_url,
            webhook_url=webhook_url,
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

    # ------------------------------------------------------------------
    # Identity management
    # ------------------------------------------------------------------

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
        )

    def refresh(self) -> AgentIdentity:
        """Re-fetch this identity from the API and update cached channels.

        Returns:
            ``self`` for chaining.
        """
        data = self._inkbox._ids_resource.get(self.agent_handle)
        self._data = data
        self._mailbox = data.mailbox
        self._phone_number = data.phone_number
        return self

    def delete(self) -> None:
        """Soft-delete this identity (unlinks channels without deleting them)."""
        self._inkbox._ids_resource.delete(self.agent_handle)

    # ------------------------------------------------------------------
    # Internal guards
    # ------------------------------------------------------------------

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

    def __repr__(self) -> str:
        return (
            f"AgentIdentity(agent_handle={self.agent_handle!r}, "
            f"mailbox={self._mailbox.email_address if self._mailbox else None!r}, "
            f"phone={self._phone_number.number if self._phone_number else None!r})"
        )
