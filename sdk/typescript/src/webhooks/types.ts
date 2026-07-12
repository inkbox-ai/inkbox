/**
 * Receiver-side webhook payload types.
 *
 * Wire-shape only: every field is snake_case so
 * `JSON.parse(body) as MailWebhookPayload` round-trips without a
 * transformer. Enum-valued fields use string-literal unions (e.g.
 * `"inbound" | "outbound"`) rather than the SDK's TS `enum` exports,
 * since `JSON.parse` produces bare strings.
 */

import type {
  RawRateLimitInfo,
  RawTextMediaItem,
  RawTextMessageRecipient,
} from "../phone/types.js";

// ---- Wire union types ------------------------------------------------

export type MessageDirectionWire = "inbound" | "outbound";

export type MessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "bounced"
  | "failed"
  | "received"
  | "deleted";

export type TextDirectionWire = "inbound" | "outbound";

export type TextTypeWire = "sms" | "mms";

export type SmsDeliveryStatusWire =
  | "queued"
  | "sent"
  | "delivered"
  | "delivery_failed"
  | "delivery_unconfirmed"
  | "sending_failed";

export type TextMessageOriginWire = "user_initiated" | "auto_reply";

export type CallOriginWire = "dedicated_number" | "shared_imessage_number";

export type CallDirectionWire = "outbound" | "inbound";

export type CallStatusWire =
  | "initiated"
  | "ringing"
  | "answered"
  | "completed"
  | "failed"
  | "canceled";

export type CallModeWire = "client_websocket" | "hosted_agent";

export type CallOutcomeWire = "completed" | "no_answer" | "declined" | "failed";

export type HangupReasonWire =
  | "local"
  | "remote"
  | "max_duration"
  | "voicemail"
  | "rejected";

// ---- Shared ----------------------------------------------------------

/**
 * Address-book match for a remote party on a phone or text webhook
 * event. Surfaced as a list — pass `id` to `inkbox.contacts.get()` to
 * hydrate.
 */
export interface WebhookContact {
  id: string;
  name: string;
}

/**
 * Identity match for a remote party on a phone or text webhook event.
 * Set when the remote party is an active agent identity in the same
 * org that is visible to the receiver.
 */
export interface WebhookAgentIdentity {
  id: string;
  agent_handle: string;
  display_name: string | null;
}

// ---- Conversation context --------------------------------------------

export type WebhookContextScopeWire = "thread" | "conversation" | "contact";
export type WebhookContextModeWire = "count" | "window";
export type WebhookContextSkipReasonWire =
  | "no_contact"
  | "no_resource"
  | "unavailable";
export type WebhookContextTextChannelWire = "sms" | "imessage";

/** Media metadata for a context text item: a count only, never URLs. */
export interface WebhookContextTextMedia {
  count: number;
}

/**
 * Slim mail context item: metadata + snippet only; bodies are omitted.
 *
 * Item-level nullable fields are present-with-`null` on the wire (not
 * omitted), so `subject`/`snippet` are required keys typed `string | null`
 * — narrow with `=== null`, not `!== undefined`.
 */
export interface WebhookContextMailItem {
  id: string;
  direction: string;
  from_address: string;
  to_addresses: string[];
  created_at: string;
  subject: string | null;
  snippet: string | null;
  /**
   * Owning mailbox address; with `id`, fetch the full body via
   * `messages.get(email_address, id)`. Optional: payloads predating the
   * feature omit it.
   */
  email_address?: string | null;
}

/**
 * One merged texts-class item (SMS or iMessage); `media` is metadata only
 * (`{ count }`), never URLs. Nullable fields are present-with-`null`.
 */
export interface WebhookContextTextItem {
  id: string;
  channel: WebhookContextTextChannelWire;
  direction: string;
  text: string;
  text_truncated: boolean;
  created_at: string;
  sender: string | null;
  status: string | null;
  media: WebhookContextTextMedia | null;
}

/**
 * One transcript entry: a turn or the abridgment marker. Optional fields are
 * omitted when unset — discriminate on `"marker" in entry`. A turn has
 * `party`/`text`/`ts_ms` (plus `truncated` when char-cut); the marker has
 * `marker`/`omitted_turns`/`omitted_ms`.
 */
export interface WebhookTranscriptEntry {
  party?: string;
  text?: string;
  ts_ms?: number;
  truncated?: boolean;
  marker?: "abridged";
  omitted_turns?: number;
  omitted_ms?: number;
}

