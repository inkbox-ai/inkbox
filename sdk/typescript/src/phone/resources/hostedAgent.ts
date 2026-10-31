/**
 * inkbox-phone/resources/hostedAgent.ts
 *
 * Inkbox Voice AI configuration and voice discovery.
 */

import { HttpTransport } from "../../_http.js";
import { HostedMcpCreate, HostedMcpUpdate, HostedMcpConnection, RawHostedMcpConnection,
  HostedMcpCatalog, HostedMcpTestResult, HostedMcpActivityPage, HostedMcpAuthorization, RawHostedMcpAuthorization,
  mcpBody, parseHostedMcpConnection, parseHostedMcpAuthorization } from "../hostedMcp.js";
import {
  HostedAgentAuthorityMode,
  HostedAgentConfig,
  HostedAgentVoiceCatalog,
  RawHostedAgentConfig,
  RawHostedAgentVoiceCatalog,
  parseHostedAgentConfig,
  parseHostedAgentVoiceCatalog,
} from "../types.js";

export class HostedAgentConfigResource {
  constructor(private readonly http: HttpTransport) {}

  /** Request a browser connection URL requiring human approval. */
  async startMcpAuthorization(id: string, options: { expectedVersion: number; idempotencyKey: string }): Promise<HostedMcpAuthorization> {
    return parseHostedMcpAuthorization(await this.http.post<RawHostedMcpAuthorization>(
      `/hosted-agent-config/mcp-servers/${encodeURIComponent(id)}/oauth/authorizations`,
      { expected_version: options.expectedVersion }, { headers: { "Idempotency-Key": options.idempotencyKey } }));
  }

  async getMcpAuthorization(id: string, transactionId: string): Promise<HostedMcpAuthorization> {
    return parseHostedMcpAuthorization(await this.http.get<RawHostedMcpAuthorization>(
      `/hosted-agent-config/mcp-servers/${encodeURIComponent(id)}/oauth/authorizations/${encodeURIComponent(transactionId)}`));
  }

  async cancelMcpAuthorization(id: string, transactionId: string): Promise<void> {
    await this.http.delete(`/hosted-agent-config/mcp-servers/${encodeURIComponent(id)}/oauth/authorizations/${encodeURIComponent(transactionId)}`);
  }

  async disconnectMcpServer(id: string, options: { expectedVersion: number; idempotencyKey: string }): Promise<HostedMcpTestResult> {
    const r = await this.http.post<{ success: boolean; code: string; config_version: number }>(
      `/hosted-agent-config/mcp-servers/${encodeURIComponent(id)}/oauth/disconnect`,
      { expected_version: options.expectedVersion }, { headers: { "Idempotency-Key": options.idempotencyKey } });
    return { success: r.success, code: r.code, configVersion: r.config_version };
  }

  async listMcpServers(options?: { agentIdentityId?: string }): Promise<HostedMcpConnection[]> {
    const data = await this.http.get<{ connections: RawHostedMcpConnection[] }>("/hosted-agent-config/mcp-servers",
      options?.agentIdentityId ? { agent_identity_id: options.agentIdentityId } : {});
    return data.connections.map(parseHostedMcpConnection);
  }

  async createMcpServer(body: HostedMcpCreate, options: { idempotencyKey: string }): Promise<HostedMcpConnection> {
    return parseHostedMcpConnection(await this.http.post<RawHostedMcpConnection>("/hosted-agent-config/mcp-servers", mcpBody(body),
      { headers: { "Idempotency-Key": options.idempotencyKey } }));
  }

  async getMcpServer(id: string): Promise<HostedMcpConnection> {
    return parseHostedMcpConnection(await this.http.get<RawHostedMcpConnection>(`/hosted-agent-config/mcp-servers/${encodeURIComponent(id)}`));
  }

  /** Omitted auth is retained. Changing the URL requires replacement auth or type none. */
  async updateMcpServer(id: string, body: HostedMcpUpdate): Promise<HostedMcpConnection> {
    return parseHostedMcpConnection(await this.http.patch<RawHostedMcpConnection>(`/hosted-agent-config/mcp-servers/${encodeURIComponent(id)}`, mcpBody(body)));
  }

  async deleteMcpServer(id: string): Promise<void> {
    await this.http.delete(`/hosted-agent-config/mcp-servers/${encodeURIComponent(id)}`);
  }

  async testMcpServer(id: string): Promise<HostedMcpTestResult> {
    const r = await this.http.post<{ success: boolean; code: string; config_version: number }>(`/hosted-agent-config/mcp-servers/${encodeURIComponent(id)}/test`);
    return { success: r.success, code: r.code, configVersion: r.config_version };
  }

  async refreshMcpServer(id: string, options: { idempotencyKey: string }): Promise<HostedMcpTestResult> {
    const r = await this.http.post<{ success: boolean; code: string; config_version: number }>(`/hosted-agent-config/mcp-servers/${encodeURIComponent(id)}/refresh`, undefined,
      { headers: { "Idempotency-Key": options.idempotencyKey } });
    return { success: r.success, code: r.code, configVersion: r.config_version };
  }

