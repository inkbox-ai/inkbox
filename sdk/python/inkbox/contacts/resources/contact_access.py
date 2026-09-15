"""
inkbox/contacts/resources/contact_access.py

Selected-agent visibility and communication access, plus compatibility metadata.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from urllib.parse import quote
from uuid import UUID

from inkbox.contacts.types import ContactAccess, ContactAccessSettings, ContactChannelAccessUpdate

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_BASE = "/contacts"


class ContactAccessResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def get(self, handle: str, contact_id: UUID | str) -> ContactAccessSettings:
        """Read group visibility and contactable addresses using admin credentials."""
        data = self._http.get(
            f"/identities/{quote(handle, safe='')}/contacts/{quote(str(contact_id), safe='')}/access"
        )
        return ContactAccessSettings._from_dict(data)

    def update(
        self,
        handle: str,
        contact_id: UUID | str,
        *,
        email: ContactChannelAccessUpdate | None = None,
        phone: ContactChannelAccessUpdate | None = None,
        profile: bool | None = None,
        memories: bool | None = None,
    ) -> ContactAccessSettings:
        """Save partial access choices; hiding Profile also hides omitted groups."""
        body: dict[str, Any] = {
            key: value
            for key, value in (("profile", profile), ("memories", memories))
            if value is not None
        }
        for key, group in (("email", email), ("phone", phone)):
            if group is not None:
                body[key] = group.to_wire()
        if profile is False and (
            memories is True
            or any(
                group is not None and (group.visible is True or bool(group.contactable))
                for group in (email, phone)
            )
        ):
            raise ValueError("Profile cannot be disabled while email, phone, or memories is enabled")
        data = self._http.patch(
            f"/identities/{quote(handle, safe='')}/contacts/{quote(str(contact_id), safe='')}/access",
            json=body,
        )
        return ContactAccessSettings._from_dict(data)

    def list(self, contact_id: UUID | str) -> list[ContactAccess]:
        """List deprecated read-only compatibility metadata for a contact.

        Communication policies, not these records, control contact visibility.
        """
        data = self._http.get(f"{_BASE}/{contact_id}/access")
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        return [ContactAccess._from_dict(a) for a in items]
