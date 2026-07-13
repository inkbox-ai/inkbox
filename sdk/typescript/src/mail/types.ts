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
 * verified domain via the `sendingDomain` option on `createIdentity`.
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

/**
 * An Inkbox mailbox (an email address owned by your organization).
 *
 * **Storage.** `storageUsedBytes` is what the mailbox currently holds;
 * `storageLimitBytes` is the plan's cap (binary — 2 GiB is `2 * 1024 ** 3`),
 * or `null` when the server didn't resolve it. Sends over the cap are
 * rejected with {@link StorageLimitExceededError}; deleting messages or
 * threads frees space immediately.
 *
 * To deliver `message.*` events to an HTTPS endpoint, create a row on
 * the channel-agnostic subscription resource at
 * `inkbox.webhooks.subscriptions.create({ mailboxId, url, eventTypes })`.
 * Up to 20 active subscriptions per mailbox.
 *
 * @see {@link WebhookSubscriptionsResource} on `inkbox.webhooks.subscriptions`
 */
export interface Mailbox {
  id: string;
  emailAddress: string;
  /**
   * Bare domain the mailbox sends from, derived from `emailAddress`.
   * Either the platform default (e.g. `"inkboxmail.com"`) or a
   * verified custom domain.
   */
  sendingDomain: string;
  filterMode: FilterMode;
  /**
   * UUID of the owning agent identity. Non-null for live customer
   * mailboxes (1:1 invariant); null only on deleted rows and system
   * mailboxes.
   */
  agentIdentityId: string | null;
  createdAt: Date;
  updatedAt: Date;
  filterModeChangeNotice: FilterModeChangeNotice | null;
  /** Bytes currently stored. `0` on servers predating storage caps. */
  storageUsedBytes: number;
  /** Plan cap in bytes (binary — divide by 1024, label GiB/MiB), or `null` if unresolved. */
  storageLimitBytes: number | null;
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
  /** First observed recipient open (tracked sends only); `null` otherwise. */
  firstOpenedAt: Date | null;
  /** Observed opens; approximate (proxy prefetch inflates, the per-window debounce collapses repeats) — prefer `firstOpenedAt`. */
  openCount: number;
}

/** Server-suggested To/Cc for a reply-all (sending mailbox and BCC excluded). */
export interface ReplyAllRecipients {
  to: string[];
  cc: string[];
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
  /** Suggested reply-all recipients, for prefilling UIs. */
  replyAllRecipients: ReplyAllRecipients | null;
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

/**
 * A mail allow/block rule scoped to a mailbox.
 *
 * @deprecated Returned by the legacy per-mailbox routes
 *   (`inkbox.mailContactRules`). The forward-looking, identity-keyed
 *   shape is {@link MailIdentityContactRule}.
 */
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

/**
 * A mail allow/block rule scoped to an **agent identity**.
 *
 * Returned by the identity-keyed routes
 * (`inkbox.mailIdentityContactRules` / `identity.listMailContactRules()`).
 * Same shape as {@link MailContactRule} but keyed by `agentIdentityId`
 * instead of `mailboxId`.
 */
export interface MailIdentityContactRule {
  id: string;
  agentIdentityId: string;
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
  filter_mode?: string;
  agent_identity_id?: string | null;
  filter_mode_change_notice?: RawFilterModeChangeNotice | null;
  created_at: string;
  updated_at: string;
  storage_used_bytes?: number;
  storage_limit_bytes?: number | null;
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
  first_opened_at?: string | null;
  open_count?: number;
  // detail-only fields
  body_text?: string | null;
  body_html?: string | null;
  bcc_addresses?: string[] | null;
  in_reply_to?: string | null;
  references?: string[] | null;
  attachment_metadata?: Record<string, unknown>[] | null;
  ses_message_id?: string | null;
  updated_at?: string;
  reply_all_recipients?: { to: string[]; cc: string[] } | null;
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

export interface RawMailIdentityContactRule {
  id: string;
  agent_identity_id: string;
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
    filterMode: (r.filter_mode as FilterMode) ?? FilterMode.BLACKLIST,
    agentIdentityId: r.agent_identity_id ?? null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    filterModeChangeNotice: r.filter_mode_change_notice
      ? parseFilterModeChangeNotice(r.filter_mode_change_notice)
      : null,
    // Both absent on servers predating storage caps -> 0 / null.
    storageUsedBytes: r.storage_used_bytes ?? 0,
    storageLimitBytes: r.storage_limit_bytes ?? null,
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
    firstOpenedAt: r.first_opened_at ? new Date(r.first_opened_at) : null,
    openCount: r.open_count ?? 0,
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
    replyAllRecipients: r.reply_all_recipients
      ? {
          to: r.reply_all_recipients.to ?? [],
          cc: r.reply_all_recipients.cc ?? [],
        }
      : null,
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

export function parseMailIdentityContactRule(
  r: RawMailIdentityContactRule,
): MailIdentityContactRule {
  return {
    id: r.id,
    agentIdentityId: r.agent_identity_id,
    action: r.action as MailRuleAction,
    matchType: r.match_type as MailRuleMatchType,
    matchTarget: r.match_target,
    status: (r.status as ContactRuleStatus) ?? ContactRuleStatus.ACTIVE,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}
