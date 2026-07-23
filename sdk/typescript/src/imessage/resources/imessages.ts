/**
 * inkbox-imessage/resources/imessages.ts
 *
 * iMessage operations: dedicated numbers, send, list, conversations,
 * reactions, read receipts, typing indicators, media upload.
 *
 * Conversation operations key off `conversationId` / `agentIdentityId`.
 * Dedicated number inventory is managed through `listNumbers` and
 * `claimNumber`.
 */

import { HttpTransport, validateIdempotencyKey } from "../../_http.js";
import {
  IMessage,
  IMessageAssignment,
  IMessageConversation,
  IMessageConversationSummary,
  IMessageDedicatedNumberType,
  IMessageNumber,
  IMessageMarkReadResult,
  IMessageMediaUpload,
  IMessageReaction,
  IMessageReactionType,
  IMessageSendStyle,
  IMessageTriageNumber,
  RawIMessage,
  RawIMessageAssignment,
  RawIMessageConversation,
  RawIMessageConversationSummary,
  RawIMessageNumber,
  RawIMessageReaction,
  RawIMessageTriageNumber,
  parseIMessage,
  parseIMessageAssignment,
  parseIMessageConversation,
  parseIMessageConversationSummary,
  parseIMessageNumber,
  parseIMessageReaction,
  parseIMessageTriageNumber,
} from "../types.js";

const SENDABLE_REACTIONS = new Set<string>([
  "love",
  "like",
  "dislike",
  "laugh",
  "emphasize",
  "question",
  "eyes",
]);

function validateSendableReaction(reaction: IMessageReactionType | string): string {
  if (!SENDABLE_REACTIONS.has(reaction)) {
    throw new Error(
      `reaction must be one of: ${[...SENDABLE_REACTIONS].join(", ")}`,
    );
  }
  return reaction;
}

