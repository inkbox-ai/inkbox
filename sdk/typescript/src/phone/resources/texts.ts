/**
 * inkbox-phone/resources/texts.ts
 *
 * Text message (SMS/MMS) operations: list, get, update, search, conversations.
 */

import { HttpTransport } from "../../_http.js";
import {
  TextMessage,
  TextConversationSummary,
  RawTextMessage,
  RawTextConversationSummary,
  parseTextMessage,
  parseTextConversationSummary,
} from "../types.js";

export class TextsResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Send an outbound SMS from a phone number.
   *
   * The returned message is in `queued` state. The full outbound
   * lifecycle (`text.sent` → `text.delivered` / `text.delivery_failed`
   * / `text.delivery_unconfirmed`) arrives via the
   * `incomingTextWebhookUrl` configured on the sender. The same URL
   * also receives inbound `text.received` events; see
   * `TextWebhookEventType` and `TextWebhookPayload` for the typed
   * receiver-side shapes.
   *
   * @param phoneNumberId - UUID of the sending phone number.
   * @param options.to - E.164 destination number.
   * @param options.text - Message body (1-1600 chars, non-whitespace required).
   *
   * @throws {RecipientBlockedError} when the destination is blocked by an
   *   outbound contact rule on the sender.
   * @throws {InkboxAPIError} for other 4xx/5xx errors. Stable `error` codes
   *   live on `err.detail.error`.
   */
  async send(
    phoneNumberId: string,
    options: { to: string; text: string },
  ): Promise<TextMessage> {
    // Sender is selected by path param, not body.
    const data = await this.http.post<RawTextMessage>(
      `/numbers/${phoneNumberId}/texts`,
      { to: options.to, text: options.text },
    );
    return parseTextMessage(data);
  }

  /**
   * Send a group MMS to 2–8 recipients as a single conversation.
   *
   * Group MMS is MMS-only and billed per recipient. All participants
   * must clear opt-in and contact-rule checks together; a single
   * failure rejects the whole send.
   *
   * @param phoneNumberId - UUID of the sending phone number.
   * @param options.to - 2–8 E.164 recipient phone numbers.
   * @param options.text - Optional message body (≤1600 chars).
   * @param options.mediaUrls - Optional publicly-fetchable media URLs.
   *
   * @returns The queued group `TextMessage`. `groupId` is set;
   *   `remotePhoneNumber` is `null`; `recipientsStatus` carries
   *   per-recipient lifecycle state. Subsequent `text.sent` /
   *   `text.delivered` / `text.delivery_failed` /
   *   `text.delivery_unconfirmed` webhooks fire **per recipient**,
   *   with the affected number in the payload's `recipientPhoneNumber`.
   *
   * @throws {RecipientBlockedError} when any recipient is blocked by an
   *   outbound contact rule on the sender.
   * @throws {InkboxAPIError} for other 4xx/5xx errors. `err.detail.address`
   *   names the offending recipient when a check fails.
   */
  async sendGroup(
    phoneNumberId: string,
    options: { to: string[]; text?: string; mediaUrls?: string[] },
  ): Promise<TextMessage> {
    const body: Record<string, unknown> = { to: options.to };
    if (options.text !== undefined) body["text"] = options.text;
    if (options.mediaUrls !== undefined) body["media_urls"] = options.mediaUrls;
    const data = await this.http.post<RawTextMessage>(
      `/numbers/${phoneNumberId}/texts/group`,
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
   * List conversations (one row per remote number) with latest message preview.
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
   */
  async listConversations(
    phoneNumberId: string,
    options?: { limit?: number; offset?: number; isBlocked?: boolean },
  ): Promise<TextConversationSummary[]> {
    const params: Record<string, string | number | boolean> = {
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
    };
    if (options?.isBlocked !== undefined) {
      params["is_blocked"] = options.isBlocked;
    }
    const data = await this.http.get<RawTextConversationSummary[]>(
      `/numbers/${phoneNumberId}/texts/conversations`,
      params,
    );
    return data.map(parseTextConversationSummary);
  }

  /**
   * Get all messages with a specific remote number, newest first.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param remoteNumber - E.164 remote phone number.
   * @param options.limit - Max results (1–200). Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   */
  async getConversation(
    phoneNumberId: string,
    remoteNumber: string,
    options?: { limit?: number; offset?: number },
  ): Promise<TextMessage[]> {
    const data = await this.http.get<RawTextMessage[]>(
      `/numbers/${phoneNumberId}/texts/conversations/${remoteNumber}`,
      { limit: options?.limit ?? 50, offset: options?.offset ?? 0 },
    );
    return data.map(parseTextMessage);
  }

  /**
   * Update the read state for all messages in a conversation.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param remoteNumber - E.164 remote phone number.
   * @param options.isRead - Mark all messages as read or unread.
   * @returns Object with `remotePhoneNumber`, `isRead`, and `updatedCount`.
   */
  async updateConversation(
    phoneNumberId: string,
    remoteNumber: string,
    options: { isRead: boolean },
  ): Promise<{ remotePhoneNumber: string; isRead: boolean; updatedCount: number }> {
    const data = await this.http.patch<{
      remote_phone_number: string;
      is_read: boolean;
      updated_count: number;
    }>(
      `/numbers/${phoneNumberId}/texts/conversations/${remoteNumber}`,
      { is_read: options.isRead },
    );
    return {
      remotePhoneNumber: data.remote_phone_number,
      isRead: data.is_read,
      updatedCount: data.updated_count,
    };
  }

  /**
   * List messages in a group MMS conversation, newest first.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param groupId - UUID of the group conversation (from
   *   `TextMessage.groupId` or `TextConversationSummary.groupId`).
   * @param options.limit - Max results (1–200). Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   */
  async getGroupConversation(
    phoneNumberId: string,
    groupId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<TextMessage[]> {
    const data = await this.http.get<RawTextMessage[]>(
      `/numbers/${phoneNumberId}/texts/conversations/group/${groupId}`,
      { limit: options?.limit ?? 50, offset: options?.offset ?? 0 },
    );
    return data.map(parseTextMessage);
  }

  /**
   * Mark all messages in a group conversation read or unread.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param groupId - UUID of the group conversation.
   * @param options.isRead - New read state.
   * @returns Object with `groupId`, `isRead`, and `updatedCount`.
   */
  async updateGroupConversation(
    phoneNumberId: string,
    groupId: string,
    options: { isRead: boolean },
  ): Promise<{ groupId: string; isRead: boolean; updatedCount: number }> {
    const data = await this.http.patch<{
      group_id: string;
      is_read: boolean;
      updated_count: number;
    }>(
      `/numbers/${phoneNumberId}/texts/conversations/group/${groupId}`,
      { is_read: options.isRead },
    );
    return {
      groupId: data.group_id,
      isRead: data.is_read,
      updatedCount: data.updated_count,
    };
  }
}
