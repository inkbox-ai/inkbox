/** Scoped Slack utilities, durable actions, and retained history. */
import type { HttpTransport } from "./_http.js";
import type { SlackPageOptions } from "./slack.js";

export type SlackProcessingStatus =
  "active" | "processing" | "suspended" | "closed";
export type SlackOperationKind =
  | "reaction_add"
  | "reaction_remove"
  | "pin_add"
  | "pin_remove"
  | "message_update"
  | "message_delete"
  | "file_upload"
  | "conversation_join"
  | "conversation_leave"
  | "processing_status";
export interface SlackOperation {
  id: string;
  connectionId: string;
  operation: SlackOperationKind;
  status: "in_progress" | "succeeded" | "failed" | "unknown";
  conversationId: string;
  messageTs: string | null;
  fileId: string | null;
  errorCode: string | null;
  retryAfter: number | null;
  processingStatus: SlackProcessingStatus | null;
  agentStatus: SlackProcessingStatus | null;
}
export interface SlackCapability {
  requiredScopes: string[];
  missingScopes: string[];
  scopesSatisfied: boolean;
}
export interface SlackCapabilitiesResponse {
  connectionId: string;
  scopes: string[];
  missingScopes: string[];
  capabilities: Record<string, SlackCapability>;
  nativeProcessingStatus: "unknown" | "missing_scope";
  maxUploadBytes: number;
}
export interface SlackUsersResponse {
  users: Record<string, unknown>[];
  nextCursor: string | null;
}
export interface SlackMembersResponse {
  members: string[];
  nextCursor: string | null;
}
export interface SlackPinsResponse {
  items: Record<string, unknown>[];
  truncated: boolean;
}
export interface SlackReactionsResponse {
  conversationId: string;
  messageTs: string;
  reactions: Record<string, unknown>[];
}
export interface SlackMessageContextResponse {
  messages: Record<string, unknown>[];
  nextCursor: string | null;
  hasMore: boolean;
  window: "messages_at_or_before_timestamp";
  complete: false;
}
export interface SlackPermalinkResponse {
  conversationId: string;
  messageTs: string;
  permalink: string;
}
export interface SlackArchiveSettings {
  captureEnabled: boolean;
  retentionDays: number | null;
  conversationIds: string[];
  revision: number;
}
export interface SlackArchiveSettingsOptions {
  captureEnabled: boolean;
  retentionDays?: number | null;
  conversationIds?: string[];
}
export interface SlackArchivedMessage {
  id: string;
  connectionId: string;
  conversationId: string;
  messageTs: string;
  threadTs: string | null;
  userId: string | null;
  text: string;
  files: Record<string, unknown>[];
  mentioned: boolean;
  source: "event" | "backfill" | "action";
  sourceUrl: string | null;
  capturedAt: Date;
}
export interface SlackArchiveMessagesResponse {
  messages: SlackArchivedMessage[];
  nextCursor: string | null;
  source: "archive";
}
export interface SlackArchiveCoverage {
  conversationId: string;
  threadTs: string | null;
  status: "observed" | "pending" | "running" | "complete" | "failed" | "paused";
  importedCount: number;
  oldestTs: string | null;
  newestTs: string | null;
  errorCode: string | null;
  updatedAt: Date;
  includesAllThreads: boolean;
  accessRevoked: boolean;
}
export interface SlackArchiveCoverageResponse {
  coverage: SlackArchiveCoverage[];
  nextCursor: string | null;
}
export interface SlackArchiveMessagesOptions extends SlackPageOptions {
  conversationId?: string;
  threadTs?: string | null;
  beforeTs?: string | null;
  afterTs?: string | null;
}
export interface SlackArchiveSearchOptions extends Omit<
  SlackArchiveMessagesOptions,
  "threadTs"
> {
  userId?: string;
}
export interface SlackUploadFileOptions {
  conversationId: string;
  filename: string;
  contentBase64: string;
  idempotencyKey: string;
  title?: string | null;
  initialComment?: string | null;
  threadTs?: string | null;
}
export interface SlackMutationOptions {
  idempotencyKey: string;
}

type Snake<S extends string> = S extends `${infer A}${infer B}`
  ? `${A extends Lowercase<A> ? A : `_${Lowercase<A>}`}${Snake<B>}`
  : S;
type Wire<T> = {
  [K in keyof T as Snake<K & string>]: T[K] extends Date ? string : T[K];
};
type RawOperation = Wire<SlackOperation>;
const base = (id: string): string =>
  `/slack/connections/${encodeURIComponent(id)}`;
const conversation = (id: string, channel: string): string =>
  `${base(id)}/conversations/${encodeURIComponent(channel)}`;
