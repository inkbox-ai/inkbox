"""Unified correspondence for a contact."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Sequence
from uuid import UUID

from inkbox.contacts.types import (
    ContactCorrespondence,
    CorrespondenceChannel,
    CorrespondenceContentMode,
    CorrespondenceOrder,
    CorrespondenceTranscriptMode,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


@dataclass
class ContactCorrespondenceOptions:
    channels: Sequence[CorrespondenceChannel | str] | None = None
    after: datetime | None = None
    before: datetime | None = None
    limit_per_channel: int | None = None
    email_limit: int | None = None
    sms_limit: int | None = None
    imessage_limit: int | None = None
    calls_limit: int | None = None
    cursor: str | None = None
    order: CorrespondenceOrder | str | None = None
    content: CorrespondenceContentMode | str | None = None
    transcripts: CorrespondenceTranscriptMode | str | None = None
    include_failed: bool | None = None
    identity_id: UUID | str | None = None
    include_dismissed: bool | None = None

    def _to_params(self) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if self.channels is not None:
            params["channels"] = ",".join(str(channel) for channel in self.channels)
        for name in ("after", "before"):
            value = getattr(self, name)
            if value is not None:
                params[name] = value.isoformat()
        for name in (
            "limit_per_channel",
            "email_limit",
            "sms_limit",
            "imessage_limit",
            "calls_limit",
            "cursor",
            "order",
            "content",
            "transcripts",
            "include_failed",
            "identity_id",
            "include_dismissed",
        ):
            value = getattr(self, name)
            if value is not None:
                params[name] = str(value) if isinstance(value, (UUID,)) else value
        return params


class ContactCorrespondenceResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def get(
        self,
        contact_id: UUID | str,
        options: ContactCorrespondenceOptions | None = None,
    ) -> ContactCorrespondence:
        data = self._http.get(
            f"/contacts/{contact_id}/correspondence",
            params=(options or ContactCorrespondenceOptions())._to_params(),
        )
        return ContactCorrespondence._from_dict(data)

    def list(
        self,
        contact_id: UUID | str,
        options: ContactCorrespondenceOptions | None = None,
    ) -> ContactCorrespondence:
        """Alias for :meth:`get`."""
        return self.get(contact_id, options)
