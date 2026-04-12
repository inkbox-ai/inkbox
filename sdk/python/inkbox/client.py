"""
inkbox/client.py

Inkbox — org-level entry point for all Inkbox APIs.
"""

from __future__ import annotations

from inkbox._http import HttpTransport
from inkbox.mail.resources.mailboxes import MailboxesResource
from inkbox.mail.resources.messages import MessagesResource
from inkbox.mail.resources.threads import ThreadsResource
from inkbox.phone.resources.calls import CallsResource
from inkbox.phone.resources.numbers import PhoneNumbersResource
from inkbox.phone.resources.texts import TextsResource
from inkbox.phone.resources.transcripts import TranscriptsResource
from inkbox.identities.resources.identities import IdentitiesResource
from inkbox.vault.resources.vault import VaultResource
from inkbox.agent_identity import AgentIdentity
from inkbox.identities.types import (
    AgentIdentitySummary,
    IdentityMailboxCreateOptions,
    IdentityPhoneNumberCreateOptions,
)
from inkbox.signing_keys import SigningKey, SigningKeysResource
from inkbox.whoami.types import WhoamiResponse, _parse_whoami
from inkbox.agent_signup.types import (
    AgentSignupResponse,
    AgentSignupVerifyResponse,
    AgentSignupResendResponse,
    AgentSignupStatusResponse,
)
from uuid import UUID
from typing import Literal

_DEFAULT_BASE_URL = "https://inkbox.ai"


