/**
 * inkbox-mail/resources/messages.ts
 *
 * Message operations: list (auto-paginated), get, send, flag updates, delete.
 */

import { HttpTransport } from "../../_http.js";
import {
  ForwardMode,
  Message,
  MessageDetail,
  MessageDirection,
  RawCursorPage,
  RawMessage,
  parseMessage,
  parseMessageDetail,
} from "../types.js";

const DEFAULT_PAGE_SIZE = 50;

export class MessagesResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Async iterator over all messages in a mailbox, newest first.
   *
   * Pagination is handled automatically — just iterate.
   *
   * @example
   * ```ts
   * for await (const msg of client.messages.list(emailAddress)) {
   *   console.log(msg.subject, msg.fromAddress);
   * }
   * ```
   */
  async *list(
    emailAddress: string,
    options?: { pageSize?: number; direction?: MessageDirection },
  ): AsyncGenerator<Message> {
    const limit = options?.pageSize ?? DEFAULT_PAGE_SIZE;
    let cursor: string | undefined;

    while (true) {
      const params: Record<string, string | number | undefined> = { limit, cursor };
      if (options?.direction !== undefined) params["direction"] = options.direction;
      const page = await this.http.get<RawCursorPage<RawMessage>>(
        `/mailboxes/${emailAddress}/messages`,
        params,
      );
      for (const item of page.items) {
        yield parseMessage(item);
      }
      if (!page.has_more) break;
      cursor = page.next_cursor ?? undefined;
    }
  }

  /**
   * Get a message with full body content.
   *
   * @param emailAddress - Full email address of the owning mailbox.
   * @param messageId - UUID of the message.
   */
  async get(emailAddress: string, messageId: string): Promise<MessageDetail> {
    const data = await this.http.get<RawMessage>(
      `/mailboxes/${emailAddress}/messages/${messageId}`,
    );
    return parseMessageDetail(data);
  }

  /**
   * Send an email from a mailbox.
   *
   * @param emailAddress - Full email address of the sending mailbox.
   * @param options.to - Primary recipient addresses (at least one required).
   * @param options.subject - Email subject line.
   * @param options.bodyText - Plain-text body.
   * @param options.bodyHtml - HTML body.
   * @param options.cc - Carbon-copy recipients.
   * @param options.bcc - Blind carbon-copy recipients.
   * @param options.inReplyToMessageId - RFC 5322 Message-ID of the message being
   *   replied to. Threads the reply automatically.
   * @param options.attachments - Optional file attachments. Each entry must have
   *   `filename`, `contentType` (MIME type), and `contentBase64` (base64-encoded
   *   file content). Max total size: 25 MB. Blocked: `.exe`, `.bat`, `.scr`.
   */
  async send(
    emailAddress: string,
    options: {
      to: string[];
      subject: string;
      bodyText?: string;
      bodyHtml?: string;
      cc?: string[];
      bcc?: string[];
      inReplyToMessageId?: string;
      attachments?: Array<{
        filename: string;
        contentType: string;
        contentBase64: string;
      }>;
    },
  ): Promise<Message> {
    const recipients: Record<string, unknown> = { to: options.to };
    if (options.cc) recipients["cc"] = options.cc;
    if (options.bcc) recipients["bcc"] = options.bcc;

    const body: Record<string, unknown> = {
      recipients,
      subject: options.subject,
    };
    if (options.bodyText !== undefined) body["body_text"] = options.bodyText;
    if (options.bodyHtml !== undefined) body["body_html"] = options.bodyHtml;
    if (options.inReplyToMessageId !== undefined) {
      body["in_reply_to_message_id"] = options.inReplyToMessageId;
    }
    if (options.attachments !== undefined) {
      body["attachments"] = options.attachments.map((a) => ({
        filename: a.filename,
        content_type: a.contentType,
        content_base64: a.contentBase64,
      }));
    }

    const data = await this.http.post<RawMessage>(
      `/mailboxes/${emailAddress}/messages`,
      body,
    );
    return parseMessage(data);
  }

  /**
   * Forward a stored message out from this mailbox.
   *
   * Two modes are available — see {@link ForwardMode}. Forwards start a
   * brand-new thread.
   *
   * @param emailAddress - Full email address of the forwarding mailbox.
   * @param messageId - UUID of the message being forwarded.
   * @param options.to - Primary recipient addresses.
   * @param options.cc - Carbon-copy recipients.
   * @param options.bcc - Blind carbon-copy recipients. At least one address
   *   is required across `to`, `cc`, and `bcc`.
   * @param options.mode - `"inline"` (default) or `"wrapped"`.
   * @param options.subject - Optional override; defaults to
   *   `"Fwd: " + original.subject` (idempotent).
   * @param options.bodyText - Optional caller note prepended above the
   *   original body (inline) or as a top-level note (wrapped).
   * @param options.bodyHtml - Optional HTML caller note.
   * @param options.additionalAttachments - Optional caller-authored
   *   attachments alongside the forwarded content. Same shape as
   *   `send({ attachments })`. Subject to the same blocked-extension and
   *   25 MB limits.
   * @param options.includeOriginalAttachments - `inline` mode only. When
   *   `true` (default), original attachments are re-attached as direct
   *   outbound parts. Ignored in `wrapped` mode.
   * @param options.replyTo - Optional Reply-To address for the forward's
   *   outer envelope.
   */
  async forward(
    emailAddress: string,
    messageId: string,
    options: {
      to?: string[];
      cc?: string[];
      bcc?: string[];
      mode?: ForwardMode | "inline" | "wrapped";
      subject?: string;
      bodyText?: string;
      bodyHtml?: string;
      additionalAttachments?: Array<{
        filename: string;
        contentType: string;
        contentBase64: string;
      }>;
      includeOriginalAttachments?: boolean;
      replyTo?: string;
    },
  ): Promise<Message> {
    const recipients: Record<string, unknown> = {};
    if (options.to) recipients["to"] = options.to;
    if (options.cc) recipients["cc"] = options.cc;
    if (options.bcc) recipients["bcc"] = options.bcc;

    const body: Record<string, unknown> = {
      recipients,
      mode: options.mode ?? ForwardMode.INLINE,
      include_original_attachments: options.includeOriginalAttachments ?? true,
    };
    if (options.subject !== undefined) body["subject"] = options.subject;
    if (options.bodyText !== undefined) body["body_text"] = options.bodyText;
    if (options.bodyHtml !== undefined) body["body_html"] = options.bodyHtml;
    if (options.additionalAttachments !== undefined) {
      body["additional_attachments"] = options.additionalAttachments.map((a) => ({
        filename: a.filename,
        content_type: a.contentType,
        content_base64: a.contentBase64,
      }));
    }
    if (options.replyTo !== undefined) body["reply_to"] = options.replyTo;

    const data = await this.http.post<RawMessage>(
      `/mailboxes/${emailAddress}/messages/${messageId}/forward`,
      body,
    );
    return parseMessage(data);
  }

  /**
   * Update read/starred flags on a message.
   *
   * Pass only the flags you want to change; omitted flags are left as-is.
   */
  async updateFlags(
    emailAddress: string,
    messageId: string,
    flags: { isRead?: boolean; isStarred?: boolean },
  ): Promise<Message> {
    const body: Record<string, boolean> = {};
    if (flags.isRead !== undefined) body["is_read"] = flags.isRead;
    if (flags.isStarred !== undefined) body["is_starred"] = flags.isStarred;

    const data = await this.http.patch<RawMessage>(
      `/mailboxes/${emailAddress}/messages/${messageId}`,
      body,
    );
    return parseMessage(data);
  }

  /** Mark a message as read. */
  async markRead(emailAddress: string, messageId: string): Promise<Message> {
    return this.updateFlags(emailAddress, messageId, { isRead: true });
  }

  /** Mark a message as unread. */
  async markUnread(emailAddress: string, messageId: string): Promise<Message> {
    return this.updateFlags(emailAddress, messageId, { isRead: false });
  }

  /** Star a message. */
  async star(emailAddress: string, messageId: string): Promise<Message> {
    return this.updateFlags(emailAddress, messageId, { isStarred: true });
  }

  /** Unstar a message. */
  async unstar(emailAddress: string, messageId: string): Promise<Message> {
    return this.updateFlags(emailAddress, messageId, { isStarred: false });
  }

  /** Delete a message. */
  async delete(emailAddress: string, messageId: string): Promise<void> {
    await this.http.delete(`/mailboxes/${emailAddress}/messages/${messageId}`);
  }

  /**
   * Get a temporary signed URL for a message attachment.
   *
   * @param emailAddress - Full email address of the owning mailbox.
   * @param messageId - UUID of the message.
   * @param filename - Attachment filename.
   * @param options.redirect - If `true`, follows the redirect. If `false` (default),
   *   returns `{ url, filename, expiresIn }`.
   */
  async getAttachment(
    emailAddress: string,
    messageId: string,
    filename: string,
    options?: { redirect?: boolean },
  ): Promise<{ url: string; filename: string; expiresIn: number }> {
    return this.http.get(
      `/mailboxes/${emailAddress}/messages/${messageId}/attachments/${filename}`,
      { redirect: options?.redirect ? "true" : "false" },
    );
  }
}