/**
 * One calls-class item: metadata plus its (possibly abridged) transcript.
 *
 * `remote_number` is the far-end number; `duration` is the call length in
 * whole seconds. Nullable fields are present-with-`null` on the wire.
 */
export interface WebhookContextCallItem {
  call_id: string;
  abridged: boolean;
  transcript: WebhookTranscriptEntry[];
  direction: string | null;
  remote_number: string | null;
  duration: number | null;
  started_at: string | null;
}

/**
 * One delivered context class under `data.context`. Block-level optional
 * fields (`mode`/`requested`/`hours`/`skipped`) are absent (not null) when
 * unset — item-level nullable fields, by contrast, are present-with-`null`
 * (see the item types). `items` is chronological oldest-first and excludes
 * the trigger; a skipped class ships `items: []` plus `skipped`.
 */
export interface WebhookContextBlock {
  scope: WebhookContextScopeWire;
  items: Array<
    WebhookContextMailItem | WebhookContextTextItem | WebhookContextCallItem
  >;
  truncated: boolean;
  mode?: WebhookContextModeWire;
  requested?: number;
  hours?: number;
  skipped?: WebhookContextSkipReasonWire;
}

/**
 * `data.context` value — only configured classes appear. Present only on
 * received events whose subscription opted in via `contextConfig`. Capped at
 * 256 KB; over-cap classes drop oldest items and set `truncated: true`.
 */
export interface WebhookContext {
  email?: WebhookContextBlock;
  texts?: WebhookContextBlock;
  calls?: WebhookContextBlock;
}

// ---- Mail ------------------------------------------------------------

export type MailWebhookEventType =
  | "message.received"
  | "message.sent"
  | "message.forwarded"
  | "message.delivered"
  | "message.bounced"
  | "message.failed";

/** Which recipient list a mail webhook contact/identity was matched from. */
export type MailContactBucket = "from" | "to" | "cc" | "bcc";

/**
 * Per-recipient address-book match on a mail webhook event.
 *
 * Mail events resolve every relevant recipient (inbound: sender + CC;
 * outbound: every To + CC + BCC) and surface each match as its own
 * entry. Pair to the source field by `(bucket, address)`, not by
 * `address` alone — the same address may appear in multiple buckets on
 * a single send, producing one entry per bucket. `address` echoes the
 * original wire-form casing on `data.message.{from,to,cc,bcc}_addresses`,
 * so naive `===` against that bucket array works for messages your
 * platform sent. The list is sparse: only matched recipients appear.
 */
export interface WebhookMailContact {
  bucket: MailContactBucket;
  address: string;
  id: string;
  name: string;
}

/**
 * Per-recipient identity match on a mail webhook event. Same shape as
 * `WebhookMailContact` but with `agent_handle` / `display_name`
 * instead of `name`.
 */
export interface WebhookMailAgentIdentity {
  bucket: MailContactBucket;
  address: string;
  id: string;
  agent_handle: string;
  display_name: string | null;
}

/**
 * Stored mail message. `message_id` is the RFC 5322 `Message-ID`
 * header value (not Inkbox's row id — that's `id`). `bcc_addresses` is
 * only populated on outbound events; inbound payloads carry `null`
 * (BCC is not visible to recipients).
 */
export interface MailWebhookMessage {
  id: string;
  mailbox_id: string;
  thread_id: string | null;
  message_id: string | null;
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[] | null;
  bcc_addresses: string[] | null;
  subject: string | null;
  snippet: string | null;
  /**
   * Owning mailbox address; with `id`, fetch the full body via
   * `messages.get(email_address, id)`. Optional: payloads predating the
   * body feature omit it.
   */
  email_address?: string | null;
  /**
   * Plain-text body on inbound `message.received` only; present-with-`null`
   * on other events. Whole under the size cap, else a prefix — see
   * `body_state`/`body_truncated`. Optional: absent on pre-feature payloads.
   */
  body?: string | null;
  body_state?: "complete" | "truncated" | "unavailable" | null;
  /** `true` when `body` is a prefix; fetch the rest by `id`. */
  body_truncated?: boolean | null;
  body_total_chars?: number | null;
  body_included_chars?: number | null;
  direction: MessageDirectionWire;
  status: MessageStatus;
  has_attachments: boolean;
  /** ISO 8601 datetime. */
  created_at: string | null;
}

