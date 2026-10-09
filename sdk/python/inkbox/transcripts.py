"""Speaker snapshots shared by call transcripts and call history."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, NotRequired, TypedDict
from uuid import UUID


PhoneTranscriptSpeakerKind = Literal["human", "agent"]


class PhoneTranscriptSpeakerWire(TypedDict):
    """JSON speaker snapshot. Optional facts can be absent or null."""

    id: str
    kind: PhoneTranscriptSpeakerKind
    name: NotRequired[str | None]
    phone_number: NotRequired[str | None]
    contact_id: NotRequired[str | None]
    agent_identity_id: NotRequired[str | None]


@dataclass
class PhoneTranscriptSpeaker:
    """Recorded speaker identity, separate from the local/remote call side.

    ``id`` is stable within a call, not a cross-call person identifier. Facts
    describe the speaker when recorded and do not track later contact edits.
    """

    id: UUID
    kind: PhoneTranscriptSpeakerKind
    name: str | None = None
    phone_number: str | None = None
    contact_id: UUID | None = None
    agent_identity_id: UUID | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> PhoneTranscriptSpeaker:
        return cls(
            id=UUID(d["id"]),
            kind=d["kind"],
            name=d.get("name"),
            phone_number=d.get("phone_number"),
            contact_id=UUID(d["contact_id"]) if d.get("contact_id") else None,
            agent_identity_id=(
                UUID(d["agent_identity_id"]) if d.get("agent_identity_id") else None
            ),
        )
