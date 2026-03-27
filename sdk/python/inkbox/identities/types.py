"""
inkbox/identities/types.py

Dataclasses mirroring the Inkbox Identities API response models.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from inkbox.vault.crypto import VaultKeyMaterial


class ResourceStatus(StrEnum):
    """
    Allowed lifecycle statuses for identity updates.
    """
    ACTIVE = "active"
    PAUSED = "paused"


@dataclass
class IdentityMailboxCreateOptions:
    """
    Optional mailbox payload nested under identity creation.

    Attributes:
        display_name: Optional human-readable mailbox name to set when the
            mailbox is created.
        email_local_part: Optional requested local part to use before the
            sending domain. If omitted, the server generates a random one.
    """

    display_name: str | None = None
    email_local_part: str | None = None

    def to_wire(self) -> dict[str, str]:
        """Return a JSON-serializable dict matching the API schema."""
        body: dict[str, str] = {}
        if self.display_name is not None:
            body["display_name"] = self.display_name
        if self.email_local_part is not None:
            body["email_local_part"] = self.email_local_part
        return body


@dataclass
class IdentityVaultInitializeRequest:
    """
    Vault initialization payload nested under identity creation.

    Attributes:
        vault_key: Primary vault key material to register for the new vault.
        recovery_keys: Exactly four recovery-key materials to register
            alongside the primary key.
    """

    vault_key: VaultKeyMaterial
    recovery_keys: list[VaultKeyMaterial]

    def to_wire(self) -> dict[str, Any]:
        """Return a JSON-serializable dict matching the API schema."""
        if len(self.recovery_keys) != 4:
            raise ValueError("recovery_keys must contain exactly 4 entries")
        return {
            "vault_key": self.vault_key.to_wire(),
            "recovery_keys": [key.to_wire() for key in self.recovery_keys],
        }


@dataclass
class IdentityMailbox:
    """Mailbox channel linked to an agent identity."""

    id: UUID
    email_address: str
    display_name: str | None
    status: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IdentityMailbox:
        return cls(
            id=UUID(d["id"]),
            email_address=d["email_address"],
            display_name=d.get("display_name"),
            status=d["status"],
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )


@dataclass
class IdentityPhoneNumber:
    """Phone number channel linked to an agent identity."""

    id: UUID
    number: str
    type: str
    status: str
    incoming_call_action: str
    client_websocket_url: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> IdentityPhoneNumber:
        return cls(
            id=UUID(d["id"]),
            number=d["number"],
            type=d["type"],
            status=d["status"],
            incoming_call_action=d["incoming_call_action"],
            client_websocket_url=d.get("client_websocket_url"),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )


@dataclass
class AgentIdentitySummary:
    """Lightweight agent identity returned by list and update endpoints."""

    id: UUID
    organization_id: str
    agent_handle: str
    status: str
    email_address: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> AgentIdentitySummary:
        return cls(
            id=UUID(d["id"]),
            organization_id=d["organization_id"],
            agent_handle=d["agent_handle"],
            status=d["status"],
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