export interface MailWebhookPayload {
  /** Stable per-event id (`evt_...`); idempotency key, stable across replays. */
  id: string;
  event_type: MailWebhookEventType;
  /** ISO 8601 datetime. */
  timestamp: string;
  data: {
    message: MailWebhookMessage;
    /**
     * Per-recipient address-book matches. Always present, possibly
     * empty. Wire order is `from` → `to` → `cc` → `bcc`, then within
     * each bucket by source-field order; receivers should pair by
     * `(bucket, address)` rather than relying on the order. Up to 50
     * distinct normalized addresses are resolved per event; over-cap
     * inputs and resolver failures both fall back to an empty list.
     */
    contacts: WebhookMailContact[];
    /**
     * Per-recipient identity matches. Always present, possibly empty.
     * Same matching rules as `contacts`. A peer can match both a
     * contact and an agent identity — two rows are emitted; receivers
     * decide precedence.
     */
    agent_identities: WebhookMailAgentIdentity[];
    /** Conversation context; present only when the subscription configured `contextConfig`. */
    /**
     * Present only on the channel's `*.received` event, and only when the
     * subscription opted into it via `contextConfig`. Absent on
     * sent/delivery-status/reaction events even though this shared data
     * type permits the key.
     */
    context?: WebhookContext;
  };
}

// ---- Text -----------------------------------------------------------

export type TextWebhookEventType =
  | "text.received"
  | "text.sent"
  | "text.delivered"
  | "text.delivery_failed"
  | "text.delivery_unconfirmed";

/**
 * Stored text message. `is_blocked` is not part of the wire body —
 * blocked texts never reach the webhook.
 *
 * Field population by traffic shape:
 *   - `remote_phone_number`: populated on inbound and on outbound 1:1;
 *     `null` on group outbound (per-recipient state lives in
 *     `recipients[]`).
 *   - `delivery_status`: populated on outbound. On group outbound this
 *     is the message-level rollup across `recipients[]`; on inbound it
 *     is `null`.
 *   - Legacy top-level lifecycle details (`error_code`, `error_detail`,
 *     `sent_at`, `delivered_at`, `failed_at`): populated only on
 *     outbound 1:1. On group outbound the per-recipient values live in
 *     `recipients[]`; on inbound there is no carrier lifecycle to track,
 *     so all five are `null`.
 */
export interface TextWebhookMessage {
  id: string;
  direction: TextDirectionWire;
  local_phone_number: string;
  remote_phone_number: string | null;
  text: string | null;
  type: TextTypeWire;
  media: RawTextMediaItem[] | null;
  is_read: boolean;
  delivery_status: SmsDeliveryStatusWire | null;
  origin: TextMessageOriginWire;
  error_code: string | null;
  error_detail: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  conversation_id: string | null;
  sender_phone_number: string | null;
  /**
   * `null` on inbound (and rows that didn't eager-load recipients);
   * a one-element list on outbound 1:1 (the legacy 1:1 lifecycle
   * fields above are hoisted from that entry); multiple entries on
   * group outbound.
   */
  recipients: RawTextMessageRecipient[] | null;
  created_at: string;
  updated_at: string;
}

export interface TextWebhookPayload {
  /** Stable per-event id (`evt_...`); idempotency key, stable across replays. */
  id: string;
  event_type: TextWebhookEventType;
  timestamp: string;
  data: {
    text_message: TextWebhookMessage;
    /** Address-book matches for the remote party (or parties). Always present, possibly empty. */
    contacts: WebhookContact[];
    /** Identity matches for the remote party (or parties). Always present, possibly empty. */
    agent_identities: WebhookAgentIdentity[];
    /**
     * For outbound group lifecycle events, the specific recipient this
     * event is about. `null` on inbound and on 1:1 outbound (where
     * `text_message.remote_phone_number` already identifies the
     * recipient).
     */
    recipient_phone_number: string | null;
    /** Conversation context; present only when the subscription configured `contextConfig`. */
    /**
     * Present only on the channel's `*.received` event, and only when the
     * subscription opted into it via `contextConfig`. Absent on
     * sent/delivery-status/reaction events even though this shared data
     * type permits the key.
     */
    context?: WebhookContext;
  };
}

// ---- iMessage ---------------------------------------------------------

export type IMessageWebhookEventType =
  | "imessage.received"
  | "imessage.reaction_received"
  | "imessage.sent"
  | "imessage.delivered"
  | "imessage.delivery_failed";

export type IMessageDirectionWire = "inbound" | "outbound";

export type IMessageServiceWire = "imessage" | "sms" | "rcs";

export type IMessageTypeWire = "message" | "carousel";

