"""
inkbox/notes/resources/notes.py

Notes CRUD + per-note access subresource.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID

from inkbox.notes.resources.note_access import NoteAccessResource
from inkbox.notes.types import Note

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_BASE = "/notes"
_UNSET = object()


class NotesResource:
    """Org-scoped notes with per-identity access grants."""

    def __init__(self, http: HttpTransport) -> None:
        self._http = http
        self._access = NoteAccessResource(http)

    @property
    def access(self) -> NoteAccessResource:
        return self._access

    def list(
        self,
        *,
        q: str | None = None,
        identity_id: UUID | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        order: Literal["recent", "created"] | str | None = None,
    ) -> list[Note]:
        """List accessible notes.

        Args:
            q: Substring search (≤200 chars).
            identity_id: Filter to notes visible to a specific identity.
            limit: 1–200 (server default 50).
            offset: Offset for paging.
            order: ``"recent"`` (default) or ``"created"``.
        """
        params: dict[str, Any] = {}
        if q is not None:
            params["q"] = q
        if identity_id is not None:
            params["identity_id"] = str(identity_id)
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        if order is not None:
            params["order"] = order
        data = self._http.get(_BASE, params=params)
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        return [Note._from_dict(n) for n in items]

    def get(self, note_id: UUID | str) -> Note:
        data = self._http.get(f"{_BASE}/{note_id}")
        return Note._from_dict(data)

    def create(self, *, body: str, title: str | None = None) -> Note:
        """Create a note.

        Agent-created notes auto-grant the creator. Human-created notes start
        with zero grants and are invisible to all agents until granted.
        """
        payload: dict[str, Any] = {"body": body}
        if title is not None:
            payload["title"] = title
        data = self._http.post(_BASE, json=payload)
        return Note._from_dict(data)

    def update(
        self,
        note_id: UUID | str,
        *,
        title: str | None = _UNSET,  # type: ignore[assignment]
        body: str = _UNSET,  # type: ignore[assignment]
    ) -> Note:
        """JSON-merge-patch update.

        ``title=None`` clears the title column (200 OK). ``body=None`` is
        **not** a legal operation — the body column is required; the server
        returns 422 if you try.
        """
        payload: dict[str, Any] = {}
        if title is not _UNSET:
            payload["title"] = title
        if body is not _UNSET:
            payload["body"] = body
        data = self._http.patch(f"{_BASE}/{note_id}", json=payload)
        return Note._from_dict(data)

    def delete(self, note_id: UUID | str) -> None:
        self._http.delete(f"{_BASE}/{note_id}")