export class IMessagesResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Return the active triage line and the connect command.
   *
   * Recipients text the returned `connectCommand` (e.g.
   * `connect @your-handle`) to the triage `number` to get connected to
   * an agent identity. Resolve this at runtime instead of hardcoding
   * the number — the line can change.
   *
   * @throws {InkboxAPIError} 404 when no triage line is active.
   */
  async getTriageNumber(): Promise<IMessageTriageNumber> {
    const data = await this.http.get<RawIMessageTriageNumber>("/triage-number");
    return parseIMessageTriageNumber(data);
  }

  /**
   * List every non-released dedicated iMessage number owned by the
   * organization, including unattached numbers.
   */
  async listNumbers(): Promise<IMessageNumber[]> {
    const data = await this.http.get<RawIMessageNumber[]>("/numbers");
    return data.map(parseIMessageNumber);
  }

  /**
   * Claim one dedicated iMessage number for the organization.
   *
   * Claiming does not attach the number to an identity. Pass
   * `imessageNumberType` during identity creation or update to claim and
   * attach atomically, or pass an owned number's id as `imessageNumberId`
   * during identity update.
   *
   * Reuse the same caller-generated `idempotencyKey` when retrying an
   * ambiguous request. A new key can claim another number.
   *
   * @throws {DedicatedIMessageNumberQuotaExceededError} 402 when the
   *   organization has reached its quota for the requested number type.
   * @throws {DedicatedIMessageNumberInventoryPendingError} 503 when number
   *   inventory is pending; inspect `retryAfterSeconds` before retrying.
   * @throws {IdempotencyKeyReusedError} 409 when the key was already used
   *   for a different request.
   */
  async claimNumber(options: {
    type: IMessageDedicatedNumberType;
    idempotencyKey: string;
  }): Promise<IMessageNumber> {
    validateIdempotencyKey(options.idempotencyKey);
    const data = await this.http.post<RawIMessageNumber>("/numbers", {
      type: options.type,
    }, {
      headers: { "Idempotency-Key": options.idempotencyKey },
    });
    return parseIMessageNumber(data);
  }

  /**
   * Send an outbound iMessage through an existing assignment.
   *
   * Shared and dedicated-inbound numbers require the recipient to connect
   * first. An identity attached to a dedicated-outbound number may initiate
   * a conversation, subject to server-side consent and rate limits.
   * Inbound replies and reactions arrive via identity-owned webhook
   * subscriptions (`inkbox.webhooks.subscriptions.create({
   * agentIdentityId, url, eventTypes: ["imessage.received", ...] })`).
   *
   * @param options.to - One E.164 recipient or 1–8 distinct recipients. Two
   *   or more recipients select or create a dedicated-outbound group.
   *   Mutually exclusive with `conversationId`.
   * @param options.conversationId - Existing conversation UUID to reply into.
   * @param options.text - Message body.
   * @param options.mediaUrls - Media URLs (at most one). Use
   *   {@link uploadMedia} to turn raw bytes into a sendable URL first.
   * @param options.sendStyle - Optional expressive send style. The same
   *   `IMessageSendStyle` values work for one-to-one sends, new groups, and
   *   replies by group `conversationId`, including sends with one media URL.
   * @param options.agentIdentityId - Identity to send as. Required for
   *   org-wide API keys when sending by `to`; ignored for
   *   identity-scoped keys (the key's identity wins).
   *
   * @throws {InkboxAPIError} 400 when the identity is not
   *   iMessage-enabled; 403 when the recipient is blocked by a contact
   *   rule.
   */
  async send(options: {
    to?: string | string[] | null;
    conversationId?: string | null;
    text?: string | null;
    mediaUrls?: string[] | null;
    sendStyle?: IMessageSendStyle | string | null;
    agentIdentityId?: string | null;
  }): Promise<IMessage> {
    const body: {
      to?: string | string[];
      conversation_id?: string;
      text?: string;
      media_urls?: string[];
      send_style?: string;
    } = {};
    if (options.to != null) {
      body.to = options.to;
    }
    if (options.conversationId != null) {
      body.conversation_id = options.conversationId;
    }
    if (options.text != null) {
      body.text = options.text;
    }
    if (options.mediaUrls != null) {
      body.media_urls = options.mediaUrls;
    }
    if (options.sendStyle != null) {
      body.send_style = options.sendStyle;
    }
    const params: Record<string, string> = {};
    if (options.agentIdentityId != null) {
      params["agent_identity_id"] = options.agentIdentityId;
    }
    const data = await this.http.post<{ message: RawIMessage }>(
      "/messages",
      body,
      { params },
    );
    return parseIMessage(data.message);
  }

  /**
   * List iMessages visible to the caller, newest first.
   *
   * Identity-scoped API keys never see contact-rule-blocked rows
   * regardless of `isBlocked` (filtered server-side). Admin/JWT callers
   * see everything by default.
   *
   * @param options.agentIdentityId - Narrow to one agent identity.
   *   Ignored for identity-scoped keys (always their own identity).
   * @param options.conversationId - Narrow to one conversation.
   * @param options.limit - Max results (1–200). Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   * @param options.isRead - Filter by read state.
   * @param options.isBlocked - Tri-state filter. `true` for only blocked,
   *   `false` for only non-blocked, omit for all.
   */
  async list(
    options?: {
      agentIdentityId?: string;
      conversationId?: string;
      limit?: number;
      offset?: number;
      isRead?: boolean;
      isBlocked?: boolean;
      includeGroups?: boolean;
      startDatetime?: string;
      endDatetime?: string;
      tz?: string;
    },
  ): Promise<IMessage[]> {
    const params: Record<string, string | number | boolean> = {
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
    };
    if (options?.agentIdentityId !== undefined) {
      params["agent_identity_id"] = options.agentIdentityId;
    }
    if (options?.conversationId !== undefined) {
      params["conversation_id"] = options.conversationId;
    }
    if (options?.isRead !== undefined) {
      params["is_read"] = options.isRead;
    }
    if (options?.isBlocked !== undefined) {
      params["is_blocked"] = options.isBlocked;
    }
    if (options?.includeGroups === true) {
      params["include_groups"] = true;
    }
    if (options?.startDatetime !== undefined) params["start_datetime"] = options.startDatetime;
    if (options?.endDatetime !== undefined) params["end_datetime"] = options.endDatetime;
    if (options?.tz !== undefined) params["tz"] = options.tz;
    const data = await this.http.get<RawIMessage[]>("/messages", params);
    return data.map(parseIMessage);
  }

  /**
   * List active iMessage connections, newest first.
   *
   * One row per recipient currently connected to an agent identity
   * through triage. Released connections are not returned.
   *
   * @param options.agentIdentityId - Narrow to one agent identity.
   *   Ignored for identity-scoped keys (always their own identity).
   * @param options.limit - Max results (1–200). Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   */
  async listAssignments(
    options?: {
      agentIdentityId?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<IMessageAssignment[]> {
    const params: Record<string, string | number> = {
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
    };
    if (options?.agentIdentityId !== undefined) {
      params["agent_identity_id"] = options.agentIdentityId;
    }
    const data = await this.http.get<RawIMessageAssignment[]>("/assignments", params);
    return data.map(parseIMessageAssignment);
  }

  /**
   * List iMessage conversations with latest-message preview.
   *
   * @param options.agentIdentityId - Narrow to one agent identity.
   *   Ignored for identity-scoped keys (always their own identity).
   * @param options.limit - Max results (1–200). Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   * @param options.isBlocked - Tri-state filter applied to the
   *   underlying messages. `true` for only blocked, `false` for only
   *   non-blocked, omit for all.
   */
  async listConversations(
    options?: {
      agentIdentityId?: string;
      limit?: number;
      offset?: number;
      isBlocked?: boolean;
      includeGroups?: boolean;
      startDatetime?: string;
      endDatetime?: string;
      tz?: string;
    },
  ): Promise<IMessageConversationSummary[]> {
    const params: Record<string, string | number | boolean> = {
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
    };
    if (options?.agentIdentityId !== undefined) {
      params["agent_identity_id"] = options.agentIdentityId;
    }
    if (options?.isBlocked !== undefined) {
      params["is_blocked"] = options.isBlocked;
    }
    if (options?.includeGroups === true) {
      params["include_groups"] = true;
    }
    if (options?.startDatetime !== undefined) params["start_datetime"] = options.startDatetime;
    if (options?.endDatetime !== undefined) params["end_datetime"] = options.endDatetime;
    if (options?.tz !== undefined) params["tz"] = options.tz;
    const data = await this.http.get<RawIMessageConversationSummary[]>(
      "/conversations",
      params,
    );
    return data.map(parseIMessageConversationSummary);
  }

  /**
   * Get one iMessage conversation by ID.
   *
   * @param conversationId - UUID of the conversation.
   * @param options.agentIdentityId - Optional identity assertion; 404s
   *   when the conversation belongs to a different identity.
   */
  async getConversation(
    conversationId: string,
    options?: { agentIdentityId?: string },
  ): Promise<IMessageConversation> {
    const params: Record<string, string> = {};
    if (options?.agentIdentityId !== undefined) {
      params["agent_identity_id"] = options.agentIdentityId;
    }
    const data = await this.http.get<RawIMessageConversation>(
      `/conversations/${conversationId}`,
      params,
    );
    return parseIMessageConversation(data);
  }

  /**
   * Send a tapback reaction to an inbound one-to-one or group message.
   *
   * @param options.messageId - UUID of the message being reacted to.
   * @param options.reaction - Tapback kind. Sends accept `love`, `like`,
   *   `dislike`, `laugh`, `emphasize`, `question`, and `eyes`; `custom` is
   *   inbound-only and rejected locally.
   * @param options.partIndex - Part of a multi-part message to react to.
   *   Defaults to 0.
   * @throws {Error} when `reaction` is custom or not one of the seven
   *   provider-supported named tapbacks.
   */
  async sendReaction(options: {
    messageId: string;
    reaction: IMessageReactionType | string;
    partIndex?: number;
  }): Promise<IMessageReaction> {
    const reaction = validateSendableReaction(options.reaction);
    const data = await this.http.post<RawIMessageReaction>("/reactions", {
      message_id: options.messageId,
      reaction,
      part_index: options.partIndex ?? 0,
    });
    return parseIMessageReaction(data);
  }

  /**
   * Send a one-to-one read receipt and mark inbound messages read locally.
   * Group conversations return 409.
   *
   * @param conversationId - UUID of the conversation.
   * @returns Object with `conversationId` and `updatedCount`.
   */
  async markConversationRead(
    conversationId: string,
  ): Promise<IMessageMarkReadResult> {
    const data = await this.http.post<{
      conversation_id: string;
      updated_count: number;
    }>("/mark-read", { conversation_id: conversationId });
    return {
      conversationId: data.conversation_id,
      updatedCount: data.updated_count,
    };
  }

  /**
   * Show a typing indicator to a one-to-one recipient.
   * Group conversations return 409.
   *
   * @param conversationId - UUID of the conversation.
   */
  async sendTyping(conversationId: string): Promise<void> {
    await this.http.post("/typing", { conversation_id: conversationId });
  }

  /**
   * Upload media and get back a URL usable in `mediaUrls`.
   *
   * @param options.content - Raw file bytes (max 10 MiB).
   * @param options.filename - Original filename, used for type inference.
   * @param options.contentType - Optional MIME type; defaults
   *   server-side to `application/octet-stream`.
   */
  async uploadMedia(options: {
    content: Uint8Array | Blob;
    filename: string;
    contentType?: string;
  }): Promise<IMessageMediaUpload> {
    const data = await this.http.postMultipart<{
      media_url: string;
      content_type?: string | null;
      size?: number | null;
    }>("/media", {
      fieldName: "file",
      filename: options.filename,
      content: options.content,
      contentType: options.contentType ?? "application/octet-stream",
    });
    return {
      mediaUrl: data.media_url,
      contentType: data.content_type ?? null,
      size: data.size ?? null,
    };
  }
}
