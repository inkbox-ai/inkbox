/**
 * inkbox-mail/resources/mailboxes.ts
 *
 * Mailbox read + update + full-text search. Mailboxes are created and
 * deleted exclusively via identity-create / identity-delete cascades —
 * there is no standalone mailbox create or delete surface.
 */

import { HttpTransport } from "../../_http.js";
import {
  FilterMode,
  Mailbox,
  Message,
  RawCursorPage,
  RawMailbox,
  RawMessage,
  parseMailbox,
  parseMessage,
} from "../types.js";
import { MailboxImportsResource } from "./imports.js";

const BASE = "/mailboxes";

export class MailboxesResource {
  readonly imports: MailboxImportsResource;

  constructor(private readonly http: HttpTransport) {
    this.imports = new MailboxImportsResource(http);
  }

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
   * To attach a webhook receiver, use
   * `inkbox.webhooks.subscriptions.create({ mailboxId, url, eventTypes })`.
   *
   * @param emailAddress - Full email address of the mailbox to update.
   * @param options.filterMode - Contact-rule filter mode. Mutation requires an admin-scoped key.
   */
  async update(
    emailAddress: string,
    options: {
      filterMode?: FilterMode;
    },
  ): Promise<Mailbox> {
    const body: Record<string, unknown> = {};
    if (options.filterMode !== undefined) {
      body["filter_mode"] = options.filterMode;
    }
    const data = await this.http.patch<RawMailbox>(`${BASE}/${emailAddress}`, body);
    return parseMailbox(data);
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
