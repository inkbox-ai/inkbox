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

// ---- internal raw API shapes (snake_case from JSON) ----

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
  // detail-only fields
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

// ---- parsers ----

export function parseMailbox(r: RawMailbox): Mailbox {
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

export function parseMessage(r: RawMessage): Message {
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
    direction: r.direction as "inbound" | "outbound",
    status: r.status,
    isRead: r.is_read,
    isStarred: r.is_starred,
    hasAttachments: r.has_attachments,
    createdAt: new Date(r.created_at),
  };
}

export function parseMessageDetail(r: RawMessage): MessageDetail {
  return {
    ...parseMessage(r),
    bodyText: r.body_text ?? null,
    bodyHtml: r.body_html ?? null,
    bccAddresses: r.bcc_addresses ?? null,
    inReplyTo: r.in_reply_to ?? null,
    references: r.references ?? null,
    attachmentMetadata: r.attachment_metadata ?? null,
    sesMessageId: r.ses_message_id ?? null,
    updatedAt: new Date(r.updated_at!),
  };
}

export function parseThread(r: RawThread): Thread {
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

export function parseThreadDetail(r: RawThread): ThreadDetail {
  return {
    ...parseThread(r),
    messages: (r.messages ?? []).map(parseMessage),
  };
}

