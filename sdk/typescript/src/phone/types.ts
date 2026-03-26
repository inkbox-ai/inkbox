/**
 * inkbox-phone TypeScript SDK — public types.
 */

export interface PhoneNumber {
  id: string;
  number: string;
  /** "toll_free" | "local" */
  type: string;
  /** "active" | "paused" | "released" */
  status: string;
  /** "auto_accept" | "auto_reject" | "webhook" */
  incomingCallAction: string;
  clientWebsocketUrl: string | null;
  incomingCallWebhookUrl: string | null;
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

export interface TextMessage {
  id: string;
  /** "inbound" | "outbound" */
  direction: string;
  localPhoneNumber: string;
  remotePhoneNumber: string;
  text: string | null;
  /** "sms" | "mms" */
  type: string;
  media: TextMediaItem[] | null;
  /** "active" | "deleted" */
  status: string;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TextConversationSummary {
  remotePhoneNumber: string;
  latestText: string | null;
  latestDirection: string;
  latestType: string;
  latestMessageAt: Date;
  unreadCount: number;
  totalCount: number;
}

// ---- internal raw API shapes (snake_case from JSON) ----

export interface RawPhoneNumber {
  id: string;
  number: string;
  type: string;
  status: string;
  incoming_call_action: string;
  client_websocket_url: string | null;
  incoming_call_webhook_url: string | null;
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

export interface RawTextMessage {
  id: string;
  direction: string;
  local_phone_number: string;
  remote_phone_number: string;
  text: string | null;
  type: string;
  media: RawTextMediaItem[] | null;
  status: string;
  is_read: boolean;
  created_at: string;
  updated_at: string;
}

export interface RawTextConversationSummary {
  remote_phone_number: string;
  latest_text: string | null;
  latest_direction: string;
  latest_type: string;
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
    incomingCallAction: r.incoming_call_action,
    clientWebsocketUrl: r.client_websocket_url,
    incomingCallWebhookUrl: r.incoming_call_webhook_url,
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

export function parseTextMessage(r: RawTextMessage): TextMessage {
  return {
    id: r.id,
    direction: r.direction,
    localPhoneNumber: r.local_phone_number,
    remotePhoneNumber: r.remote_phone_number,
    text: r.text,
    type: r.type,
    media: r.media ? r.media.map(parseTextMediaItem) : null,
    status: r.status,
    isRead: r.is_read,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseTextConversationSummary(
  r: RawTextConversationSummary,
): TextConversationSummary {
  return {
    remotePhoneNumber: r.remote_phone_number,
    latestText: r.latest_text,
    latestDirection: r.latest_direction,
    latestType: r.latest_type,
    latestMessageAt: new Date(r.latest_message_at),
    unreadCount: r.unread_count,
    totalCount: r.total_count,
  };
}

