"""
inkbox/phone/resources/calls.py

Call operations: list, get, place.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.phone.types import PhoneCall, PhoneCallWithRateLimit

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class CallsResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        phone_number_id: UUID | str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> list[PhoneCall]:
        """List calls for a phone number, newest first.

        Args:
            phone_number_id: UUID of the phone number.
            limit: Max results to return (1–200).
            offset: Pagination offset.
        """
        data = self._http.get(
            f"/numbers/{phone_number_id}/calls",
            params={"limit": limit, "offset": offset},
        )
        return [PhoneCall._from_dict(c) for c in data]

    def get(
        self,
        phone_number_id: UUID | str,
        call_id: UUID | str,
    ) -> PhoneCall:
        """Get a single call by ID.

        Args:
            phone_number_id: UUID of the phone number.
            call_id: UUID of the call.
        """
        data = self._http.get(f"/numbers/{phone_number_id}/calls/{call_id}")
        return PhoneCall._from_dict(data)

    def place(
        self,
        *,
        from_number: str,
        to_number: str,
        client_websocket_url: str | None = None,
    ) -> PhoneCallWithRateLimit:
        """Place an outbound call.

        Args:
            from_number: E.164 number to call from. Must belong to your org and be active.
            to_number: E.164 number to call.
            client_websocket_url: WebSocket URL (wss://) for audio bridging.

        Returns:
            The created call record with current rate limit info.
        """
        body: dict[str, Any] = {
            "from_number": from_number,
            "to_number": to_number,
        }
        if client_websocket_url is not None:
            body["client_websocket_url"] = client_websocket_url
        data = self._http.post("/place-call", json=body)
        return PhoneCallWithRateLimit._from_dict(data)
