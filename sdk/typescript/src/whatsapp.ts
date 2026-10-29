/** Approved WhatsApp conversations, quoted replies, reactions, and owned media. */
import { HttpTransport } from "./_http.js";
import { postMessage } from "./message_sends.js";
export type WhatsAppDirection = "inbound" | "outbound";
export type WhatsAppMessageStatus =
  | "received"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "uncertain"
  | "cancelled";
export type WhatsAppDeliveryState = "pending" | "delivered" | "unknown";
export type WhatsAppGroupCreationStatus = "pending" | "creating" | "ready" | "uncertain" | "failed";
export type WhatsAppReactionType = "love" | "like" | "dislike" | "laugh" | "emphasize" | "question" | "eyes";
export type WhatsAppReactionStatus = "queued" | "sending" | "applied" | "removed" | "failed" | "uncertain" | "superseded";
export interface WhatsAppReaction {
  id: string; targetMessageId: string; conversationId: string; agentIdentityId: string;
  direction: WhatsAppDirection; remoteNumber: string | null;
  reaction: WhatsAppReactionType | "custom"; customEmoji: string | null; emoji: string;
  status: WhatsAppReactionStatus; revision: number; createdAt: Date; updatedAt: Date; removedAt: Date | null;
}
export interface RawWhatsAppReaction {
  id: string; target_message_id: string; conversation_id: string; agent_identity_id: string;
  direction: WhatsAppDirection; remote_number: string | null;
  reaction: WhatsAppReactionType | "custom"; custom_emoji: string | null; emoji: string;
  status: WhatsAppReactionStatus; revision: number; created_at: string; updated_at: string; removed_at: string | null;
}
export function parseWhatsAppReaction(r: RawWhatsAppReaction): WhatsAppReaction {
  return { id: r.id, targetMessageId: r.target_message_id, conversationId: r.conversation_id,
    agentIdentityId: r.agent_identity_id, direction: r.direction, remoteNumber: r.remote_number,
    reaction: r.reaction, customEmoji: r.custom_emoji, emoji: r.emoji, status: r.status, revision: r.revision,
    createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at), removedAt: r.removed_at ? new Date(r.removed_at) : null };
}
export interface WhatsAppReactionOptions {
  messageId: string; reaction?: WhatsAppReactionType; customEmoji?: string;
  idempotencyKey: string; agentIdentityId?: string;
}
const reactionTypes = new Set(["love", "like", "dislike", "laugh", "emphasize", "question", "eyes"]);
const validUuid = (value: string) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const validPhone = (value: string) => /^\+[1-9][0-9]{6,14}$/.test(value);
function reactionKey(value: string): Record<string, string> {
  if (typeof value !== "string" || !value.trim() || value.length > 255) throw new Error("A stable idempotencyKey is required");
  return { "Idempotency-Key": value };
}
function reactionBody(o: WhatsAppReactionOptions): Record<string, string> {
  if (!validUuid(o.messageId) || (o.reaction == null) === (o.customEmoji == null)) throw new Error("Provide messageId and exactly one of reaction or customEmoji");
  if (o.reaction != null && !reactionTypes.has(o.reaction)) throw new Error("Unsupported WhatsApp reaction");
  if (o.customEmoji != null && (!o.customEmoji || Array.from(o.customEmoji).length > 32 || /[\s\p{Cc}\p{Cs}]/u.test(o.customEmoji))) throw new Error("customEmoji must contain 1–32 non-whitespace characters");
  return { message_id: o.messageId, ...(o.reaction != null ? { reaction: o.reaction } : { custom_emoji: o.customEmoji! }) };
}
export type WhatsAppMediaStatus = "pending" | "ready" | "unavailable";
export interface WhatsAppMedia {
  id: string;
  filename: string;
  contentType: string;
  size: number | null;
  status: WhatsAppMediaStatus;
  url: string | null;
}
export interface RawWhatsAppMedia {
  id: string;
  filename: string;
  content_type: string;
  size: number | null;
  status: WhatsAppMediaStatus;
  url: string | null;
}
export function parseWhatsAppMedia(r: RawWhatsAppMedia): WhatsAppMedia {
  return {
    id: r.id,
    filename: r.filename,
    contentType: r.content_type,
    size: r.size,
    status: r.status,
    url: r.url,
  };
}
export interface WhatsAppRecipient {
  remoteNumber: string;
  deliveryStatus: WhatsAppMessageStatus;
  deliveryState: WhatsAppDeliveryState;
  errorCode: string | null;
  errorDetail: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
}
export interface RawWhatsAppRecipient {
  remote_number: string;
  delivery_status: WhatsAppMessageStatus;
  delivery_state: WhatsAppDeliveryState;
  error_code: string | null;
  error_detail: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
}
export function parseWhatsAppRecipient(
  r: RawWhatsAppRecipient,
): WhatsAppRecipient {
  return {
    remoteNumber: r.remote_number,
    deliveryStatus: r.delivery_status,
    deliveryState: r.delivery_state,
    errorCode: r.error_code,
    errorDetail: r.error_detail,
    sentAt: r.sent_at ? new Date(r.sent_at) : null,
    deliveredAt: r.delivered_at ? new Date(r.delivered_at) : null,
    failedAt: r.failed_at ? new Date(r.failed_at) : null,
  };
}
export interface WhatsAppMessage {
  id: string;
  agentIdentityId: string;
  conversationId: string;
  direction: WhatsAppDirection;
  localNumber: string;
  remoteNumber: string | null;
  senderNumber: string;
  participants: string[];
  isGroup: boolean;
  content: string | null;
  media: WhatsAppMedia[];
  status: WhatsAppMessageStatus;
  deliveryState: WhatsAppDeliveryState | null;
  recipients: WhatsAppRecipient[];
  isRead: boolean;
  isBlocked: boolean;
  errorCode: string | null;
  errorDetail: string | null;
  sourceAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  statusObservedAt: Date | null;
  statusRefreshPending: boolean;
  replyToMessageId: string | null;
  threadId: string | null;
  threadRootMessageId: string | null;
  reactions: WhatsAppReaction[];
}
export interface RawWhatsAppMessage {
  id: string;
  agent_identity_id: string;
  conversation_id: string;
  direction: WhatsAppDirection;
  local_number: string;
  remote_number: string | null;
  sender_number: string;
  participants: string[];
  is_group: boolean;
  content: string | null;
  media: RawWhatsAppMedia[];
  status: WhatsAppMessageStatus;
  delivery_state: WhatsAppDeliveryState | null;
  recipients: RawWhatsAppRecipient[];
  is_read: boolean;
  is_blocked: boolean;
  error_code: string | null;
  error_detail: string | null;
  source_at: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  status_observed_at: string | null;
  status_refresh_pending: boolean;
  reply_to_message_id?: string | null;
  thread_id?: string | null;
  thread_root_message_id?: string | null;
  reactions?: RawWhatsAppReaction[];
}
export function parseWhatsAppMessage(r: RawWhatsAppMessage): WhatsAppMessage {
  return {
    id: r.id,
    agentIdentityId: r.agent_identity_id,
    conversationId: r.conversation_id,
    direction: r.direction,
    localNumber: r.local_number,
    remoteNumber: r.remote_number,
    senderNumber: r.sender_number,
    participants: r.participants,
    isGroup: r.is_group,
    content: r.content,
    media: r.media.map(parseWhatsAppMedia),
    status: r.status,
    deliveryState: r.delivery_state,
    recipients: r.recipients.map(parseWhatsAppRecipient),
    isRead: r.is_read,
    isBlocked: r.is_blocked,
    errorCode: r.error_code,
    errorDetail: r.error_detail,
    sourceAt: r.source_at ? new Date(r.source_at) : null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    sentAt: r.sent_at ? new Date(r.sent_at) : null,
    deliveredAt: r.delivered_at ? new Date(r.delivered_at) : null,
    failedAt: r.failed_at ? new Date(r.failed_at) : null,
    statusObservedAt: r.status_observed_at
      ? new Date(r.status_observed_at)
      : null,
    statusRefreshPending: r.status_refresh_pending,
    replyToMessageId: r.reply_to_message_id ?? null,
    threadId: r.thread_id ?? null,
    threadRootMessageId: r.thread_root_message_id ?? null,
    reactions: (r.reactions ?? []).map(parseWhatsAppReaction),
  };
}
export interface WhatsAppConversation {
  id: string;
  agentIdentityId: string;
  localNumber: string;
  remoteNumber: string | null;
  participants: string[];
  isGroup: boolean;
  groupName: string | null;
  groupCreationStatus: WhatsAppGroupCreationStatus | null;
  unresolvedParticipantCount: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface RawWhatsAppConversation {
  id: string;
  agent_identity_id: string;
  local_number: string;
  remote_number: string | null;
  participants: string[];
  is_group: boolean;
  group_name?: string | null;
  group_creation_status?: WhatsAppGroupCreationStatus | null;
  unresolved_participant_count?: number;
  created_at: string;
  updated_at: string;
}
export function parseWhatsAppConversation(
  r: RawWhatsAppConversation,
): WhatsAppConversation {
  return {
    id: r.id,
    agentIdentityId: r.agent_identity_id,
    localNumber: r.local_number,
    remoteNumber: r.remote_number,
    participants: r.participants,
    isGroup: r.is_group,
    groupName: r.group_name ?? null,
    groupCreationStatus: r.group_creation_status ?? null,
    unresolvedParticipantCount: r.unresolved_participant_count ?? 0,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}
export interface WhatsAppConversationSummary extends WhatsAppConversation {
  latestText: string | null;
  latestMessageAt: Date | null;
  latestDirection: WhatsAppDirection | null;
  latestHasMedia: boolean;
  unreadCount: number;
  totalCount: number;
}
export interface RawWhatsAppConversationSummary extends RawWhatsAppConversation {
  latest_text: string | null;
  latest_message_at: string | null;
  latest_direction: WhatsAppDirection | null;
  latest_has_media: boolean;
  unread_count: number;
  total_count: number;
}
export function parseWhatsAppConversationSummary(
  r: RawWhatsAppConversationSummary,
): WhatsAppConversationSummary {
  return {
    ...parseWhatsAppConversation(r),
    latestText: r.latest_text,
    latestMessageAt: r.latest_message_at ? new Date(r.latest_message_at) : null,
    latestDirection: r.latest_direction,
    latestHasMedia: r.latest_has_media,
    unreadCount: r.unread_count,
    totalCount: r.total_count,
  };
}
export interface WhatsAppMarkReadResult {
  conversationId: string;
  updatedCount: number;
}
export interface RawWhatsAppMarkReadResult {
  conversation_id: string;
  updated_count: number;
}
export function parseWhatsAppMarkReadResult(
  r: RawWhatsAppMarkReadResult,
): WhatsAppMarkReadResult {
  return {
    conversationId: r.conversation_id,
    updatedCount: r.updated_count,
  };
}
export interface WhatsAppChannelStatus {
  enabled: boolean;
  number: string | null;
  status: string;
}
export interface RawWhatsAppChannelStatus {
  enabled: boolean;
  number: string | null;
  status: string;
}
export function parseWhatsAppChannelStatus(
  r: RawWhatsAppChannelStatus,
): WhatsAppChannelStatus {
  return {
    enabled: r.enabled,
    number: r.number,
    status: r.status,
  };
}

export interface WhatsAppSendOptions {
  to?: string | string[];
  conversationId?: string;
  replyToMessageId?: string;
  /** Defaults true; false requires native quoting. Missing evidence or uncertain sends never trigger a plain replacement. */
  plainReplyFallback?: boolean;
  groupName?: string;
  text?: string;
  mediaIds?: string[];
  agentIdentityId?: string;
  idempotencyKey?: string;
}
export interface WhatsAppListOptions {
  agentIdentityId?: string;
  conversationId?: string;
  threadId?: string;
  includeGroups?: boolean;
  startDatetime?: string;
  endDatetime?: string;
  tz?: string;
  limit?: number;
  offset?: number;
  isRead?: boolean;
  isBlocked?: boolean;
}
export type WhatsAppConversationListOptions = Omit<
  WhatsAppListOptions,
  "conversationId" | "threadId" | "isRead"
>;
const owner = (id?: string): Record<string, string> =>
  id === undefined ? {} : { agent_identity_id: id };
export interface WhatsAppLimits {
  agentIdentityId: string;
  limits: Record<string, number>;
  usage: Record<string, number>;
}
export interface RawWhatsAppLimits {
  agent_identity_id: string;
  limits: Record<string, number>;
  usage: Record<string, number>;
}
export function parseWhatsAppLimits(row: RawWhatsAppLimits): WhatsAppLimits {
  return {
    agentIdentityId: row.agent_identity_id,
    limits: { ...row.limits },
    usage: { ...row.usage },
  };
}
export class WhatsAppResource {
  constructor(private readonly http: HttpTransport) {}
  /** Queue one message. Reuse its key and owned media IDs after uncertainty. */
  async send(o: WhatsAppSendOptions): Promise<WhatsAppMessage> {
    if (o.plainReplyFallback !== undefined && typeof o.plainReplyFallback !== "boolean")
      throw new Error("plainReplyFallback must be a boolean");
    if ((o.to == null) === (o.conversationId == null))
      throw new Error("Specify exactly one of to or conversationId");
    const recipients = o.to == null ? [] : typeof o.to === "string" ? [o.to] : o.to;
    if (o.to != null && (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 8 || recipients.some(value => typeof value !== "string" || !validPhone(value)) || new Set(recipients).size !== recipients.length))
      throw new Error("Provide 1–8 unique E.164 recipients");
    if (o.replyToMessageId != null && (!o.conversationId || !validUuid(o.replyToMessageId))) throw new Error("replyToMessageId requires conversationId and a valid message UUID");
    if (o.groupName != null && (!Array.isArray(o.to) || o.to.length < 2 || !o.groupName.trim() || Array.from(o.groupName).length > 100)) throw new Error("groupName requires a new recipient-list group and 1–100 characters");
    if ((o.mediaIds?.length ?? 0) > 1)
      throw new Error("WhatsApp supports at most one attachment");
    if (!o.text?.trim() && !o.mediaIds?.length)
      throw new Error("Provide text or one media ID");
    if (o.text != null && Array.from(o.text).length > 4000)
      throw new Error("WhatsApp text must be at most 4000 characters");
    const body = {
      ...(o.to != null ? { to: o.to } : {}),
      ...(o.conversationId != null
        ? { conversation_id: o.conversationId }
        : {}),
      ...(o.replyToMessageId != null ? { reply_to_message_id: o.replyToMessageId } : {}),
      ...(o.replyToMessageId != null && o.plainReplyFallback === false ? { plain_reply_fallback: false } : {}),
      ...(o.groupName != null ? { group_name: o.groupName } : {}),
      ...(o.text != null ? { text: o.text } : {}),
      ...(o.mediaIds != null ? { media_ids: o.mediaIds } : {}),
    };
    const data = await postMessage<{ message: RawWhatsAppMessage }>(
      this.http,
      "/messages",
      body,
      o.idempotencyKey,
      owner(o.agentIdentityId),
    );
    return parseWhatsAppMessage(data.message);
  }
  async get(
    id: string,
    o: { agentIdentityId?: string } = {},
  ): Promise<WhatsAppMessage> {
    return parseWhatsAppMessage(
      await this.http.get<RawWhatsAppMessage>(
        `/messages/${encodeURIComponent(id)}`,
        owner(o.agentIdentityId),
      ),
    );
  }
  async list(o: WhatsAppListOptions = {}): Promise<WhatsAppMessage[]> {
    if (o.threadId != null && o.conversationId == null) throw new Error("threadId requires conversationId");
    const rows = await this.http.get<RawWhatsAppMessage[]>("/messages", {
      ...owner(o.agentIdentityId),
      limit: o.limit ?? 50,
      offset: o.offset ?? 0,
      ...(o.conversationId != null
        ? { conversation_id: o.conversationId }
        : {}),
      ...(o.threadId != null ? { thread_id: o.threadId } : {}),
      include_groups: o.includeGroups ?? false,
      ...(o.startDatetime != null ? { start_datetime: o.startDatetime } : {}),
      ...(o.endDatetime != null ? { end_datetime: o.endDatetime } : {}),
      ...(o.tz != null ? { tz: o.tz } : {}),
      ...(o.isRead != null ? { is_read: o.isRead } : {}),
      ...(o.isBlocked != null ? { is_blocked: o.isBlocked } : {}),
    });
    return rows.map(parseWhatsAppMessage);
  }
  async listConversations(
    o: WhatsAppConversationListOptions = {},
  ): Promise<WhatsAppConversationSummary[]> {
    const rows = await this.http.get<RawWhatsAppConversationSummary[]>(
      "/conversations",
      {
        ...owner(o.agentIdentityId),
        limit: o.limit ?? 50,
        offset: o.offset ?? 0,
        include_groups: o.includeGroups ?? false,
        ...(o.startDatetime != null ? { start_datetime: o.startDatetime } : {}),
        ...(o.endDatetime != null ? { end_datetime: o.endDatetime } : {}),
        ...(o.tz != null ? { tz: o.tz } : {}),
        ...(o.isBlocked != null ? { is_blocked: o.isBlocked } : {}),
      },
    );
    return rows.map(parseWhatsAppConversationSummary);
  }
  async getConversation(
    id: string,
    o: { agentIdentityId?: string } = {},
  ): Promise<WhatsAppConversation> {
    return parseWhatsAppConversation(
      await this.http.get<RawWhatsAppConversation>(
        `/conversations/${encodeURIComponent(id)}`,
        owner(o.agentIdentityId),
      ),
    );
  }
  /** Read a chronological page of visible quote-chain messages. */
  async getThread(messageId: string, o: WhatsAppThreadOptions = {}): Promise<WhatsAppThread> {
    return this.getThreadPage(`/messages/${encodeURIComponent(messageId)}/thread`, o);
  }
  async getConversationThread(conversationId: string, threadId: string, o: WhatsAppThreadOptions = {}): Promise<WhatsAppThread> {
    return this.getThreadPage(`/conversations/${encodeURIComponent(conversationId)}/threads/${encodeURIComponent(threadId)}`, o);
  }
  private async getThreadPage(path: string, o: WhatsAppThreadOptions): Promise<WhatsAppThread> {
    const limit = o.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("Thread limit must be 1–200");
    const r = await this.http.get<RawWhatsAppThread>(path, { ...owner(o.agentIdentityId), limit, ...(o.cursor != null ? { cursor: o.cursor } : {}) });
    return { conversationId: r.conversation_id, threadId: r.thread_id, threadRootMessageId: r.thread_root_message_id, messages: r.messages.map(parseWhatsAppMessage), nextCursor: r.next_cursor };
  }
  /** The receipt may be queued or uncertain; only applied reactions are live. */
  async sendReaction(o: WhatsAppReactionOptions): Promise<WhatsAppReaction> {
    const body = reactionBody(o), headers = reactionKey(o.idempotencyKey);
    const result = await this.http.post<{ reaction: RawWhatsAppReaction }>("/reactions", body, { params: owner(o.agentIdentityId), headers });
    return parseWhatsAppReaction(result.reaction);
  }
  async getReaction(id: string, o: { agentIdentityId?: string } = {}): Promise<WhatsAppReaction> {
    const result = await this.http.get<{ reaction: RawWhatsAppReaction }>(`/reactions/${encodeURIComponent(id)}`, owner(o.agentIdentityId));
    return parseWhatsAppReaction(result.reaction);
  }
  /** Replay a removal with its original key; a superseded receipt removes nothing newer. */
  async removeReaction(id: string, o: { idempotencyKey: string; agentIdentityId?: string }): Promise<WhatsAppReaction> {
    const result = await this.http.deleteWithResponse<{ reaction: RawWhatsAppReaction }>(`/reactions/${encodeURIComponent(id)}`, { params: owner(o.agentIdentityId), headers: reactionKey(o.idempotencyKey) });
    return parseWhatsAppReaction(result.reaction);
  }
  async uploadMedia(o: {
    content: Uint8Array | Blob;
    filename: string;
    contentType?: string;
    agentIdentityId?: string;
  }): Promise<WhatsAppMedia> {
    const size =
      o.content instanceof Blob ? o.content.size : o.content.byteLength;
    if (size > 20 * 1024 * 1024)
      throw new Error("WhatsApp media must be at most 20 MiB");
    const row = await this.http.postMultipart<RawWhatsAppMedia>(
      "/media",
      {
        fieldName: "file",
        filename: o.filename,
        content: o.content instanceof Blob && o.contentType !== undefined
          ? new Blob([o.content], { type: o.contentType })
          : o.content,
        contentType: o.contentType ?? "application/octet-stream",
      },
      { params: owner(o.agentIdentityId) },
    );
    return parseWhatsAppMedia(row);
  }
  /** Reauthorize an attachment and obtain a fresh temporary URL. */
  async getMedia(
    id: string,
    o: { agentIdentityId?: string } = {},
  ): Promise<WhatsAppMedia> {
    return parseWhatsAppMedia(
      await this.http.get<RawWhatsAppMedia>(
        `/media/${encodeURIComponent(id)}`,
        owner(o.agentIdentityId),
      ),
    );
  }
  /** Local read state only; this sends no remote receipt. */
  async markRead(
    conversationId: string,
    throughMessageId: string,
    o: { agentIdentityId?: string } = {},
  ): Promise<WhatsAppMarkReadResult> {
    return parseWhatsAppMarkReadResult(
      await this.http.post<RawWhatsAppMarkReadResult>(
        "/mark-read",
        {
          conversation_id: conversationId,
          through_message_id: throughMessageId,
        },
        { params: owner(o.agentIdentityId) },
      ),
    );
  }
  /** Effective server limits and independent usage; protocol maxima are not entitlements. */
  async getLimits(
    o: { agentIdentityId?: string } = {},
  ): Promise<WhatsAppLimits> {
    return parseWhatsAppLimits(
      await this.http.get<RawWhatsAppLimits>(
        "/limits",
        owner(o.agentIdentityId),
      ),
    );
  }
}

export interface WhatsAppThreadOptions { agentIdentityId?: string; limit?: number; cursor?: string; }
export interface WhatsAppThread { conversationId: string; threadId: string | null; threadRootMessageId: string | null; messages: WhatsAppMessage[]; nextCursor: string | null; }
export interface RawWhatsAppThread { conversation_id: string; thread_id: string | null; thread_root_message_id: string | null; messages: RawWhatsAppMessage[]; next_cursor: string | null; }
