import { conversationFilterParams } from "./_conversationFilters.js";
import type { SenderAccess } from "./sender_access.js";
/** WhatsApp conversations, recipient connections, quoted replies, reactions, and owned media. */
import { HttpTransport } from "./_http.js";
import { messageKey, postMessage } from "./message_sends.js";
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
function requiredKey(value: string): Record<string, string> {
  if (typeof value !== "string" || !value.trim() || value.length > 255) throw new Error("A stable idempotencyKey is required");
  return { "Idempotency-Key": value };
}
function reactionBody(o: WhatsAppReactionOptions): Record<string, string> {
  if (!validUuid(o.messageId) || (o.reaction == null) === (o.customEmoji == null)) throw new Error("Provide messageId and exactly one of reaction or customEmoji");
  if (o.reaction != null && !reactionTypes.has(o.reaction)) throw new Error("Unsupported WhatsApp reaction");
  if (o.customEmoji != null && (!o.customEmoji || Array.from(o.customEmoji).length > 32 || /[\s\p{Cc}\p{Cs}]/u.test(o.customEmoji))) throw new Error("customEmoji must contain 1–32 non-whitespace characters");
  return { message_id: o.messageId, ...(o.reaction != null ? { reaction: o.reaction } : { custom_emoji: o.customEmoji! }) };
}
/** A shared-number assignment. The shared number itself is not exposed. */
export interface WhatsAppAssignment {
  id: string; agentIdentityId: string; remoteNumber: string; organizationId: string;
  status: "active" | "released" | (string & {}); releasedAt: Date | null; createdAt: Date; updatedAt: Date;
}
export interface RawWhatsAppAssignment {
  id: string; agent_identity_id: string; remote_number: string; organization_id: string;
  status: string; released_at: string | null; created_at: string; updated_at: string;
}
export function parseWhatsAppAssignment(r: RawWhatsAppAssignment): WhatsAppAssignment {
  return { id: r.id, agentIdentityId: r.agent_identity_id, remoteNumber: r.remote_number,
    organizationId: r.organization_id, status: r.status,
    releasedAt: r.released_at ? new Date(r.released_at) : null,
    createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at) };
}
/** Connecting sends nothing. Global shared numbers have no assignedNumber. */
export interface WhatsAppConnectResult {
  assignment: WhatsAppAssignment; conversationId: string; assignedNumber: string | null;
  alreadyConnected: boolean; awaitingInbound: boolean;
}
export interface RawWhatsAppConnectResult {
  assignment: RawWhatsAppAssignment; conversation_id: string; assigned_number: string | null;
  already_connected: boolean; awaiting_inbound: boolean;
}
export interface WhatsAppDisconnectResult {
  assignmentId: string | null; disconnected: boolean;
}
export interface RawWhatsAppDisconnectResult { assignment_id?: string | null; disconnected?: boolean; }
/** The triage number and a draft connect link and QR code. */
export interface WhatsAppTriageNumber {
  number: string; connectCommand: string; whatsappLink: string; connectQrPngDataUrl: string;
}
export interface RawWhatsAppTriageNumber {
  number: string; connect_command: string; whatsapp_link: string; connect_qr_png_data_url: string;
}
export interface WhatsAppConnectOptions { agentIdentityId: string; recipientNumber: string; idempotencyKey: string; }
function connectionBody(o: WhatsAppConnectOptions): Record<string, string> {
  if (!validUuid(o.agentIdentityId)) throw new Error("agentIdentityId must be a UUID");
  if (typeof o.recipientNumber !== "string" || !validPhone(o.recipientNumber)) throw new Error("Provide one E.164 recipientNumber");
  return { agent_identity_id: o.agentIdentityId, recipient_number: o.recipientNumber };
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
export interface WhatsAppMention {
  text: string | null;
  phoneNumber: string | null;
  isAgent: boolean;
}
export interface RawWhatsAppMention {
  text: string | null;
  phone_number: string | null;
  is_agent: boolean;
}
export interface WhatsAppMessage {
  /** Stable direct-conversation ID across number changes. */
  logicalConversationId?: string | null;
  id: string;
  agentIdentityId: string;
  conversationId: string;
  direction: WhatsAppDirection;
  localNumber: string | null;
  remoteNumber: string | null;
  senderNumber: string | null;
  participants: string[];
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
  senderAccess?: SenderAccess | null;
  mentions: WhatsAppMention[];
  agentMentioned: boolean;
  isGroup: boolean;
  groupName: string | null;
  unresolvedParticipantCount: number;
}
export interface RawWhatsAppMessage {
  logical_conversation_id?: string | null;
  id: string;
  agent_identity_id: string;
  conversation_id: string;
  direction: WhatsAppDirection;
  local_number: string | null;
  remote_number: string | null;
  sender_number: string | null;
  participants: string[];
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
  sender_access?: SenderAccess | null;
  mentions?: RawWhatsAppMention[];
  agent_mentioned?: boolean;
  is_group?: boolean;
  group_name?: string | null;
  unresolved_participant_count?: number;
}
export function parseWhatsAppMessage(r: RawWhatsAppMessage): WhatsAppMessage {
  return {
    mentions: (r.mentions ?? []).map((item) => ({ text: item.text, phoneNumber: item.phone_number, isAgent: item.is_agent === true })),
    ...(r.sender_access === undefined ? {} : { senderAccess: r.sender_access }),
    agentMentioned: r.agent_mentioned === true,
    isGroup: r.is_group ?? false,
    groupName: r.group_name ?? null,
    unresolvedParticipantCount: r.unresolved_participant_count ?? 0,
    id: r.id,
    agentIdentityId: r.agent_identity_id,
    conversationId: r.conversation_id,
    logicalConversationId: r.logical_conversation_id ?? null,
    direction: r.direction,
    localNumber: r.local_number,
    remoteNumber: r.remote_number,
    senderNumber: r.sender_number,
    participants: r.participants,
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
  /** Current conversation for sending; absent before current-route history exists. */
  activeConversationId?: string | null;
  id: string;
  agentIdentityId: string;
  localNumber: string | null;
  remoteNumber: string | null;
  participants: string[];
  createdAt: Date;
  updatedAt: Date;
  isGroup: boolean;
  groupName: string | null;
  unresolvedParticipantCount: number;
}
export interface RawWhatsAppConversation {
  active_conversation_id?: string | null;
  id: string;
  agent_identity_id: string;
  local_number: string | null;
  remote_number: string | null;
  participants: string[];
  created_at: string;
  updated_at: string;
  is_group?: boolean;
  group_name?: string | null;
  unresolved_participant_count?: number;
}
export function parseWhatsAppConversation(
  r: RawWhatsAppConversation,
): WhatsAppConversation {
  return {
    isGroup: r.is_group ?? false,
    groupName: r.group_name ?? null,
    unresolvedParticipantCount: r.unresolved_participant_count ?? 0,
    activeConversationId: r.active_conversation_id ?? null,
    id: r.id,
    agentIdentityId: r.agent_identity_id,
    localNumber: r.local_number,
    remoteNumber: r.remote_number,
    participants: r.participants,
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
  readReceiptsSent: boolean;
}
export interface RawWhatsAppMarkReadResult {
  conversation_id: string;
  updated_count: number;
  read_receipts_sent?: boolean;
}
export function parseWhatsAppMarkReadResult(
  r: RawWhatsAppMarkReadResult,
): WhatsAppMarkReadResult {
  return {
    conversationId: r.conversation_id,
    updatedCount: r.updated_count,
    readReceiptsSent: r.read_receipts_sent ?? false,
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
  to?: string;
  conversationId?: string;
  replyToMessageId?: string;
  /** Defaults true; false requires native quoting. Missing evidence or uncertain sends never trigger a plain replacement. */
  plainReplyFallback?: boolean;
  /** Play an uploaded MP4 attachment as an animation. */
  gifPlayback?: boolean;
  text?: string;
  mediaIds?: string[];
  agentIdentityId?: string;
  idempotencyKey?: string;
}
export interface WhatsAppListOptions {
  agentIdentityId?: string;
  conversationId?: string;
  threadId?: string;
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
> & { participants?: string[]; contactId?: string };
const owner = (id?: string): Record<string, string> =>
  id === undefined ? {} : { agent_identity_id: id };
/** A message draft. Router fields are null for legacy direct-link responses. */
export interface WhatsAppOnboarding {
  agentIdentityId: string; triageNumber: string | null; connectCommand: string | null; connectLink: string | null;
  connectQrPngDataUrl: string | null; ready: boolean;
  number: string | null; messageText: string; messageLink: string | null; messageQrPngDataUrl: string | null;
}
export interface RawWhatsAppOnboarding {
  agent_identity_id: string; triage_number?: string; connect_command?: string; connect_link?: string;
  connect_qr_png_data_url?: string; ready: boolean;
  number?: string | null; message_text?: string; message_link?: string | null; message_qr_png_data_url?: string | null;
}
export function parseWhatsAppOnboarding(r: RawWhatsAppOnboarding): WhatsAppOnboarding {
  return { agentIdentityId: r.agent_identity_id, triageNumber: r.triage_number ?? null, connectCommand: r.connect_command ?? null,
    connectLink: r.connect_link ?? null, connectQrPngDataUrl: r.connect_qr_png_data_url ?? null, ready: r.ready,
    number: r.triage_number ?? r.number ?? null, messageText: r.connect_command ?? r.message_text ?? "",
    messageLink: r.connect_link ?? r.message_link ?? null,
    messageQrPngDataUrl: r.connect_qr_png_data_url ?? r.message_qr_png_data_url ?? null };
}
export interface WhatsAppNumber {
  id: string; number: string; agentIdentityId: string | null; revision: number; state: string;
  bindingState: string | null; assignable: boolean; unavailableReason: string | null;
}
interface RawWhatsAppNumber {
  id: string; number: string; agent_identity_id: string | null; revision: number; state: string;
  binding_state: string | null; assignable: boolean; unavailable_reason: string | null;
}
export interface WhatsAppNumberList { numbers: WhatsAppNumber[]; hasMore: boolean }
export interface WhatsAppRouter {
  id: string; number: string; revision: number; state: string; profileDisplayName: string | null;
  acceptingNewConnections: boolean;
}
interface RawWhatsAppRouter {
  id: string; number: string; revision: number; state: string; profile_display_name: string | null;
  accepting_new_connections: boolean;
}
export interface WhatsAppRouterUpdate {
  expectedRouterId: string; expectedRevision: number; profileDisplayName?: string | null;
  acceptingNewConnections?: boolean;
}
export interface WhatsAppRouterThread { remoteNumber: string; lastMessageAt: Date; latestText: string; messageCount: number }
export interface WhatsAppRouterThreads { items: WhatsAppRouterThread[]; hasMore: boolean }
export interface WhatsAppRouterMessage { id: string; direction: WhatsAppDirection; content: string; status: string; createdAt: Date }
export interface WhatsAppRouterMessages { items: WhatsAppRouterMessage[]; hasMore: boolean }
function parseNumber(r: RawWhatsAppNumber): WhatsAppNumber {
  return { id: r.id, number: r.number, agentIdentityId: r.agent_identity_id, revision: r.revision, state: r.state,
    bindingState: r.binding_state, assignable: r.assignable, unavailableReason: r.unavailable_reason };
}
function parseRouter(r: RawWhatsAppRouter): WhatsAppRouter {
  return { id: r.id, number: r.number, revision: r.revision, state: r.state,
    profileDisplayName: r.profile_display_name, acceptingNewConnections: r.accepting_new_connections };
}
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
/**
 * WhatsApp on dedicated and shared numbers. WhatsApp never starts a conversation
 * by default: an agent replies after the recipient messages first. Shared numbers
 * never start conversations; dedicated numbers can only with approval for
 * your organization. Otherwise sends throw `WhatsAppAwaitingInboundError`.
 */
export class WhatsAppResource {
  constructor(private readonly http: HttpTransport) {}
  /**
   * Queue one message. Reuse its key and owned media IDs after uncertainty.
   * @throws {WhatsAppAwaitingInboundError} 409 until the recipient messages this number.
   * @throws {InkboxAPIError} 403 `whatsapp_access_required` when replying through a shared number to an unconnected recipient.
   */
  async send(o: WhatsAppSendOptions): Promise<WhatsAppMessage> {
    if (o.gifPlayback !== undefined && typeof o.gifPlayback !== "boolean")
      throw new Error("gifPlayback must be a boolean");
    if (o.gifPlayback && !o.mediaIds?.length)
      throw new Error("gifPlayback requires one MP4 media attachment");
    if (o.plainReplyFallback !== undefined && typeof o.plainReplyFallback !== "boolean")
      throw new Error("plainReplyFallback must be a boolean");
    if ((o.to == null) === (o.conversationId == null))
      throw new Error("Specify exactly one of to or conversationId");
    if (o.to != null && (typeof o.to !== "string" || !validPhone(o.to)))
      throw new Error("Provide one E.164 recipient");
    if (o.replyToMessageId != null && (!o.conversationId || !validUuid(o.replyToMessageId))) throw new Error("replyToMessageId requires conversationId and a valid message UUID");
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
      ...(o.text != null ? { text: o.text } : {}),
      ...(o.mediaIds != null ? { media_ids: o.mediaIds } : {}),
      ...(o.gifPlayback === true ? { gif_playback: true } : {}),
    };
    const key = messageKey(o.idempotencyKey);
    const data = await postMessage<{ message: RawWhatsAppMessage }>(
      this.http,
      "/messages",
      body,
      key,
      owner(o.agentIdentityId),
    );
    try {
      return parseWhatsAppMessage(data.message);
    } catch (error) {
      // Keep recovery possible when an accepted response cannot be decoded.
      if (error instanceof Error) Object.assign(error, { idempotencyKey: key });
      throw error;
    }
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
        ...conversationFilterParams(o),
        limit: o.limit ?? 50,
        offset: o.offset ?? 0,
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
    const body = reactionBody(o), headers = requiredKey(o.idempotencyKey);
    const result = await this.http.post<RawWhatsAppReaction | { reaction: RawWhatsAppReaction }>("/reactions", body, { params: owner(o.agentIdentityId), headers });
    return parseWhatsAppReaction(typeof result.reaction === "object" ? result.reaction : result as RawWhatsAppReaction);
  }
  async getReaction(id: string, o: { agentIdentityId?: string } = {}): Promise<WhatsAppReaction> {
    const result = await this.http.get<RawWhatsAppReaction | { reaction: RawWhatsAppReaction }>(`/reactions/${encodeURIComponent(id)}`, owner(o.agentIdentityId));
    return parseWhatsAppReaction(typeof result.reaction === "object" ? result.reaction : result as RawWhatsAppReaction);
  }
  /** Replay a removal with its original key; a superseded receipt removes nothing newer. */
  async removeReaction(id: string, o: { idempotencyKey: string; agentIdentityId?: string }): Promise<WhatsAppReaction> {
    const result = await this.http.deleteWithResponse<RawWhatsAppReaction | { reaction: RawWhatsAppReaction } | undefined>(`/reactions/${encodeURIComponent(id)}`, { params: owner(o.agentIdentityId), headers: requiredKey(o.idempotencyKey) });
    if (result === undefined) return this.getReaction(id, o);
    return parseWhatsAppReaction(typeof result.reaction === "object" ? result.reaction : result as RawWhatsAppReaction);
  }
  async uploadMedia(o: {
    content: Uint8Array | Blob;
    filename: string;
    contentType?: string;
    agentIdentityId?: string;
    /** Required when the agent replies through a shared number. */
    recipientNumber?: string;
  }): Promise<WhatsAppMedia> {
    const size =
      o.content instanceof Blob ? o.content.size : o.content.byteLength;
    if (size > 20 * 1024 * 1024)
      throw new Error("WhatsApp media must be at most 20 MiB");
    if (o.recipientNumber !== undefined && (typeof o.recipientNumber !== "string" || !validPhone(o.recipientNumber)))
      throw new Error("Provide one E.164 recipientNumber");
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
      { params: { ...owner(o.agentIdentityId), ...(o.recipientNumber !== undefined ? { recipient_number: o.recipientNumber } : {}) } },
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
  /** Mark history read and send supported read receipts; omit the boundary for all unread messages. */
  async markRead(
    conversationId: string,
    throughMessageId?: string,
    o: { agentIdentityId?: string } = {},
  ): Promise<WhatsAppMarkReadResult> {
    return parseWhatsAppMarkReadResult(
      await this.http.post<RawWhatsAppMarkReadResult>(
        "/mark-read",
        {
          conversation_id: conversationId,
          ...(throughMessageId !== undefined ? { through_message_id: throughMessageId } : {}),
        },
        { params: owner(o.agentIdentityId) },
      ),
    );
  }
  /**
   * Reserve one of the organization's shared numbers for a recipient. Nothing is
   * sent; the agent can reply after the recipient messages the returned number.
   * Requires an admin-scoped API key. Use a new key (for example
   * `crypto.randomUUID()`) for each new connect or disconnect; reuse a key only
   * to retry that same request, because a reused key replays the earlier result.
   * @throws {IdempotencyKeyReusedError} 409 when the key was used for a different request.
   * @throws {InkboxAPIError} 409 `whatsapp_identity_has_dedicated_line`, `whatsapp_pool_unavailable`,
   * `whatsapp_recipient_connections_full`,
   * `whatsapp_connection_busy` or `idempotency_in_progress` (retry with the same key), `result_unavailable`
   * (check `listAssignments` first); 403 `recipient_blocked`; 422 `invalid_idempotency_key`; 400 when WhatsApp is disabled.
   */
  async connect(o: WhatsAppConnectOptions): Promise<WhatsAppConnectResult> {
    const body = connectionBody(o), headers = requiredKey(o.idempotencyKey);
    const r = await this.http.post<RawWhatsAppConnectResult>("/connect", body, { headers });
    const assignment = parseWhatsAppAssignment(r.assignment);
    return { assignment, conversationId: r.conversation_id, assignedNumber: r.assigned_number,
      alreadyConnected: r.already_connected, awaitingInbound: r.awaiting_inbound };
  }
  /** Release an agent's recipient connection; history is kept. Use a new key per disconnect; key errors match `connect`. */
  async disconnect(o: WhatsAppConnectOptions): Promise<WhatsAppDisconnectResult> {
    const body = connectionBody(o), headers = requiredKey(o.idempotencyKey);
    const r = await this.http.post<RawWhatsAppDisconnectResult>("/disconnect", body, { headers });
    return { assignmentId: r.assignment_id ?? null, disconnected: r.disconnected ?? true };
  }
  /** List active dedicated or shared recipient connections. */
  async listAssignments(o: { agentIdentityId?: string; limit?: number; offset?: number } = {}): Promise<WhatsAppAssignment[]> {
    const r = await this.http.get<RawWhatsAppAssignment[]>("/assignments", { ...owner(o.agentIdentityId), limit: o.limit ?? 50, offset: o.offset ?? 0 });
    return r.map(parseWhatsAppAssignment);
  }
  /** Release an assignment without deleting conversation history. */
  async deleteAssignment(id: string): Promise<void> {
    await this.http.delete(`/assignments/${encodeURIComponent(id)}`);
  }
  /** Get the triage number and a connect draft; optionally select an agent. */
  async getTriageNumber(o: { agentIdentityId?: string } = {}): Promise<WhatsAppTriageNumber> {
    const r = await this.http.get<RawWhatsAppTriageNumber>("/triage-number", owner(o.agentIdentityId));
    return { number: r.number, connectCommand: r.connect_command, whatsappLink: r.whatsapp_link,
      connectQrPngDataUrl: r.connect_qr_png_data_url };
  }
  /** Send a typing indicator in an existing direct conversation. */
  async sendTyping(conversationId: string, o: { agentIdentityId?: string } = {}): Promise<{ status: string }> {
    return this.http.post("/typing", { conversation_id: conversationId }, { params: owner(o.agentIdentityId) });
  }
  /** Read a link and QR for messaging the agent, without sending or enabling WhatsApp. */
  /** List up to 100 already-owned dedicated numbers; requires an admin-scoped API key. */
  async listNumbers(o: { offset?: number } = {}): Promise<WhatsAppNumberList> {
    const r = await this.http.get<{ numbers: RawWhatsAppNumber[]; has_more: boolean }>("/numbers", { offset: o.offset ?? 0 });
    return { numbers: r.numbers.map(parseNumber), hasMore: r.has_more };
  }
  /** Attach or detach an already-owned number. This never purchases a number. */
  async assignNumber(id: string, o: { agentIdentityId: string | null; expectedRevision: number; confirmedImessageNumber?: string }): Promise<WhatsAppNumber> {
    return parseNumber(await this.http.patch<RawWhatsAppNumber>(`/numbers/${encodeURIComponent(id)}`, {
      agent_identity_id: o.agentIdentityId, expected_revision: o.expectedRevision,
      ...(o.confirmedImessageNumber !== undefined ? { confirmed_imessage_number: o.confirmedImessageNumber } : {}),
    }));
  }
  /** Read your organization's dedicated router; requires an admin-scoped API key. */
  async getRouter(): Promise<WhatsAppRouter | null> {
    const r = await this.http.get<{ router: RawWhatsAppRouter | null }>("/router");
    return r.router === null ? null : parseRouter(r.router);
  }
  /** Edit the router you read. Omit the name to preserve it; pass null to clear it. */
  async updateRouter(o: WhatsAppRouterUpdate): Promise<WhatsAppRouter> {
    const r = await this.http.patch<{ router: RawWhatsAppRouter }>("/router", {
      expected_router_id: o.expectedRouterId, expected_revision: o.expectedRevision,
      ...(o.profileDisplayName !== undefined ? { profile_display_name: o.profileDisplayName } : {}),
      ...(o.acceptingNewConnections !== undefined ? { accepting_new_connections: o.acceptingNewConnections } : {}),
    });
    return parseRouter(r.router);
  }
  /** List recipient threads on your organization's dedicated router, newest first. */
  async listRouterThreads(o: { offset?: number; limit?: number } = {}): Promise<WhatsAppRouterThreads> {
    const r = await this.http.get<{ items: { remote_number: string; last_message_at: string; latest_text: string; message_count: number }[]; has_more: boolean }>(
      "/router/conversations", { offset: o.offset ?? 0, limit: o.limit ?? 50 });
    return { items: r.items.map(i => ({ remoteNumber: i.remote_number, lastMessageAt: new Date(i.last_message_at), latestText: i.latest_text, messageCount: i.message_count })), hasMore: r.has_more };
  }
  /** Read one dedicated-router recipient thread; requires an admin-scoped API key. */
  async listRouterMessages(remoteNumber: string, o: { offset?: number; limit?: number } = {}): Promise<WhatsAppRouterMessages> {
    if (!validPhone(remoteNumber)) throw new Error("Provide one E.164 recipient.");
    const r = await this.http.get<{ items: { id: string; direction: WhatsAppDirection; content: string; status: string; created_at: string }[]; has_more: boolean }>(
      `/router/conversations/${encodeURIComponent(remoteNumber)}/messages`, { offset: o.offset ?? 0, limit: o.limit ?? 50 });
    return { items: r.items.map(i => ({ id: i.id, direction: i.direction, content: i.content, status: i.status, createdAt: new Date(i.created_at) })), hasMore: r.has_more };
  }
  async getOnboarding(o: { agentIdentityId?: string } = {}): Promise<WhatsAppOnboarding> {
    return parseWhatsAppOnboarding(
      await this.http.get<RawWhatsAppOnboarding>("/onboarding", owner(o.agentIdentityId)),
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
