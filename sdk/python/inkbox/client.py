"""
inkbox/client.py

Inkbox — org-level entry point for all Inkbox APIs.
"""

from __future__ import annotations

from typing import Any, Literal
from urllib.parse import urlparse
from uuid import UUID

import httpx

from inkbox._http import HttpTransport, sdk_user_agent
from inkbox._config import resolve_client_settings
from inkbox._cookies import CookieJar
from inkbox.agent_identity import AgentIdentity
from inkbox.api_keys.resources.api_keys import ApiKeysResource
from inkbox.contacts.resources.contacts import ContactsResource
from inkbox.notes.resources.notes import NotesResource
from inkbox.agent_signup.types import (
    AgentSignupResponse,
    AgentSignupVerifyResponse,
    AgentSignupResendResponse,
    AgentSignupStatusResponse,
)
from inkbox.exceptions import InkboxAPIError
from inkbox.identities.resources.identities import IdentitiesResource
from inkbox.identities.types import (  # noqa: I001
    _UNSET,
    IdentityTunnelCreateOptions,
    AgentIdentitySummary,
    IdentityMailboxCreateOptions,
    IdentityPhoneNumberCreateOptions,
)
from inkbox.imessage.resources.contact_rules import IMessageContactRulesResource
from inkbox.imessage.resources.imessages import IMessagesResource
from inkbox.mail.resources.contact_rules import MailContactRulesResource
from inkbox.mail.resources.identity_contact_rules import MailIdentityContactRulesResource
from inkbox.mail.resources.domains import DomainsResource
from inkbox.mail.resources.mailboxes import MailboxesResource
from inkbox.mail.resources.messages import MessagesResource
from inkbox.mail.resources.threads import ThreadsResource
from inkbox.phone.resources.calls import CallsResource
from inkbox.phone.resources.incoming_call_action import IncomingCallActionResource
from inkbox.phone.resources.contact_rules import PhoneContactRulesResource
from inkbox.phone.resources.identity_contact_rules import (
    PhoneIdentityContactRulesResource,
)
from inkbox.phone.resources.numbers import PhoneNumbersResource
from inkbox.phone.resources.sms_opt_ins import SmsOptInsResource
from inkbox.phone.resources.texts import TextsResource
from inkbox.signing_keys import SigningKey, SigningKeysResource
from inkbox.tunnels.resources.tunnels import TunnelsResource
from inkbox.webhook_deliveries import WebhookDeliveriesResource
from inkbox.webhook_subscriptions import WebhookSubscriptionsResource
from inkbox.vault.resources.vault import VaultResource
from inkbox.whoami.types import WhoamiResponse, _parse_whoami

_DEFAULT_BASE_URL = "https://inkbox.ai"

# `_UNSET` is imported from inkbox.identities.types above. Identity-based
# `is not _UNSET` checks must compare against the SAME object across all
# layers; a module-local `object()` here would leak the sentinel through
# to the wire body and crash JSON encoding.


