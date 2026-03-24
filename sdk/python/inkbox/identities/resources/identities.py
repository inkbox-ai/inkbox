"""
inkbox/identities/resources/identities.py

Identity CRUD and channel assignment.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.identities.types import AgentIdentitySummary, _AgentIdentityData

if TYPE_CHECKING:
    from inkbox.identities._http import HttpTransport


class IdentitiesResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def create(self, *, agent_handle: str) -> AgentIdentitySummary:
        """Create a new agent identity.

        Args:
            agent_handle: Unique handle for this identity within your organisation
                (e.g. ``"sales-agent"`` or ``"@sales-agent"``).

        Returns:
            The created identity.
        """
        data = self._http.post("/", json={"agent_handle": agent_handle})
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
        status: str | None = None,
    ) -> AgentIdentitySummary:
        """Update an identity's handle or status.

        Only provided fields are applied; omitted fields are left unchanged.

        Args:
            agent_handle: Current handle of the identity to update.
            new_handle: New handle value.
            status: New lifecycle status: ``"active"`` or ``"paused"``.
        """
        body: dict[str, Any] = {}
        if new_handle is not None:
            body["agent_handle"] = new_handle
        if status is not None:
            body["status"] = status
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

