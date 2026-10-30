/** External connection configuration for Voice AI. Authentication is write-only. */
export type McpAuth = { type: "none" } | { type: "bearer"; token: string } |
  { type: "header"; token: string; headerName: string; valuePrefix?: string } | McpOAuthAuth;
export interface McpOAuthAuth {
  type: "oauth";
  issuer?: string;
  scopes?: string[];
  clientId?: string;
  clientSecret?: string;
  tokenEndpointAuthMethod?: "none" | "client_secret_basic" | "client_secret_post";
  profile?: "standard" | "offline_consent";
}
export interface HostedMcpAuthorization {
  id: string;
  connectionId: string;
  agentIdentityId: string;
  status: string;
  expiresAt: Date;
  connectUrl: string | null;
  configVersion: number | null;
  requestedScopes: string[];
  errorCode: string | null;
}
export interface RawHostedMcpAuthorization {
  id: string; connection_id: string; agent_identity_id: string; status: string;
  expires_at: string; connect_url: string | null; config_version: number | null;
  requested_scopes: string[]; error_code: string | null;
}
export function parseHostedMcpAuthorization(r: RawHostedMcpAuthorization): HostedMcpAuthorization {
  return { id: r.id, connectionId: r.connection_id, agentIdentityId: r.agent_identity_id,
    status: r.status, expiresAt: new Date(r.expires_at), connectUrl: r.connect_url,
    configVersion: r.config_version, requestedScopes: r.requested_scopes, errorCode: r.error_code };
}
export interface McpContextSelections {
  mode?: "selected" | "all";
  prompts?: Array<{ name: string; arguments?: Record<string, string> }>;
  resources?: string[];
  skills?: Array<{ uri: string; manifestDigest: string }>;
}
export interface HostedMcpCreate {
  label: string;
  url: string;
  agentIdentityId?: string;
  transport?: "streamable_http" | "sse";
  auth?: McpAuth;
  enabled?: boolean;
  allowedTools?: string[] | null;
  context?: McpContextSelections;
}
export type HostedMcpUpdate = Partial<Omit<HostedMcpCreate, "agentIdentityId">> & { expectedVersion: number };
export interface HostedMcpConnection {
  id: string;
  agentIdentityId: string;
  label: string;
  url: string;
  transport: "streamable_http" | "sse";
  auth: { type: string; configured: boolean; headerName: string | null; valuePrefix: string | null;
    status?: string | null; expiresAt?: Date | null; refreshSupported?: boolean;
    requestedScopes?: string[]; grantedScopes?: string[]; errorCode?: string | null;
    issuer?: string | null; callbackUri?: string | null };
  enabled: boolean;
  allowedTools: string[] | null;
  context: McpContextSelections;
  configVersion: number;
  preparationStatus: "pending" | "ready" | "error";
  healthCode: string | null;
  capabilities: Record<string, boolean>;
  catalogVersion: string | null;
  catalogFetchedAt: Date | null;
}
export interface RawHostedMcpConnection {
  id: string; agent_identity_id: string; label: string; url: string;
  transport: HostedMcpConnection["transport"];
  auth: { type: string; configured: boolean; header_name: string | null; value_prefix: string | null;
    status?: string | null; expires_at?: string | null; refresh_supported?: boolean;
    requested_scopes?: string[]; granted_scopes?: string[]; error_code?: string | null;
    issuer?: string | null; callback_uri?: string | null };
  enabled: boolean; allowed_tools: string[] | null;
  context: { mode?: McpContextSelections["mode"]; prompts?: McpContextSelections["prompts"]; resources?: string[]; skills?: Array<{ uri: string; manifest_digest: string }> };
  config_version: number; preparation_status: HostedMcpConnection["preparationStatus"];
  health_code: string | null; capabilities: Record<string, boolean>; catalog_version: string | null; catalog_fetched_at: string | null;
}
export interface HostedMcpCatalog {
  tools: Record<string, unknown>[];
  prompts: Record<string, unknown>[];
  resources: Record<string, unknown>[];
  skills: Record<string, unknown>[];
  nextCursor: string | null;
  configVersion: number;
  catalogVersion: string | null;
}
export interface HostedMcpTestResult { success: boolean; code: string; configVersion: number }
export interface HostedMcpActivityPage {
  items: Array<{ id: string; connectionLabel: string; toolName: string;
    status: "started" | "succeeded" | "failed" | "unknown"; errorCode: string | null;
    startedAt: Date | null; completedAt: Date | null }>;
  limit: number; offset: number; hasMore: boolean; incomplete: boolean;
}
export function mcpBody(body: HostedMcpCreate | HostedMcpUpdate): Record<string, unknown> {
  const auth = body.auth;
  return {
    label: body.label, url: body.url, transport: body.transport, enabled: body.enabled,
    agent_identity_id: "agentIdentityId" in body ? body.agentIdentityId : undefined,
    expected_version: "expectedVersion" in body ? body.expectedVersion : undefined,
    allowed_tools: body.allowedTools,
    auth: auth?.type === "header" ? { type: auth.type, token: auth.token, header_name: auth.headerName, value_prefix: auth.valuePrefix } :
      auth?.type === "oauth" ? { type: auth.type, issuer: auth.issuer, scopes: auth.scopes, client_id: auth.clientId,
        client_secret: auth.clientSecret, token_endpoint_auth_method: auth.tokenEndpointAuthMethod, profile: auth.profile } : auth,
    context: body.context === undefined ? undefined : { mode: body.context.mode, prompts: body.context.prompts, resources: body.context.resources,
      skills: body.context.skills?.map(s => ({ uri: s.uri, manifest_digest: s.manifestDigest })) },
  };
}
export function parseHostedMcpConnection(r: RawHostedMcpConnection): HostedMcpConnection {
  return { id: r.id, agentIdentityId: r.agent_identity_id, label: r.label, url: r.url, transport: r.transport,
    auth: { type: r.auth.type, configured: r.auth.configured, headerName: r.auth.header_name, valuePrefix: r.auth.value_prefix,
      status: r.auth.status, expiresAt: r.auth.expires_at ? new Date(r.auth.expires_at) : null,
      refreshSupported: r.auth.refresh_supported, requestedScopes: r.auth.requested_scopes, grantedScopes: r.auth.granted_scopes,
      errorCode: r.auth.error_code, issuer: r.auth.issuer, callbackUri: r.auth.callback_uri },
    enabled: r.enabled, allowedTools: r.allowed_tools, configVersion: r.config_version, preparationStatus: r.preparation_status,
    healthCode: r.health_code, capabilities: r.capabilities, catalogVersion: r.catalog_version,
    catalogFetchedAt: r.catalog_fetched_at ? new Date(r.catalog_fetched_at) : null,
    context: { mode: r.context.mode, prompts: r.context.prompts, resources: r.context.resources,
      skills: r.context.skills?.map(s => ({ uri: s.uri, manifestDigest: s.manifest_digest })) } };
}
