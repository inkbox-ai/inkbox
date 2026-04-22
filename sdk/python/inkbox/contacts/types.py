"""
inkbox/contacts/types.py

Dataclasses for the org-scoped Contacts API.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from uuid import UUID


def _opt_uuid(value: Any) -> UUID | None:
    return UUID(str(value)) if value is not None else None


def _opt_date(value: Any) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value) if isinstance(value, str) else value


@dataclass
class ContactEmail:
    """An email address on a contact card."""

    label: str | None
    value: str
    is_primary: bool = False

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ContactEmail:
        return cls(
            label=d.get("label"),
            value=d["value"],
            is_primary=bool(d.get("is_primary", False)),
        )

    def to_wire(self) -> dict[str, Any]:
        body: dict[str, Any] = {"value": self.value}
        if self.label is not None:
            body["label"] = self.label
        if self.is_primary:
            body["is_primary"] = True
        return body


@dataclass
class ContactPhone:
    """A phone number on a contact card (stored E.164)."""

    label: str | None
    value: str
    is_primary: bool = False

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ContactPhone:
        return cls(
            label=d.get("label"),
            value=d["value_e164"],
            is_primary=bool(d.get("is_primary", False)),
        )

    def to_wire(self) -> dict[str, Any]:
        body: dict[str, Any] = {"value_e164": self.value}
        if self.label is not None:
            body["label"] = self.label
        if self.is_primary:
            body["is_primary"] = True
        return body


@dataclass
class ContactWebsite:
    label: str | None
    value: str

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ContactWebsite:
        return cls(label=d.get("label"), value=d["url"])

    def to_wire(self) -> dict[str, Any]:
        body: dict[str, Any] = {"url": self.value}
        if self.label is not None:
            body["label"] = self.label
        return body


@dataclass
class ContactDate:
    label: str | None
    value: date

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ContactDate:
        return cls(label=d.get("label"), value=date.fromisoformat(d["date"]))

    def to_wire(self) -> dict[str, Any]:
        body: dict[str, Any] = {"date": self.value.isoformat()}
        if self.label is not None:
            body["label"] = self.label
        return body


@dataclass
class ContactAddress:
    label: str | None
    street: str | None
    city: str | None
    region: str | None
    postal_code: str | None
    country: str | None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ContactAddress:
        return cls(
            label=d.get("label"),
            street=d.get("street"),
            city=d.get("city"),
            region=d.get("region"),
            postal_code=d.get("postal"),
            country=d.get("country"),
        )

    def to_wire(self) -> dict[str, Any]:
        body: dict[str, Any] = {}
        for name in ("label", "street", "city", "region", "country"):
            value = getattr(self, name)
            if value is not None:
                body[name] = value
        if self.postal_code is not None:
            body["postal"] = self.postal_code
        return body


@dataclass
class ContactCustomField:
    label: str
    value: str

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ContactCustomField:
        return cls(label=d["label"], value=d["value"])

    def to_wire(self) -> dict[str, Any]:
        return {"label": self.label, "value": self.value}


@dataclass
class ContactAccess:
    """A single access grant on a contact.

    ``identity_id=None`` means the grant is a wildcard — every active
    identity can see the contact.
    """

    id: UUID
    contact_id: UUID
    identity_id: UUID | None
    created_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ContactAccess:
        return cls(
            id=UUID(d["id"]),
            contact_id=UUID(d["contact_id"]),
            identity_id=_opt_uuid(d.get("identity_id")),
            created_at=datetime.fromisoformat(d["created_at"]),
        )


@dataclass
class Contact:
    """A contact (address-book entry) owned by your organisation."""

    id: UUID
    preferred_name: str | None
    name_prefix: str | None
    given_name: str | None
    middle_name: str | None
    family_name: str | None
    name_suffix: str | None
    company_name: str | None
    job_title: str | None
    birthday: date | None
    notes: str | None
    emails: list[ContactEmail] = field(default_factory=list)
    phones: list[ContactPhone] = field(default_factory=list)
    websites: list[ContactWebsite] = field(default_factory=list)
    dates: list[ContactDate] = field(default_factory=list)
    addresses: list[ContactAddress] = field(default_factory=list)
    custom_fields: list[ContactCustomField] = field(default_factory=list)
    access: list[ContactAccess] = field(default_factory=list)
    organization_id: str | None = None
    status: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.fromtimestamp(0))
    updated_at: datetime = field(default_factory=lambda: datetime.fromtimestamp(0))

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> Contact:
        return cls(
            id=UUID(d["id"]),
            preferred_name=d.get("preferred_name"),
            name_prefix=d.get("name_prefix"),
            given_name=d.get("given_name"),
            middle_name=d.get("middle_name"),
            family_name=d.get("family_name"),
            name_suffix=d.get("name_suffix"),
            company_name=d.get("company_name"),
            job_title=d.get("job_title"),
            birthday=_opt_date(d.get("birthday")),
            notes=d.get("notes"),
            emails=[ContactEmail._from_dict(e) for e in d.get("emails") or []],
            phones=[ContactPhone._from_dict(p) for p in d.get("phones") or []],
            websites=[ContactWebsite._from_dict(w) for w in d.get("websites") or []],
            dates=[ContactDate._from_dict(dt) for dt in d.get("dates") or []],
            addresses=[ContactAddress._from_dict(a) for a in d.get("addresses") or []],
            custom_fields=[
                ContactCustomField._from_dict(c) for c in d.get("custom_fields") or []
            ],
            access=[ContactAccess._from_dict(a) for a in d.get("access") or []],
            organization_id=d.get("organization_id"),
            status=d.get("status"),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )


@dataclass
class ContactImportResultItem:
    """One card's result inside a bulk vCard import response.

    Attributes:
        index: 0-based position within the uploaded vCard stream.
        status: ``"created"`` if the card was stored, ``"error"`` otherwise.
        contact: The resulting :class:`Contact` when ``status == "created"``;
            ``None`` otherwise.
        error: The rejection reason when ``status == "error"``; ``None`` when
            the card was created successfully.
    """

    index: int
    status: str
    contact: "Contact | None" = None
    error: str | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ContactImportResultItem:
        contact_payload = d.get("contact")
        return cls(
            index=int(d["index"]),
            status=str(d["status"]),
            contact=Contact._from_dict(contact_payload) if contact_payload else None,
            error=d.get("error"),
        )


@dataclass
class ContactImportResult:
    """Result of a bulk vCard import (always 200 when the request parsed).

    Attributes:
        created_count: Number of cards that were stored.
        error_count: Number of cards that failed to parse / validate.
        results: Per-card outcome in submission order.
    """

    created_count: int
    error_count: int
    results: list[ContactImportResultItem] = field(default_factory=list)

    @property
    def created_ids(self) -> list[UUID]:
        """IDs of successfully-created contacts, in submission order."""
        return [item.contact.id for item in self.results if item.contact is not None]

    @property
    def errors(self) -> list[ContactImportResultItem]:
        """Only the items whose ``status == "error"``."""
        return [item for item in self.results if item.status == "error"]

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ContactImportResult:
        return cls(
            created_count=int(d["created_count"]),
            error_count=int(d["error_count"]),
            results=[
                ContactImportResultItem._from_dict(r) for r in d.get("results") or []
            ],
        )
