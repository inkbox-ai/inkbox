/** Slack workspace setup, live reads, and durable sends. */
import type { HttpTransport } from "./_http.js";
import { SlackOperationsResource } from "./slack-operations.js";

export type SlackMessageKind =
  "dm" | "group_dm" | "mention" | "channel" | "thread";
export interface SlackApplication {
  id: string;
  identityId: string;
  appId: string | null;
  status: "provisioning" | "ready" | "failed" | "deleting" | "delete_failed" | "deleted";
  provisioningWorkspaceId: string;
  createdAt: Date;
}
export interface SlackAppDeletion {
  id: string;
  identityId: string;
  applicationId: string;
  appId: string | null;
  appName: string;
  provisioningWorkspaceId: string;
  status: "waiting_for_creation" | "pending" | "running" | "failed" | "deleted" | "manually_confirmed";
  attempts: number;
  retryAt: Date | null;
  errorCode: string | null;
  managementUrl: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface SlackApplicationState {
  application: SlackApplication | null;
  deletion: SlackAppDeletion | null;
}
export interface SlackAppDeletionsResponse {
  deletions: SlackAppDeletion[];
  nextCursor: string | null;
}
interface RawApplication {
  id: string; identity_id: string; app_id: string | null;
  status: SlackApplication["status"]; provisioning_workspace_id: string; created_at: string;
}
interface RawAppDeletion {
  id: string; identity_id: string; application_id: string; app_id: string | null; app_name: string;
  provisioning_workspace_id: string; status: SlackAppDeletion["status"]; attempts: number;
  retry_at: string | null; error_code: string | null; management_url: string;
  created_at: string; updated_at: string;
}
const application = (r: RawApplication): SlackApplication => ({
  id: r.id, identityId: r.identity_id, appId: r.app_id, status: r.status,
  provisioningWorkspaceId: r.provisioning_workspace_id, createdAt: new Date(r.created_at),
});
const appDeletion = (r: RawAppDeletion): SlackAppDeletion => ({
  id: r.id, identityId: r.identity_id, applicationId: r.application_id, appId: r.app_id,
  appName: r.app_name, provisioningWorkspaceId: r.provisioning_workspace_id,
  status: r.status, attempts: r.attempts, retryAt: r.retry_at ? new Date(r.retry_at) : null,
  errorCode: r.error_code, managementUrl: r.management_url,
  createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at),
});
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
  errorCode: "setup_failed" | "outcome_unknown" | "quota_exceeded" | "credentials_required" | "application_deleting" | null;
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

export class SlackResource extends SlackOperationsResource {
  constructor(http: HttpTransport) {
    super(http);
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
  /** Read app and cleanup status without creating an app or polling. */
  async getApplication(identityId: string): Promise<SlackApplicationState> {
    const r = await this.http.get<{ application: RawApplication | null; deletion: RawAppDeletion | null }>(
      "/slack/applications", { identity_id: identityId });
    return { application: r.application ? application(r.application) : null,
      deletion: r.deletion ? appDeletion(r.deletion) : null };
  }
  /** Permanently remove every installation, retaining saved history. Requires a human organization JWT.
   * Agent and management API keys cannot perform this action. Pending is not confirmed deletion.
   */
  async deleteApplication(applicationId: string): Promise<SlackAppDeletion> {
    return appDeletion(await this.http.deleteWithResponse<RawAppDeletion>(
      `/slack/applications/${encodeURIComponent(applicationId)}`));
  }
  /** One cleanup page including deleted identities; requires a human organization JWT. */
  async listApplicationDeletions(options: SlackPageOptions = {}): Promise<SlackAppDeletionsResponse> {
    const r = await this.http.get<{ deletions: RawAppDeletion[]; next_cursor: string | null }>(
      "/slack/application-deletions", { cursor: options.cursor, limit: options.limit ?? 50 });
    return { deletions: r.deletions.map(appDeletion), nextCursor: r.next_cursor };
  }
  /** Retry after credential repair or manual removal; requires a human organization JWT. */
  async retryApplicationDeletion(deletionId: string): Promise<SlackAppDeletion> {
    return appDeletion(await this.http.post<RawAppDeletion>(
      `/slack/application-deletions/${encodeURIComponent(deletionId)}/retry`));
  }
  /** Human attestation for unknown creation after quarantine, not provider verification. */
  async confirmManualAppRemoval(deletionId: string, confirmation: string): Promise<SlackAppDeletion> {
    return appDeletion(await this.http.post<RawAppDeletion>(
      `/slack/application-deletions/${encodeURIComponent(deletionId)}/confirm-manual-removal`,
      { confirmation }));
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
