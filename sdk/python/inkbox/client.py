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
from inkbox.phone.resources.texts import TextsResource
from inkbox.phone.resources.transcripts import TranscriptsResource
from inkbox.identities._http import HttpTransport as IdsHttpTransport
from inkbox.identities.resources.identities import IdentitiesResource
from inkbox.vault._http import HttpTransport as VaultHttpTransport
from inkbox.vault.resources.vault import VaultResource
from inkbox.agent_identity import AgentIdentity
from inkbox.identities.types import AgentIdentitySummary
from inkbox.signing_keys import SigningKey, SigningKeysResource

_DEFAULT_BASE_URL = "https://api.inkbox.ai"


class Inkbox:
    """
    Org-level entry point for all Inkbox APIs.

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

    With vault credentials::

        with Inkbox(api_key="ApiKey_...", vault_key="my-Vault-key-01!") as inkbox:
            identity = inkbox.get_identity("my-agent")
            for login in identity.credentials.list_logins():
                print(login.name, login.payload.username)
    """

    ## Magic methods

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = 30.0,
        vault_key: str | None = None,
    ) -> None:
        """
        Create an Inkbox client.

        Args:
            api_key: Your Inkbox API key (``X-Service-Token``).
            base_url: Override the API base URL (useful for self-hosting
                or testing).
            timeout: Request timeout in seconds (default 30).
            vault_key: Optional vault key or recovery code.  When provided,
                the vault is unlocked automatically at construction so
                ``identity.credentials`` is immediately available.
        """
        if not base_url.startswith("https://"):
            from urllib.parse import urlparse
            _parsed = urlparse(base_url)
            if _parsed.hostname not in ("localhost", "127.0.0.1"):
                raise ValueError(
                    "Only HTTPS base URLs are permitted (HTTP is allowed for "
                    "localhost and 127.0.0.1). "
                    "Received a base_url that does not start with 'https://'."
                )
        _api_root = f"{base_url.rstrip('/')}/api/v1"

        self._mail_http = MailHttpTransport(
            api_key=api_key,
            base_url=f"{_api_root}/mail",
            timeout=timeout,
        )
        self._phone_http = PhoneHttpTransport(
            api_key=api_key,
            base_url=f"{_api_root}/phone",
            timeout=timeout,
        )
        self._ids_http = IdsHttpTransport(
            api_key=api_key,
            base_url=f"{_api_root}/identities",
            timeout=timeout,
        )
        self._vault_http = VaultHttpTransport(
            api_key=api_key,
            base_url=f"{_api_root}/vault",
            timeout=timeout,
        )
        self._api_http = MailHttpTransport(
            api_key=api_key,
            base_url=_api_root,
            timeout=timeout,
        )

        self._mailboxes = MailboxesResource(self._mail_http)
        self._messages = MessagesResource(self._mail_http)
        self._threads = ThreadsResource(self._mail_http)

        self._calls = CallsResource(self._phone_http)
        self._numbers = PhoneNumbersResource(self._phone_http)
        self._texts = TextsResource(self._phone_http)
        self._transcripts = TranscriptsResource(self._phone_http)

        self._vault_resource = VaultResource(self._vault_http)

        self._signing_keys = SigningKeysResource(self._api_http)
        self._ids_resource = IdentitiesResource(self._ids_http)

        if vault_key is not None:
            self._vault_resource.unlock(vault_key)

    def __enter__(self) -> Inkbox:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    ## Lifecycle

    def close(self) -> None:
        """Close all underlying HTTP connection pools."""
        self._mail_http.close()
        self._phone_http.close()
        self._ids_http.close()
        self._vault_http.close()
        self._api_http.close()

    ## Public resource accessors

    @property
    def mailboxes(self) -> MailboxesResource:
        """Access org-level mailbox operations (list, get, create, update, delete)."""
        return self._mailboxes

    @property
    def phone_numbers(self) -> PhoneNumbersResource:
        """Access org-level phone number operations (list, get, provision, release)."""
        return self._numbers

    @property
    def texts(self) -> TextsResource:
        """Access org-level text message operations (list, get, search, conversations)."""
        return self._texts

    @property
    def vault(self) -> VaultResource:
        """Access the encrypted vault (info, unlock, secrets)."""
        return self._vault_resource

    ## Org-level operations

    def create_identity(self, agent_handle: str) -> AgentIdentity:
        """
        Create a new agent identity.

        Args:
            agent_handle: Unique handle for this identity (e.g. ``"sales-bot"``).

        Returns:
            The created :class:`AgentIdentity`.
        """
        self._ids_resource.create(agent_handle=agent_handle)
        data = self._ids_resource.get(agent_handle)
        return AgentIdentity(data, self)

    def get_identity(self, agent_handle: str) -> AgentIdentity:
        """
        Get an agent identity by handle.

        Args:
            agent_handle: Handle of the identity to fetch.

        Returns:
            The :class:`AgentIdentity`.
        """
        return AgentIdentity(
            data=self._ids_resource.get(agent_handle),
            inkbox=self,
        )

    def list_identities(self) -> list[AgentIdentitySummary]:
        """List all agent identities for your organisation."""
        return self._ids_resource.list()

    def create_signing_key(self) -> SigningKey:
        """
        Create or rotate the org-level webhook signing key.

        The plaintext key is returned once — save it immediately.
        """
        return self._signing_keys.create_or_rotate()
