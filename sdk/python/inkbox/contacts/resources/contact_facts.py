"""Contact facts and their supporting citations."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit
from uuid import UUID

from inkbox.contacts.types import (
    ContactFact,
    ContactFactCitationDetail,
    ContactFactDeleteResult,
    ContactFactKind,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class ContactFactsResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        contact_id: UUID | str,
        *,
        include_expired: bool = False,
    ) -> list[ContactFact]:
        """List a contact's facts.

        Args:
            contact_id: Contact whose facts to list.
            include_expired: Also return context facts whose ``expires_at``
                has passed. They are left out by default; locked facts remain
                active and stay in the default list.
        """
        params: dict[str, Any] = {}
        if include_expired:
            params["include_expired"] = True
        data = self._http.get(f"/contacts/{contact_id}/facts", params=params)
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        return [ContactFact._from_dict(item) for item in items]

    def get(self, contact_id: UUID | str, fact_id: UUID | str) -> ContactFact:
        data = self._http.get(f"/contacts/{contact_id}/facts/{fact_id}")
        return ContactFact._from_dict(data)

    def create(
        self,
        contact_id: UUID | str,
        *,
        content: str,
        kind: ContactFactKind | str,
    ) -> ContactFact:
        """Record a fact by hand. Requires an admin-scoped API key; an
        agent-scoped key is rejected with 403.

        Hand-written facts never expire, whatever their kind. The call fails
        with 409 when the contact is already at its limit for that kind.
        """
        data = self._http.post(
            f"/contacts/{contact_id}/facts",
            json={"content": content, "kind": str(kind)},
        )
        return ContactFact._from_dict(data)

    def update(
        self,
        contact_id: UUID | str,
        fact_id: UUID | str,
        *,
        content: str | None = None,
        kind: ContactFactKind | str | None = None,
    ) -> ContactFact:
        """Edit a fact's content or kind. Requires an admin-scoped API key; an
        agent-scoped key is rejected with 403.

        At least one of ``content`` and ``kind`` is required. Any edit makes the
        fact user-authored, clears its expiry, and revives it if it had expired.
        Editing content also drops the citations and confidence recorded for
        the old wording; editing only the kind leaves them in place.
        """
        body: dict[str, Any] = {}
        if content is not None:
            body["content"] = content
        if kind is not None:
            body["kind"] = str(kind)
        if not body:
            raise ValueError("update() requires content or kind")
        data = self._http.patch(
            f"/contacts/{contact_id}/facts/{fact_id}",
            json=body,
        )
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
        """Delete a fact using an admin-scoped API key."""
        data = self._http.delete_with_response(
            f"/contacts/{contact_id}/facts/{fact_id}"
        )
        return ContactFactDeleteResult._from_dict(data)
