/**
 * inkbox-phone/resources/texts.ts
 *
 * Text message (SMS/MMS) operations: list, get, update, search, conversations.
 */

import { HttpTransport } from "../../_http.js";
import {
  TextMessage,
  TextConversationSummary,
  TextConversationUpdateResult,
  RawTextMessage,
  RawTextConversationSummary,
  parseTextMessage,
  parseTextConversationSummary,
} from "../types.js";

export class TextsResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Send an outbound SMS/MMS from a phone number.
   *
   * The returned message is in `queued` state. The full outbound
   * lifecycle (`text.sent` → `text.delivered` / `text.delivery_failed`
   * / `text.delivery_unconfirmed`) — and inbound `text.received`
   * events — arrive via webhook subscriptions on the sender's phone
   * number (`inkbox.webhooks.subscriptions.create({ phoneNumberId,
   * url, eventTypes })`). See `TextWebhookEventType` and
   * `TextWebhookPayload` for the typed receiver-side shapes.
   *
   * @param phoneNumberId - UUID of the sending phone number.
   * @param options.to - E.164 destination number, or numbers for a group send.
   *   Mutually exclusive with `conversationId`.
   * @param options.conversationId - Existing conversation UUID to reply into.
   *   The server resolves it to that conversation's participants.
   * @param options.text - Message body.
   * @param options.mediaUrls - MMS media URLs.
   *
   * @throws {RecipientBlockedError} when the destination is blocked by an
   *   outbound contact rule on the sender.
   * @throws {InkboxAPIError} for other 4xx/5xx errors. Stable `error` codes
   *   live on `err.detail.error`.
   */
  async send(
    phoneNumberId: string,
    options: {
      to?: string | string[] | null;
      conversationId?: string | null;
      text?: string | null;
      mediaUrls?: string[] | null;
    },
  ): Promise<TextMessage> {
    const body: {
      to?: string | string[];
      conversation_id?: string;
      text?: string;
      media_urls?: string[];
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
    const data = await this.http.post<RawTextMessage>(
      `/numbers/${phoneNumberId}/texts`,
      body,
    );
    return parseTextMessage(data);
  }

  /**
   * List text messages for a phone number, newest first.
   *
   * Identity-scoped API keys never see contact-rule-blocked rows
   * regardless of `isBlocked` (filtered server-side). Admin/JWT
   * callers see everything by default; pass `isBlocked=true` for the
   * blocked-only listing or `isBlocked=false` to exclude blocked rows.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param options.limit - Max results (1–200). Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   * @param options.isRead - Filter by read state.
   * @param options.isBlocked - Tri-state filter. `true` for only blocked,
   *   `false` for only non-blocked, omit for all.
   */
  async list(
    phoneNumberId: string,
    options?: {
      limit?: number;
      offset?: number;
      isRead?: boolean;
      isBlocked?: boolean;
    },
  ): Promise<TextMessage[]> {
    const params: Record<string, string | number | boolean> = {
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
    };
    if (options?.isRead !== undefined) {
      params["is_read"] = options.isRead;
    }
    if (options?.isBlocked !== undefined) {
      params["is_blocked"] = options.isBlocked;
    }
    const data = await this.http.get<RawTextMessage[]>(
      `/numbers/${phoneNumberId}/texts`,
      params,
    );
    return data.map(parseTextMessage);
  }

  /**
   * Get a single text message by ID.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param textId - UUID of the text message.
   */
  async get(phoneNumberId: string, textId: string): Promise<TextMessage> {
    const data = await this.http.get<RawTextMessage>(
      `/numbers/${phoneNumberId}/texts/${textId}`,
    );
    return parseTextMessage(data);
  }

  /**
   * Update a text message (mark as read).
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param textId - UUID of the text message.
   * @param options.isRead - Mark as read or unread.
   */
  async update(
    phoneNumberId: string,
    textId: string,
    options: { isRead?: boolean },
  ): Promise<TextMessage> {
    const body: Record<string, unknown> = {};
    if (options.isRead !== undefined) body["is_read"] = options.isRead;
    const data = await this.http.patch<RawTextMessage>(
      `/numbers/${phoneNumberId}/texts/${textId}`,
      body,
    );
    return parseTextMessage(data);
  }

  /**
   * Full-text search across text messages for a phone number.
   *
   * Identity-scoped API keys never see contact-rule-blocked rows in
   * results regardless of `isBlocked`. Admin/JWT callers see everything
   * by default; `isBlocked=false` keeps search clean of blocked spam,
   * `isBlocked=true` searches only the blocked folder.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param options.q - Search query string.
   * @param options.limit - Max results (1–200). Defaults to 50.
   * @param options.isBlocked - Tri-state filter. `true` for only blocked,
   *   `false` for only non-blocked, omit for all.
   */
  async search(
    phoneNumberId: string,
    options: { q: string; limit?: number; isBlocked?: boolean },
  ): Promise<TextMessage[]> {
    const params: Record<string, string | number | boolean> = {
      q: options.q,
      limit: options.limit ?? 50,
    };
    if (options.isBlocked !== undefined) {
      params["is_blocked"] = options.isBlocked;
    }
    const data = await this.http.get<RawTextMessage[]>(
      `/numbers/${phoneNumberId}/texts/search`,
      params,
    );
    return data.map(parseTextMessage);
  }

  /**
   * List conversations with latest message preview.
   *
   * Identity-scoped API keys never see blocked rows in conversation
   * summaries; admin/JWT callers can pass `isBlocked=false` to hide
   * spam-only counterparties and stop blocked rows from bumping quiet
   * conversations to the top, or `isBlocked=true` to narrow to
   * conversations made up of blocked rows.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param options.limit - Max results (1–200). Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   * @param options.isBlocked - Tri-state filter applied to the
   *   underlying messages. `true` for only blocked, `false` for only
   *   non-blocked, omit for all.
   * @param options.includeGroups - Include group conversations. Defaults to
   *   false so old clients continue to see one-to-one rows only.
   */
  async listConversations(
    phoneNumberId: string,
    options?: {
      limit?: number;
      offset?: number;
      isBlocked?: boolean;
      includeGroups?: boolean;
    },
  ): Promise<TextConversationSummary[]> {
    const params: Record<string, string | number | boolean> = {
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
    };
    if (options?.isBlocked !== undefined) {
      params["is_blocked"] = options.isBlocked;
    }
    if (options?.includeGroups) {
      params["include_groups"] = true;
    }
    const data = await this.http.get<RawTextConversationSummary[]>(
      `/numbers/${phoneNumberId}/texts/conversations`,
      params,
    );
    return data.map(parseTextConversationSummary);
  }

  /**
   * Get all messages in a conversation, newest first.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param conversationKey - E.164 one-to-one remote number, or conversation UUID.
   * @param options.limit - Max results (1–200). Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   */
  async getConversation(
    phoneNumberId: string,
    conversationKey: string,
    options?: { limit?: number; offset?: number },
  ): Promise<TextMessage[]> {
    const data = await this.http.get<RawTextMessage[]>(
      `/numbers/${phoneNumberId}/texts/conversations/${conversationKey}`,
      { limit: options?.limit ?? 50, offset: options?.offset ?? 0 },
    );
    return data.map(parseTextMessage);
  }

  /**
   * Update the read state for all messages in a conversation.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param conversationKey - E.164 one-to-one remote number, or conversation UUID.
   * @param options.isRead - Mark all messages as read or unread.
   * @returns Object with `conversationId`, `remotePhoneNumber`, `isRead`, and `updatedCount`.
   */
  async updateConversation(
    phoneNumberId: string,
    conversationKey: string,
    options: { isRead: boolean },
  ): Promise<TextConversationUpdateResult> {
    const data = await this.http.patch<{
      remote_phone_number?: string | null;
      conversation_id?: string | null;
      is_read: boolean;
      updated_count: number;
    }>(
      `/numbers/${phoneNumberId}/texts/conversations/${conversationKey}`,
      { is_read: options.isRead },
    );
    return {
      remotePhoneNumber: data.remote_phone_number ?? null,
      conversationId: data.conversation_id ?? null,
      isRead: data.is_read,
      updatedCount: data.updated_count,
    };
  }
}
