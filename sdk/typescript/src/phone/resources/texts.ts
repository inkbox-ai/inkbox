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
   * The returned message is in `queued` state — final delivery
   * (`delivered`, `delivery_failed`, `delivery_unconfirmed`) arrives via
   * the `incomingTextWebhookUrl` configured on the sender.
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
   * List text messages for a phone number, newest first.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param options.limit - Max results (1–200). Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   * @param options.isRead - Filter by read state.
   */
  async list(
    phoneNumberId: string,
    options?: { limit?: number; offset?: number; isRead?: boolean },
  ): Promise<TextMessage[]> {
    const params: Record<string, string | number | boolean> = {
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
    };
    if (options?.isRead !== undefined) {
      params["is_read"] = options.isRead;
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
   * @param phoneNumberId - UUID of the phone number.
   * @param options.q - Search query string.
   * @param options.limit - Max results (1–200). Defaults to 50.
   */
  async search(
    phoneNumberId: string,
    options: { q: string; limit?: number },
  ): Promise<TextMessage[]> {
    const data = await this.http.get<RawTextMessage[]>(
      `/numbers/${phoneNumberId}/texts/search`,
      { q: options.q, limit: options.limit ?? 50 },
    );
    return data.map(parseTextMessage);
  }

  /**
   * List conversations (one row per remote number) with latest message preview.
   *
   * @param phoneNumberId - UUID of the phone number.
   * @param options.limit - Max results (1–200). Defaults to 50.
   * @param options.offset - Pagination offset. Defaults to 0.
   */
  async listConversations(
    phoneNumberId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<TextConversationSummary[]> {
    const data = await this.http.get<RawTextConversationSummary[]>(
      `/numbers/${phoneNumberId}/texts/conversations`,
      { limit: options?.limit ?? 50, offset: options?.offset ?? 0 },
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
}
