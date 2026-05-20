"""
inkbox/identities/resources/identities.py

Identity CRUD. Mailbox and tunnel are provisioned atomically by
``create()``; there is no standalone mailbox / tunnel create surface.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.exceptions import InkboxAPIError
from inkbox.identities.exceptions import map_identity_conflict_error
from inkbox.identities.types import (
    _UNSET,
    AgentIdentitySummary,
    IdentityMailboxCreateOptions,
    IdentityPhoneNumberCreateOptions,
    IdentityTunnelCreateOptions,
    _AgentIdentityData,
    vault_secret_ids_to_wire,
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
        display_name: str | None = None,
        description: Any = _UNSET,
        mailbox: IdentityMailboxCreateOptions | None = None,
        tunnel: IdentityTunnelCreateOptions | None = None,
        phone_number: IdentityPhoneNumberCreateOptions | None = None,
        vault_secret_ids: UUID | str | list[UUID | str] | None = None,
    ) -> _AgentIdentityData:
        """Create a new agent identity. Atomically provisions the
        identity's mailbox and tunnel; both are returned nested on the
        response.

        Args:
            agent_handle: Unique handle, globally unique across all orgs
                (the handle shares its namespace with tunnel names). May
                be passed with or without a leading ``@``.
            display_name: Human-readable identity name. Defaults
                server-side to ``agent_handle``.
            description: Free-form org-internal description. Pass
                ``None`` to leave the column null; omit entirely to defer
                to the server default.
            mailbox: Optional nested mailbox spec.
            tunnel: Optional nested tunnel spec (tls_mode only).
            phone_number: Optional phone-number provisioning payload.
            vault_secret_ids: Optional vault secret selection to attach.

        Returns:
            The created identity with ``mailbox`` and ``tunnel``
            populated from the atomic create response.
        """
        body: dict[str, Any] = {"agent_handle": agent_handle}
        if display_name is not None:
            body["display_name"] = display_name
        if description is not _UNSET:
            body["description"] = description
        if mailbox is not None:
            body["mailbox"] = mailbox.to_wire()
        if tunnel is not None:
            body["tunnel"] = tunnel.to_wire()
        if phone_number is not None:
            body["phone_number"] = phone_number.to_wire()
        if vault_secret_ids is not None:
            body["vault_secret_ids"] = vault_secret_ids_to_wire(vault_secret_ids)
        try:
            data = self._http.post("/", json=body)
        except InkboxAPIError as err:
            raise map_identity_conflict_error(err) from err
        return _AgentIdentityData._from_dict(data)

    def list(self) -> list[AgentIdentitySummary]:
        """List all identities for your organisation."""
        data = self._http.get("/")
        return [AgentIdentitySummary._from_dict(i) for i in data]

    def get(self, agent_handle: str) -> _AgentIdentityData:
        """Get an identity with its linked channels (mailbox, phone
        number, tunnel)."""
        data = self._http.get(f"/{agent_handle}")
        return _AgentIdentityData._from_dict(data)

    def update(
        self,
        agent_handle: str,
        *,
        new_handle: str | None = None,
        display_name: Any = _UNSET,
        description: Any = _UNSET,
        status: str | None = None,
    ) -> AgentIdentitySummary:
        """Update an identity's handle, display name, description, and/or
        status.

        Only provided fields are applied; omitted fields are left
        unchanged. For ``display_name`` and ``description``, explicit
        ``None`` clears the column; omitting the keyword argument leaves
        it untouched (distinguished via an internal ``_UNSET`` sentinel).

        Args:
            agent_handle: Current handle of the identity to update.
            new_handle: New handle value.
            display_name: New display name, or ``None`` to clear.
            description: New description, or ``None`` to clear.
            status: ``"active"`` or ``"paused"``. Call :meth:`delete`
                to remove an identity; ``"deleted"`` is rejected here.
        """
        body: dict[str, Any] = {}
        if new_handle is not None:
            body["agent_handle"] = new_handle
        if display_name is not _UNSET:
            body["display_name"] = display_name
        if description is not _UNSET:
            body["description"] = description
        if status is not None:
            body["status"] = status
        try:
            data = self._http.patch(f"/{agent_handle}", json=body)
        except InkboxAPIError as err:
            raise map_identity_conflict_error(err) from err
        return AgentIdentitySummary._from_dict(data)

    def delete(self, agent_handle: str) -> None:
        """Delete an identity.

        Cascades: flips the linked mailbox to ``deleted``, force-finalizes
        the linked tunnel to ``deleted``, revokes any identity-scoped
        API keys, and releases any linked phone number (vendor + local).
        """
        self._http.delete(f"/{agent_handle}")

    def unlink_phone_number(self, agent_handle: str) -> None:
        """Release the identity's phone number (vendor + local).

        Released at the carrier; the number is not available for
        reassignment afterwards.
        """
        self._http.delete(f"/{agent_handle}/phone_number")
