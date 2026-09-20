"""Contact entries in email and phone communication lists."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID
from inkbox.contact_rules import ContactRuleDirection, _UNSET, _direction_fields

from inkbox.contacts.types import Contact, ContactAccessSettings, ContactEmail, ContactPhone, ContactReviewStatus

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

ContactDecision = Literal["inherit", "allow", "block"]


@dataclass(frozen=True)
class ContactAddressPermission:
    """Explicit and effective access for a selected agent's exact address."""
    kind: Literal["email", "phone"]
    value: str
    label: str | None
    action: ContactDecision
    allowed: bool
    inbound_action: ContactDecision | None = None
    outbound_action: ContactDecision | None = None
    allowed_inbound: bool | None = None
    allowed_outbound: bool | None = None

    @classmethod
    def _from_dict(cls, row: dict[str, Any]) -> ContactAddressPermission:
        return cls(row["kind"], row["value"], row["label"],
                   row.get("outbound_action", row["action"]),
                   row.get("allowed_outbound", row["allowed"]),
                   row.get("inbound_action", row["action"]),
                   row.get("outbound_action", row["action"]),
                   row.get("allowed_inbound", row["allowed"]),
                   row.get("allowed_outbound", row["allowed"]))


@dataclass(frozen=True)
class ContactAddressUpdate:
    """Edit an exact-address choice using its observed explicit decision."""
    kind: Literal["email", "phone"]
    value: str
    action: ContactDecision
    expected_action: ContactDecision = _UNSET  # type: ignore[assignment]
    direction: ContactRuleDirection | str = _UNSET  # type: ignore[assignment]
    expected_inbound_action: ContactDecision = _UNSET  # type: ignore[assignment]
    expected_outbound_action: ContactDecision = _UNSET  # type: ignore[assignment]

    def to_wire(self) -> dict[str, Any]:
        body = {"kind": self.kind, "value": self.value, "action": self.action,
                **_direction_fields(self.direction)}
        for name in ("expected_action", "expected_inbound_action", "expected_outbound_action"):
            value = getattr(self, name)
            if value is not _UNSET:
                if value not in ("inherit", "allow", "block"):
                    raise ValueError(f"Invalid {name}")
                body[name] = value
        direction = body.get("direction", "both")
        sides = ("inbound", "outbound") if direction == "both" else (direction,)
        if self.expected_action is _UNSET and any(
            getattr(self, f"expected_{side}_action") is _UNSET for side in sides
        ):
            raise ValueError("Provide expected_action or expected actions for every edited direction")
        return body


