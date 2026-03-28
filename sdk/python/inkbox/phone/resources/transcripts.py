"""
inkbox/phone/resources/transcripts.py

Transcript retrieval.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from inkbox.phone.types import PhoneTranscript

if TYPE_CHECKING:
    from inkbox.phone._http import HttpTransport


class TranscriptsResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        phone_number_id: UUID | str,
        call_id: UUID | str,
    ) -> list[PhoneTranscript]:
        """List all transcript segments for a call, ordered by sequence number.

        Args:
            phone_number_id: UUID of the phone number.
            call_id: UUID of the call.
        """
        data = self._http.get(
            f"/numbers/{phone_number_id}/calls/{call_id}/transcripts",
        )
        return [PhoneTranscript._from_dict(t) for t in data]
