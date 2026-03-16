/**
 * inkbox-mail/resources/messages.ts
 *
 * Message operations: list (auto-paginated), get, send, flag updates, delete.
 */
import { HttpTransport } from "../../_http.js";
import { Message, MessageDetail } from "../types.js";
export declare class MessagesResource {
    private readonly http;
    constructor(http: HttpTransport);
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
    list(emailAddress: string, options?: {
        pageSize?: number;
        direction?: "inbound" | "outbound";
    }): AsyncGenerator<Message>;
    /**
     * Get a message with full body content.
     *
     * @param emailAddress - Full email address of the owning mailbox.
     * @param messageId - UUID of the message.
     */
    get(emailAddress: string, messageId: string): Promise<MessageDetail>;
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
    send(emailAddress: string, options: {
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
    }): Promise<Message>;
    /**
     * Update read/starred flags on a message.
     *
     * Pass only the flags you want to change; omitted flags are left as-is.
     */
    updateFlags(emailAddress: string, messageId: string, flags: {
        isRead?: boolean;
        isStarred?: boolean;
    }): Promise<Message>;
    /** Mark a message as read. */
    markRead(emailAddress: string, messageId: string): Promise<Message>;
    /** Mark a message as unread. */
    markUnread(emailAddress: string, messageId: string): Promise<Message>;
    /** Star a message. */
    star(emailAddress: string, messageId: string): Promise<Message>;
    /** Unstar a message. */
    unstar(emailAddress: string, messageId: string): Promise<Message>;
    /** Delete a message. */
    delete(emailAddress: string, messageId: string): Promise<void>;
    /**
     * Get a presigned URL for a message attachment.
     *
     * @param emailAddress - Full email address of the owning mailbox.
     * @param messageId - UUID of the message.
     * @param filename - Attachment filename.
     * @param options.redirect - If `true`, follows the redirect. If `false` (default),
     *   returns `{ url, filename, expiresIn }`.
     */
    getAttachment(emailAddress: string, messageId: string, filename: string, options?: {
        redirect?: boolean;
    }): Promise<{
        url: string;
        filename: string;
        expiresIn: number;
    }>;
}
//# sourceMappingURL=messages.d.ts.map