"""
inkbox/notes/resources/note_access.py

Per-note access grant management. No wildcards.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from inkbox.notes.types import NoteAccess

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_BASE = "/notes"


class NoteAccessResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(self, note_id: UUID | str) -> list[NoteAccess]:
        data = self._http.get(f"{_BASE}/{note_id}/access")
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        return [NoteAccess._from_dict(a) for a in items]

    def grant(self, note_id: UUID | str, *, identity_id: UUID | str) -> NoteAccess:
        """Grant access on a note. Admin + JWT only."""
        data = self._http.post(
            f"{_BASE}/{note_id}/access",
            json={"identity_id": str(identity_id)},
        )
        return NoteAccess._from_dict(data)

    def revoke(self, note_id: UUID | str, identity_id: UUID | str) -> None:
        """Revoke a specific identity's access on a note.

        Claimed-agent keys may only revoke their own grant.
        """
        self._http.delete(f"{_BASE}/{note_id}/access/{identity_id}")
