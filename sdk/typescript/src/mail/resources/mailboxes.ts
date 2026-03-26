/**
 * inkbox-mail/resources/mailboxes.ts
 *
 * Mailbox CRUD and full-text search.
 */

import { HttpTransport } from "../../_http.js";
import {
  Mailbox,
  Message,
  RawCursorPage,
  RawMailbox,
  RawMessage,
  parseMailbox,
  parseMessage,
} from "../types.js";

const BASE = "/mailboxes";

export class MailboxesResource {
  constructor(private readonly http: HttpTransport) {}

  /** List all mailboxes for your organisation. */
  async list(): Promise<Mailbox[]> {
    const data = await this.http.get<RawMailbox[]>(BASE);
    return data.map(parseMailbox);
  }

  /**
   * Get a mailbox by its email address.
   *
   * @param emailAddress - Full email address of the mailbox (e.g. `"abc-xyz@inkboxmail.com"`).
   */
  async get(emailAddress: string): Promise<Mailbox> {
    const data = await this.http.get<RawMailbox>(`${BASE}/${emailAddress}`);
    return parseMailbox(data);
  }

  /**
   * Update mutable mailbox fields.
   *
   * Only provided fields are applied; omitted fields are left unchanged.
   * Pass `webhookUrl: null` to unsubscribe from webhooks.
   *
   * @param emailAddress - Full email address of the mailbox to update.
   * @param options.displayName - New human-readable sender name.
   * @param options.webhookUrl - HTTPS URL to receive webhook events, or `null` to unsubscribe.
   */
  async update(
    emailAddress: string,
    options: { displayName?: string; webhookUrl?: string | null },
  ): Promise<Mailbox> {
    const body: Record<string, unknown> = {};
    if (options.displayName !== undefined) {
      body["display_name"] = options.displayName;
    }
    if ("webhookUrl" in options) {
      body["webhook_url"] = options.webhookUrl;
    }
    const data = await this.http.patch<RawMailbox>(`${BASE}/${emailAddress}`, body);
    return parseMailbox(data);
  }

  /**
   * Delete a mailbox.
   *
   * @param emailAddress - Full email address of the mailbox to delete.
   */
  async delete(emailAddress: string): Promise<void> {
    await this.http.delete(`${BASE}/${emailAddress}`);
  }

  /**
   * Full-text search across messages in a mailbox.
   *
   * @param emailAddress - Full email address of the mailbox to search.
   * @param options.q - Search query string.
   * @param options.limit - Maximum number of results (1–100). Defaults to 50.
   */
  async search(
    emailAddress: string,
    options: { q: string; limit?: number },
  ): Promise<Message[]> {
    const data = await this.http.get<RawCursorPage<RawMessage>>(
      `${BASE}/${emailAddress}/search`,
      { q: options.q, limit: options.limit ?? 50 },
    );
    return data.items.map(parseMessage);
  }
}
