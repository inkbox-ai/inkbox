"""Effective yes/no contact permissions for one agent."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from urllib.parse import quote
from uuid import UUID
from inkbox.contact_rules import _UNSET

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


@dataclass(frozen=True)
class ContactPermissions:
    """Phone permissions cover SMS, calls, and iMessage."""

    emails: dict[str, bool]
    phones: dict[str, bool]
    profile: bool
    memories: bool
    inbound_emails: dict[str, bool] | None = None
    outbound_emails: dict[str, bool] | None = None
    inbound_phones: dict[str, bool] | None = None
    outbound_phones: dict[str, bool] | None = None

    def __post_init__(self) -> None:
        for channel in ("emails", "phones"):
            for side in ("inbound", "outbound"):
                name = f"{side}_{channel}"
                if getattr(self, name) is None:
                    object.__setattr__(self, name, dict(getattr(self, channel)))
            object.__setattr__(self, channel, dict(getattr(self, f"outbound_{channel}")))

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> ContactPermissions:
        """Read known fields while tolerating additive response fields."""
        return cls(emails=data["emails"], phones=data["phones"], profile=data["profile"], memories=data["memories"],
                   inbound_emails=data.get("inbound_emails"), outbound_emails=data.get("outbound_emails"),
                   inbound_phones=data.get("inbound_phones"), outbound_phones=data.get("outbound_phones"))


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
               profile: bool | None = None, memories: bool | None = None,
               inbound_emails: dict[str, bool] = _UNSET,  # type: ignore[assignment]
               outbound_emails: dict[str, bool] = _UNSET,  # type: ignore[assignment]
               inbound_phones: dict[str, bool] = _UNSET,  # type: ignore[assignment]
               outbound_phones: dict[str, bool] = _UNSET,  # type: ignore[assignment]
               ) -> ContactPermissions:
        """Save explicit choices; omitted fields and addresses stay unchanged."""
        body = {key: value for key, value in {
            "emails": emails, "phones": phones, "profile": profile, "memories": memories,
        }.items() if value is not None}
        for channel, shared, inbound, outbound in (
            ("emails", emails, inbound_emails, outbound_emails),
            ("phones", phones, inbound_phones, outbound_phones),
        ):
            if shared is not None and (inbound is not _UNSET or outbound is not _UNSET):
                raise ValueError(f"Cannot combine shared and directional {channel}")
            for side, values in (("inbound", inbound), ("outbound", outbound)):
                if values is not _UNSET:
                    if values is None:
                        raise ValueError("Directional permissions cannot be null")
                    if profile is False and any(values.values()):
                        raise ValueError("Profile cannot be disabled while email or phone is enabled")
                    body[f"{side}_{channel}"] = values
        if profile is False and (
            memories is True
            or any((emails or {}).values())
            or any((phones or {}).values())
        ):
            raise ValueError("Profile cannot be disabled while email, phone, or memories is enabled")
        return ContactPermissions._from_dict(self._http.patch(
            f"/identities/{quote(handle, safe='')}/contacts/{quote(str(contact_id), safe='')}/permissions", json=body))
