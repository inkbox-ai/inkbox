"""
inkbox/phone/resources/hosted_realtime.py

Per-identity platform-hosted realtime voice config: get, set.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.phone.types import HostedRealtimeConfig

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class HostedRealtimeResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def get_config(
        self,
        *,
        agent_identity_id: UUID | str | None = None,
    ) -> HostedRealtimeConfig:
        """Get the hosted realtime voice config for an identity.

        ``agent_identity_id`` is optional — an agent-scoped key resolves
        its own identity; under admin/JWT the server 422s if it's omitted.

        Args:
            agent_identity_id: UUID of the agent identity, or ``None`` for
                an agent-scoped key.
        """
        params: dict[str, Any] = {}
        if agent_identity_id is not None:
            params["agent_identity_id"] = str(agent_identity_id)
        data = self._http.get("/hosted-realtime-config", params=params)
        return HostedRealtimeConfig._from_dict(data)

    def set_config(
        self,
        *,
        enabled: bool,
        voice: str | None = None,
        model: str | None = None,
        instructions: str | None = None,
        agent_identity_id: UUID | str | None = None,
    ) -> HostedRealtimeConfig:
        """Set the hosted realtime voice config for an identity.

        ``agent_identity_id`` is optional — an agent-scoped key resolves
        its own identity; under admin/JWT the server 422s if it's omitted.

        Args:
            enabled: Whether the platform hosts the realtime voice agent
                for this identity's inbound calls.
            voice: Provider voice id, or ``None`` for the server default.
            model: Realtime model id, or ``None`` for the server default.
            instructions: Extra system instructions appended to the base
                prompt, or ``None`` to leave unset.
            agent_identity_id: UUID of the agent identity, or ``None`` for
                an agent-scoped key.
        """
        body: dict[str, Any] = {"enabled": enabled}
        if agent_identity_id is not None:
            body["agent_identity_id"] = str(agent_identity_id)
        if voice is not None:
            body["voice"] = voice
        if model is not None:
            body["model"] = model
        if instructions is not None:
            body["instructions"] = instructions
        data = self._http.put("/hosted-realtime-config", json=body)
        return HostedRealtimeConfig._from_dict(data)
