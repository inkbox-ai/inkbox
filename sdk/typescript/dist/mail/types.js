/**
 * inkbox-mail TypeScript SDK — public types.
 */
// ---- parsers ----
export function parseMailbox(r) {
    return {
        id: r.id,
        emailAddress: r.email_address,
        displayName: r.display_name,
        webhookUrl: r.webhook_url,
        status: r.status,
        createdAt: new Date(r.created_at),
        updatedAt: new Date(r.updated_at),
    };
}
export function parseMessage(r) {
    return {
        id: r.id,
        mailboxId: r.mailbox_id,
        threadId: r.thread_id,
        messageId: r.message_id,
        fromAddress: r.from_address,
        toAddresses: r.to_addresses,
        ccAddresses: r.cc_addresses ?? null,
        subject: r.subject,
        snippet: r.snippet,
        direction: r.direction,
        status: r.status,
        isRead: r.is_read,
        isStarred: r.is_starred,
        hasAttachments: r.has_attachments,
        createdAt: new Date(r.created_at),
    };
}
export function parseMessageDetail(r) {
    return {
        ...parseMessage(r),
        bodyText: r.body_text ?? null,
        bodyHtml: r.body_html ?? null,
        bccAddresses: r.bcc_addresses ?? null,
        inReplyTo: r.in_reply_to ?? null,
        references: r.references ?? null,
        attachmentMetadata: r.attachment_metadata ?? null,
        sesMessageId: r.ses_message_id ?? null,
        updatedAt: new Date(r.updated_at),
    };
}
export function parseThread(r) {
    return {
        id: r.id,
        mailboxId: r.mailbox_id,
        subject: r.subject,
        status: r.status,
        messageCount: r.message_count,
        lastMessageAt: new Date(r.last_message_at),
        createdAt: new Date(r.created_at),
    };
}
export function parseThreadDetail(r) {
    return {
        ...parseThread(r),
        messages: (r.messages ?? []).map(parseMessage),
    };
}
//# sourceMappingURL=types.js.map