function timestamp(
  value: string | null | undefined,
): string | null | undefined {
  if (value != null && typeof value !== "string")
    throw new TypeError("Slack timestamps must be strings");
  return value;
}
const message = (id: string, channel: string, ts: string): string => {
  timestamp(ts);
  return `${conversation(id, channel)}/messages/${encodeURIComponent(ts)}`;
};
const operation = (r: RawOperation): SlackOperation => ({
  id: r.id,
  connectionId: r.connection_id,
  operation: r.operation,
  status: r.status,
  conversationId: r.conversation_id,
  messageTs: r.message_ts ?? null,
  fileId: r.file_id ?? null,
  errorCode: r.error_code ?? null,
  retryAfter: r.retry_after ?? null,
  processingStatus: r.processing_status ?? null,
  agentStatus: r.agent_status ?? null,
});
const settings = (r: Wire<SlackArchiveSettings>): SlackArchiveSettings => ({
  captureEnabled: r.capture_enabled,
  retentionDays: r.retention_days,
  conversationIds: r.conversation_ids,
  revision: r.revision,
});
const archivedMessage = (
  r: Wire<SlackArchivedMessage>,
): SlackArchivedMessage => ({
  id: r.id,
  connectionId: r.connection_id,
  conversationId: r.conversation_id,
  messageTs: r.message_ts,
  threadTs: r.thread_ts,
  userId: r.user_id,
  text: r.text,
  files: r.files,
  mentioned: r.mentioned,
  source: r.source,
  sourceUrl: r.source_url ?? null,
  capturedAt: new Date(r.captured_at),
});
const coverage = (r: Wire<SlackArchiveCoverage>): SlackArchiveCoverage => ({
  conversationId: r.conversation_id,
  threadTs: r.thread_ts,
  status: r.status,
  importedCount: r.imported_count,
  oldestTs: r.oldest_ts,
  newestTs: r.newest_ts,
  errorCode: r.error_code,
  updatedAt: new Date(r.updated_at),
  includesAllThreads: r.includes_all_threads ?? false,
  accessRevoked: r.access_revoked ?? false,
});

