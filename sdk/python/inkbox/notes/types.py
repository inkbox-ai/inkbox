"""
inkbox/notes/types.py

Dataclasses for the Notes API.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID


@dataclass
class NoteAccess:
    """A single grant on a note. No wildcard for notes — every grant is explicit."""

    id: UUID
    note_id: UUID
    identity_id: UUID
    created_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> NoteAccess:
        return cls(
            id=UUID(d["id"]),
            note_id=UUID(d["note_id"]),
            identity_id=UUID(d["identity_id"]),
            created_at=datetime.fromisoformat(d["created_at"]),
        )


@dataclass
class Note:
    """An org-scoped note (free-form markdown body)."""

    id: UUID
    organization_id: str
    created_by: str
    title: str | None
    body: str
    status: str
    created_at: datetime
    updated_at: datetime
    access: list[NoteAccess] = field(default_factory=list)

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> Note:
        return cls(
            id=UUID(d["id"]),
            organization_id=str(d["organization_id"]),
            created_by=str(d["created_by"]),
            title=d.get("title"),
            body=d["body"],
            status=str(d["status"]),
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            access=[NoteAccess._from_dict(a) for a in d.get("access") or []],
        )
