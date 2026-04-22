"""
inkbox/contacts/resources/contact_access.py

Per-contact access grant management.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.contacts.types import ContactAccess

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_BASE = "/contacts"


class ContactAccessResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(self, contact_id: UUID | str) -> list[ContactAccess]:
        """List grants for a single contact.

        Returns 404 from the server if the caller can't see the contact.
        """
        data = self._http.get(f"{_BASE}/{contact_id}/access")
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        return [ContactAccess._from_dict(a) for a in items]

    def grant(
        self,
        contact_id: UUID | str,
        *,
        identity_id: UUID | str | None = None,
        wildcard: bool = False,
    ) -> ContactAccess:
        """Grant access on a contact. Admin + JWT only.

        Args:
            identity_id: Identity to grant. Mutually exclusive with ``wildcard``.
            wildcard: If True, reset the contact to the wildcard grant
                (every active identity sees the contact).
        """
        if wildcard and identity_id is not None:
            raise ValueError("Pass either identity_id or wildcard=True, not both.")
        body: dict[str, Any] = {
            "identity_id": None if wildcard else str(identity_id) if identity_id is not None else None,
        }
        data = self._http.post(f"{_BASE}/{contact_id}/access", json=body)
        return ContactAccess._from_dict(data)

    def revoke(self, contact_id: UUID | str, identity_id: UUID | str) -> None:
        """Revoke a specific identity's access on a contact.

        Claimed-agent keys may only revoke their own grant; peer revokes
        receive 403.
        """
        self._http.delete(f"{_BASE}/{contact_id}/access/{identity_id}")
