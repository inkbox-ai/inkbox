"""
inkbox/contacts/resources/contacts.py

Contacts CRUD + search + lookup.
"""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID

from inkbox.contacts.resources.contact_access import ContactAccessResource
from inkbox.contacts.resources.contact_facts import ContactFactsResource
from inkbox.contacts.resources.correspondence import ContactCorrespondenceResource
from inkbox.contacts.resources.vcards import VCardsResource
from inkbox.contacts.types import (
    Contact,
    ContactAddress,
    ContactBulkDeleteResult,
    ContactCustomField,
    ContactDate,
    ContactEmail,
    ContactPhone,
    ContactReviewStatus,
    ContactWebsite,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_BASE = "/contacts"
_UNSET = object()


def _items_to_wire(items: list[Any] | None) -> list[dict[str, Any]] | None:
    if items is None:
        return None
    return [item.to_wire() if hasattr(item, "to_wire") else item for item in items]


class ContactsResource:
    """Organization-wide contacts and contact memory."""

    def __init__(self, http: HttpTransport) -> None:
        self._http = http
        self._access = ContactAccessResource(http)
        self._facts = ContactFactsResource(http)
        self._correspondence = ContactCorrespondenceResource(http)
        self._vcards = VCardsResource(http)

    @property
    def access(self) -> ContactAccessResource:
        """Compatibility access records (read-only)."""
        return self._access

    @property
    def facts(self) -> ContactFactsResource:
        """Facts recorded for contacts."""
        return self._facts

    @property
    def correspondence(self) -> ContactCorrespondenceResource:
        """Correspondence across contact channels."""
        return self._correspondence

    @property
    def vcards(self) -> VCardsResource:
        """vCard import / export."""
        return self._vcards

    def list(
        self,
        *,
        q: str | None = None,
        order: Literal["name", "recent"] | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        review_status: list[ContactReviewStatus | str] | None = None,
    ) -> list[Contact]:
        """List contacts with optional substring search.

        Args:
            q: Optional case-insensitive substring filter across
                ``preferred_name``, ``given_name``, ``family_name``,
                ``company_name``, ``job_title``, and ``notes``. Max 100 chars.
            order: ``"name"`` or ``"recent"`` sort order (server default applies).
            limit: Max rows to return.
            offset: Offset for paging, from 0 through 10,000.
            review_status: Review states to include.
        """
        params: dict[str, Any] = {}
        if q is not None:
            params["q"] = q
        if order is not None:
            params["order"] = order
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        if review_status is not None:
            params["review_status"] = [str(status) for status in review_status]
        data = self._http.get(_BASE, params=params)
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        return [Contact._from_dict(c) for c in items]

    def lookup(
        self,
        *,
        email: str | None = None,
        email_contains: str | None = None,
        email_domain: str | None = None,
        phone: str | None = None,
        phone_contains: str | None = None,
    ) -> list[Contact]:
        """Reverse-lookup contacts by a single field.

        Exactly one of the five arguments must be supplied; passing zero or
        more than one raises ``ValueError`` before hitting the server.
        """
        supplied = {
            "email": email,
            "email_contains": email_contains,
            "email_domain": email_domain,
            "phone": phone,
            "phone_contains": phone_contains,
        }
        non_none = {k: v for k, v in supplied.items() if v is not None}
        if len(non_none) != 1:
            raise ValueError(
                "lookup() requires exactly one of: email, email_contains, "
                "email_domain, phone, phone_contains.",
            )
        data = self._http.get(f"{_BASE}/lookup", params=non_none)
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        return [Contact._from_dict(c) for c in items]

    def get(self, contact_id: UUID | str) -> Contact:
        """Fetch a single contact by id."""
        data = self._http.get(f"{_BASE}/{contact_id}")
        return Contact._from_dict(data)

    def create(
        self,
        *,
        preferred_name: str | None = None,
        name_prefix: str | None = None,
        given_name: str | None = None,
        middle_name: str | None = None,
        family_name: str | None = None,
        name_suffix: str | None = None,
        company_name: str | None = None,
        job_title: str | None = None,
        birthday: date | str | None = None,
        notes: str | None = None,
        emails: list[ContactEmail] | None = None,
        phones: list[ContactPhone] | None = None,
        websites: list[ContactWebsite] | None = None,
        dates: list[ContactDate] | None = None,
        addresses: list[ContactAddress] | None = None,
        custom_fields: list[ContactCustomField] | None = None,
    ) -> Contact:
        """Create a new contact.

        Args:
            birthday: Optional ISO date (``YYYY-MM-DD``) or :class:`datetime.date`.
        """
        body: dict[str, Any] = {}
        for name, value in (
            ("preferred_name", preferred_name),
            ("name_prefix", name_prefix),
            ("given_name", given_name),
            ("middle_name", middle_name),
            ("family_name", family_name),
            ("name_suffix", name_suffix),
            ("company_name", company_name),
            ("job_title", job_title),
            ("notes", notes),
        ):
            if value is not None:
                body[name] = value
        if birthday is not None:
            body["birthday"] = (
                birthday.isoformat() if isinstance(birthday, date) else birthday
            )
        for name, items in (
            ("emails", emails),
            ("phones", phones),
            ("websites", websites),
            ("dates", dates),
            ("addresses", addresses),
            ("custom_fields", custom_fields),
        ):
            wire = _items_to_wire(items)
            if wire is not None:
                body[name] = wire
        data = self._http.post(_BASE, json=body)
        return Contact._from_dict(data)

    def update(
        self,
        contact_id: UUID | str,
        *,
        preferred_name: str | None = _UNSET,  # type: ignore[assignment]
        name_prefix: str | None = _UNSET,  # type: ignore[assignment]
        given_name: str | None = _UNSET,  # type: ignore[assignment]
        middle_name: str | None = _UNSET,  # type: ignore[assignment]
        family_name: str | None = _UNSET,  # type: ignore[assignment]
        name_suffix: str | None = _UNSET,  # type: ignore[assignment]
        company_name: str | None = _UNSET,  # type: ignore[assignment]
        job_title: str | None = _UNSET,  # type: ignore[assignment]
        birthday: date | str | None = _UNSET,  # type: ignore[assignment]
        notes: str | None = _UNSET,  # type: ignore[assignment]
        emails: list[ContactEmail] | None = _UNSET,  # type: ignore[assignment]
        phones: list[ContactPhone] | None = _UNSET,  # type: ignore[assignment]
        websites: list[ContactWebsite] | None = _UNSET,  # type: ignore[assignment]
        dates: list[ContactDate] | None = _UNSET,  # type: ignore[assignment]
        addresses: list[ContactAddress] | None = _UNSET,  # type: ignore[assignment]
        custom_fields: list[ContactCustomField] | None = _UNSET,  # type: ignore[assignment]
        review_status: ContactReviewStatus | str = _UNSET,  # type: ignore[assignment]
    ) -> Contact:
        """JSON-merge-patch update.

        Only provided fields are sent; omit a field to leave it unchanged.
        Pass a scalar as ``None`` to clear it.
        """
        body: dict[str, Any] = {}
        scalar_fields = (
            ("preferred_name", preferred_name),
            ("name_prefix", name_prefix),
            ("given_name", given_name),
            ("middle_name", middle_name),
            ("family_name", family_name),
            ("name_suffix", name_suffix),
            ("company_name", company_name),
            ("job_title", job_title),
            ("notes", notes),
        )
        for name, value in scalar_fields:
            if value is not _UNSET:
                body[name] = value
        if review_status is not _UNSET:
            body["review_status"] = review_status
        if birthday is not _UNSET:
            body["birthday"] = (
                birthday.isoformat() if isinstance(birthday, date) else birthday
            )
        list_fields = (
            ("emails", emails),
            ("phones", phones),
            ("websites", websites),
            ("dates", dates),
            ("addresses", addresses),
            ("custom_fields", custom_fields),
        )
        for name, items in list_fields:
            if items is _UNSET:
                continue
            body[name] = _items_to_wire(items) if items is not None else None
        data = self._http.patch(f"{_BASE}/{contact_id}", json=body)
        return Contact._from_dict(data)

    def merge(
        self,
        contact_id: UUID | str,
        *,
        losing_contact_ids: list[UUID | str],
        field_sources: dict[str, UUID | str] | None = None,
    ) -> Contact:
        """Merge contacts into the contact identified by ``contact_id``."""
        body = {
            "losing_contact_ids": [str(value) for value in losing_contact_ids],
            "field_sources": {
                name: str(value) for name, value in (field_sources or {}).items()
            },
        }
        data = self._http.post(f"{_BASE}/{contact_id}/merge", json=body)
        return Contact._from_dict(data)

    def delete(self, contact_id: UUID | str) -> None:
        """Delete a contact."""
        self._http.delete(f"{_BASE}/{contact_id}")

    def bulk_delete(
        self,
        contact_ids: list[UUID | str],
    ) -> ContactBulkDeleteResult:
        """Delete multiple contacts and return per-contact outcomes."""
        data = self._http.post(
            f"{_BASE}/bulk-delete",
            json={"contact_ids": [str(contact_id) for contact_id in contact_ids]},
        )
        return ContactBulkDeleteResult._from_dict(data)
