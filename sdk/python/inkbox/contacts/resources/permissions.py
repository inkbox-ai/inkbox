"""Effective yes/no contact permissions for one agent."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
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

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> ContactPermissions:
        """Read known fields while tolerating additive response fields."""
        return cls(emails=data["emails"], phones=data["phones"], profile=data["profile"], memories=data["memories"])


class ContactPermissionsResource:
    """Read and update selected-agent access using admin credentials."""

    def __init__(self, http: "HttpTransport") -> None:
        self._http = http

    def get(self, handle: str, contact_id: UUID | str) -> ContactPermissions:
        """Read effective yes/no access, including blocked identifiers."""
        return ContactPermissions._from_dict(self._http.get(
            f"/identities/{quote(handle, safe='')}/contacts/{quote(str(contact_id), safe='')}/permissions"))

    def update(self, handle: str, contact_id: UUID | str, *,
               emails: dict[str, bool] | None = None, phones: dict[str, bool] | None = None,
               profile: bool | None = None, memories: bool | None = None) -> ContactPermissions:
        """Save explicit choices; omitted fields and addresses stay unchanged."""
        body = {key: value for key, value in {
            "emails": emails, "phones": phones, "profile": profile, "memories": memories,
        }.items() if value is not None}
        if profile is False and (
            memories is True
            or any((emails or {}).values())
            or any((phones or {}).values())
        ):
            raise ValueError("Profile cannot be disabled while email, phone, or memories is enabled")
        return ContactPermissions._from_dict(self._http.patch(
            f"/identities/{quote(handle, safe='')}/contacts/{quote(str(contact_id), safe='')}/permissions", json=body))
