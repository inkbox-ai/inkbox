"""
inkbox/contacts/resources/vcards.py

vCard import / export.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from inkbox.contacts.types import ContactImportResult

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_BASE = "/contacts"
_VCARD_CONTENT_TYPE = "text/vcard"


class VCardsResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def import_vcards(
        self,
        content: str | bytes,
        *,
        content_type: str = _VCARD_CONTENT_TYPE,
    ) -> ContactImportResult:
        """Bulk-import vCards.

        Args:
            content: Raw vCard text or bytes. The server caps payload size at
                5 MiB and at most 1000 cards. Zero cards returns 422.
            content_type: MIME type to send. Defaults to ``text/vcard``;
                ``text/x-vcard`` is also accepted.
        """
        body = content.encode("utf-8") if isinstance(content, str) else content
        data = self._http.post_bytes(
            f"{_BASE}/import",
            content=body,
            content_type=content_type,
        )
        return ContactImportResult._from_dict(data)

    def export_vcard(self, contact_id: UUID | str) -> str:
        """Export a single contact as vCard 4.0 text.

        Returns the raw vCard body as a UTF-8 string.
        """
        data = self._http.get_bytes(
            f"{_BASE}/{contact_id}.vcf",
            accept=_VCARD_CONTENT_TYPE,
        )
        return data.decode("utf-8")