export type IMessageDeliveryStatusWire =
  | "registered"
  | "pending"
  | "queued"
  | "accepted"
  | "sent"
  | "delivered"
  | "declined"
  | "error"
  | "received";

export type IMessageReactionTypeWire =
  | "love"
  | "like"
  | "dislike"
  | "laugh"
  | "emphasize"
  | "question"
  | "custom";

export type IMessageSendStyleWire =
  | "celebration"
  | "shooting_star"
  | "fireworks"
  | "lasers"
  | "love"
  | "confetti"
  | "balloons"
  | "spotlight"
  | "echo"
  | "invisible"
  | "gentle"
  | "loud"
  | "slam";

/** iMessage media attachment (snake_case wire shape). */
export interface IMessageMediaItemWire {
  content_type: string | null;
  size: number | null;
  url: string;
}

/** Per-recipient outbound iMessage delivery state. */
export interface IMessageRecipientWire {
  remote_number: string;
  delivery_status: IMessageDeliveryStatusWire | null;
  service: IMessageServiceWire | null;
  error_code: string | null;
  error_message: string | null;
  error_reason: string | null;
  error_detail: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
}

/** A live tapback attached to a message (snake_case wire shape). */
export interface IMessageMessageReactionWire {
  id: string;
  direction: IMessageDirectionWire;
  reaction: IMessageReactionTypeWire;
  custom_emoji: string | null;
  remote_number: string;
  part_index: number;
  created_at: string;
}

/**
 * Stored iMessage. `is_blocked` is not part of the wire body — blocked
 * messages never reach the webhook. There is no local-number field:
 * shared pool lines are hidden from agents, so the message is
 * identified by `conversation_id` and the counterparty `remote_number`
 * only.
 */
export interface IMessageWebhookMessage {
  id: string;
  conversation_id: string;
  assignment_id: string;
  direction: IMessageDirectionWire;
  remote_number: string;
  content: string | null;
  message_type: IMessageTypeWire;
  service: IMessageServiceWire;
  send_style: IMessageSendStyleWire | null;
  media: IMessageMediaItemWire[] | null;
  was_downgraded: boolean | null;
  status: IMessageDeliveryStatusWire | null;
  error_code: string | null;
  error_message: string | null;
  error_reason: string | null;
  error_detail: string | null;
  is_read: boolean;
  recipients: IMessageRecipientWire[] | null;
  reactions: IMessageMessageReactionWire[] | null;
  created_at: string;
  updated_at: string;
}

/**
 * A tapback reaction on an iMessage (snake_case wire shape).
 * `custom_emoji` carries the literal emoji when `reaction` is
 * `"custom"`; `null` for the classic six.
 */
export interface IMessageWebhookReaction {
  id: string;
  conversation_id: string;
  assignment_id: string;
  target_message_id: string;
  direction: IMessageDirectionWire;
  reaction: IMessageReactionTypeWire;
  custom_emoji: string | null;
  remote_number: string;
  part_index: number;
  created_at: string;
  updated_at: string;
}

export interface IMessageWebhookPayload {
  /** Stable per-event id (`evt_...`); idempotency key, stable across replays. */
  id: string;
  event_type: IMessageWebhookEventType;
  /** ISO 8601 datetime. */
  timestamp: string;
  data: {
    /** Populated on `imessage.received` and the delivery-lifecycle events
     * (`imessage.sent` / `imessage.delivered` / `imessage.delivery_failed`);
     * `null` on reaction events. */
    message: IMessageWebhookMessage | null;
    /** Populated on `imessage.reaction_received`; `null` on message events. */
    reaction: IMessageWebhookReaction | null;
    /** Address-book matches for the remote party. Always present, possibly empty. */
    contacts: WebhookContact[];
    /** Identity matches for the remote party. Always present, possibly empty. */
    agent_identities: WebhookAgentIdentity[];
    /** Conversation context; present only when the subscription configured `contextConfig`. */
    /**
     * Present only on the channel's `*.received` event, and only when the
     * subscription opted into it via `contextConfig`. Absent on
     * sent/delivery-status/reaction events even though this shared data
     * type permits the key.
     */
    context?: WebhookContext;
  };
}

// ---- Inbound call (FLAT — no envelope) ------------------------------

/**
 * Inbound call payload. **Flat** — no `{ event_type, timestamp, data }`
 * envelope; `contacts` / `agent_identities` sit at the top level.
 * `is_blocked` is not part of the wire body — blocked calls never
 * reach the webhook.
 */
