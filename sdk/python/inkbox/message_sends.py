"""Recover original message identifiers using their request keys."""

from typing import TYPE_CHECKING, Literal
from uuid import UUID

from inkbox._message_requests import send_key

if TYPE_CHECKING:
    from inkbox._http import HttpTransport
    from inkbox.mail.resources.mailboxes import MailboxesResource


def get_message_request_key(error: BaseException) -> str | None:
    """Recover a send key from API, transport, or response-decoding errors."""
    key = getattr(error, "idempotency_key", None)
    return key if isinstance(key, str) else None


class MessageSendsResource:
    """Read-only message lookup; this resource never initiates a send."""

    def __init__(self, http: "HttpTransport", mailboxes: "MailboxesResource") -> None:
        self._http = http
        self._mailboxes = mailboxes

    def lookup(self, *, sender_kind: Literal["mailbox", "phone_number", "imessage_identity"],
               sender_id: UUID | str, operation: str, idempotency_key: str) -> UUID:
        """Find the original ID, then use its channel's get method for current status."""
        data = self._http.get("/message-sends/lookup", params={
            "sender_kind": sender_kind, "sender_id": str(sender_id), "operation": operation,
        }, headers={"Idempotency-Key": send_key(idempotency_key)})
        return UUID(data["message_id"])

    def lookup_email(self, email_address: str, *, operation: str = "mail.send", idempotency_key: str) -> UUID:
        """Look up an email request using its sending address."""
        mailbox = self._mailboxes.get(email_address)
        return self.lookup(sender_kind="mailbox", sender_id=mailbox.id,
                           operation=operation, idempotency_key=idempotency_key)
