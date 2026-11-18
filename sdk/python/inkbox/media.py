"""Transcription results for incoming audio attachments."""

from dataclasses import dataclass
from typing import Any, Literal, TypedDict

TranscriptionStatus = Literal["pending", "completed", "failed", "skipped"]


class MediaTranscriptionWire(TypedDict):
    status: TranscriptionStatus
    text: str | None
    error_code: str | None


@dataclass
class MediaTranscription:
    status: TranscriptionStatus
    text: str | None = None
    error_code: str | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> "MediaTranscription":
        return cls(
            status=d["status"], text=d.get("text"), error_code=d.get("error_code")
        )
