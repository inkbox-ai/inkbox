"""
inkbox/phone/resources/hosted_agent.py

Inkbox Voice AI configuration and voice discovery.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID
from inkbox.phone.hosted_mcp import (
    HostedMcpActivityPage, HostedMcpCatalog, HostedMcpConnection, HostedMcpCreate,
    HostedMcpTestResult, HostedMcpUpdate, HostedMcpAuthorization,
)

from inkbox.phone.types import (
    HostedAgentAuthorityMode,
    HostedAgentConfig,
    HostedAgentVoiceCatalog,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class HostedAgentConfigResource:

    def start_mcp_authorization(self, connection_id: UUID | str, *, expected_version: int,
                                idempotency_key: str) -> HostedMcpAuthorization:
        """Request a browser connection URL requiring human approval."""
        return self._http.post(f"/hosted-agent-config/mcp-servers/{UUID(str(connection_id))}/oauth/authorizations",
            json={"expected_version": expected_version}, headers={"Idempotency-Key": idempotency_key})

    def get_mcp_authorization(self, connection_id: UUID | str, transaction_id: UUID | str) -> HostedMcpAuthorization:
        """Read authorization status without receiving external credentials."""
        return self._http.get(f"/hosted-agent-config/mcp-servers/{UUID(str(connection_id))}/oauth/authorizations/{UUID(str(transaction_id))}")

    def cancel_mcp_authorization(self, connection_id: UUID | str, transaction_id: UUID | str) -> None:
        """Cancel an unfinished browser authorization."""
        self._http.delete(f"/hosted-agent-config/mcp-servers/{UUID(str(connection_id))}/oauth/authorizations/{UUID(str(transaction_id))}")

    def disconnect_mcp_server(self, connection_id: UUID | str, *, expected_version: int,
                              idempotency_key: str) -> HostedMcpTestResult:
        """Disconnect OAuth access while keeping connection settings."""
        return self._http.post(f"/hosted-agent-config/mcp-servers/{UUID(str(connection_id))}/oauth/disconnect",
            json={"expected_version": expected_version}, headers={"Idempotency-Key": idempotency_key})

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list_voices(self) -> HostedAgentVoiceCatalog:
        """List Voice AI voices, previews, and your organization's availability.

        No identity is required. Unavailable voices remain in the catalog;
        select an option with ``available=True`` when updating a config.
        """
        data = self._http.get("/hosted-agent-voices")
        return HostedAgentVoiceCatalog._from_dict(data)

    def list_mcp_servers(self, *, agent_identity_id: UUID | str | None = None) -> list[HostedMcpConnection]:
        params = {"agent_identity_id": str(agent_identity_id)} if agent_identity_id is not None else {}
        data = self._http.get("/hosted-agent-config/mcp-servers", params=params)
        return [HostedMcpConnection._from_dict(row) for row in data["connections"]]

    def create_mcp_server(self, body: HostedMcpCreate, *, idempotency_key: str) -> HostedMcpConnection:
        """Add one of up to three connections. Reuse the key when retrying this creation."""
        return HostedMcpConnection._from_dict(self._http.post("/hosted-agent-config/mcp-servers", json=body,
            headers={"Idempotency-Key": idempotency_key}))

    def get_mcp_server(self, connection_id: UUID | str) -> HostedMcpConnection:
        return HostedMcpConnection._from_dict(self._http.get(f"/hosted-agent-config/mcp-servers/{UUID(str(connection_id))}"))

    def update_mcp_server(self, connection_id: UUID | str, body: HostedMcpUpdate) -> HostedMcpConnection:
        """Omitted auth is retained. URL changes require replacement auth or type none."""
        return HostedMcpConnection._from_dict(self._http.patch(f"/hosted-agent-config/mcp-servers/{UUID(str(connection_id))}", json=body))

    def delete_mcp_server(self, connection_id: UUID | str) -> None:
        self._http.delete(f"/hosted-agent-config/mcp-servers/{UUID(str(connection_id))}")

    def test_mcp_server(self, connection_id: UUID | str) -> HostedMcpTestResult:
        return self._http.post(f"/hosted-agent-config/mcp-servers/{UUID(str(connection_id))}/test")

    def refresh_mcp_server(self, connection_id: UUID | str, *, idempotency_key: str) -> HostedMcpTestResult:
        return self._http.post(f"/hosted-agent-config/mcp-servers/{UUID(str(connection_id))}/refresh",
                               headers={"Idempotency-Key": idempotency_key})

    def get_mcp_catalog(self, connection_id: UUID | str, *, cursor: str | None = None, limit: int = 50,
                        skill_uri: str | None = None) -> HostedMcpCatalog:
        params: dict[str, Any] = {"limit": limit}
        if cursor is not None:
            params["cursor"] = cursor
        if skill_uri is not None:
            params["skill_uri"] = skill_uri
        return self._http.get(f"/hosted-agent-config/mcp-servers/{UUID(str(connection_id))}/catalog", params=params)

    def get_mcp_activity(self, call_id: UUID | str, *, limit: int = 50, offset: int = 0) -> HostedMcpActivityPage:
        return self._http.get(f"/calls/{UUID(str(call_id))}/mcp-activity", params={"limit": limit, "offset": offset})

    def get_config(
        self,
        *,
        agent_identity_id: UUID | str | None = None,
    ) -> HostedAgentConfig:
        """Get the Inkbox Voice AI config for an identity.

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
        """Set the Inkbox Voice AI config for an identity.

        Full-replace PUT: every call replaces voice and instructions. The
        deprecated ``model`` argument remains accepted but is ignored.

        Args:
            voice: Voice override, or ``None`` for the server default.
            model: Deprecated compatibility argument; accepted but ignored.
            instructions: Per-identity steering prompt appended to
                Voice AI's system prompt, or ``None`` for none.
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
        if instructions is not None:
            body["instructions"] = instructions
        data = self._http.put("/hosted-agent-config", json=body)
        return HostedAgentConfig._from_dict(data)

    def set_authority_mode(
        self,
        *,
        agent_identity_id: UUID | str,
        authority_mode: HostedAgentAuthorityMode | str,
    ) -> HostedAgentConfig:
        """Set an identity's saved Voice AI authority.

        This privileged operation requires an admin API key. Incoming calls
        use this value, and outbound calls inherit it when they omit a per-call
        override.
        """
        mode = (
            authority_mode.value
            if isinstance(authority_mode, HostedAgentAuthorityMode)
            else authority_mode
        )
        data = self._http.put(
            "/hosted-agent-config/authority-mode",
            json={
                "agent_identity_id": str(agent_identity_id),
                "authority_mode": mode,
            },
        )
        return HostedAgentConfig._from_dict(data)
