"""Write-only authentication and external connection configuration for Voice AI."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal, NotRequired, TypedDict
from uuid import UUID


class McpNoAuth(TypedDict):
    type: Literal["none"]


class McpBearerAuth(TypedDict):
    type: Literal["bearer"]
    token: str


class McpHeaderAuth(TypedDict):
    type: Literal["header"]
    token: str
    header_name: str
    value_prefix: NotRequired[str]


class McpOAuthAuth(TypedDict):
    type: Literal["oauth"]
    issuer: NotRequired[str]
    scopes: NotRequired[list[str]]
    client_id: NotRequired[str]
    client_secret: NotRequired[str]
    token_endpoint_auth_method: NotRequired[Literal["none", "client_secret_basic", "client_secret_post"]]
    profile: NotRequired[Literal["standard", "offline_consent"]]


McpAuth = McpNoAuth | McpBearerAuth | McpHeaderAuth | McpOAuthAuth


class HostedMcpAuthorization(TypedDict):
    id: str
    connection_id: str
    agent_identity_id: str
    status: str
    expires_at: str
    connect_url: str | None
    config_version: int | None
    requested_scopes: list[str]
    error_code: str | None


class McpPromptSelection(TypedDict):
    name: str
    arguments: NotRequired[dict[str, str]]


class McpSkillSelection(TypedDict):
    uri: str
    manifest_digest: str


class McpContextSelections(TypedDict, total=False):
    mode: Literal["selected", "all"]
    prompts: list[McpPromptSelection]
    resources: list[str]
    skills: list[McpSkillSelection]


class HostedMcpCreate(TypedDict):
    label: str
    url: str
    agent_identity_id: NotRequired[str]
    transport: NotRequired[Literal["streamable_http", "sse"]]
    auth: NotRequired[McpAuth]
    enabled: NotRequired[bool]
    allowed_tools: NotRequired[list[str] | None]
    context: NotRequired[McpContextSelections]


class HostedMcpUpdate(TypedDict):
    expected_version: int
    label: NotRequired[str]
    url: NotRequired[str]
    transport: NotRequired[Literal["streamable_http", "sse"]]
    auth: NotRequired[McpAuth]
    enabled: NotRequired[bool]
    allowed_tools: NotRequired[list[str] | None]
    context: NotRequired[McpContextSelections]


@dataclass
class HostedMcpConnection:
    id: UUID
    agent_identity_id: UUID
    label: str
    url: str = field(repr=False)
    transport: str
    auth: dict[str, Any]
    enabled: bool
    allowed_tools: list[str] | None
    context: McpContextSelections
    config_version: int
    preparation_status: str
    health_code: str | None
    capabilities: dict[str, bool]
    catalog_version: str | None
    catalog_fetched_at: datetime | None

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> HostedMcpConnection:
        return cls(id=UUID(data["id"]), agent_identity_id=UUID(data["agent_identity_id"]),
            label=data["label"], url=data["url"], transport=data["transport"], auth=data["auth"],
            enabled=data["enabled"], allowed_tools=data.get("allowed_tools"), context=data.get("context", {}),
            config_version=data["config_version"], preparation_status=data["preparation_status"],
            health_code=data.get("health_code"), capabilities=data.get("capabilities", {}),
            catalog_version=data.get("catalog_version"),
            catalog_fetched_at=datetime.fromisoformat(data["catalog_fetched_at"]) if data.get("catalog_fetched_at") else None)


class HostedMcpCatalog(TypedDict):
    tools: list[dict[str, Any]]
    prompts: list[dict[str, Any]]
    resources: list[dict[str, Any]]
    skills: list[dict[str, Any]]
    next_cursor: str | None
    config_version: int
    catalog_version: str | None


class HostedMcpTestResult(TypedDict):
    success: bool
    code: str
    config_version: int


class HostedMcpActivity(TypedDict):
    id: str
    connection_label: str
    tool_name: str
    status: Literal["started", "succeeded", "failed", "unknown"]
    error_code: str | None
    started_at: str | None
    completed_at: str | None


class HostedMcpActivityPage(TypedDict):
    items: list[HostedMcpActivity]
    limit: int
    offset: int
    has_more: bool
    incomplete: bool
