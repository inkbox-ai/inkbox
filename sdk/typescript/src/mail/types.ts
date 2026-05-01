/**
 * inkbox-mail TypeScript SDK — public types.
 */

/** Whether a message was received by or sent from a mailbox. */
export enum MessageDirection {
  /** Email received from an external sender. */
  INBOUND = "inbound",
  /** Email sent by the mailbox. */
  OUTBOUND = "outbound",
}

/**
 * Strategy for embedding the original message in a forward.
 *
 * `INLINE` — render the original body inline below a Gmail-style preamble.
 *   May not perfectly preserve inline images or complex layouts.
 * `WRAPPED` — attach the original raw MIME as a single `message/rfc822`
 *   part — semantically preserved.
 */
export enum ForwardMode {
  INLINE = "inline",
  WRAPPED = "wrapped",
}

/**
 * Contact-rule filter mode on a mailbox or phone number.
 *
 * `WHITELIST` — only addresses that match an `allow` rule are delivered.
 * `BLACKLIST` — everything is delivered except matches against a
 *   `block` rule. This is the default.
 */
export enum FilterMode {
  WHITELIST = "whitelist",
  BLACKLIST = "blacklist",
}

/**
 * Logical folder a thread lives in.
 *
 * `BLOCKED` is server-assigned and is not client-settable — PATCH will
 * reject it.
 */
export enum ThreadFolder {
  INBOX = "inbox",
  SPAM = "spam",
  BLOCKED = "blocked",
  ARCHIVE = "archive",
}

/** Whether a matching address is allowed through or blocked. */
export enum MailRuleAction {
  ALLOW = "allow",
  BLOCK = "block",
}

/** What a mail contact rule matches on. */
export enum MailRuleMatchType {
  EXACT_EMAIL = "exact_email",
  DOMAIN = "domain",
}

/** Whether a contact rule is currently enforced. */
export enum ContactRuleStatus {
  ACTIVE = "active",
  PAUSED = "paused",
}

/** Lifecycle status of a custom sending domain. */
export enum SendingDomainStatus {
  NOT_STARTED = "not_started",
  AWAITING_OWNERSHIP = "awaiting_ownership",
  PENDING = "pending",
  DNS_INVALID = "dns_invalid",
  VERIFYING = "verifying",
  VERIFIED = "verified",
  FAILED = "failed",
  PENDING_DKIM_ROTATION = "pending_dkim_rotation",
  DEGRADED = "degraded",
  PENDING_DELETION = "pending_deletion",
}

/**
 * A custom sending domain registered to your organisation.
 *
 * Returned by `inkbox.domains.list()`. Mailboxes can be bound to a
 * verified domain via the `sendingDomainId` option on
 * `mailboxes.create()` or `sendingDomain` on `createIdentity`.
 */
export interface Domain {
  /** Sending-domain row id (e.g. `"sending_domain_<uuid>"`). */
  id: string;
  /** Bare registered domain (e.g. `"mail.acme.com"`). */
  domain: string;
  /** Current lifecycle status. Only `VERIFIED` rows are usable for sending. */
  status: SendingDomainStatus;
  /** True if this is the org's default sending domain (at most one). */
  isDefault: boolean;
  /** First time this domain reached `VERIFIED`. `null` if never verified. */
  verifiedAt: Date | null;
}

export interface FilterModeChangeNotice {
  /** The mode the resource was just flipped to. */
  newFilterMode: FilterMode;
  /**
   * Action whose rules are now redundant under `newFilterMode` —
   * `"block"` under whitelist, `"allow"` under blacklist. Typed as a
   * free-form string to tolerate new server values.
   */
  redundantRuleAction: string;
  /**
   * Count of active rules whose `action` equals `redundantRuleAction`.
   * `0` is a clean flip. Paused / deleted rules are not counted.
   */
  redundantRuleCount: number;
}

