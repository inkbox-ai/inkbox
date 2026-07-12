"""
inkbox/phone/resources/calls.py

Identity-centered call operations: list, get, transcripts, place.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.phone.types import (
    CallMode,
    CallOrigin,
    PhoneCall,
    PhoneCallWithRateLimit,
    PhoneTranscript,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class CallsResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        *,
        agent_identity_id: UUID | str | None = None,
        limit: int = 50,
        offset: int = 0,
        is_blocked: bool | None = None,
        start_datetime: str | None = None,
        end_datetime: str | None = None,
        tz: str | None = None,
    ) -> list[PhoneCall]:
        """List calls, newest first.

        Identity-scoped API keys resolve their own identity, so
        ``agent_identity_id`` is optional — pass it only under an
        admin/JWT caller (the server returns a 422 if it's required and
        omitted, surfaced verbatim).

        Identity-scoped API keys never see contact-rule-blocked rows
        regardless of ``is_blocked`` — the server filters them at the
        access-policy layer. Admin-scoped keys and JWT humans see
        everything by default; pass ``is_blocked=True`` to surface the
        blocked-only listing or ``is_blocked=False`` to exclude blocked
        rows.

        Args:
            agent_identity_id: UUID of the agent identity to scope to, or
                ``None`` to let an agent-scoped key resolve its own.
            limit: Max results to return (1–200).
            offset: Pagination offset.
            is_blocked: Tri-state filter — ``True`` for only blocked,
                ``False`` for only non-blocked, ``None`` for all.
            start_datetime: Inclusive lower bound on ``created_at`` (str). Bare
                dates resolve to the start of that day; naive datetimes are
                interpreted in ``tz``; zoned datetimes are exact instants.
                ``None`` leaves the range open on this side.
            end_datetime: Upper bound on ``created_at`` (str). A bare date is
                whole-day inclusive. ``None`` leaves the range open.
            tz: IANA timezone name (str) governing zone-less values;
                ``None`` means UTC.
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if agent_identity_id is not None:
            params["agent_identity_id"] = str(agent_identity_id)
        if is_blocked is not None:
            params["is_blocked"] = is_blocked
        if start_datetime is not None:
            params["start_datetime"] = start_datetime
        if end_datetime is not None:
            params["end_datetime"] = end_datetime
        if tz is not None:
            params["tz"] = tz
        data = self._http.get("/calls", params=params)
        return [PhoneCall._from_dict(c) for c in data]

    def get(self, call_id: UUID | str) -> PhoneCall:
        """Get a single call by ID.

        Args:
            call_id: UUID of the call.
        """
        data = self._http.get(f"/calls/{call_id}")
        return PhoneCall._from_dict(data)

    def hangup(self, call_id: UUID | str) -> PhoneCall:
        """Hang up a live call by ID, from outside the call.

        The lever for anything not on the call itself (tests, operators,
        another process); the agent on the call keeps ending it in-band.
        The carrier confirms the teardown asynchronously, so the returned
        call can still show its live status for a moment. A call that has
        already ended (or has no active carrier leg yet) surfaces the
        server's 409 verbatim.

        Args:
            call_id: UUID of the call.
        """
        data = self._http.post(f"/calls/{call_id}/hangup")
        return PhoneCall._from_dict(data)

    def transcripts(self, call_id: UUID | str) -> list[PhoneTranscript]:
        """List all transcript segments for a call, ordered by sequence number.

        Args:
            call_id: UUID of the call.
        """
        data = self._http.get(f"/calls/{call_id}/transcripts")
        return [PhoneTranscript._from_dict(t) for t in data]

    def place(
        self,
        *,
        to_number: str,
        origination: CallOrigin | str = CallOrigin.DEDICATED_NUMBER,
        from_number: str | None = None,
        agent_identity_id: UUID | str | None = None,
        client_websocket_url: str | None = None,
        mode: CallMode | str = CallMode.CLIENT_WEBSOCKET,
        reason: str | None = None,
    ) -> PhoneCallWithRateLimit:
        """Place an outbound call.

        The server enforces the conditional shape: ``from_number`` is
        required for ``dedicated_number`` origination, ``agent_identity_id``
        for ``shared_imessage_number``; ``hosted_agent`` mode requires
        ``reason`` and excludes ``client_websocket_url``. This method never
        client-gates — it forwards whatever is provided and surfaces the
        server's 422.

        Args:
            to_number: E.164 number to call.
            origination: How to place the call. Defaults to
                ``dedicated_number``. See :class:`CallOrigin`.
            from_number: E.164 number to call from (dedicated origination).
                Must belong to your org and be active.
            agent_identity_id: UUID of the placing identity (shared
                origination), or ``None`` for an agent-scoped key.
            client_websocket_url: WebSocket URL (wss://) for audio bridging.
            mode: Who drives the call. Defaults to ``client_websocket``.
                See :class:`CallMode`.
            reason: Voice AI's task brief for the call — what to
                accomplish. Required with ``mode=hosted_agent``, invalid
                otherwise.

        Returns:
            The created call record with current rate limit info.
        """
        origination_value = (
            origination.value if isinstance(origination, CallOrigin) else origination
        )
        mode_value = mode.value if isinstance(mode, CallMode) else mode
        body: dict[str, Any] = {
            "to_number": to_number,
            "origination": origination_value,
            "mode": mode_value,
        }
        if from_number is not None:
            body["from_number"] = from_number
        if agent_identity_id is not None:
            body["agent_identity_id"] = str(agent_identity_id)
        if client_websocket_url is not None:
            body["client_websocket_url"] = client_websocket_url
        if reason is not None:
            body["reason"] = reason
        data = self._http.post("/place-call", json=body)
        return PhoneCallWithRateLimit._from_dict(data)
