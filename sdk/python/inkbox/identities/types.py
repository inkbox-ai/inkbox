"""
inkbox/identities/types.py

Dataclasses mirroring the Inkbox Identities API response models.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from inkbox.mail.types import FilterMode, FilterModeChangeNotice
from inkbox.phone.types import SmsStatus

# Sentinel for "field omitted" that's distinct from explicit ``None``.
# Mirrors the pattern used in :mod:`inkbox.mail.resources.mailboxes`.
_UNSET = object()


@dataclass
class IdentityMailboxCreateOptions:
    """
    Optional mailbox payload nested under identity creation.

    Attributes:
        display_name: Optional human-readable mailbox name to set when the
            mailbox is created.
        email_local_part: Optional requested local part to use before the
            sending domain. If omitted, the server generates a random one.
        sending_domain: Optional sending-domain selector by **bare domain
            name** (not an id). Leave at ``_UNSET`` to inherit the org
            default; pass ``None`` to force the platform default; pass a
            verified custom-domain name (e.g. ``"mail.acme.com"``) to bind.
    """

    display_name: str | None = None
    email_local_part: str | None = None
    sending_domain: str | None = _UNSET  # type: ignore[assignment]

    def to_wire(self) -> dict[str, Any]:
        """Return a JSON-serializable dict matching the API schema."""
        body: dict[str, Any] = {}
        if self.display_name is not None:
            body["display_name"] = self.display_name
        if self.email_local_part is not None:
            body["email_local_part"] = self.email_local_part
        if self.sending_domain is not _UNSET:
            body["sending_domain"] = self.sending_domain
        return body


@dataclass
class IdentityPhoneNumberCreateOptions:
    """
    Optional phone-number provisioning payload nested under identity creation.

    Attributes:
        type: Type of phone number to provision. Defaults to ``"toll_free"``.
        state: Optional US state abbreviation filter for local numbers.
        incoming_call_action: How to handle inbound calls on the provisioned number.
        client_websocket_url: WebSocket URL for ``"auto_accept"`` call handling.
        incoming_call_webhook_url: Webhook URL for ``"webhook"`` call handling.
        incoming_text_webhook_url: Webhook URL for inbound text notifications.
    """

    type: str = "toll_free"
    state: str | None = None
    incoming_call_action: str = "auto_reject"
    client_websocket_url: str | None = None
    incoming_call_webhook_url: str | None = None
    incoming_text_webhook_url: str | None = None

    def to_wire(self) -> dict[str, Any]:
        """Return a JSON-serializable dict matching the API schema."""
        if self.type == "toll_free" and self.state is not None:
            raise ValueError("state is only supported for local phone numbers")
        if self.incoming_call_action == "auto_accept" and self.client_websocket_url is None:
            raise ValueError("client_websocket_url is required for auto_accept")
        if self.incoming_call_action == "webhook" and self.incoming_call_webhook_url is None:
            raise ValueError("incoming_call_webhook_url is required for webhook")

        body: dict[str, Any] = {
            "type": self.type,
            "incoming_call_action": self.incoming_call_action,
        }
        if self.state is not None:
            body["state"] = self.state
        if self.client_websocket_url is not None:
            body["client_websocket_url"] = self.client_websocket_url
        if self.incoming_call_webhook_url is not None:
            body["incoming_call_webhook_url"] = self.incoming_call_webhook_url
        if self.incoming_text_webhook_url is not None:
            body["incoming_text_webhook_url"] = self.incoming_text_webhook_url
        return body


def vault_secret_ids_to_wire(
    value: UUID | str | list[UUID | str] | Literal["*", "all"] | None,
) -> str | list[str] | Literal["*", "all"] | None:
    """Return a JSON-serializable vault secret selection value."""
    if value in (None, "*", "all"):
        return value
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, str):
        return value
    return [str(item) for item in value]


@dataclass
class IdentityMailbox:
    """Mailbox channel linked to an agent identity.

    ``agent_identity_id`` mirrors the same field on :class:`Mailbox`;
    on the embedded variant it always equals the owning identity's ID.

    ``sending_domain`` is the bare domain the mailbox sends from, derived
    from ``email_address``.
    """

    id: UUID
    email_address: str
    display_name: str | None
    filter_mode: FilterMode
    created_at: datetime
    updated_at: datetime
    sending_domain: str = ""
    agent_identity_id: UUID | None = None
    filter_mode_change_notice: FilterModeChangeNotice | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IdentityMailbox:
        notice = d.get("filter_mode_change_notice")
        agent_identity_id = d.get("agent_identity_id")
        sending_domain = d.get("sending_domain")
        if not sending_domain:
            email_address = d["email_address"]
            _, _, sending_domain = email_address.partition("@")
        return cls(
            id=UUID(d["id"]),
            email_address=d["email_address"],
            sending_domain=sending_domain,
            display_name=d.get("display_name"),
            filter_mode=FilterMode(d.get("filter_mode", "blacklist")),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            agent_identity_id=UUID(agent_identity_id) if agent_identity_id else None,
            filter_mode_change_notice=(
                FilterModeChangeNotice._from_dict(notice) if notice else None
            ),
        )


@dataclass
class IdentityPhoneNumber:
    """Phone number channel linked to an agent identity.

    ``agent_identity_id`` mirrors the same field on :class:`PhoneNumber`;
    on the embedded variant it always equals the owning identity's ID.

    SMS-readiness fields (``sms_status``, ``sms_error_code``,
    ``sms_error_detail``, ``sms_ready_at``) mirror the same fields on
    :class:`PhoneNumber` and reflect 10DLC / TFV provisioning progress.
    """

    id: UUID
    number: str
    type: str
    status: str
    sms_status: SmsStatus
    incoming_call_action: str
    client_websocket_url: str | None
    incoming_text_webhook_url: str | None
    filter_mode: FilterMode
    created_at: datetime
    updated_at: datetime
    sms_error_code: str | None = None
    sms_error_detail: str | None = None
    sms_ready_at: datetime | None = None
    agent_identity_id: UUID | None = None
    filter_mode_change_notice: FilterModeChangeNotice | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IdentityPhoneNumber:
        notice = d.get("filter_mode_change_notice")
        agent_identity_id = d.get("agent_identity_id")
        raw_sms_status = d.get("sms_status")
        raw_sms_ready_at = d.get("sms_ready_at")
        return cls(
            id=UUID(d["id"]),
            number=d["number"],
            type=d["type"],
            status=d["status"],
            sms_status=SmsStatus(raw_sms_status) if raw_sms_status else SmsStatus.READY,
            incoming_call_action=d["incoming_call_action"],
            client_websocket_url=d.get("client_websocket_url"),
            incoming_text_webhook_url=d.get("incoming_text_webhook_url"),
            filter_mode=FilterMode(d.get("filter_mode", "blacklist")),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            sms_error_code=d.get("sms_error_code"),
            sms_error_detail=d.get("sms_error_detail"),
            sms_ready_at=(
                datetime.fromisoformat(raw_sms_ready_at) if raw_sms_ready_at else None
            ),
            agent_identity_id=UUID(agent_identity_id) if agent_identity_id else None,
            filter_mode_change_notice=(
                FilterModeChangeNotice._from_dict(notice) if notice else None
            ),
        )


@dataclass
class AgentIdentitySummary:
    """Lightweight agent identity returned by list and update endpoints."""

    id: UUID
    organization_id: str
    agent_handle: str
    email_address: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> AgentIdentitySummary:
        return cls(
            id=UUID(d["id"]),
            organization_id=d["organization_id"],
            agent_handle=d["agent_handle"],
            email_address=d.get("email_address"),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )


@dataclass
class _AgentIdentityData(AgentIdentitySummary):
    """
    Agent identity with linked communication channels.

    Returned by get, assign-mailbox, and assign-phone-number endpoints.
    Internal — users interact with AgentIdentity (the domain class) instead.
    """

    mailbox: IdentityMailbox | None = field(default=None)
    phone_number: IdentityPhoneNumber | None = field(default=None)

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> _AgentIdentityData:  # type: ignore[override]
        base = AgentIdentitySummary._from_dict(d)
        mailbox_data = d.get("mailbox")
        phone_data = d.get("phone_number")
        return cls(
            **base.__dict__,
            mailbox=IdentityMailbox._from_dict(mailbox_data) if mailbox_data else None,
            phone_number=IdentityPhoneNumber._from_dict(phone_data) if phone_data else None,
        )