export interface Mailbox {
  id: string;
  emailAddress: string;
  /**
   * Bare domain the mailbox sends from, derived from `emailAddress`.
   * Either the platform default (e.g. `"inkboxmail.com"`) or a
   * verified custom domain.
   */
  sendingDomain: string;
  displayName: string | null;
  webhookUrl: string | null;
  filterMode: FilterMode;
  /**
   * UUID of the owning agent identity, or `null` if the mailbox is
   * standalone (not tied to any agent). Always present on every mailbox
   * response shape.
   */
  agentIdentityId: string | null;
  createdAt: Date;
  updatedAt: Date;
  filterModeChangeNotice: FilterModeChangeNotice | null;
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
  direction: MessageDirection;
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
  folder: ThreadFolder;
  messageCount: number;
  lastMessageAt: Date;
  createdAt: Date;
}

export interface ThreadDetail extends Thread {
  /** All messages in the thread, oldest-first */
  messages: Message[];
}

export interface MailContactRule {
  id: string;
  mailboxId: string;
  action: MailRuleAction;
  matchType: MailRuleMatchType;
  matchTarget: string;
  status: ContactRuleStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ---- internal raw API shapes (snake_case from JSON) ----

export interface RawFilterModeChangeNotice {
  new_filter_mode: string;
  redundant_rule_action: string;
  redundant_rule_count: number;
}

export interface RawMailbox {
  id: string;
  email_address: string;
  sending_domain?: string;
  display_name: string | null;
  webhook_url: string | null;
  filter_mode?: string;
  agent_identity_id?: string | null;
  filter_mode_change_notice?: RawFilterModeChangeNotice | null;
  created_at: string;
  updated_at: string;
}

export interface RawDomain {
  id: string;
  domain: string;
  status: string;
  is_default: boolean;
  verified_at: string | null;
}

export interface RawSetDefaultDomainResponse {
  default_domain: string | null;
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
  folder?: string;
  message_count: number;
  last_message_at: string;
  created_at: string;
  messages?: RawMessage[];
}

export interface RawMailContactRule {
  id: string;
  mailbox_id: string;
  action: string;
  match_type: string;
  match_target: string;
  status?: string;
  created_at: string;
  updated_at: string;
}

export interface RawCursorPage<T> {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
}

// ---- parsers ----

export function parseFilterModeChangeNotice(
  r: RawFilterModeChangeNotice,
): FilterModeChangeNotice {
  return {
    newFilterMode: r.new_filter_mode as FilterMode,
    redundantRuleAction: r.redundant_rule_action,
    redundantRuleCount: r.redundant_rule_count,
  };
}

export function parseMailbox(r: RawMailbox): Mailbox {
  return {
    id: r.id,
    emailAddress: r.email_address,
    sendingDomain: r.sending_domain ?? r.email_address.split("@")[1] ?? "",
    displayName: r.display_name,
    webhookUrl: r.webhook_url,
    filterMode: (r.filter_mode as FilterMode) ?? FilterMode.BLACKLIST,
    agentIdentityId: r.agent_identity_id ?? null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    filterModeChangeNotice: r.filter_mode_change_notice
      ? parseFilterModeChangeNotice(r.filter_mode_change_notice)
      : null,
  };
}

export function parseDomain(r: RawDomain): Domain {
  return {
    id: r.id,
    domain: r.domain,
    status: r.status as SendingDomainStatus,
    isDefault: r.is_default,
    verifiedAt: r.verified_at ? new Date(r.verified_at) : null,
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
    direction: r.direction as MessageDirection,
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
    folder: (r.folder as ThreadFolder) ?? ThreadFolder.INBOX,
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

export function parseMailContactRule(r: RawMailContactRule): MailContactRule {
  return {
    id: r.id,
    mailboxId: r.mailbox_id,
    action: r.action as MailRuleAction,
    matchType: r.match_type as MailRuleMatchType,
    matchTarget: r.match_target,
    status: (r.status as ContactRuleStatus) ?? ContactRuleStatus.ACTIVE,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}