export interface PhoneIncomingCallWebhookPayload {
  id: string;
  local_phone_number: string;
  remote_phone_number: string;
  direction: "inbound";
  status: CallStatusWire;
  client_websocket_url: string | null;
  use_inkbox_tts: boolean | null;
  use_inkbox_stt: boolean | null;
  hangup_reason: HangupReasonWire | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  rate_limit: RawRateLimitInfo | null;
  /** Address-book matches for the remote party. Always present, possibly empty. */
  contacts: WebhookContact[];
  /** Identity matches for the remote party. Always present, possibly empty. */
  agent_identities: WebhookAgentIdentity[];
}

// ---- Call lifecycle (post-call fan-out) ------------------------------

/**
 * Post-call lifecycle event types, delivered to an agent-identity-owned
 * `call.ended` subscription. Fire-and-forget and replayable (unlike the
 * synchronous `phone.incoming_call` control-plane callback).
 */
export type CallLifecycleWebhookEventType = "call.ended";

/**
 * Stored phone call embedded in a call-lifecycle webhook payload.
 *
 * Mirrors `PhoneCallResponse` minus `is_blocked` (blocked calls never reach
 * the webhook). `local_phone_number` is `null` and `origin` is
 * `"shared_imessage_number"` on shared-line calls (the pool line is never
 * surfaced). `duration_seconds` is the connected length in whole seconds, or
 * `null` when the call never connected. `mode` says who drove the call and
 * `reason` carries the outbound hosted-call brief (`null` inbound and on
 * `client_websocket` calls); both are optional only so payloads predating
 * hosted calls still parse.
 */
export interface WebhookPhoneCall {
  id: string;
  origin: CallOriginWire;
  local_phone_number: string | null;
  remote_phone_number: string;
  direction: CallDirectionWire;
  status: CallStatusWire;
  hangup_reason: HangupReasonWire | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  duration_seconds: number | null;
  mode?: CallModeWire;
  reason?: string | null;
}

/**
 * Inline transcript block on a `call.ended` payload. Present when the
 * platform captured a transcript for the call. `entries` reuses the shared
 * middle-cut `WebhookTranscriptEntry` shape — discriminate a turn from the
 * abridgment marker on `"marker" in entry`. `abridged` is `true` when the
 * middle was cut. `url` points at the authoritative verbatim transcript
 * (same value as `transcript_url` on the data wrapper).
 */
export interface WebhookCallTranscript {
  entries: WebhookTranscriptEntry[];
  abridged: boolean;
  url: string;
}

/**
 * One open action item Inkbox Voice AI recorded during the call.
 *
 * Rides `call.ended` in `seq` order, mirroring the inline
 * `PhoneCall.postCallActionItems`. Canceled items are omitted, so `status`
 * here is always `"open"`.
 */
export interface WebhookPostCallActionItem {
  id: string;
  seq: number;
  action: string;
  details: string | null;
  status: string;
}

/** Wrapper object under the `call.ended` webhook `data` field. */
export interface CallEndedWebhookData {
  call: WebhookPhoneCall;
  /** Address-book matches for the caller. Always present, possibly empty. */
  contacts: WebhookContact[];
  /** Identity matches for the caller. Always present, possibly empty. */
  agent_identities: WebhookAgentIdentity[];
  /**
   * Inline (possibly abridged) transcript. Present-with-`null`: populated
   * only when the platform captured a transcript for the call, otherwise
   * `null`.
   */
  transcript: WebhookCallTranscript | null;
  /**
   * Always present; the authoritative verbatim transcript resource (fetch
   * with an API key that can access the call — the subscription
   * owner's own key suffices).
   */
  transcript_url: string;
  /**
   * The hosted call's terminal result; `null` iff `data.call.mode` is
   * `client_websocket`. Optional only so payloads predating hosted calls
   * still parse.
   */
  outcome?: CallOutcomeWire | null;
  /**
   * Voice AI's recorded todo list, `seq`-ascending. Always present
   * on new payloads (empty for non-hosted calls / no todos); optional only
   * so payloads predating hosted calls still parse.
   */
  post_call_action_items?: WebhookPostCallActionItem[];
}

/**
 * Top-level `call.ended` webhook payload (`{ event_type, timestamp, data }`
 * envelope).
 */
export interface CallEndedWebhookPayload {
  /** Stable per-event id (`evt_...`); idempotency key, stable across replays. */
  id: string;
  event_type: CallLifecycleWebhookEventType;
  /** ISO 8601 datetime. */
  timestamp: string;
  data: CallEndedWebhookData;
}
