/**
 * inkbox-phone TypeScript SDK — public types.
 */

import type {
  ContactRuleStatus,
  FilterMode,
  FilterModeChangeNotice,
  RawFilterModeChangeNotice,
} from "../mail/types.js";
import {
  FilterMode as FilterModeEnum,
  parseFilterModeChangeNotice,
} from "../mail/types.js";

/** Whether a matching phone number is allowed through or blocked. */
export enum PhoneRuleAction {
  ALLOW = "allow",
  BLOCK = "block",
}

/** What a phone contact rule matches on. */
export enum PhoneRuleMatchType {
  EXACT_NUMBER = "exact_number",
}

/**
 * Outbound SMS provisioning readiness for a phone number.
 *
 * Drives whether `sendText` will be accepted by the server. `pending`
 * means the 10DLC campaign / TFV propagation is still running on the
 * carrier side; `ready` means the number can send SMS;
 * `assignment_failed` means provisioning retries were exhausted.
 */
export enum SmsStatus {
  PENDING = "pending",
  READY = "ready",
  ASSIGNMENT_FAILED = "assignment_failed",
}

/** Carrier-facing outbound delivery lifecycle for a text message. */
export enum SmsDeliveryStatus {
  QUEUED = "queued",
  SENT = "sent",
  DELIVERED = "delivered",
  DELIVERY_FAILED = "delivery_failed",
  DELIVERY_UNCONFIRMED = "delivery_unconfirmed",
  SENDING_FAILED = "sending_failed",
}

/** Whether a text was user-initiated or an internal auto-reply. */
export enum TextMessageOrigin {
  USER_INITIATED = "user_initiated",
  AUTO_REPLY = "auto_reply",
}

export interface PhoneNumber {
  id: string;
  number: string;
  /** "toll_free" | "local" */
  type: string;
  /** "active" | "paused" | "released" */
  status: string;
  /** Outbound SMS readiness — gate `sendText` on `ready`. */
  smsStatus: SmsStatus;
  /** Last carrier-reported error code from SMS provisioning, if any. */
  smsErrorCode: string | null;
  smsErrorDetail: string | null;
  /** Timestamp when the number first transitioned into `ready`. */
  smsReadyAt: Date | null;
  /** "auto_accept" | "auto_reject" | "webhook" */
  incomingCallAction: string;
  clientWebsocketUrl: string | null;
  incomingCallWebhookUrl: string | null;
  filterMode: FilterMode;
  /**
   * 2-letter US state abbreviation for LOCAL numbers (e.g. `"NY"`);
   * `null` for TOLL_FREE.
   */
  state: string | null;
  /**
   * UUID of the owning agent identity. `null` only for pool / released
   * states — active org-owned numbers are always bound to an identity.
   * Always present on every phone-number response shape.
   */
  agentIdentityId: string | null;
  createdAt: Date;
  updatedAt: Date;
  filterModeChangeNotice: FilterModeChangeNotice | null;
}

export interface PhoneContactRule {
  id: string;
  phoneNumberId: string;
  action: PhoneRuleAction;
  matchType: PhoneRuleMatchType;
  matchTarget: string;
  status: ContactRuleStatus;
  createdAt: Date;
  updatedAt: Date;
}

export enum SmsOptInStatus {
  OPTED_IN = "opted_in",
  OPTED_OUT = "opted_out",
}

/**
 * Channel that recorded the consent transition.
 *
 * - `api` — org with its own active, customer-managed 10DLC campaign called the
 *   opt-in / opt-out endpoints directly.
 * - `sms` — inbound STOP/START keyword.
 */
export enum SmsOptInSource {
  SMS = "sms",
  API = "api",
}

