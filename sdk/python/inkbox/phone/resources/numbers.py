"""
inkbox/phone/resources/numbers.py

Phone number CRUD, provisioning, release, and transcript search.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.mail.types import FilterMode
from inkbox.phone.types import PhoneNumber, PhoneTranscript

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_BASE = "/numbers"
_UNSET = object()


class PhoneNumbersResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(self) -> list[PhoneNumber]:
        """List all phone numbers for your organisation."""
        data = self._http.get(_BASE)
        return [PhoneNumber._from_dict(n) for n in data]

    def get(self, phone_number_id: UUID | str) -> PhoneNumber:
        """Get a phone number by ID."""
        data = self._http.get(f"{_BASE}/{phone_number_id}")
        return PhoneNumber._from_dict(data)

    def update(
        self,
        phone_number_id: UUID | str,
        *,
        incoming_call_action: str | None = _UNSET,  # type: ignore[assignment]
        client_websocket_url: str | None = _UNSET,  # type: ignore[assignment]
        incoming_call_webhook_url: str | None = _UNSET,  # type: ignore[assignment]
        incoming_text_webhook_url: str | None = _UNSET,  # type: ignore[assignment]
        filter_mode: FilterMode | str = _UNSET,  # type: ignore[assignment]
    ) -> PhoneNumber:
        """Update phone number settings.

        Pass only the fields you want to change; omitted fields are left as-is.
        Pass a field as ``None`` to clear it.

        Args:
            phone_number_id: UUID of the phone number.
            incoming_call_action: ``"auto_accept"``, ``"auto_reject"``, or ``"webhook"``.
            client_websocket_url: WebSocket URL (wss://) for audio bridging.
            incoming_call_webhook_url: Webhook URL called for incoming calls when action is ``"webhook"``.
            incoming_text_webhook_url: Webhook URL called for incoming text messages.
            filter_mode: ``"whitelist"`` or ``"blacklist"``. Admin-only on
                the server; agent-scoped keys receive 403. A single value
                governs both inbound voice and SMS.

        Returns:
            The updated phone number. When ``filter_mode`` was supplied and
            the value actually changed, ``number.filter_mode_change_notice``
            is populated with counts of now-redundant rules.
        """
        body: dict[str, Any] = {}
        if incoming_call_action is not _UNSET:
            body["incoming_call_action"] = incoming_call_action
        if client_websocket_url is not _UNSET:
            body["client_websocket_url"] = client_websocket_url
        if incoming_call_webhook_url is not _UNSET:
            body["incoming_call_webhook_url"] = incoming_call_webhook_url
        if incoming_text_webhook_url is not _UNSET:
            body["incoming_text_webhook_url"] = incoming_text_webhook_url
        if filter_mode is not _UNSET:
            body["filter_mode"] = (
                filter_mode.value if isinstance(filter_mode, FilterMode) else filter_mode
            )
        data = self._http.patch(f"{_BASE}/{phone_number_id}", json=body)
        return PhoneNumber._from_dict(data)

    def provision(
        self,
        *,
        agent_handle: str,
        type: str = "toll_free",
        state: str | None = None,
        incoming_text_webhook_url: str | None = None,
    ) -> PhoneNumber:
        """Provision a new phone number and link it to an agent identity.

        Args:
            agent_handle: Handle of the agent identity to assign this number to.
            type: ``"toll_free"`` or ``"local"``. Defaults to ``"toll_free"``.
            state: US state abbreviation (e.g. ``"NY"``). Only valid for ``local`` numbers.
            incoming_text_webhook_url: Webhook URL called for incoming text messages.

        Returns:
            The provisioned phone number.
        """
        body: dict[str, Any] = {"agent_handle": agent_handle, "type": type}
        if state is not None:
            body["state"] = state
        if incoming_text_webhook_url is not None:
            body["incoming_text_webhook_url"] = incoming_text_webhook_url
        data = self._http.post(_BASE, json=body)
        return PhoneNumber._from_dict(data)

    def release(self, phone_number_id: UUID | str) -> None:
        """Release a phone number.

        Args:
            phone_number_id: UUID of the phone number to release.
        """
        self._http.delete(f"{_BASE}/{phone_number_id}")

    def search_transcripts(
        self,
        phone_number_id: UUID | str,
        *,
        q: str,
        party: str | None = None,
        limit: int = 50,
    ) -> list[PhoneTranscript]:
        """Full-text search across transcripts for a phone number.

        Args:
            phone_number_id: UUID of the phone number.
            q: Search query string.
            party: Filter by speaker: ``"local"`` or ``"remote"``.
            limit: Maximum number of results (1–200).
        """
        data = self._http.get(
            f"{_BASE}/{phone_number_id}/search",
            params={"q": q, "party": party, "limit": limit},
        )
        return [PhoneTranscript._from_dict(t) for t in data]