class _WebhooksNamespace:
    """Typed namespace for ``inkbox.webhooks.*`` resources.

    Single allocation per ``Inkbox`` instance so identity checks
    (``client.webhooks is client.webhooks``) hold.
    """
    __slots__ = ("subscriptions", "deliveries")

    def __init__(
        self,
        subscriptions: WebhookSubscriptionsResource,
        deliveries: WebhookDeliveriesResource,
    ) -> None:
        self.subscriptions = subscriptions
        self.deliveries = deliveries


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
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        timeout: float = 30.0,
        vault_key: str | None = None,
        user_agent_prefix: str | None = None,
    ) -> None:
        """
        Create an Inkbox client.

        Each of ``api_key`` / ``base_url`` / ``vault_key`` falls back to its
        env var (``INKBOX_API_KEY`` / ``INKBOX_BASE_URL`` / ``INKBOX_VAULT_KEY``)
        and then to ``~/.inkbox/config`` — handy for background/agent processes
        that don't inherit the shell's env.

        Args:
            api_key: Your Inkbox API key (``X-API-Key``).
            base_url: Override the API base URL (useful for self-hosting
                or testing). Defaults to ``https://inkbox.ai``.
            timeout: Request timeout in seconds (default 30).
            vault_key: Optional vault key or recovery code.  When provided,
                the vault is unlocked automatically at construction so
                ``identity.credentials`` is immediately available.
            user_agent_prefix: Optional token prepended to the ``User-Agent``
                header (e.g. ``"inkbox-cli/1.2.3"``) so a downstream tool
                identifies itself ahead of the SDK's own token.
        """
        api_key, base_url, vault_key = resolve_client_settings(
            api_key=api_key, base_url=base_url, vault_key=vault_key,
        )
        if not api_key:
            raise ValueError(
                "No API key found. Pass api_key=, set INKBOX_API_KEY, or add "
                "'api_key = ...' to ~/.inkbox/config."
            )
        if base_url is None:
            base_url = _DEFAULT_BASE_URL
        if not base_url.startswith("https://"):
            _parsed = urlparse(base_url)
            if _parsed.hostname not in ("localhost", "127.0.0.1"):
                raise ValueError(
                    "Only HTTPS base URLs are permitted (HTTP is allowed for "
                    "localhost and 127.0.0.1). "
                    "Received a base_url that does not start with 'https://'."
                )
        _api_base = f"{base_url.rstrip('/')}/api"
        _api_root = f"{base_url.rstrip('/')}/api/v1"
        _cookie_jar = CookieJar()
        _ua = sdk_user_agent(user_agent_prefix)

        # Held for the tunnel-agent runtime, which authenticates the
        # data-plane hello with the same key used for the control plane.
        self._api_key = api_key

        self._mail_http = HttpTransport(
            api_key=api_key,
            base_url=f"{_api_root}/mail",
            timeout=timeout,
            cookie_jar=_cookie_jar,
            user_agent=_ua,
        )
        self._contacts_http = HttpTransport(
            api_key=api_key,
            base_url=_api_root,
            timeout=timeout,
            cookie_jar=_cookie_jar,
            user_agent=_ua,
        )
        self._phone_http = HttpTransport(
            api_key=api_key,
            base_url=f"{_api_root}/phone",
            timeout=timeout,
            cookie_jar=_cookie_jar,
            user_agent=_ua,
        )
        self._imessage_http = HttpTransport(
            api_key=api_key,
            base_url=f"{_api_root}/imessage",
            timeout=timeout,
            cookie_jar=_cookie_jar,
            user_agent=_ua,
        )
        self._ids_http = HttpTransport(
            api_key=api_key,
            base_url=f"{_api_root}/identities",
            timeout=timeout,
            cookie_jar=_cookie_jar,
            user_agent=_ua,
        )
        self._vault_http = HttpTransport(
            api_key=api_key,
            base_url=f"{_api_root}/vault",
            timeout=timeout,
            cookie_jar=_cookie_jar,
            user_agent=_ua,
        )
        self._domains_http = HttpTransport(
            api_key=api_key,
            base_url=f"{_api_root}/domains",
            timeout=timeout,
            cookie_jar=_cookie_jar,
            user_agent=_ua,
        )
        self._root_api_http = HttpTransport(
            api_key=api_key,
            base_url=_api_base,
            timeout=timeout,
            cookie_jar=_cookie_jar,
            user_agent=_ua,
        )
        self._api_http = HttpTransport(
            api_key=api_key,
            base_url=_api_root,
            timeout=timeout,
            cookie_jar=_cookie_jar,
            user_agent=_ua,
        )

        self._mailboxes = MailboxesResource(self._mail_http)
        self._messages = MessagesResource(self._mail_http)
        self._threads = ThreadsResource(self._mail_http)
        self._mail_contact_rules = MailContactRulesResource(self._mail_http)
        self._domains = DomainsResource(self._domains_http)

        self._calls = CallsResource(self._phone_http)
        self._numbers = PhoneNumbersResource(self._phone_http)
        self._texts = TextsResource(self._phone_http)
        self._incoming_call_action = IncomingCallActionResource(self._phone_http)
        self._phone_contact_rules = PhoneContactRulesResource(self._phone_http)
        self._sms_opt_ins = SmsOptInsResource(self._phone_http)

        # Identity-keyed contact rules ride the api-root transport (base
        # /api/v1) so they reach both /identities/{handle}/...-contact-rules
        # and the org-wide /mail|/phone/contact-rules with full paths.
        self._mail_identity_contact_rules = MailIdentityContactRulesResource(
            self._api_http
        )
        self._phone_identity_contact_rules = PhoneIdentityContactRulesResource(
            self._api_http
        )

        self._imessages = IMessagesResource(self._imessage_http)
        self._imessage_contact_rules = IMessageContactRulesResource(self._imessage_http)

        self._vault_resource = VaultResource(self._vault_http, api_http=self._root_api_http)

        self._signing_keys = SigningKeysResource(self._api_http)
        self._webhook_subscriptions = WebhookSubscriptionsResource(self._api_http)
        self._webhook_deliveries = WebhookDeliveriesResource(self._api_http)
        self._webhooks = _WebhooksNamespace(
            self._webhook_subscriptions,
            self._webhook_deliveries,
        )
        self._api_keys = ApiKeysResource(self._api_http)
        self._ids_resource = IdentitiesResource(self._ids_http)

        self._contacts = ContactsResource(self._contacts_http)
        self._notes = NotesResource(self._contacts_http)

        self._tunnels = TunnelsResource(self._api_http, inkbox=self)

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
        self._imessage_http.close()
        self._ids_http.close()
        self._vault_http.close()
        self._root_api_http.close()
        self._api_http.close()
        self._contacts_http.close()
        self._domains_http.close()

    ## Public resource accessors

    @property
    def mailboxes(self) -> MailboxesResource:
        """Access org-level mailbox operations (list, get, update, search). Mailboxes are provisioned by ``create_identity`` and removed by ``identity.delete()`` (cascade)."""
        return self._mailboxes

    @property
    def messages(self) -> MessagesResource:
        """Access org-level message operations (list, get, send, delete, flags)."""
        return self._messages

    @property
    def threads(self) -> ThreadsResource:
        """Access org-level thread operations (list, get, delete)."""
        return self._threads

    @property
    def phone_numbers(self) -> PhoneNumbersResource:
        """Access org-level phone number operations (list, get, provision, release)."""
        return self._numbers

    @property
    def calls(self) -> CallsResource:
        """Access org-level call operations (list, get, place)."""
        return self._calls

    @property
    def texts(self) -> TextsResource:
        """Access org-level text message operations (list, get, search, conversations)."""
        return self._texts

    @property
    def imessages(self) -> IMessagesResource:
        """Access org-level iMessage operations (send, list, conversations, reactions)."""
        return self._imessages

    @property
    def imessage_contact_rules(self) -> IMessageContactRulesResource:
        """iMessage per-identity allow/block rules (+ org-wide list)."""
        return self._imessage_contact_rules

    @property
    def incoming_call_action(self) -> IncomingCallActionResource:
        """Access per-identity inbound-call handling config (get, set)."""
        return self._incoming_call_action

    @property
    def vault(self) -> VaultResource:
        """Access the encrypted vault (info, unlock, secrets)."""
        return self._vault_resource

    @property
    def contacts(self) -> ContactsResource:
        """Org-wide contacts (list, get, create, update, delete, lookup, access, vCards)."""
        return self._contacts

    @property
    def notes(self) -> NotesResource:
        """Org-scoped notes with per-identity access grants."""
        return self._notes

    @property
    def mail_contact_rules(self) -> MailContactRulesResource:
        """Mail per-mailbox allow/block rules (+ org-wide list).

        Deprecated: contact rules are now keyed by agent identity — use
        :attr:`mail_identity_contact_rules` (or ``identity.*_mail_contact_rule``).
        """
        return self._mail_contact_rules

    @property
    def phone_contact_rules(self) -> PhoneContactRulesResource:
        """Phone per-number allow/block rules (+ org-wide list).

        Deprecated: contact rules are now keyed by agent identity — use
        :attr:`phone_identity_contact_rules` (or ``identity.*_phone_contact_rule``).
        """
        return self._phone_contact_rules

    @property
    def mail_identity_contact_rules(self) -> MailIdentityContactRulesResource:
        """Mail per-identity allow/block rules (+ org-wide list), keyed by ``agent_handle``."""
        return self._mail_identity_contact_rules

    @property
    def phone_identity_contact_rules(self) -> PhoneIdentityContactRulesResource:
        """Phone per-identity allow/block rules (+ org-wide list), keyed by ``agent_handle``."""
        return self._phone_identity_contact_rules

    @property
    def sms_opt_ins(self) -> SmsOptInsResource:
        """SMS opt-in / opt-out registry (per-(org, receiver) consent).

        Writes (``opt_in`` / ``opt_out``) require the org to be on its
        own active, customer-managed 10DLC campaign.
        """
        return self._sms_opt_ins

    @property
    def domains(self) -> DomainsResource:
        """Custom sending domains (list, set org default)."""
        return self._domains

    @property
    def tunnels(self) -> TunnelsResource:
        """Tunnels (list, get, update, sign_csr). Tunnel lifecycle is owned by identity-create / identity-delete."""
        return self._tunnels

    @property
    def api_keys(self) -> ApiKeysResource:
        """Org-level API key creation. Admin-scoped API keys can mint identity-scoped keys."""
        return self._api_keys

    @property
    def signing_keys(self) -> SigningKeysResource:
        """Per-identity webhook signing keys.

        Use ``create_or_rotate(agent_handle)`` / ``get_status(agent_handle)``
        (or the ``identity.create_signing_key()`` /
        ``identity.get_signing_key_status()`` convenience methods). Calling
        either with no handle hits the deprecated org-level endpoint.
        """
        return self._signing_keys

    @property
    def webhooks(self) -> "_WebhooksNamespace":
        """Webhook subscription management and delivery log.

        Use ``inkbox.webhooks.subscriptions`` to attach HTTPS receivers
        to mail (``message.*``) or phone-text (``text.*``) events, and
        ``inkbox.webhooks.deliveries`` to inspect logged delivery
        attempts and replay missed ones. Incoming-call webhooks still
        live on the phone-number resource (``incoming_call_webhook_url``)
        because the response body controls call routing.
        """
        return self._webhooks

    ## Org-level operations

    def create_identity(
        self,
        agent_handle: str,
        *,
        display_name: str | None = None,
        description: Any = _UNSET,
        imessage_enabled: bool | None = None,
        email_local_part: str | None = None,
        sending_domain: str | None = _UNSET,  # type: ignore[assignment]
        tunnel: "IdentityTunnelCreateOptions | None" = None,
        phone_number: IdentityPhoneNumberCreateOptions | None = None,
        vault_secret_ids: UUID | str | list[UUID | str] | Literal["*", "all"] | None = None,
    ) -> AgentIdentity:
        """
        Create a new agent identity. Atomically provisions the linked
        mailbox and tunnel as part of the same request.

        Args:
            agent_handle: Unique handle, globally unique across all orgs
                (the handle shares its namespace with tunnel names).
            display_name: Identity-level human-readable name. Defaults
                server-side to ``agent_handle``.
            description: Free-form org-internal description. Pass
                ``None`` to leave the column null; omit to defer to the
                server default. Never surfaces in outbound mail.
            imessage_enabled: Whether this identity can be reached over
                the shared iMessage service. Defaults server-side to
                ``False``; pass ``True`` to opt in.
            email_local_part: Optional requested mailbox local part.
                On the platform domain the server forces it to the
                handle; only meaningful on a custom sending domain.
            sending_domain: Optional sending-domain selector by **bare
                domain name**. Leave at ``_UNSET`` to inherit the org
                default; pass ``None`` to force the platform default;
                pass a verified custom-domain name to bind.
            tunnel: Optional nested tunnel spec (tls_mode only).
                Defaults to edge TLS.
            phone_number: Optional phone-number provisioning payload.
            vault_secret_ids: Optional vault secret selection to attach.

        Returns:
            The created :class:`AgentIdentity` with ``mailbox`` and
            ``tunnel`` populated from the atomic create response.
        """
        sending_domain_provided = sending_domain is not _UNSET
        mailbox_kwargs: dict[str, Any] = {}
        if email_local_part is not None:
            mailbox_kwargs["email_local_part"] = email_local_part
        if sending_domain_provided:
            mailbox_kwargs["sending_domain"] = sending_domain
        mailbox: IdentityMailboxCreateOptions | None = (
            IdentityMailboxCreateOptions(**mailbox_kwargs) if mailbox_kwargs else None
        )
        data = self._ids_resource.create(
            agent_handle=agent_handle,
            display_name=display_name,
            description=description,
            imessage_enabled=imessage_enabled,
            mailbox=mailbox,
            tunnel=tunnel,
            phone_number=phone_number,
            vault_secret_ids=vault_secret_ids,
        )
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
        Create or rotate a webhook signing key via the deprecated org-level
        endpoint.

        Deprecated: signing keys are now per agent identity. Prefer
        ``identity.create_signing_key()`` (or
        ``inkbox.signing_keys.create_or_rotate(agent_handle)``). With an
        agent-scoped API key this rotates that key's identity; with an admin
        key the server returns 409 (``InkboxAPIError``).

        The plaintext key is returned once — save it immediately.
        """
        return self._signing_keys.create_or_rotate()

    ## Agent signup (class methods — no instance required)

    @classmethod
    def _validate_base_url(cls, base_url: str) -> None:
        if not base_url.startswith("https://"):
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
        cls._validate_base_url(base_url)
        url = f"{base_url.rstrip('/')}/api/v1/agent-signup{path}"
        headers: dict[str, str] = {
            "Accept": "application/json",
            "User-Agent": sdk_user_agent(),
        }
        if api_key:
            headers["X-API-Key"] = api_key

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
        *,
        note_to_human: str,
        display_name: str | None = None,
        agent_handle: str | None = None,
        email_local_part: str | None = None,
        harness: str | None = None,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ) -> AgentSignupResponse:
        """
        Register a new agent (public — no API key required).

        Returns the provisioned email, org, and a one-time API key.

        Args:
            human_email: Email of the human who should approve this agent.
            note_to_human: Message from the agent to the human, included in
                the verification email.
            display_name: Optional human-readable name for the agent.
            agent_handle: Optional requested handle for the agent identity.
            email_local_part: Optional requested mailbox local part.
            harness: Optional identifier for the agent harness/runtime (e.g.
                ``"claude-code"``, ``"codex"``). Free-form string passed to the
                server to record the calling runtime.
            base_url: Override the API base URL.
            timeout: Request timeout in seconds.

        Returns:
            AgentSignupResponse: Provisioned mailbox, org, and one-time API key.
        """
        body: dict[str, str] = {
            "human_email": human_email,
            "note_to_human": note_to_human,
        }
        if display_name is not None:
            body["display_name"] = display_name
        if agent_handle is not None:
            body["agent_handle"] = agent_handle
        if email_local_part is not None:
            body["email_local_part"] = email_local_part
        if harness is not None:
            body["harness"] = harness
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