export class SlackOperationsResource {
  constructor(protected readonly http: HttpTransport) {}
  private async mutate(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    key: string,
    body?: unknown,
  ): Promise<SlackOperation> {
    if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))
      throw new TypeError(
        "idempotencyKey must be 1..128 letters, digits, '.', '_', ':', or '-'",
      );
    const opts = { headers: { "Idempotency-Key": key } };
    const result =
      method === "DELETE"
        ? await this.http.deleteWithResponse<RawOperation>(path, opts)
        : method === "PATCH"
          ? await this.http.patch<RawOperation>(path, body, opts)
          : await this.http.post<RawOperation>(path, body, opts);
    return operation(result);
  }
  async capabilities(connectionId: string): Promise<SlackCapabilitiesResponse> {
    const r = await this.http.get<
      Omit<Wire<SlackCapabilitiesResponse>, "capabilities"> & {
        capabilities: Record<string, Wire<SlackCapability>>;
      }
    >(`${base(connectionId)}/capabilities`);
    return {
      connectionId: r.connection_id,
      scopes: r.scopes,
      missingScopes: r.missing_scopes,
      nativeProcessingStatus: r.native_processing_status,
      maxUploadBytes: r.max_upload_bytes,
      capabilities: Object.fromEntries(
        Object.entries(r.capabilities).map(([name, value]) => [
          name,
          {
            requiredScopes: value.required_scopes,
            missingScopes: value.missing_scopes,
            scopesSatisfied: value.scopes_satisfied,
          },
        ]),
      ),
    };
  }
  async listUsers(
    connectionId: string,
    options: SlackPageOptions = {},
  ): Promise<SlackUsersResponse> {
    const r = await this.http.get<Wire<SlackUsersResponse>>(
      `${base(connectionId)}/users`,
      { limit: options.limit ?? 100, cursor: options.cursor },
    );
    return { users: r.users, nextCursor: r.next_cursor ?? null };
  }
  async getUser(
    connectionId: string,
    userId: string,
  ): Promise<Record<string, unknown>> {
    return this.http.get(
      `${base(connectionId)}/users/${encodeURIComponent(userId)}`,
    );
  }
  async listMembers(
    connectionId: string,
    conversationId: string,
    options: SlackPageOptions = {},
  ): Promise<SlackMembersResponse> {
    const r = await this.http.get<Wire<SlackMembersResponse>>(
      `${conversation(connectionId, conversationId)}/members`,
      { limit: options.limit ?? 100, cursor: options.cursor },
    );
    return { members: r.members, nextCursor: r.next_cursor ?? null };
  }
  async getMessage(
    connectionId: string,
    conversationId: string,
    messageTs: string,
    options: { threadTs?: string | null } = {},
  ): Promise<Record<string, unknown>> {
    return this.http.get(message(connectionId, conversationId, messageTs), {
      thread_ts: timestamp(options.threadTs),
    });
  }
  async messageContext(
    connectionId: string,
    conversationId: string,
    messageTs: string,
    options: { threadTs?: string | null; limit?: number } = {},
  ): Promise<SlackMessageContextResponse> {
    const r = await this.http.get<Wire<SlackMessageContextResponse>>(
      `${message(connectionId, conversationId, messageTs)}/context`,
      { thread_ts: timestamp(options.threadTs), limit: options.limit ?? 5 },
    );
    return {
      messages: r.messages,
      nextCursor: r.next_cursor ?? null,
      hasMore: r.has_more ?? false,
      window: r.window,
      complete: r.complete,
    };
  }
  async getPermalink(
    connectionId: string,
    conversationId: string,
    messageTs: string,
  ): Promise<SlackPermalinkResponse> {
    const r = await this.http.get<Wire<SlackPermalinkResponse>>(
      `${message(connectionId, conversationId, messageTs)}/permalink`,
    );
    return {
      conversationId: r.conversation_id,
      messageTs: r.message_ts,
      permalink: r.permalink,
    };
  }
  async getReactions(
    connectionId: string,
    conversationId: string,
    messageTs: string,
  ): Promise<SlackReactionsResponse> {
    const r = await this.http.get<Wire<SlackReactionsResponse>>(
      `${message(connectionId, conversationId, messageTs)}/reactions`,
    );
    return {
      conversationId: r.conversation_id,
      messageTs: r.message_ts,
      reactions: r.reactions,
    };
  }
  async listPins(
    connectionId: string,
    conversationId: string,
  ): Promise<SlackPinsResponse> {
    return this.http.get(`${conversation(connectionId, conversationId)}/pins`);
  }
  /** Poll only in_progress. Unknown is terminal uncertainty; never blindly repeat. */
  async getOperation(
    connectionId: string,
    operationId: string,
  ): Promise<SlackOperation> {
    return operation(
      await this.http.get(
        `${base(connectionId)}/operations/${encodeURIComponent(operationId)}`,
      ),
    );
  }
  async addReaction(
    connectionId: string,
    conversationId: string,
    messageTs: string,
    name: string,
    options: SlackMutationOptions,
  ): Promise<SlackOperation> {
    return this.mutate(
      "POST",
      `${message(connectionId, conversationId, messageTs)}/reactions`,
      options.idempotencyKey,
      { name },
    );
  }
  async removeReaction(
    connectionId: string,
    conversationId: string,
    messageTs: string,
    name: string,
    options: SlackMutationOptions,
  ): Promise<SlackOperation> {
    return this.mutate(
      "DELETE",
      `${message(connectionId, conversationId, messageTs)}/reactions/${encodeURIComponent(name)}`,
      options.idempotencyKey,
    );
  }
  async addPin(
    connectionId: string,
    conversationId: string,
    messageTs: string,
    options: SlackMutationOptions,
  ): Promise<SlackOperation> {
    return this.mutate(
      "POST",
      `${conversation(connectionId, conversationId)}/pins`,
      options.idempotencyKey,
      { message_ts: timestamp(messageTs) },
    );
  }
  async removePin(
    connectionId: string,
    conversationId: string,
    messageTs: string,
    options: SlackMutationOptions,
  ): Promise<SlackOperation> {
    timestamp(messageTs);
    return this.mutate(
      "DELETE",
      `${conversation(connectionId, conversationId)}/pins/${encodeURIComponent(messageTs)}`,
      options.idempotencyKey,
    );
  }
  /** Slack enforces that the connected agent can only edit its own message. */
  async updateMessage(
    connectionId: string,
    conversationId: string,
    messageTs: string,
    text: string,
    options: SlackMutationOptions,
  ): Promise<SlackOperation> {
    return this.mutate(
      "PATCH",
      message(connectionId, conversationId, messageTs),
      options.idempotencyKey,
      { text },
    );
  }
  async deleteMessage(
    connectionId: string,
    conversationId: string,
    messageTs: string,
    options: SlackMutationOptions,
  ): Promise<SlackOperation> {
    return this.mutate(
      "DELETE",
      message(connectionId, conversationId, messageTs),
      options.idempotencyKey,
    );
  }
  async joinConversation(
    connectionId: string,
    conversationId: string,
    options: SlackMutationOptions,
  ): Promise<SlackOperation> {
    return this.mutate(
      "POST",
      `${conversation(connectionId, conversationId)}/join`,
      options.idempotencyKey,
    );
  }
  async leaveConversation(
    connectionId: string,
    conversationId: string,
    options: SlackMutationOptions,
  ): Promise<SlackOperation> {
    return this.mutate(
      "POST",
      `${conversation(connectionId, conversationId)}/leave`,
      options.idempotencyKey,
    );
  }
  /** Native workspace support is not implied by scopes; unsupported calls remain explicit failures. */
  async setProcessingStatus(
    connectionId: string,
    conversationId: string,
    threadTs: string,
    status: SlackProcessingStatus,
    options: SlackMutationOptions,
  ): Promise<SlackOperation> {
    return this.mutate(
      "POST",
      `${conversation(connectionId, conversationId)}/processing-status`,
      options.idempotencyKey,
      { thread_ts: timestamp(threadTs), status },
    );
  }
  /** Standard base64 of any file type, bounded to 1 byte..10 MiB decoded. */
  async uploadFile(
    connectionId: string,
    options: SlackUploadFileOptions,
  ): Promise<SlackOperation> {
    return this.mutate(
      "POST",
      `${base(connectionId)}/files`,
      options.idempotencyKey,
      {
        conversation_id: options.conversationId,
        filename: options.filename,
        content_base64: options.contentBase64,
        title: options.title,
        initial_comment: options.initialComment,
        thread_ts: timestamp(options.threadTs),
      },
    );
  }
  async getArchiveSettings(
    connectionId: string,
  ): Promise<SlackArchiveSettings> {
    return settings(
      await this.http.get(`${base(connectionId)}/archive/settings`),
    );
  }
  /** Organization management only. Replaces capture settings; null retention has no time limit. */
  async updateArchiveSettings(
    connectionId: string,
    options: SlackArchiveSettingsOptions,
  ): Promise<SlackArchiveSettings> {
    return settings(
      await this.http.patch(`${base(connectionId)}/archive/settings`, {
        capture_enabled: options.captureEnabled,
        retention_days: options.retentionDays ?? null,
        conversation_ids: options.conversationIds ?? [],
      }),
    );
  }
  private async archiveMessages(
    connectionId: string,
    path: string,
    options: SlackArchiveMessagesOptions,
    extra: Record<string, string | undefined> = {},
  ): Promise<SlackArchiveMessagesResponse> {
    const r = await this.http.get<{
      messages: Wire<SlackArchivedMessage>[];
      next_cursor?: string | null;
      source: "archive";
    }>(`${base(connectionId)}/archive/${path}`, {
      conversation_id: options.conversationId,
      thread_ts: timestamp(options.threadTs),
      before_ts: timestamp(options.beforeTs),
      after_ts: timestamp(options.afterTs),
      cursor: options.cursor,
      limit: options.limit ?? 50,
      ...extra,
    });
    return {
      messages: r.messages.map(archivedMessage),
      nextCursor: r.next_cursor ?? null,
      source: r.source,
    };
  }
  async listArchivedMessages(
    connectionId: string,
    options: SlackArchiveMessagesOptions = {},
  ): Promise<SlackArchiveMessagesResponse> {
    return this.archiveMessages(connectionId, "messages", options);
  }
  async searchArchivedMessages(
    connectionId: string,
    q: string,
    options: SlackArchiveSearchOptions = {},
  ): Promise<SlackArchiveMessagesResponse> {
    return this.archiveMessages(connectionId, "search", options, {
      q,
      user_id: options.userId,
    });
  }
  async archiveBackfill(
    connectionId: string,
    conversationId: string,
    options: { threadTs?: string | null; restart?: boolean } = {},
  ): Promise<SlackArchiveCoverage> {
    return coverage(
      await this.http.post(`${base(connectionId)}/archive/backfill`, {
        conversation_id: conversationId,
        thread_ts: timestamp(options.threadTs),
        restart: options.restart ?? false,
      }),
    );
  }
  async listArchiveCoverage(
    connectionId: string,
    options: SlackPageOptions = {},
  ): Promise<SlackArchiveCoverageResponse> {
    const r = await this.http.get<{
      coverage: Wire<SlackArchiveCoverage>[];
      next_cursor?: string | null;
    }>(`${base(connectionId)}/archive/coverage`, {
      limit: options.limit ?? 100,
      cursor: options.cursor,
    });
    return {
      coverage: r.coverage.map(coverage),
      nextCursor: r.next_cursor ?? null,
    };
  }
  /** Organization management only; disables capture and queues retained-content deletion. */
  async purgeArchive(
    connectionId: string,
  ): Promise<{ status: "pending"; captureEnabled: false }> {
    const r = await this.http.deleteWithResponse<{
      status: "pending";
      capture_enabled: false;
    }>(`${base(connectionId)}/archive`);
    return { status: r.status, captureEnabled: r.capture_enabled };
  }
}
