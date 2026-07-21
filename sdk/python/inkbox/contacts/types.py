"""
inkbox/contacts/types.py

Dataclasses for the org-scoped Contacts API.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any
from uuid import UUID


def _opt_uuid(value: Any) -> UUID | None:
    return UUID(str(value)) if value is not None else None


def _opt_date(value: Any) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value) if isinstance(value, str) else value


def _opt_datetime(value: Any) -> datetime | None:
    return datetime.fromisoformat(value) if isinstance(value, str) else value


class ContactCreationSource(StrEnum):
    MANUAL = "manual"
    VCARD = "vcard"
    COMMUNICATION = "communication"
    BACKFILL = "backfill"


class ContactReviewStatus(StrEnum):
    UNREVIEWED = "unreviewed"
    CONFIRMED = "confirmed"


class ContactNameSource(StrEnum):
    MANUAL = "manual"
    VCARD = "vcard"
    PROVIDER = "provider"
    MAIL_HEADER = "mail_header"
    IDENTIFIER_FALLBACK = "identifier_fallback"


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
    creation_source: ContactCreationSource = ContactCreationSource.BACKFILL
    review_status: ContactReviewStatus = ContactReviewStatus.CONFIRMED
    reviewed_at: datetime | None = None
    reviewed_by: str | None = None
    preferred_name_source: ContactNameSource = ContactNameSource.MANUAL
    preferred_name_locked_at: datetime | None = None
    created_by_identity_id: UUID | None = None
    merged_into_contact_id: UUID | None = None
    is_auto_created: bool = False
    is_confirmed: bool = True
    memory_count: int | None = None
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
            creation_source=ContactCreationSource(d.get("creation_source", "backfill")),
            review_status=ContactReviewStatus(d.get("review_status", "confirmed")),
            reviewed_at=_opt_datetime(d.get("reviewed_at")),
            reviewed_by=d.get("reviewed_by"),
            preferred_name_source=ContactNameSource(
                d.get("preferred_name_source", "manual")
            ),
            preferred_name_locked_at=_opt_datetime(d.get("preferred_name_locked_at")),
            created_by_identity_id=_opt_uuid(d.get("created_by_identity_id")),
            merged_into_contact_id=_opt_uuid(d.get("merged_into_contact_id")),
            is_auto_created=bool(d.get("is_auto_created", False)),
            is_confirmed=bool(d.get("is_confirmed", True)),
            memory_count=d.get("memory_count"),
            organization_id=d.get("organization_id"),
            status=d.get("status"),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )


class CorrespondenceChannel(StrEnum):
    EMAIL = "email"
    SMS = "sms"
    IMESSAGE = "imessage"
    CALLS = "calls"


class CorrespondenceContentMode(StrEnum):
    METADATA = "metadata"
    PREVIEW = "preview"
    FULL = "full"


class CorrespondenceTranscriptMode(StrEnum):
    NONE = "none"
    ABRIDGED = "abridged"
    FULL = "full"


class CorrespondenceOrder(StrEnum):
    ASC = "asc"
    DESC = "desc"


class CorrespondenceChannelStatus(StrEnum):
    AVAILABLE = "available"
    NO_IDENTIFIER = "no_identifier"
    NO_RESOURCE = "no_resource"


class CorrespondenceDirection(StrEnum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"


class CorrespondenceTranscriptMarker(StrEnum):
    ABRIDGED = "abridged"


class ContactFactCitationAvailability(StrEnum):
    AVAILABLE = "available"
    PURGED = "purged"
    SOURCE_UNAVAILABLE_TO_CALLER = "source_unavailable_to_caller"


class ContactFactOrigin(StrEnum):
    GENERATED = "generated"
    USER = "user"


@dataclass
class ContactFactCitation:
    source_type: str
    availability: ContactFactCitationAvailability
    source_id: UUID | None = None
    source_url: str | None = None
    source_locator: dict[str, Any] | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ContactFactCitation:
        return cls(
            source_type=d["source_type"],
            availability=ContactFactCitationAvailability(d["availability"]),
            source_id=_opt_uuid(d.get("source_id")),
            source_url=d.get("source_url"),
            source_locator=d.get("source_locator"),
        )


@dataclass
class ContactFact:
    id: UUID
    contact_id: UUID
    content: str
    confidence: Decimal | None
    origin: ContactFactOrigin
    locked_at: datetime | None
    created_at: datetime
    updated_at: datetime
    citations: list[ContactFactCitation] = field(default_factory=list)

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ContactFact:
        confidence = d.get("confidence")
        return cls(
            id=UUID(d["id"]),
            contact_id=UUID(d["contact_id"]),
            content=d["content"],
            confidence=Decimal(str(confidence)) if confidence is not None else None,
            origin=ContactFactOrigin(d["origin"]),
            locked_at=_opt_datetime(d.get("locked_at")),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            citations=[
                ContactFactCitation._from_dict(c) for c in d.get("citations") or []
            ],
        )


@dataclass
class ContactFactCitationDetail:
    source_type: str
    source_id: UUID
    source_locator: dict[str, Any]
    source_url: str | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ContactFactCitationDetail:
        return cls(
            source_type=d["source_type"],
            source_id=UUID(d["source_id"]),
            source_locator=d["source_locator"],
            source_url=d.get("source_url"),
        )


@dataclass
class CorrespondenceMediaMetadata:
    count: int


@dataclass
class CorrespondenceAttachmentMetadata:
    filename: str | None = None
    content_type: str | None = None
    size: int | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> CorrespondenceAttachmentMetadata:
        return cls(
            filename=d.get("filename"),
            content_type=d.get("content_type"),
            size=d.get("size"),
        )


@dataclass
class CorrespondenceTranscriptEntry:
    id: UUID | None = None
    seq: int | None = None
    party: str | None = None
    text: str | None = None
    ts_ms: int | None = None
    marker: CorrespondenceTranscriptMarker | None = None
    omitted_turns: int | None = None
    omitted_ms: int | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> CorrespondenceTranscriptEntry:
        return cls(
            id=_opt_uuid(d.get("id")),
            seq=d.get("seq"),
            party=d.get("party"),
            text=d.get("text"),
            ts_ms=d.get("ts_ms"),
            marker=(
                CorrespondenceTranscriptMarker(d["marker"])
                if d.get("marker") is not None
                else None
            ),
            omitted_turns=d.get("omitted_turns"),
            omitted_ms=d.get("omitted_ms"),
        )


@dataclass
class CorrespondenceItem:
    source_id: UUID
    direction: CorrespondenceDirection
    occurred_at: datetime
    identity_id: UUID
    status: str | None
    detail_url: str | None
    channel: CorrespondenceChannel


@dataclass
class EmailCorrespondenceItem(CorrespondenceItem):
    mailbox_email: str
    from_address: str
    to_addresses: list[str]
    thread_id: UUID | None = None
    cc_addresses: list[str] = field(default_factory=list)
    bcc_addresses: list[str] = field(default_factory=list)
    subject: str | None = None
    snippet: str | None = None
    body_text: str | None = None
    content_unavailable: bool = False
    attachments: list[CorrespondenceAttachmentMetadata] = field(default_factory=list)


@dataclass
class SmsCorrespondenceItem(CorrespondenceItem):
    conversation_id: UUID
    local_resource_id: UUID
    local_phone_number: str
    participants: list[str]
    matched_contact_phone: str
    is_group: bool
    sender_phone_number: str | None = None
    text: str | None = None
    media: CorrespondenceMediaMetadata | None = None


@dataclass
class IMessageCorrespondenceItem(CorrespondenceItem):
    conversation_id: UUID
    remote_handle: str
    service: str
    text: str | None = None
    media: CorrespondenceMediaMetadata | None = None


@dataclass
class CallCorrespondenceItem(CorrespondenceItem):
    remote_phone_number: str
    local_phone_number: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    duration_seconds: int | None = None
    transcript: list[CorrespondenceTranscriptEntry] | None = None
    transcript_abridged: bool = False
    transcript_unavailable: bool = False


@dataclass
class CorrespondenceChannelResult:
    channel: CorrespondenceChannel
    status: CorrespondenceChannelStatus
    returned: int

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> CorrespondenceChannelResult:
        return cls(
            channel=CorrespondenceChannel(d["channel"]),
            status=CorrespondenceChannelStatus(d["status"]),
            returned=int(d["returned"]),
        )


@dataclass
class ContactCorrespondence:
    contact_id: UUID
    identity_id: UUID
    items: list[CorrespondenceItem]
    channels: list[CorrespondenceChannelResult]
    next_cursor: str | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ContactCorrespondence:
        return cls(
            contact_id=UUID(d["contact_id"]),
            identity_id=UUID(d["identity_id"]),
            items=[_parse_correspondence_item(item) for item in d.get("items") or []],
            channels=[
                CorrespondenceChannelResult._from_dict(c)
                for c in d.get("channels") or []
            ],
            next_cursor=d.get("next_cursor"),
        )


def _parse_correspondence_item(d: dict[str, Any]) -> CorrespondenceItem:
    channel = CorrespondenceChannel(d["channel"])
    common = {
        "source_id": UUID(d["source_id"]),
        "direction": CorrespondenceDirection(d["direction"]),
        "occurred_at": datetime.fromisoformat(d["occurred_at"]),
        "identity_id": UUID(d["identity_id"]),
        "status": d.get("status"),
        "detail_url": d.get("detail_url"),
        "channel": channel,
    }
    if channel is CorrespondenceChannel.EMAIL:
        return EmailCorrespondenceItem(
            **common,
            mailbox_email=d["mailbox_email"],
            thread_id=_opt_uuid(d.get("thread_id")),
            from_address=d["from_address"],
            to_addresses=d["to_addresses"],
            cc_addresses=d.get("cc_addresses") or [],
            bcc_addresses=d.get("bcc_addresses") or [],
            subject=d.get("subject"),
            snippet=d.get("snippet"),
            body_text=d.get("body_text"),
            content_unavailable=bool(d.get("content_unavailable", False)),
            attachments=[
                CorrespondenceAttachmentMetadata._from_dict(a)
                for a in d.get("attachments") or []
            ],
        )
    media = d.get("media")
    parsed_media = CorrespondenceMediaMetadata(count=media["count"]) if media else None
    if channel is CorrespondenceChannel.SMS:
        return SmsCorrespondenceItem(
            **common,
            conversation_id=UUID(d["conversation_id"]),
            local_resource_id=UUID(d["local_resource_id"]),
            local_phone_number=d["local_phone_number"],
            sender_phone_number=d.get("sender_phone_number"),
            participants=d["participants"],
            matched_contact_phone=d["matched_contact_phone"],
            is_group=d["is_group"],
            text=d.get("text"),
            media=parsed_media,
        )
    if channel is CorrespondenceChannel.IMESSAGE:
        return IMessageCorrespondenceItem(
            **common,
            conversation_id=UUID(d["conversation_id"]),
            remote_handle=d["remote_handle"],
            service=d["service"],
            text=d.get("text"),
            media=parsed_media,
        )
    transcript = d.get("transcript")
    return CallCorrespondenceItem(
        **common,
        remote_phone_number=d["remote_phone_number"],
        local_phone_number=d.get("local_phone_number"),
        started_at=_opt_datetime(d.get("started_at")),
        ended_at=_opt_datetime(d.get("ended_at")),
        duration_seconds=d.get("duration_seconds"),
        transcript=[CorrespondenceTranscriptEntry._from_dict(t) for t in transcript]
        if transcript is not None
        else None,
        transcript_abridged=bool(d.get("transcript_abridged", False)),
        transcript_unavailable=bool(d.get("transcript_unavailable", False)),
    )


class ContactImportStatus(StrEnum):
    CREATED = "created"
    CONFLICT = "conflict"
    ERROR = "error"


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
    status: ContactImportStatus
    contact: "Contact | None" = None
    error: str | None = None
    conflicting_contact_id: UUID | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ContactImportResultItem:
        contact_payload = d.get("contact")
        return cls(
            index=int(d["index"]),
            status=ContactImportStatus(d["status"]),
            contact=Contact._from_dict(contact_payload) if contact_payload else None,
            error=d.get("error"),
            conflicting_contact_id=_opt_uuid(d.get("conflicting_contact_id")),
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
        return [item for item in self.results if item.status is ContactImportStatus.ERROR]

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> ContactImportResult:
        return cls(
            created_count=int(d["created_count"]),
            error_count=int(d["error_count"]),
            results=[
                ContactImportResultItem._from_dict(r) for r in d.get("results") or []
            ],
        )
