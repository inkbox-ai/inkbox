"""Contact facts and their supporting citations."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from inkbox.contacts.types import ContactFact, ContactFactCitationDetail

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class ContactFactsResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(self, contact_id: UUID | str) -> list[ContactFact]:
        data = self._http.get(f"/contacts/{contact_id}/facts")
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        return [ContactFact._from_dict(item) for item in items]

    def get(self, contact_id: UUID | str, fact_id: UUID | str) -> ContactFact:
        data = self._http.get(f"/contacts/{contact_id}/facts/{fact_id}")
        return ContactFact._from_dict(data)

    def resolve_citation(
        self,
        contact_id: UUID | str,
        fact_id: UUID | str,
        citation_id: UUID | str,
    ) -> ContactFactCitationDetail:
        data = self._http.get(
            f"/contacts/{contact_id}/facts/{fact_id}/citations/{citation_id}"
        )
        return ContactFactCitationDetail._from_dict(data)
