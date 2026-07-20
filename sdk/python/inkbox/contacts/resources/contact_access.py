"""
inkbox/contacts/resources/contact_access.py

Read-only compatibility access information.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from inkbox.contacts.types import ContactAccess

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_BASE = "/contacts"


class ContactAccessResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(self, contact_id: UUID | str) -> list[ContactAccess]:
        """List compatibility access rows for a single contact.

        Returns 404 from the server if the caller can't see the contact.
        """
        data = self._http.get(f"{_BASE}/{contact_id}/access")
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        return [ContactAccess._from_dict(a) for a in items]