class Inkbox:
    """
    Org-level entry point for all Inkbox APIs.

    Example::

        from inkbox import Inkbox

        with Inkbox(api_key="ApiKey_...") as inkbox:
            identity = inkbox.create_identity("support-bot")
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

        self._mail_http = HttpTransport(
            api_key=api_key,
            base_url=f"{_api_root}/mail",
            timeout=timeout,
        )
        self._phone_http = HttpTransport(
            api_key=api_key,
            base_url=f"{_api_root}/phone",
            timeout=timeout,
        )
        self._ids_http = HttpTransport(
            api_key=api_key,
            base_url=f"{_api_root}/identities",
            timeout=timeout,
        )
        self._vault_http = HttpTransport(
            api_key=api_key,
            base_url=f"{_api_root}/vault",
            timeout=timeout,
        )
        _api_base = f"{base_url.rstrip('/')}/api"
        self._root_api_http = HttpTransport(
            api_key=api_key,
            base_url=_api_base,
            timeout=timeout,
        )
        self._api_http = HttpTransport(
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

        self._vault_resource = VaultResource(self._vault_http, api_http=self._root_api_http)

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
        self._root_api_http.close()
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

    def create_identity(
        self,
        agent_handle: str,
        *,
        create_mailbox: bool = False,
        display_name: str | None = None,
        email_local_part: str | None = None,
        phone_number: IdentityPhoneNumberCreateOptions | None = None,
        vault_secret_ids: UUID | str | list[UUID | str] | Literal["*", "all"] | None = None,
    ) -> AgentIdentity:
        """
        Create a new agent identity.

        Args:
            agent_handle: Unique handle for this identity (e.g. ``"sales-bot"``).
            create_mailbox: Whether to create and link a mailbox in the same
                request. This is also implied when ``display_name`` or
                ``email_local_part`` is provided.
            display_name: Optional human-readable mailbox name.
            email_local_part: Optional requested mailbox local part.
            phone_number: Optional phone-number provisioning payload to create
                and link a number in the same request.
            vault_secret_ids: Optional vault secret selection to attach to the
                new identity. Use ``"*"``, ``"all"``, a single UUID/string, or
                a list of UUIDs/strings.

        Returns:
            The created :class:`AgentIdentity`.
        """
        mailbox = None
        if create_mailbox or display_name is not None or email_local_part is not None:
            mailbox = IdentityMailboxCreateOptions(
                display_name=display_name,
                email_local_part=email_local_part,
            )
        self._ids_resource.create(
            agent_handle=agent_handle,
            mailbox=mailbox,
            phone_number=phone_number,
            vault_secret_ids=vault_secret_ids,
        )
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

    def whoami(self) -> WhoamiResponse:
        """Return the authenticated caller's identity and auth type."""
        data = self._root_api_http.get("/whoami")
        return _parse_whoami(data)

    def create_signing_key(self) -> SigningKey:
        """
        Create or rotate the org-level webhook signing key.

        The plaintext key is returned once — save it immediately.
        """
        return self._signing_keys.create_or_rotate()

    ## Agent signup (class methods — no instance required)

    @classmethod
    def _validate_base_url(cls, base_url: str) -> None:
        if not base_url.startswith("https://"):
            from urllib.parse import urlparse
            _parsed = urlparse(base_url)
            if _parsed.hostname not in ("localhost", "127.0.0.1"):
                raise ValueError(
                    "Only HTTPS base URLs are permitted (HTTP is allowed for "
                    "localhost and 127.0.0.1)."
                )

    @classmethod
    def _signup_request(
        cls,
        method: str,
        path: str,
        *,
        api_key: str | None = None,
        json: dict | None = None,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ) -> dict:
        """One-shot HTTP request for agent-signup endpoints."""
        import httpx
        from inkbox.exceptions import InkboxAPIError

        cls._validate_base_url(base_url)
        url = f"{base_url.rstrip('/')}/api/v1/agent-signup{path}"
        headers: dict[str, str] = {"Accept": "application/json"}
        if api_key:
            headers["X-Service-Token"] = api_key

        with httpx.Client(timeout=timeout) as client:
            resp = client.request(method, url, headers=headers, json=json)

        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise InkboxAPIError(status_code=resp.status_code, detail=str(detail))
        return resp.json()

    @classmethod
    def signup(
        cls,
        human_email: str,
        display_name: str,
        *,
        note_to_human: str,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ) -> AgentSignupResponse:
        """
        Register a new agent (public — no API key required).

        Returns the provisioned email, org, and a one-time API key.

        Args:
            human_email: Email of the human who should approve this agent.
            display_name: Human-readable name for the agent.
            note_to_human: Message from the agent to the human, included in
                the verification email.
            base_url: Override the API base URL.
            timeout: Request timeout in seconds.
        """
        body: dict[str, str] = {
            "human_email": human_email,
            "display_name": display_name,
            "note_to_human": note_to_human,
        }
        data = cls._signup_request(
            "POST", "", json=body, base_url=base_url, timeout=timeout,
        )
        return AgentSignupResponse._from_dict(data)

    @classmethod
    def verify_signup(
        cls,
        api_key: str,
        verification_code: str,
        *,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ) -> AgentSignupVerifyResponse:
        """
        Submit a 6-digit verification code to unlock full capabilities.

        Args:
            api_key: The API key returned from :meth:`signup`.
            verification_code: The 6-digit code from the verification email.
            base_url: Override the API base URL.
            timeout: Request timeout in seconds.
        """
        data = cls._signup_request(
            "POST", "/verify",
            api_key=api_key,
            json={"verification_code": verification_code},
            base_url=base_url,
            timeout=timeout,
        )
        return AgentSignupVerifyResponse._from_dict(data)

    @classmethod
    def resend_signup_verification(
        cls,
        api_key: str,
        *,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ) -> AgentSignupResendResponse:
        """
        Resend the verification email (5-minute cooldown).

        Args:
            api_key: The API key returned from :meth:`signup`.
            base_url: Override the API base URL.
            timeout: Request timeout in seconds.
        """
        data = cls._signup_request(
            "POST", "/resend-verification",
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
        )
        return AgentSignupResendResponse._from_dict(data)

    @classmethod
    def get_signup_status(
        cls,
        api_key: str,
        *,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ) -> AgentSignupStatusResponse:
        """
        Check the current signup claim status and restrictions.

        Args:
            api_key: The API key returned from :meth:`signup`.
            base_url: Override the API base URL.
            timeout: Request timeout in seconds.
        """
        data = cls._signup_request(
            "GET", "/status",
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
        )
        return AgentSignupStatusResponse._from_dict(data)
