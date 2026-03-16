"""
inkbox/client.py

Inkbox — org-level entry point for all Inkbox APIs.
"""

from __future__ import annotations

from inkbox.mail._http import HttpTransport as MailHttpTransport
from inkbox.mail.resources.mailboxes import MailboxesResource
from inkbox.mail.resources.messages import MessagesResource
from inkbox.mail.resources.threads import ThreadsResource
from inkbox.phone._http import HttpTransport as PhoneHttpTransport
from inkbox.phone.resources.calls import CallsResource
from inkbox.phone.resources.numbers import PhoneNumbersResource
from inkbox.phone.resources.transcripts import TranscriptsResource
from inkbox.identities._http import HttpTransport as IdsHttpTransport
from inkbox.identities.resources.identities import IdentitiesResource
from inkbox.agent_identity import AgentIdentity
from inkbox.identities.types import AgentIdentitySummary
from inkbox.signing_keys import SigningKey, SigningKeysResource

_DEFAULT_BASE_URL = "https://api.inkbox.ai"


class Inkbox:
    """Org-level entry point for all Inkbox APIs.

    Args:
        api_key: Your Inkbox API key (``X-Service-Token``).
        base_url: Override the API base URL (useful for self-hosting or testing).
        timeout: Request timeout in seconds (default 30).

    Example::

        from inkbox import Inkbox

        with Inkbox(api_key="ApiKey_...") as inkbox:
            identity = inkbox.create_identity("support-bot")
            identity.create_mailbox(display_name="Support Bot")
            identity.send_email(
                to=["customer@example.com"],
                subject="Hello!",
                body_text="Hi there",
            )
    """

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ) -> None:
        _api_root = f"{base_url.rstrip('/')}/api/v1"

        self._mail_http = MailHttpTransport(
            api_key=api_key, base_url=f"{_api_root}/mail", timeout=timeout
        )
        self._phone_http = PhoneHttpTransport(
            api_key=api_key, base_url=f"{_api_root}/phone", timeout=timeout
        )
        self._ids_http = IdsHttpTransport(
            api_key=api_key, base_url=f"{_api_root}/identities", timeout=timeout
        )
        self._api_http = MailHttpTransport(
            api_key=api_key, base_url=_api_root, timeout=timeout
        )

        self._mailboxes = MailboxesResource(self._mail_http)
        self._messages = MessagesResource(self._mail_http)
        self._threads = ThreadsResource(self._mail_http)

        self._calls = CallsResource(self._phone_http)
        self._numbers = PhoneNumbersResource(self._phone_http)
        self._transcripts = TranscriptsResource(self._phone_http)

        self._signing_keys = SigningKeysResource(self._api_http)
        self._ids_resource = IdentitiesResource(self._ids_http)

    # ------------------------------------------------------------------
    # Public resource accessors
    # ------------------------------------------------------------------

    @property
    def mailboxes(self) -> MailboxesResource:
        """Access org-level mailbox operations (list, get, create, update, delete)."""
        return self._mailboxes

    @property
    def phone_numbers(self) -> PhoneNumbersResource:
        """Access org-level phone number operations (list, get, provision, release)."""
        return self._numbers

    # ------------------------------------------------------------------
    # Org-level operations
    # ------------------------------------------------------------------

    def create_identity(self, agent_handle: str) -> AgentIdentity:
        """Create a new agent identity.

        Args:
            agent_handle: Unique handle for this identity (e.g. ``"sales-bot"``).

        Returns:
            The created :class:`AgentIdentity`.
        """
        from inkbox.agent_identity import AgentIdentity

        self._ids_resource.create(agent_handle=agent_handle)
        data = self._ids_resource.get(agent_handle)
        return AgentIdentity(data, self)

    def get_identity(self, agent_handle: str) -> AgentIdentity:
        """Get an agent identity by handle.

        Args:
            agent_handle: Handle of the identity to fetch.

        Returns:
            The :class:`AgentIdentity`.
        """
        from inkbox.agent_identity import AgentIdentity

        return AgentIdentity(self._ids_resource.get(agent_handle), self)

    def list_identities(self) -> list[AgentIdentitySummary]:
        """List all agent identities for your organisation."""
        return self._ids_resource.list()

    def create_signing_key(self) -> SigningKey:
        """Create or rotate the org-level webhook signing key.

        The plaintext key is returned once — save it immediately.
        """
        return self._signing_keys.create_or_rotate()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Close all underlying HTTP connection pools."""
        self._mail_http.close()
        self._phone_http.close()
        self._ids_http.close()
        self._api_http.close()

    def __enter__(self) -> Inkbox:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