  async getMcpCatalog(id: string, options?: { cursor?: string; limit?: number; skillUri?: string }): Promise<HostedMcpCatalog> {
    const r = await this.http.get<Omit<HostedMcpCatalog, "nextCursor" | "configVersion" | "catalogVersion"> & {
      next_cursor: string | null; config_version: number; catalog_version: string | null;
    }>(`/hosted-agent-config/mcp-servers/${encodeURIComponent(id)}/catalog`, {
      cursor: options?.cursor, limit: options?.limit, skill_uri: options?.skillUri,
    });
    return { tools: r.tools, prompts: r.prompts, resources: r.resources, skills: r.skills,
      nextCursor: r.next_cursor, configVersion: r.config_version, catalogVersion: r.catalog_version };
  }

  async getMcpActivity(callId: string, options?: { limit?: number; offset?: number }): Promise<HostedMcpActivityPage> {
    const r = await this.http.get<{ items: Array<{ id: string; connection_label: string; tool_name: string;
      status: HostedMcpActivityPage["items"][number]["status"]; error_code: string | null;
      started_at: string | null; completed_at: string | null }>; limit: number; offset: number; has_more: boolean; incomplete: boolean;
    }>(`/calls/${encodeURIComponent(callId)}/mcp-activity`, options);
    return { items: r.items.map(i => ({ id: i.id, connectionLabel: i.connection_label, toolName: i.tool_name, status: i.status,
      errorCode: i.error_code, startedAt: i.started_at ? new Date(i.started_at) : null, completedAt: i.completed_at ? new Date(i.completed_at) : null })),
      limit: r.limit, offset: r.offset, hasMore: r.has_more, incomplete: r.incomplete };
  }

  /** List your organization's voices, availability, previews, and default. */
  async listVoices(): Promise<HostedAgentVoiceCatalog> {
    const data = await this.http.get<RawHostedAgentVoiceCatalog>(
      "/hosted-agent-voices",
    );
    return parseHostedAgentVoiceCatalog(data);
  }

  /**
   * Get the Inkbox Voice AI config.
   *
   * Agent-scoped keys resolve their own identity; admin/JWT callers must
   * pass `agentIdentityId` (the server returns 422 otherwise).
   *
   * @param options.agentIdentityId - UUID of the agent identity. Optional
   *   for agent-scoped keys; required under admin/JWT.
   */
  async getConfig(options?: {
    agentIdentityId?: string;
  }): Promise<HostedAgentConfig> {
    const params: Record<string, string> = {};
    if (options?.agentIdentityId !== undefined) {
      params["agent_identity_id"] = options.agentIdentityId;
    }
    const data = await this.http.get<RawHostedAgentConfig>(
      "/hosted-agent-config",
      params,
    );
    return parseHostedAgentConfig(data);
  }

  /**
   * Set the Inkbox Voice AI config.
   *
   * Full-replace PUT: every call replaces voice and instructions. The
   * deprecated `model` option remains accepted but is ignored.
   *
   * @param options.voice - Voice override; omit for the server default.
   * @param options.model - Deprecated compatibility option; accepted but ignored.
   * @param options.instructions - Per-identity steering prompt appended to
   *   Voice AI's system prompt; omit for none.
   * @param options.agentIdentityId - UUID of the agent identity. Optional
   *   for agent-scoped keys; required under admin/JWT.
   */
  async setConfig(options?: {
    voice?: string;
    /** @deprecated Accepted for compatibility but ignored. */
    model?: string;
    instructions?: string;
    agentIdentityId?: string;
  }): Promise<HostedAgentConfig> {
    const body: Record<string, unknown> = {};
    if (options?.agentIdentityId !== undefined) {
      body["agent_identity_id"] = options.agentIdentityId;
    }
    // Omitted fields are equivalent to explicit nulls on this full-replace
    // PUT: the server resets them to its defaults.
    if (options?.voice !== undefined) body["voice"] = options.voice;
    if (options?.instructions !== undefined) {
      body["instructions"] = options.instructions;
    }
    const data = await this.http.put<RawHostedAgentConfig>(
      "/hosted-agent-config",
      body,
    );
    return parseHostedAgentConfig(data);
  }

  /**
   * Set an identity's saved Voice AI authority.
   *
   * This privileged operation requires an admin API key. Incoming calls use
   * this value, and outbound calls inherit it when they omit a per-call
   * override.
   */
  async setAuthorityMode(options: {
    agentIdentityId: string;
    authorityMode: HostedAgentAuthorityMode;
  }): Promise<HostedAgentConfig> {
    const data = await this.http.put<RawHostedAgentConfig>(
      "/hosted-agent-config/authority-mode",
      {
        agent_identity_id: options.agentIdentityId,
        authority_mode: options.authorityMode,
      },
    );
    return parseHostedAgentConfig(data);
  }
}
