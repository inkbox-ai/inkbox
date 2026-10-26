/** Dedicated, approved one-to-one WhatsApp and owned media. */
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
  };
}
export interface WhatsAppConversation {
  id: string;
  agentIdentityId: string;
  localNumber: string;
  remoteNumber: string | null;
  participants: string[];
  isGroup: boolean;
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
  text?: string;
  mediaIds?: string[];
  agentIdentityId?: string;
  idempotencyKey?: string;
}
export interface WhatsAppListOptions {
  agentIdentityId?: string;
  conversationId?: string;
  limit?: number;
  offset?: number;
  isRead?: boolean;
  isBlocked?: boolean;
}
export type WhatsAppConversationListOptions = Omit<
  WhatsAppListOptions,
  "conversationId" | "isRead"
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
    if ((o.to == null) === (o.conversationId == null))
      throw new Error("Specify exactly one of to or conversationId");
    if (Array.isArray(o.to) && o.to.length !== 1)
      throw new Error("WhatsApp supports exactly one recipient");
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
    const rows = await this.http.get<RawWhatsAppMessage[]>("/messages", {
      ...owner(o.agentIdentityId),
      limit: o.limit ?? 50,
      offset: o.offset ?? 0,
      ...(o.conversationId != null
        ? { conversation_id: o.conversationId }
        : {}),
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
        content: o.content,
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
