"""
inkbox/identities/resources/identities.py

Identity CRUD and channel assignment.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.identities.types import (
    AgentIdentitySummary,
    IdentityMailboxCreateOptions,
    IdentityPhoneNumberCreateOptions,
    vault_secret_ids_to_wire,
    _AgentIdentityData,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class IdentitiesResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def create(
        self,
        *,
        agent_handle: str,
        mailbox: IdentityMailboxCreateOptions | None = None,
        phone_number: IdentityPhoneNumberCreateOptions | None = None,
        vault_secret_ids: UUID | str | list[UUID | str] | None = None,
    ) -> AgentIdentitySummary:
        """Create a new agent identity.

        Args:
            agent_handle: Unique handle for this identity within your organisation
                (e.g. ``"sales-agent"`` or ``"@sales-agent"``).
            mailbox: Optional mailbox payload to create and link a mailbox
                during identity creation.
            phone_number: Optional phone-number provisioning payload.
            vault_secret_ids: Optional vault secret selection to attach to the
                new identity. Use ``"*"``, ``"all"``, a single UUID/string, or
                a list of UUIDs/strings.

        Returns:
            The created identity. ``email_address`` is populated only when a
            mailbox was created for the identity.
        """
        body: dict[str, Any] = {"agent_handle": agent_handle}
        if mailbox is not None:
            body["mailbox"] = mailbox.to_wire()
        if phone_number is not None:
            body["phone_number"] = phone_number.to_wire()
        if vault_secret_ids is not None:
            body["vault_secret_ids"] = vault_secret_ids_to_wire(vault_secret_ids)
        data = self._http.post("/", json=body)
        return AgentIdentitySummary._from_dict(data)

    def list(self) -> list[AgentIdentitySummary]:
        """List all identities for your organisation."""
        data = self._http.get("/")
        return [AgentIdentitySummary._from_dict(i) for i in data]

    def get(self, agent_handle: str) -> _AgentIdentityData:
        """Get an identity with its linked channels (mailbox, phone number).

        Args:
            agent_handle: Handle of the identity to fetch.
        """
        data = self._http.get(f"/{agent_handle}")
        return _AgentIdentityData._from_dict(data)

    def update(
        self,
        agent_handle: str,
        *,
        new_handle: str | None = None,
    ) -> AgentIdentitySummary:
        """Update an identity's handle.

        Only provided fields are applied; omitted fields are left unchanged.

        Args:
            agent_handle: Current handle of the identity to update.
            new_handle: New handle value.
        """
        body: dict[str, Any] = {}
        if new_handle is not None:
            body["agent_handle"] = new_handle
        data = self._http.patch(f"/{agent_handle}", json=body)
        return AgentIdentitySummary._from_dict(data)

    def delete(self, agent_handle: str) -> None:
        """Delete an identity.

        Unlinks any assigned channels without deleting them.

        Args:
            agent_handle: Handle of the identity to delete.
        """
        self._http.delete(f"/{agent_handle}")

    def assign_mailbox(
        self,
        agent_handle: str,
        *,
        mailbox_id: UUID | str,
    ) -> _AgentIdentityData:
        """Assign a mailbox to an identity.

        Args:
            agent_handle: Handle of the identity.
            mailbox_id: UUID of the mailbox to assign.
        """
        data = self._http.post(
            f"/{agent_handle}/mailbox",
            json={"mailbox_id": str(mailbox_id)},
        )
        return _AgentIdentityData._from_dict(data)

    def unlink_mailbox(self, agent_handle: str) -> None:
        """Unlink the mailbox from an identity (does not delete the mailbox).

        Args:
            agent_handle: Handle of the identity.
        """
        self._http.delete(f"/{agent_handle}/mailbox")

    def assign_phone_number(
        self,
        agent_handle: str,
        *,
        phone_number_id: UUID | str,
    ) -> _AgentIdentityData:
        """Assign a phone number to an identity.

        Args:
            agent_handle: Handle of the identity.
            phone_number_id: UUID of the phone number to assign.
        """
        data = self._http.post(
            f"/{agent_handle}/phone_number",
            json={"phone_number_id": str(phone_number_id)},
        )
        return _AgentIdentityData._from_dict(data)

    def unlink_phone_number(self, agent_handle: str) -> None:
        """Unlink the phone number from an identity (does not delete the number).

        Args:
            agent_handle: Handle of the identity.
        """
        self._http.delete(f"/{agent_handle}/phone_number")
