/** Slack workspace setup, live reads, and durable sends. */
import type { HttpTransport } from "./_http.js";
import { SlackContactRulesResource } from "./slack-rules.js";
import { SlackOperationsResource } from "./slack-operations.js";

export type SlackMessageKind =
  "dm" | "group_dm" | "mention" | "channel" | "thread";
export interface SlackConnection {
  id: string;
  identityId: string;
  workspaceId: string;
  workspaceName: string;
  botUserId: string;
  status: "connected" | "disconnected" | "reauthorization_required";
  scopes: string[];
  createdAt: Date;
}
export interface SlackConnectionsResponse {
  connections: SlackConnection[];
  installationAvailable: boolean;
  setup?: SlackSetupStatus | null;
  /** App existence, independent of identity enablement or workspace connections. */
  applicationCreated?: boolean;
  provisioningWorkspace?: SlackProvisioningWorkspace | null;
}
export interface SlackSetupStatus {
  status: "not_started" | "pending" | "ready" | "failed" | "unavailable" | "needs_credentials";
  retryAt: Date | null;
  errorCode: "setup_failed" | "outcome_unknown" | "quota_exceeded" | "credentials_required" | null;
  provisioningWorkspaceId: string | null;
}
export interface SlackProvisioningWorkspace {
  id: string;
  workspaceId: string;
  workspaceName: string;
  userId: string;
  status: "ready" | "reauthorization_required";
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface SlackInstallation {
  authorizationUrl: string;
  expiresAt: Date;
}
export interface SlackAction {
  id: string;
  connectionId: string;
  status: "sending" | "sent" | "failed" | "unknown";
  conversationId: string;
  messageTs: string | null;
  threadTs: string | null;
  errorCode: string | null;
  /** Immediate rate-limit delay in seconds; absent from stored action reads. */
  retryAfter: number | null;
}
export interface SlackConversationsResponse {
  conversations: Record<string, unknown>[];
  nextCursor: string | null;
}
export interface SlackMessagesResponse {
  messages: Record<string, unknown>[];
  nextCursor: string | null;
  hasMore: boolean;
}
export interface SlackFile {
  id: string;
  name: string | null;
  title: string | null;
  mimetype: string | null;
  size: number | null;
  downloadable: boolean;
}
export interface SlackSendMessageOptions {
  conversationId: string;
  text: string;
  idempotencyKey: string;
  threadTs?: string | null;
}
export interface SlackPageOptions {
  limit?: number;
  cursor?: string | null;
}
export interface SlackMessagesOptions extends SlackPageOptions {
  threadTs?: string | null;
}
interface RawConnection {
  id: string;
  identity_id: string;
  workspace_id: string;
  workspace_name: string;
  bot_user_id: string;
  status: SlackConnection["status"];
  scopes: string[];
  created_at: string;
}
interface RawSetupStatus {
  status: SlackSetupStatus["status"];
  retry_at?: string | null;
  error_code?: SlackSetupStatus["errorCode"];
  provisioning_workspace_id?: string | null;
}
const setupStatus = (r: RawSetupStatus): SlackSetupStatus => ({
  status: r.status,
  retryAt: r.retry_at ? new Date(r.retry_at) : null,
  errorCode: r.error_code ?? null,
  provisioningWorkspaceId: r.provisioning_workspace_id ?? null,
});
interface RawProvisioningWorkspace {
  id: string;
  workspace_id: string;
  workspace_name: string;
  user_id: string;
  status: SlackProvisioningWorkspace["status"];
  token_expires_at: string | null;
  created_at: string;
  updated_at: string;
}
interface RawAction {
  id: string;
  connection_id: string;
  status: SlackAction["status"];
  conversation_id: string;
  message_ts?: string | null;
  thread_ts?: string | null;
  error_code?: string | null;
  retry_after?: number | null;
}
const connection = (r: RawConnection): SlackConnection => ({
  id: r.id,
  identityId: r.identity_id,
  workspaceId: r.workspace_id,
  workspaceName: r.workspace_name,
  botUserId: r.bot_user_id,
  status: r.status,
  scopes: r.scopes,
  createdAt: new Date(r.created_at),
});
const provisioningWorkspace = (r: RawProvisioningWorkspace): SlackProvisioningWorkspace => ({
  id: r.id,
  workspaceId: r.workspace_id,
  workspaceName: r.workspace_name,
  userId: r.user_id,
  status: r.status,
  tokenExpiresAt: r.token_expires_at ? new Date(r.token_expires_at) : null,
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});
const action = (r: RawAction): SlackAction => ({
  id: r.id,
  connectionId: r.connection_id,
  status: r.status,
  conversationId: r.conversation_id,
  messageTs: r.message_ts ?? null,
  threadTs: r.thread_ts ?? null,
  errorCode: r.error_code ?? null,
  retryAfter: r.retry_after ?? null,
});
const base = (id: string): string =>
  `/slack/connections/${encodeURIComponent(id)}`;

export interface SlackDiscoveredWorkspace {
  workspaceId: string;
  workspaceName: string | null;
  source: "connection" | "contact" | "shared_channel" | "enterprise";
}
export interface SlackWorkspaceDiscoveryResponse {
  workspaces: SlackDiscoveredWorkspace[];
  nextCursor: string | null;
  unavailableReason: string | null;
}
export interface SlackWorkspaceDiscoveryOptions {
  source?: "known" | "conversations" | "enterprise";
  limit?: number;
  cursor?: string | null;
}
export interface SlackContactImportOptions extends SlackPageOptions { conversationId?: string | null }
export interface SlackContactImportResponse {
  importedCount: number;
  skippedCount: number;
  contactIds: string[];
  nextCursor: string | null;
}

export class SlackResource extends SlackOperationsResource {
  readonly contactRules: SlackContactRulesResource;
  constructor(http: HttpTransport) {
    super(http);
    this.contactRules = new SlackContactRulesResource(http);
  }
  /** Read one page; requires an organization admin API key or Console session.
   * Known contact workspaces need not be connected to this connection. */
  async discoverWorkspaces(connectionId: string, options: SlackWorkspaceDiscoveryOptions = {}): Promise<SlackWorkspaceDiscoveryResponse> {
    const r = await this.http.get<{
      workspaces: { workspace_id: string; workspace_name: string | null; source: SlackDiscoveredWorkspace["source"] }[];
      next_cursor: string | null; unavailable_reason: string | null;
    }>(`${base(connectionId)}/workspaces`, {
      source: options.source ?? "known", limit: options.limit ?? 20, cursor: options.cursor,
    });
    return { workspaces: r.workspaces.map((w) => ({ workspaceId: w.workspace_id,
      workspaceName: w.workspace_name, source: w.source })), nextCursor: r.next_cursor,
      unavailableReason: r.unavailable_reason };
  }
  /** Import one page of visible humans without creating contact rules.
   * Requires an organization admin API key or Console session. */
  async importContacts(connectionId: string, options: SlackContactImportOptions = {}): Promise<SlackContactImportResponse> {
    const r = await this.http.post<{
      imported_count: number; skipped_count: number; contact_ids: string[]; next_cursor: string | null;
    }>(`${base(connectionId)}/contacts/import`, {
      limit: options.limit ?? 100, cursor: options.cursor ?? undefined,
      conversation_id: options.conversationId ?? undefined,
    });
    return { importedCount: r.imported_count, skippedCount: r.skipped_count,
      contactIds: r.contact_ids, nextCursor: r.next_cursor };
  }
  /**
   * Claimed agent keys can install only their own identity.
   * Open the short-lived opaque URL in a browser; do not log it.
   * returnUrl optionally selects an approved Console completion URL; omit it for the default page.
   */
  async startInstallation(
    identityId: string,
    options: { workspaceId?: string; returnUrl?: string | null } = {},
  ): Promise<SlackInstallation> {
    const r = await this.http.post<{
      authorization_url: string;
      expires_at: string;
    }>("/slack/installations", {
      identity_id: identityId,
      workspace_id: options.workspaceId,
      return_url: options.returnUrl ?? undefined,
    });
    return {
      authorizationUrl: r.authorization_url,
      expiresAt: new Date(r.expires_at),
    };
  }
  async listConnections(identityId: string): Promise<SlackConnectionsResponse> {
    const r = await this.http.get<{
      connections: RawConnection[];
      installation_available: boolean;
      setup?: RawSetupStatus | null;
      application_created?: boolean;
      provisioning_workspace?: RawProvisioningWorkspace | null;
    }>("/slack/connections", { identity_id: identityId });
    return {
      connections: r.connections.map(connection),
      installationAvailable: r.installation_available,
      setup: r.setup ? setupStatus(r.setup) : null,
      applicationCreated: r.application_created ?? false,
      provisioningWorkspace: r.provisioning_workspace ? provisioningWorkspace(r.provisioning_workspace) : null,
    };
  }
  /** List saved workspace metadata; credentials are never returned. */
  async listProvisioningWorkspaces(): Promise<SlackProvisioningWorkspace[]> {
    const r = await this.http.get<{ workspaces: RawProvisioningWorkspace[] }>(
      "/slack/provisioning-workspaces",
    );
    return r.workspaces.map(provisioningWorkspace);
  }
  /** Verify and save configuration credentials for your organization. Claimed agent keys are supported. */
  async saveProvisioningWorkspace(options: {
    accessToken: string;
    refreshToken: string;
  }): Promise<SlackProvisioningWorkspace> {
    return provisioningWorkspace(await this.http.post<RawProvisioningWorkspace>(
      "/slack/provisioning-workspaces", {
        access_token: options.accessToken,
        refresh_token: options.refreshToken,
      },
    ));
  }
  /** Prepare the identity app in a saved workspace; read listConnections for status. */
  async startSetup(identityId: string, provisioningWorkspaceId: string): Promise<SlackSetupStatus> {
    return setupStatus(await this.http.post<RawSetupStatus>(
      "/slack/applications/setup", {
        identity_id: identityId,
        provisioning_workspace_id: provisioningWorkspaceId,
      },
    ));
  }
  /** Removes Inkbox authority; does not uninstall the Slack app. */
  async disconnect(connectionId: string): Promise<SlackConnection> {
    return connection(await this.http.post(`${base(connectionId)}/disconnect`));
  }
  async listConversations(
    connectionId: string,
    options: SlackPageOptions = {},
  ): Promise<SlackConversationsResponse> {
    const r = await this.http.get<{
      conversations: Record<string, unknown>[];
      next_cursor?: string | null;
    }>(`${base(connectionId)}/conversations`, {
      limit: options.limit ?? 100,
      cursor: options.cursor,
    });
    return {
      conversations: r.conversations,
      nextCursor: r.next_cursor ?? null,
    };
  }
  async openConversation(
    connectionId: string,
    userIds: string[],
  ): Promise<Record<string, unknown>> {
    return this.http.post(`${base(connectionId)}/conversations`, {
      user_ids: userIds,
    });
  }
  async getConversation(
    connectionId: string,
    conversationId: string,
  ): Promise<Record<string, unknown>> {
    return this.http.get(
      `${base(connectionId)}/conversations/${encodeURIComponent(conversationId)}`,
    );
  }
  async listMessages(
    connectionId: string,
    conversationId: string,
    options: SlackMessagesOptions = {},
  ): Promise<SlackMessagesResponse> {
    if (options.threadTs != null && typeof options.threadTs !== "string")
      throw new TypeError("threadTs must be a string");
    const r = await this.http.get<{
      messages: Record<string, unknown>[];
      next_cursor?: string | null;
      has_more?: boolean;
    }>(
      `${base(connectionId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        limit: options.limit ?? 15,
        cursor: options.cursor,
        thread_ts: options.threadTs,
      },
    );
    return {
      messages: r.messages,
      nextCursor: r.next_cursor ?? null,
      hasMore: r.has_more ?? false,
    };
  }
  /** Keep a stable key for this exact message. Poll getAction while sending. Unknown is terminal uncertainty; never blindly resend. */
  async sendMessage(
    connectionId: string,
    options: SlackSendMessageOptions,
  ): Promise<SlackAction> {
    if (
      typeof options.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(options.idempotencyKey)
    )
      throw new TypeError(
        "idempotencyKey must be 1..128 letters, digits, '.', '_', ':', or '-'",
      );
    if (options.threadTs != null && typeof options.threadTs !== "string")
      throw new TypeError("threadTs must be a string");
    return action(
      await this.http.post(
        `${base(connectionId)}/messages`,
        {
          conversation_id: options.conversationId,
          text: options.text,
          thread_ts: options.threadTs,
        },
        { headers: { "Idempotency-Key": options.idempotencyKey } },
      ),
    );
  }
  async getAction(
    connectionId: string,
    actionId: string,
  ): Promise<SlackAction> {
    return action(
      await this.http.get(
        `${base(connectionId)}/actions/${encodeURIComponent(actionId)}`,
      ),
    );
  }
  /** Read a send without resending; a 404 does not prove no send occurred. */
  async getActionByKey(
    connectionId: string,
    idempotencyKey: string,
  ): Promise<SlackAction> {
    return action(await this.http.get(
      `${base(connectionId)}/actions/by-key`,
      undefined,
      { headers: { "Idempotency-Key": idempotencyKey } },
    ));
  }
  async getFile(connectionId: string, fileId: string): Promise<SlackFile> {
    return this.http.get(
      `${base(connectionId)}/files/${encodeURIComponent(fileId)}`,
    );
  }
  async downloadFile(
    connectionId: string,
    fileId: string,
  ): Promise<Uint8Array> {
    return (
      await this.http.getBytes(
        `${base(connectionId)}/files/${encodeURIComponent(fileId)}/content`,
      )
    ).data;
  }
}
