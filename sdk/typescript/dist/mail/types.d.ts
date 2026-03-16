/**
 * inkbox-mail TypeScript SDK — public types.
 */
export interface Mailbox {
    id: string;
    emailAddress: string;
    displayName: string | null;
    webhookUrl: string | null;
    /** "active" | "paused" | "deleted" */
    status: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface Message {
    id: string;
    mailboxId: string;
    threadId: string | null;
    /** RFC 5322 Message-ID header value */
    messageId: string;
    fromAddress: string;
    toAddresses: string[];
    ccAddresses: string[] | null;
    subject: string | null;
    /** First ~200 characters of the plain-text body */
    snippet: string | null;
    direction: "inbound" | "outbound";
    status: string;
    isRead: boolean;
    isStarred: boolean;
    hasAttachments: boolean;
    createdAt: Date;
}
export interface MessageDetail extends Message {
    bodyText: string | null;
    bodyHtml: string | null;
    bccAddresses: string[] | null;
    /** RFC 5322 In-Reply-To header value */
    inReplyTo: string | null;
    /** RFC 5322 References header values */
    references: string[] | null;
    attachmentMetadata: Record<string, unknown>[] | null;
    sesMessageId: string | null;
    updatedAt: Date;
}
export interface Thread {
    id: string;
    mailboxId: string;
    subject: string | null;
    /** "active" | "paused" | "deleted" */
    status: string;
    messageCount: number;
    lastMessageAt: Date;
    createdAt: Date;
}
export interface ThreadDetail extends Thread {
    /** All messages in the thread, oldest-first */
    messages: Message[];
}
export interface RawMailbox {
    id: string;
    email_address: string;
    display_name: string | null;
    webhook_url: string | null;
    status: string;
    created_at: string;
    updated_at: string;
}
export interface RawMessage {
    id: string;
    mailbox_id: string;
    thread_id: string | null;
    message_id: string;
    from_address: string;
    to_addresses: string[];
    cc_addresses: string[] | null;
    subject: string | null;
    snippet: string | null;
    direction: string;
    status: string;
    is_read: boolean;
    is_starred: boolean;
    has_attachments: boolean;
    created_at: string;
    body_text?: string | null;
    body_html?: string | null;
    bcc_addresses?: string[] | null;
    in_reply_to?: string | null;
    references?: string[] | null;
    attachment_metadata?: Record<string, unknown>[] | null;
    ses_message_id?: string | null;
    updated_at?: string;
}
export interface RawThread {
    id: string;
    mailbox_id: string;
    subject: string | null;
    status: string;
    message_count: number;
    last_message_at: string;
    created_at: string;
    messages?: RawMessage[];
}
export interface RawCursorPage<T> {
    items: T[];
    next_cursor: string | null;
    has_more: boolean;
}
export declare function parseMailbox(r: RawMailbox): Mailbox;
export declare function parseMessage(r: RawMessage): Message;
export declare function parseMessageDetail(r: RawMessage): MessageDetail;
export declare function parseThread(r: RawThread): Thread;
export declare function parseThreadDetail(r: RawThread): ThreadDetail;
//# sourceMappingURL=types.d.ts.map