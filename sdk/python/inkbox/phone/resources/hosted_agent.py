"""
inkbox/phone/resources/hosted_agent.py

Per-identity hosted call agent config: get_config, set_config.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.phone.types import HostedAgentConfig

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class HostedAgentConfigResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def get_config(
        self,
        *,
        agent_identity_id: UUID | str | None = None,
    ) -> HostedAgentConfig:
        """Get the hosted call agent config for an identity.

        ``agent_identity_id`` is optional — an agent-scoped key resolves
        its own identity; under admin/JWT the server 422s if it's omitted.

        Args:
            agent_identity_id: UUID of the agent identity, or ``None`` for
                an agent-scoped key.
        """
        params: dict[str, Any] = {}
        if agent_identity_id is not None:
            params["agent_identity_id"] = str(agent_identity_id)
        data = self._http.get("/hosted-agent-config", params=params)
        return HostedAgentConfig._from_dict(data)

    def set_config(
        self,
        *,
        voice: str | None = None,
        model: str | None = None,
        instructions: str | None = None,
        agent_identity_id: UUID | str | None = None,
    ) -> HostedAgentConfig:
        """Set the hosted call agent config for an identity.

        Full-replace PUT: every call sets all three fields, and a field
        left at ``None`` resets to the server default — there is no
        partial update.

        Args:
            voice: Voice override, or ``None`` for the server default.
            model: Model override, or ``None`` for the server default.
            instructions: Per-identity steering prompt appended to the
                hosted agent's system prompt, or ``None`` for none.
            agent_identity_id: UUID of the agent identity, or ``None`` for
                an agent-scoped key.
        """
        body: dict[str, Any] = {}
        if agent_identity_id is not None:
            body["agent_identity_id"] = str(agent_identity_id)
        # Omitted (None) fields are equivalent to explicit nulls on this
        # full-replace PUT: the server resets them to its defaults.
        if voice is not None:
            body["voice"] = voice
        if model is not None:
            body["model"] = model
        if instructions is not None:
            body["instructions"] = instructions
        data = self._http.put("/hosted-agent-config", json=body)
        return HostedAgentConfig._from_dict(data)
