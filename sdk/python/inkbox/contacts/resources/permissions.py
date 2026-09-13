"""Effective yes/no contact permissions for one agent."""

from dataclasses import dataclass
from typing import TYPE_CHECKING
from urllib.parse import quote
from uuid import UUID

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


@dataclass(frozen=True)
class ContactPermissions:
    """Phone permissions cover SMS, calls, and iMessage."""

    emails: dict[str, bool]
    phones: dict[str, bool]
    profile: bool
    memories: bool


class ContactPermissionsResource:
    """Read and update selected-agent access using admin credentials."""

    def __init__(self, http: "HttpTransport") -> None:
        self._http = http

    def get(self, handle: str, contact_id: UUID | str) -> ContactPermissions:
        """Read effective yes/no access, including blocked identifiers."""
        return ContactPermissions(**self._http.get(
            f"/identities/{quote(handle, safe='')}/contacts/{quote(str(contact_id), safe='')}/permissions"))

    def update(self, handle: str, contact_id: UUID | str, *,
               emails: dict[str, bool] | None = None, phones: dict[str, bool] | None = None,
               profile: bool | None = None, memories: bool | None = None) -> ContactPermissions:
        """Save explicit choices; omitted fields and addresses stay unchanged."""
        body = {key: value for key, value in {
            "emails": emails, "phones": phones, "profile": profile, "memories": memories,
        }.items() if value is not None}
        return ContactPermissions(**self._http.patch(
            f"/identities/{quote(handle, safe='')}/contacts/{quote(str(contact_id), safe='')}/permissions", json=body))
