"""Contact entries in email and phone communication lists."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID

from inkbox.contacts.types import Contact

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

ContactDecision = Literal["inherit", "allow", "block"]


@dataclass(frozen=True)
class ContactChannelDecisions:
    """Contact entries for email and phone (SMS, calls, and iMessage)."""
    email: ContactDecision = "inherit"
    phone: ContactDecision = "inherit"


@dataclass(frozen=True)
class ContactIdentityDecisions:
    """One identity's overrides of a contact's default entries."""
    identity_id: UUID | str
    email: ContactDecision = "inherit"
    phone: ContactDecision = "inherit"


@dataclass(frozen=True)
class ContactVisibilityDecisions:
    """Independent profile and memory visibility decisions."""
    profile: ContactDecision
    memories: ContactDecision


@dataclass(frozen=True)
class ContactIdentityVisibilityDecisions:
    """An identity's overrides of contact visibility defaults."""
    identity_id: UUID | str
    profile: ContactDecision
    memories: ContactDecision


@dataclass(frozen=True)
class ContactVisibilityPolicy:
    """Complete visibility defaults and identity overrides."""
    defaults: ContactVisibilityDecisions
    identities: list[ContactIdentityVisibilityDecisions]

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> ContactVisibilityPolicy:
        """Parse the visibility portion of a policy."""
        return cls(ContactVisibilityDecisions(**data["defaults"]), [
            ContactIdentityVisibilityDecisions(UUID(row["identity_id"]), row["profile"], row["memories"])
            for row in data["identities"]
        ])

    def _to_wire(self) -> dict[str, Any]:
        """Serialize identity UUIDs without changing the communication portion."""
        return {"defaults": asdict(self.defaults), "identities": [
            {**asdict(row), "identity_id": str(row.identity_id)} for row in self.identities
        ]}


@dataclass(frozen=True)
class ContactVisibilityResult:
    """Effective permissions even when a group contains no data."""
    profile: bool
    memories: bool


@dataclass(frozen=True)
class ContactCommunicationPolicy:
    """A contact's default entries, overrides, and current revision."""
    contact_id: UUID
    revision: int
    defaults: ContactChannelDecisions
    identities: list[ContactIdentityDecisions]
    visibility: ContactVisibilityPolicy | None = None

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> ContactCommunicationPolicy:
        """Parse a policy response."""
        return cls(UUID(data["contact_id"]), data["revision"], ContactChannelDecisions(**data["defaults"]),
                   [ContactIdentityDecisions(identity_id=UUID(row["identity_id"]), email=row["email"], phone=row["phone"])
                     for row in data["identities"]],
                   ContactVisibilityPolicy._from_dict(data["visibility"]) if data.get("visibility") is not None else None)


@dataclass(frozen=True)
class ContactCommunicationPreview:
    """The contact data visible to one identity."""
    identity_id: UUID
    contact: Contact | None
    email: bool
    phone: bool
    full_profile: bool
    visibility: ContactVisibilityResult | None = None

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> ContactCommunicationPreview:
        """Parse a permission-filtered contact preview."""
        return cls(UUID(data["identity_id"]), Contact._from_dict(data["contact"]) if data["contact"] else None,
                   data["email"], data["phone"], data["full_profile"],
                   ContactVisibilityResult(**data["visibility"]) if data.get("visibility") is not None else None)


@dataclass(frozen=True)
class ContactCommunicationPolicyPage:
    """A bounded page of effective contact permissions."""
    items: list[ContactCommunicationPreview]
    limit: int
    offset: int
    has_more: bool


class ContactCommunicationPolicyResource:
    """Manage contact communication entries with admin credentials."""

    def __init__(self, http: HttpTransport) -> None:
        """Use the client's authenticated API transport."""
        self._http = http

    def get(self, contact_id: UUID | str) -> ContactCommunicationPolicy:
        """Read a contact's policy and current revision."""
        return ContactCommunicationPolicy._from_dict(self._http.get(f"/contacts/{contact_id}/communication-policy"))

    def replace(self, contact_id: UUID | str, *, expected_revision: int,
                defaults: ContactChannelDecisions, identities: list[ContactIdentityDecisions],
                visibility: ContactVisibilityPolicy | None = None) -> ContactCommunicationPolicy:
        """Replace settings; omitted visibility is preserved and stale revisions return 409."""
        body = {
            "expected_revision": expected_revision, "defaults": asdict(defaults),
            "identities": [{**asdict(row), "identity_id": str(row.identity_id)} for row in identities],
        }
        if visibility is not None:
            body["visibility"] = visibility._to_wire()
        result = self._http.put(f"/contacts/{contact_id}/communication-policy", json=body)
        return ContactCommunicationPolicy._from_dict(result)

    def preview(self, contact_id: UUID | str, identity_id: UUID | str) -> ContactCommunicationPreview:
        """Preview an identity's contact visibility using admin credentials."""
        return ContactCommunicationPreview._from_dict(self._http.get(
            f"/contacts/{contact_id}/communication-preview", params={"identity_id": str(identity_id)},
        ))

    def list_for_identity(self, agent_handle: str, *, limit: int = 50, offset: int = 0) -> ContactCommunicationPolicyPage:
        """List visible contact permissions for an identity."""
        result = self._http.get(f"/identities/{agent_handle}/contact-communication-policies",
                                params={"limit": limit, "offset": offset})
        return ContactCommunicationPolicyPage([ContactCommunicationPreview._from_dict(row) for row in result["items"]],
                                               result["limit"], result["offset"], result["has_more"])
