"""Contact facts and their supporting citations."""

from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import urlsplit
from uuid import UUID

from inkbox.contacts.types import (
    ContactFact,
    ContactFactCitationDetail,
    ContactFactDeleteResult,
)

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

    def resolve_citation_url(self, source_url: str) -> ContactFactCitationDetail:
        """Resolve the authorized URL returned on an available citation."""
        parsed = urlsplit(source_url)
        path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        if path.startswith("/api/v1/"):
            path = path[len("/api/v1"):]
        if not path.startswith("/contacts/"):
            raise ValueError("source_url must be a contact citation URL")
        return ContactFactCitationDetail._from_dict(self._http.get(path))

    def delete(
        self,
        contact_id: UUID | str,
        fact_id: UUID | str,
    ) -> ContactFactDeleteResult:
        """Delete a fact using an organization-wide credential."""
        data = self._http.delete_with_response(
            f"/contacts/{contact_id}/facts/{fact_id}"
        )
        return ContactFactDeleteResult._from_dict(data)
