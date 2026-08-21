"""
inkbox/phone/resources/incoming_call_action.py

Per-identity inbound-call handling config: get, set.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.phone.types import (
    ForwardingTargetType,
    IncomingCallAction,
    IncomingCallActionConfig,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_UNSET = object()


class IncomingCallActionResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def get(
        self,
        *,
        agent_identity_id: UUID | str | None = None,
    ) -> IncomingCallActionConfig:
        """Get the inbound-call handling config for an identity.

        ``agent_identity_id`` is optional — an agent-scoped key resolves
        its own identity; under admin/JWT the server 422s if it's omitted.

        Args:
            agent_identity_id: UUID of the agent identity, or ``None`` for
                an agent-scoped key.
        """
        params: dict[str, Any] = {}
        if agent_identity_id is not None:
            params["agent_identity_id"] = str(agent_identity_id)
        data = self._http.get("/incoming-call-action", params=params)
        return IncomingCallActionConfig._from_dict(data)

    def set(
        self,
        *,
        incoming_call_action: IncomingCallAction | str,
        agent_identity_id: UUID | str | None = None,
        client_websocket_url: str | None = None,
        incoming_call_webhook_url: str | None = None,
        forwarding_target_type: ForwardingTargetType | str | None = _UNSET,  # type: ignore[assignment]
        forwarding_phone_number: str | None = _UNSET,  # type: ignore[assignment]
        forwarding_sip_uri: str | None = _UNSET,  # type: ignore[assignment]
    ) -> IncomingCallActionConfig:
        """Set the inbound-call handling config for an identity.

        ``agent_identity_id`` is optional — an agent-scoped key resolves
        its own identity; under admin/JWT the server 422s if it's omitted.

        Args:
            incoming_call_action: Behaviour to apply. See
                :class:`IncomingCallAction`.
            agent_identity_id: UUID of the agent identity, or ``None`` for
                an agent-scoped key.
            client_websocket_url: WebSocket URL (wss://) for audio bridging.
            incoming_call_webhook_url: HTTPS receiver for the
                ``webhook`` action.
            forwarding_target_type: ``phone`` or ``sip``; ``None`` clears
                both saved forwarding targets when switching away from the
                ``forward`` action. Omit to preserve it.
            forwarding_phone_number: Complete E.164 destination. Pass
                ``None`` to clear or omit to preserve it.
            forwarding_sip_uri: Complete SIP destination using a public DNS
                hostname. Pass ``None`` to clear or omit to preserve it.
        """
        action_value = (
            incoming_call_action.value
            if isinstance(incoming_call_action, IncomingCallAction)
            else incoming_call_action
        )
        body: dict[str, Any] = {"incoming_call_action": action_value}
        if agent_identity_id is not None:
            body["agent_identity_id"] = str(agent_identity_id)
        if client_websocket_url is not None:
            body["client_websocket_url"] = client_websocket_url
        if incoming_call_webhook_url is not None:
            body["incoming_call_webhook_url"] = incoming_call_webhook_url
        if forwarding_target_type is not _UNSET:
            body["forwarding_target_type"] = (
                forwarding_target_type.value
                if isinstance(forwarding_target_type, ForwardingTargetType)
                else forwarding_target_type
            )
        if forwarding_phone_number is not _UNSET:
            body["forwarding_phone_number"] = forwarding_phone_number
        if forwarding_sip_uri is not _UNSET:
            body["forwarding_sip_uri"] = forwarding_sip_uri
        data = self._http.put("/incoming-call-action", json=body)
        return IncomingCallActionConfig._from_dict(data)
