/** Live Slack reads and durable sends. Open invitation URLs for browser onboarding. */
import type { HttpTransport } from "./_http.js";
import { SlackOperationsResource } from "./slack-operations.js";

export type SlackMessageKind =
  "dm" | "group_dm" | "mention" | "channel" | "thread";
export interface SlackWebhookFilter {
  connectionIds?: string[] | null;
  conversationIds?: string[] | null;
  messageKinds?: SlackMessageKind[] | null;
}
export interface RawSlackWebhookFilter {
  connection_ids?: string[] | null;
  conversation_ids?: string[] | null;
  message_kinds?: SlackMessageKind[] | null;
}
export function slackFilterWire(
  filter: SlackWebhookFilter | null,
): RawSlackWebhookFilter | null {
  if (filter === null) return null;
  return {
    connection_ids: filter.connectionIds,
    conversation_ids: filter.conversationIds,
    message_kinds: filter.messageKinds,
  };
}
export function parseSlackFilter(
  filter?: RawSlackWebhookFilter | null,
): SlackWebhookFilter | null {
  return filter == null
    ? null
    : {
        connectionIds: filter.connection_ids,
        conversationIds: filter.conversation_ids,
        messageKinds: filter.message_kinds,
      };
}
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
}
export interface SlackInvitation {
  id: string;
  identityId: string;
  status: string;
  expiresAt: Date;
  invitationUrl: string | null;
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
interface RawInvitation {
  id: string;
  identity_id: string;
  status: string;
  expires_at: string;
  invitation_url?: string | null;
}
interface RawAction {
  id: string;
  connection_id: string;
  status: SlackAction["status"];
  conversation_id: string;
  message_ts?: string | null;
  thread_ts?: string | null;
  error_code?: string | null;
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
const invitation = (r: RawInvitation): SlackInvitation => ({
  id: r.id,
  identityId: r.identity_id,
  status: r.status,
  expiresAt: new Date(r.expires_at),
  invitationUrl: r.invitation_url ?? null,
});
const action = (r: RawAction): SlackAction => ({
  id: r.id,
  connectionId: r.connection_id,
  status: r.status,
  conversationId: r.conversation_id,
  messageTs: r.message_ts ?? null,
  threadTs: r.thread_ts ?? null,
  errorCode: r.error_code ?? null,
});
const base = (id: string): string =>
  `/slack/connections/${encodeURIComponent(id)}`;

export class SlackResource extends SlackOperationsResource {
  constructor(http: HttpTransport) {
    super(http);
  }
  /**
   * Organization management only. Open the short-lived opaque URL in a browser; do not log it.
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
    }>("/slack/connections", { identity_id: identityId });
    return {
      connections: r.connections.map(connection),
      installationAvailable: r.installation_available,
    };
  }
  /** Organization management only. Open invitationUrl in the installer's browser. */
  async createInvitation(
    identityId: string,
    options: { expiresInSeconds?: number } = {},
  ): Promise<SlackInvitation> {
    return invitation(
      await this.http.post("/slack/invitations", {
        identity_id: identityId,
        expires_in_seconds: options.expiresInSeconds ?? 86400,
      }),
    );
  }
  async listInvitations(identityId: string): Promise<SlackInvitation[]> {
    return (
      await this.http.get<RawInvitation[]>("/slack/invitations", {
        identity_id: identityId,
      })
    ).map(invitation);
  }
  async revokeInvitation(id: string): Promise<SlackInvitation> {
    return invitation(
      await this.http.post(
        `/slack/invitations/${encodeURIComponent(id)}/revoke`,
      ),
    );
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