@dataclass(frozen=True)
class ContactVisibilityDecisions:
    """Profile and dependent memory visibility decisions."""
    profile: ContactDecision
    memories: ContactDecision

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> ContactVisibilityDecisions:
        return cls(profile=data["profile"], memories=data["memories"])


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
        return cls(ContactVisibilityDecisions._from_dict(data["defaults"]), [
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

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> ContactVisibilityResult:
        return cls(profile=data["profile"], memories=data["memories"])


@dataclass(frozen=True)
class ContactCommunicationPolicy:
    """Selected-agent address access and contact-level visibility settings."""
    contact_id: UUID
    revision: int
    identity_id: UUID | None
    addresses: list[ContactAddressPermission]
    effective_visibility: ContactVisibilityResult | None
    visibility: ContactVisibilityPolicy

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> ContactCommunicationPolicy:
        """Parse a policy response."""
        return cls(UUID(data["contact_id"]), data["revision"],
                   UUID(data["identity_id"]) if data["identity_id"] else None,
                   [ContactAddressPermission._from_dict(row) for row in data["addresses"]],
                   ContactVisibilityResult._from_dict(data["effective_visibility"]) if data["effective_visibility"] is not None else None,
                   ContactVisibilityPolicy._from_dict(data["visibility"]))


@dataclass(frozen=True)
class ContactCommunicationPreview:
    """The contact data visible to one identity."""
    identity_id: UUID
    contact: Contact | None
    email: bool
    phone: bool
    full_profile: bool
    visibility: ContactVisibilityResult
    inbound_email: bool | None = None
    outbound_email: bool | None = None
    inbound_phone: bool | None = None
    outbound_phone: bool | None = None

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> ContactCommunicationPreview:
        """Parse a permission-filtered contact preview."""
        return cls(UUID(data["identity_id"]), Contact._from_dict(data["contact"]) if data["contact"] else None,
                   data["email"], data["phone"], data["full_profile"],
                   ContactVisibilityResult._from_dict(data["visibility"]),
                   data.get("inbound_email"), data.get("outbound_email"),
                   data.get("inbound_phone"), data.get("outbound_phone"))


@dataclass(frozen=True)
class ContactCommunicationPolicyPage:
    """A bounded page of effective contact permissions."""
    items: list[ContactCommunicationPreview]
    limit: int
    offset: int
    has_more: bool


IdentifierPermission = Literal["all", "some", "none", "no_identifiers"]


@dataclass(frozen=True)
class ContactPermissionSummary:
    """Compact contact identification for permission management."""
    id: UUID
    preferred_name: str | None
    given_name: str | None
    family_name: str | None
    company_name: str | None
    review_status: ContactReviewStatus
    emails: list[ContactEmail]
    phones: list[ContactPhone]


@dataclass(frozen=True)
class ContactPermissionVisibility:
    """Visibility defaults and one identity's overrides."""
    defaults: ContactVisibilityDecisions
    identity_override: ContactVisibilityDecisions


@dataclass(frozen=True)
class ContactPermissionEffective:
    """Identifier coverage and Profile-gated memory permissions."""
    email: IdentifierPermission
    phone: IdentifierPermission
    profile: bool
    memories: bool
    inbound_email: IdentifierPermission | None = None
    outbound_email: IdentifierPermission | None = None
    inbound_phone: IdentifierPermission | None = None
    outbound_phone: IdentifierPermission | None = None


@dataclass(frozen=True)
class ContactPermissionEntry:
    """Human-managed settings including contacts hidden from the identity."""
    contact: ContactPermissionSummary
    revision: int
    visibility: ContactPermissionVisibility
    effective: ContactPermissionEffective
    access: ContactAccessSettings | None = None

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> ContactPermissionEntry:
        """Parse a compact management row without inventing full contact fields."""
        contact = data["contact"]
        return cls(
            ContactPermissionSummary(UUID(contact["id"]), contact["preferred_name"], contact["given_name"],
                contact["family_name"], contact["company_name"], ContactReviewStatus(contact["review_status"]),
                [ContactEmail._from_dict(row) for row in contact["emails"]],
                [ContactPhone._from_dict(row) for row in contact["phones"]]),
            data["revision"],
            ContactPermissionVisibility(ContactVisibilityDecisions._from_dict(data["visibility"]["defaults"]),
                ContactVisibilityDecisions._from_dict(data["visibility"]["identity_override"])),
            ContactPermissionEffective(email=data["effective"]["email"], phone=data["effective"]["phone"],
                                       profile=data["effective"]["profile"], memories=data["effective"]["memories"],
                                       inbound_email=data["effective"].get("inbound_email", data["effective"]["email"]),
                                       outbound_email=data["effective"].get("outbound_email", data["effective"]["email"]),
                                       inbound_phone=data["effective"].get("inbound_phone", data["effective"]["phone"]),
                                       outbound_phone=data["effective"].get("outbound_phone", data["effective"]["phone"])),
            ContactAccessSettings._from_dict(data["access"]) if data.get("access") is not None else None,
        )


@dataclass(frozen=True)
class ContactPermissionPage:
    """A bounded contact-permission management roster."""
    items: list[ContactPermissionEntry]
    limit: int
    offset: int
    has_more: bool


class ContactCommunicationPolicyResource:
    """Manage contact communication entries with admin credentials."""

    def __init__(self, http: HttpTransport) -> None:
        """Use the client's authenticated API transport."""
        self._http = http

    def get(self, contact_id: UUID | str, identity_id: UUID | str | None = None) -> ContactCommunicationPolicy:
        """Read a contact's policy and current revision."""
        return ContactCommunicationPolicy._from_dict(self._http.get(f"/contacts/{contact_id}/communication-policy",
            params={"identity_id": str(identity_id)} if identity_id is not None else {}))

    def replace(self, contact_id: UUID | str, *, expected_revision: int,
                identity_id: UUID | str, addresses: list[ContactAddressUpdate],
                visibility: ContactVisibilityPolicy | None = None) -> ContactCommunicationPolicy:
        """Replace settings; omitted visibility is preserved and stale revisions return 409."""
        if visibility is not None:
            defaults_profile = visibility.defaults.profile != "block"
            if not defaults_profile and visibility.defaults.memories != "block":
                raise ValueError("Profile cannot be disabled while memories is enabled")
            profiles = {}
            for row in visibility.identities:
                profile = defaults_profile if row.profile == "inherit" else row.profile == "allow"
                memories = (
                    visibility.defaults.memories != "block"
                    if row.memories == "inherit"
                    else row.memories == "allow"
                )
                if not profile and memories:
                    raise ValueError("Profile cannot be disabled while memories is enabled")
                profiles[str(row.identity_id)] = profile
            if not profiles.get(str(identity_id), defaults_profile) and any(
                row.action == "allow" for row in addresses
            ):
                raise ValueError("Profile cannot be disabled while email or phone is enabled")
        body = {
            "expected_revision": expected_revision, "identity_id": str(identity_id),
            "addresses": [row.to_wire() for row in addresses],
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

    def list_management_for_identity(
        self, agent_handle: str, *, q: str | None = None, order: Literal["name", "recent"] = "recent",
        limit: int = 50, offset: int = 0, review_status: list[ContactReviewStatus] | None = None,
    ) -> ContactPermissionPage:
        """List organization contacts and effective permissions using admin credentials."""
        params: dict[str, Any] = {"limit": limit, "offset": offset, "order": order}
        if q is not None:
            params["q"] = q
        if review_status:
            params["review_status"] = [status.value for status in review_status]
        result = self._http.get(f"/identities/{agent_handle}/contact-permissions", params=params)
        return ContactPermissionPage([ContactPermissionEntry._from_dict(row) for row in result["items"]],
                                     result["limit"], result["offset"], result["has_more"])