export interface SmsOptIn {
  id: string;
  organizationId: string;
  /** E.164, e.g. `+15551234567`. */
  receiverNumber: string;
  status: SmsOptInStatus;
  source: SmsOptInSource;
  /** Set when `status === OPTED_IN`, null otherwise. */
  optedInAt: Date | null;
  /** Set when `status === OPTED_OUT`, null otherwise. */
  optedOutAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PhoneCall {
  id: string;
  localPhoneNumber: string;
  remotePhoneNumber: string;
  /** "outbound" | "inbound" */
  direction: string;
  /** "initiated" | "ringing" | "answered" | "completed" | "failed" | "canceled" */
  status: string;
  clientWebsocketUrl: string | null;
  useInkboxTts: boolean | null;
  useInkboxStt: boolean | null;
  /** "local" | "remote" | "max_duration" | "voicemail" | "rejected" */
  hangupReason: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  /**
   * `true` when this call was rejected by a contact rule or default-block
   * before connect. Identity-scoped (agent) API keys never observe `true`
   * rows — the server filters them at the access-policy layer. Admin/JWT
   * callers see both values mixed and can narrow with `isBlocked` on
   * `CallsResource.list`.
   */
  isBlocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RateLimitInfo {
  callsUsed: number;
  callsRemaining: number;
  callsLimit: number;
  minutesUsed: number;
  minutesRemaining: number;
  minutesLimit: number;
}

export interface PhoneCallWithRateLimit extends PhoneCall {
  rateLimit: RateLimitInfo;
}

export interface PhoneTranscript {
  id: string;
  callId: string;
  seq: number;
  tsMs: number;
  /** "local" | "remote" | "system" */
  party: string;
  text: string;
  createdAt: Date;
}

export interface TextMediaItem {
  contentType: string;
  size: number;
  url: string;
}

export interface TextMessageRecipient {
  recipientPhoneNumber: string;
  deliveryStatus: SmsDeliveryStatus | null;
  carrier: string | null;
  lineType: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
}

export interface TextMessage {
  id: string;
  /** "inbound" | "outbound" */
  direction: string;
  localPhoneNumber: string;
  remotePhoneNumber: string | null;
  text: string | null;
  /** "sms" | "mms" */
  type: string;
  media: TextMediaItem[] | null;
  isRead: boolean;
  conversationId: string | null;
  senderPhoneNumber: string | null;
  recipients: TextMessageRecipient[] | null;
  /** Outbound delivery lifecycle. `null` on inbound rows. */
  deliveryStatus: SmsDeliveryStatus | null;
  origin: TextMessageOrigin;
  errorCode: string | null;
  errorDetail: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  /**
   * `true` when this text was rejected by a contact rule or default-block.
   * Identity-scoped (agent) API keys never observe `true` rows — the
   * server filters them at the access-policy layer. Admin/JWT callers see
   * both values mixed and can narrow with `isBlocked` on
   * `TextsResource.list` / `search` / `listConversations`.
   */
  isBlocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TextConversationSummary {
  remotePhoneNumber: string | null;
  id: string | null;
  participants: string[] | null;
  isGroup: boolean;
  latestText: string | null;
  latestDirection: string;
  latestType: string;
  latestHasMedia: boolean;
  latestMessageAt: Date;
  unreadCount: number;
  totalCount: number;
}

export interface TextConversationUpdateResult {
  remotePhoneNumber: string | null;
  conversationId: string | null;
  isRead: boolean;
  updatedCount: number;
}

// ---- internal raw API shapes (snake_case from JSON) ----

export interface RawPhoneNumber {
  id: string;
  number: string;
  type: string;
  status: string;
  sms_status?: string;
  sms_error_code?: string | null;
  sms_error_detail?: string | null;
  sms_ready_at?: string | null;
  incoming_call_action: string;
  client_websocket_url: string | null;
  incoming_call_webhook_url: string | null;
  filter_mode?: string;
  state?: string | null;
  agent_identity_id?: string | null;
  filter_mode_change_notice?: RawFilterModeChangeNotice | null;
  created_at: string;
  updated_at: string;
}

export interface RawPhoneContactRule {
  id: string;
  phone_number_id: string;
  action: string;
  match_type: string;
  match_target: string;
  status?: string;
  created_at: string;
  updated_at: string;
}

export interface RawSmsOptIn {
  id: string;
  organization_id: string;
  receiver_number: string;
  status: string;
  source: string;
  opted_in_at: string | null;
  opted_out_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawPhoneCall {
  id: string;
  local_phone_number: string;
  remote_phone_number: string;
  direction: string;
  status: string;
  client_websocket_url: string | null;
  use_inkbox_tts: boolean | null;
  use_inkbox_stt: boolean | null;
  hangup_reason: string | null;
  started_at: string | null;
  ended_at: string | null;
  // Optional for back-compat with older server responses that predate
  // the field; parser defaults missing values to false.
  is_blocked?: boolean;
  created_at: string;
  updated_at: string;
}

export interface RawRateLimitInfo {
  calls_used: number;
  calls_remaining: number;
  calls_limit: number;
  minutes_used: number;
  minutes_remaining: number;
  minutes_limit: number;
}

export interface RawPhoneCallWithRateLimit extends RawPhoneCall {
  rate_limit: RawRateLimitInfo;
}

export interface RawTextMediaItem {
  content_type: string;
  size: number;
  url: string;
}

export interface RawTextMessageRecipient {
  recipient_phone_number: string;
  delivery_status?: string | null;
  carrier?: string | null;
  line_type?: string | null;
  error_code?: string | null;
  error_detail?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
  failed_at?: string | null;
}

export interface RawTextMessage {
  id: string;
  direction: string;
  local_phone_number: string;
  remote_phone_number?: string | null;
  text: string | null;
  type: string;
  media: RawTextMediaItem[] | null;
  is_read: boolean;
  conversation_id?: string | null;
  sender_phone_number?: string | null;
  recipients?: RawTextMessageRecipient[] | null;
  delivery_status?: string | null;
  origin?: string;
  error_code?: string | null;
  error_detail?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
  failed_at?: string | null;
  // Optional for back-compat with older server responses that predate
  // the field; parser defaults missing values to false.
  is_blocked?: boolean;
  created_at: string;
  updated_at: string;
}

export interface RawTextConversationSummary {
  remote_phone_number?: string | null;
  id?: string | null;
  participants?: string[] | null;
  is_group?: boolean | null;
  latest_text: string | null;
  latest_direction: string;
  latest_type: string;
  latest_has_media?: boolean | null;
  latest_message_at: string;
  unread_count: number;
  total_count: number;
}

export interface RawPhoneTranscript {
  id: string;
  call_id: string;
  seq: number;
  ts_ms: number;
  party: string;
  text: string;
  created_at: string;
}

// ---- parsers ----

export function parsePhoneNumber(r: RawPhoneNumber): PhoneNumber {
  return {
    id: r.id,
    number: r.number,
    type: r.type,
    status: r.status,
    // Default to READY for backwards compatibility with older server
    // responses that predate the sms_status field.
    smsStatus: (r.sms_status as SmsStatus) ?? SmsStatus.READY,
    smsErrorCode: r.sms_error_code ?? null,
    smsErrorDetail: r.sms_error_detail ?? null,
    smsReadyAt: r.sms_ready_at ? new Date(r.sms_ready_at) : null,
    incomingCallAction: r.incoming_call_action,
    clientWebsocketUrl: r.client_websocket_url,
    incomingCallWebhookUrl: r.incoming_call_webhook_url,
    filterMode: (r.filter_mode as FilterMode) ?? FilterModeEnum.BLACKLIST,
    state: r.state ?? null,
    agentIdentityId: r.agent_identity_id ?? null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    filterModeChangeNotice: r.filter_mode_change_notice
      ? parseFilterModeChangeNotice(r.filter_mode_change_notice)
      : null,
  };
}

export function parsePhoneContactRule(r: RawPhoneContactRule): PhoneContactRule {
  return {
    id: r.id,
    phoneNumberId: r.phone_number_id,
    action: r.action as PhoneRuleAction,
    matchType: r.match_type as PhoneRuleMatchType,
    matchTarget: r.match_target,
    status: (r.status as ContactRuleStatus) ?? ("active" as ContactRuleStatus),
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseSmsOptIn(r: RawSmsOptIn): SmsOptIn {
  return {
    id: r.id,
    organizationId: r.organization_id,
    receiverNumber: r.receiver_number,
    status: r.status as SmsOptInStatus,
    source: r.source as SmsOptInSource,
    optedInAt: r.opted_in_at ? new Date(r.opted_in_at) : null,
    optedOutAt: r.opted_out_at ? new Date(r.opted_out_at) : null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parsePhoneCall(r: RawPhoneCall): PhoneCall {
  return {
    id: r.id,
    localPhoneNumber: r.local_phone_number,
    remotePhoneNumber: r.remote_phone_number,
    direction: r.direction,
    status: r.status,
    clientWebsocketUrl: r.client_websocket_url,
    useInkboxTts: r.use_inkbox_tts,
    useInkboxStt: r.use_inkbox_stt,
    hangupReason: r.hangup_reason,
    startedAt: r.started_at ? new Date(r.started_at) : null,
    endedAt: r.ended_at ? new Date(r.ended_at) : null,
    isBlocked: r.is_blocked ?? false,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseRateLimitInfo(r: RawRateLimitInfo): RateLimitInfo {
  return {
    callsUsed: r.calls_used,
    callsRemaining: r.calls_remaining,
    callsLimit: r.calls_limit,
    minutesUsed: r.minutes_used,
    minutesRemaining: r.minutes_remaining,
    minutesLimit: r.minutes_limit,
  };
}

export function parsePhoneCallWithRateLimit(
  r: RawPhoneCallWithRateLimit,
): PhoneCallWithRateLimit {
  return {
    ...parsePhoneCall(r),
    rateLimit: parseRateLimitInfo(r.rate_limit),
  };
}

export function parsePhoneTranscript(r: RawPhoneTranscript): PhoneTranscript {
  return {
    id: r.id,
    callId: r.call_id,
    seq: r.seq,
    tsMs: r.ts_ms,
    party: r.party,
    text: r.text,
    createdAt: new Date(r.created_at),
  };
}

export function parseTextMediaItem(r: RawTextMediaItem): TextMediaItem {
  return {
    contentType: r.content_type,
    size: r.size,
    url: r.url,
  };
}

export function parseTextMessageRecipient(
  r: RawTextMessageRecipient,
): TextMessageRecipient {
  return {
    recipientPhoneNumber: r.recipient_phone_number,
    deliveryStatus: r.delivery_status
      ? (r.delivery_status as SmsDeliveryStatus)
      : null,
    carrier: r.carrier ?? null,
    lineType: r.line_type ?? null,
    errorCode: r.error_code ?? null,
    errorDetail: r.error_detail ?? null,
    sentAt: r.sent_at ? new Date(r.sent_at) : null,
    deliveredAt: r.delivered_at ? new Date(r.delivered_at) : null,
    failedAt: r.failed_at ? new Date(r.failed_at) : null,
  };
}

export function parseTextMessage(r: RawTextMessage): TextMessage {
  return {
    id: r.id,
    direction: r.direction,
    localPhoneNumber: r.local_phone_number,
    remotePhoneNumber: r.remote_phone_number ?? null,
    text: r.text,
    type: r.type,
    media: r.media ? r.media.map(parseTextMediaItem) : null,
    isRead: r.is_read,
    conversationId: r.conversation_id ?? null,
    senderPhoneNumber: r.sender_phone_number ?? null,
    recipients: r.recipients ? r.recipients.map(parseTextMessageRecipient) : null,
    deliveryStatus: r.delivery_status
      ? (r.delivery_status as SmsDeliveryStatus)
      : null,
    origin: (r.origin as TextMessageOrigin) ?? TextMessageOrigin.USER_INITIATED,
    errorCode: r.error_code ?? null,
    errorDetail: r.error_detail ?? null,
    sentAt: r.sent_at ? new Date(r.sent_at) : null,
    deliveredAt: r.delivered_at ? new Date(r.delivered_at) : null,
    failedAt: r.failed_at ? new Date(r.failed_at) : null,
    isBlocked: r.is_blocked ?? false,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseTextConversationSummary(
  r: RawTextConversationSummary,
): TextConversationSummary {
  return {
    remotePhoneNumber: r.remote_phone_number ?? null,
    id: r.id ?? null,
    participants: r.participants ?? null,
    isGroup: r.is_group ?? false,
    latestText: r.latest_text,
    latestDirection: r.latest_direction,
    latestType: r.latest_type,
    latestHasMedia: r.latest_has_media ?? false,
    latestMessageAt: new Date(r.latest_message_at),
    unreadCount: r.unread_count,
    totalCount: r.total_count,
  };
}
