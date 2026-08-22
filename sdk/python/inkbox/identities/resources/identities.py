"""
inkbox/identities/resources/identities.py

Identity CRUD. Mailbox and tunnel are provisioned atomically by
``create()``; there is no standalone mailbox / tunnel create surface.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal
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
from inkbox.imessage.types import _validate_idempotency_key

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
        imessage_enabled: bool | None = None,
        contact_sharing_enabled: bool | None = None,
        claim_imessage_number: Literal[True] | None = None,
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
            imessage_enabled: Whether the identity can use iMessage. Omit to
                defer to the server default (``False``).
            contact_sharing_enabled: Whether an attached dedicated iMessage
                line automatically shares this identity's name and optional
                avatar. Omit to defer to the server default (``True``).
            claim_imessage_number: Claim and attach a new dedicated iMessage
                line atomically. Requires
                ``imessage_enabled=True``.
            mailbox: Optional nested mailbox spec.
            tunnel: Optional nested tunnel spec (tls_mode only).
            phone_number: Optional phone-number provisioning payload.
            vault_secret_ids: Optional vault secret selection to attach.

        Returns:
            The created identity with ``mailbox`` and ``tunnel``
            populated from the atomic create response.
        """
        if claim_imessage_number is not None and claim_imessage_number is not True:
            raise ValueError("claim_imessage_number must be True when supplied")
        body: dict[str, Any] = {"agent_handle": agent_handle}
        if display_name is not None:
            body["display_name"] = display_name
        if description is not _UNSET:
            body["description"] = description
        if imessage_enabled is not None:
            body["imessage_enabled"] = imessage_enabled
        if contact_sharing_enabled is not None:
            body["contact_sharing_enabled"] = contact_sharing_enabled
        if claim_imessage_number is True:
            if imessage_enabled is not True:
                raise ValueError(
                    "claim_imessage_number requires imessage_enabled=True"
                )
        if claim_imessage_number is True:
            body["claim_imessage_number"] = True
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
        """List identities, including hydrated fields when provided."""
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
        imessage_enabled: bool | None = None,
        contact_sharing_enabled: bool | None = None,
        imessage_number_id: UUID | str | None = _UNSET,  # type: ignore[assignment]
        claim_imessage_number: Literal[True] | None = None,
        idempotency_key: str | None = None,
        imessage_filter_mode: str | None = None,
        mail_filter_mode: str | None = None,
        phone_filter_mode: str | None = None,
    ) -> _AgentIdentityData:
        """Update an identity's handle, display name, description,
        iMessage reachability, and contact-rule filter modes.

        Only provided fields are applied; omitted fields are left
        unchanged. For ``display_name`` and ``description``, explicit
        ``None`` clears the column; omitting the keyword argument leaves
        it untouched (distinguished via an internal ``_UNSET`` sentinel).

        Args:
            agent_handle: Current handle of the identity to update.
            new_handle: New handle value.
            display_name: New display name, or ``None`` to clear.
            description: New description, or ``None`` to clear.
            imessage_enabled: Toggle iMessage reachability.
            contact_sharing_enabled: Toggle automatic name and optional photo
                sharing for an attached dedicated iMessage line.
            imessage_number_id: Attach an already-owned dedicated line by
                UUID, pass ``None`` to move back to the shared service, or
                omit to leave the current attachment unchanged.
            claim_imessage_number: Claim and attach a new dedicated iMessage
                line. Cannot be combined with
                ``imessage_number_id`` and requires ``idempotency_key``.
            idempotency_key: Stable caller-generated key for a dedicated-line
                claim. Reuse the same value when retrying the same update.
            imessage_filter_mode: ``"whitelist"`` or ``"blacklist"`` for
                iMessage contact rules (admin-only).
            mail_filter_mode: ``"whitelist"`` or ``"blacklist"`` for this
                identity's mail contact rules (admin-only).
            phone_filter_mode: ``"whitelist"`` or ``"blacklist"`` for this
                identity's phone contact rules (admin-only). The server
                rejects this with 422 when the identity has no phone number.
        """
        if claim_imessage_number is not None and claim_imessage_number is not True:
            raise ValueError("claim_imessage_number must be True when supplied")
        body: dict[str, Any] = {}
        if new_handle is not None:
            body["agent_handle"] = new_handle
        if display_name is not _UNSET:
            body["display_name"] = display_name
        if description is not _UNSET:
            body["description"] = description
        if imessage_enabled is not None:
            body["imessage_enabled"] = imessage_enabled
        if contact_sharing_enabled is not None:
            body["contact_sharing_enabled"] = contact_sharing_enabled
        if claim_imessage_number is True and imessage_number_id is not _UNSET:
            raise ValueError(
                "claim_imessage_number and imessage_number_id cannot be set together"
            )
        if claim_imessage_number is True:
            if imessage_enabled is False:
                raise ValueError(
                    "claim_imessage_number cannot be set while disabling iMessage"
                )
            if idempotency_key is None:
                raise ValueError(
                    "idempotency_key is required with claim_imessage_number"
                )
        if claim_imessage_number is True:
            body["claim_imessage_number"] = True
        if imessage_number_id is not _UNSET:
            if imessage_number_id is not None and imessage_enabled is False:
                raise ValueError(
                    "imessage_number_id cannot be set while disabling iMessage"
                )
            body["imessage_number_id"] = (
                str(imessage_number_id)
                if imessage_number_id is not None
                else None
            )
        if imessage_filter_mode is not None:
            body["imessage_filter_mode"] = imessage_filter_mode
        if mail_filter_mode is not None:
            body["mail_filter_mode"] = mail_filter_mode
        if phone_filter_mode is not None:
            body["phone_filter_mode"] = phone_filter_mode
        headers = None
        if idempotency_key is not None:
            headers = {
                "Idempotency-Key": _validate_idempotency_key(idempotency_key),
            }
        try:
            if headers is None:
                data = self._http.patch(f"/{agent_handle}", json=body)
            else:
                data = self._http.patch(
                    f"/{agent_handle}", json=body, headers=headers,
                )
        except InkboxAPIError as err:
            raise map_identity_conflict_error(err) from err
        return _AgentIdentityData._from_dict(data)

    def delete(self, agent_handle: str) -> None:
        """Delete an identity.

        Cascades: flips the linked mailbox to ``deleted``, force-finalizes
        the linked tunnel to ``deleted``, revokes any identity-scoped
        API keys, and releases any linked phone number (vendor + local).
        """
        self._http.delete(f"/{agent_handle}")

    def release_phone_number(self, agent_handle: str) -> None:
        """Release the identity's phone number (vendor + local).

        Released at the carrier; the number is not available for
        reassignment afterwards.
        """
        self._http.delete(f"/{agent_handle}/phone_number")
