/**
 * Receiver-side webhook payload types.
 *
 * Wire-shape only: every field is snake_case so
 * `JSON.parse(body) as MailWebhookPayload` round-trips without a
 * transformer. Enum-valued fields use string-literal unions (e.g.
 * `"inbound" | "outbound"`) rather than the SDK's TS `enum` exports,
 * since `JSON.parse` produces bare strings.
 */

import type { RawRateLimitInfo, RawTextMediaItem } from "../phone/types.js";

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

export type CallDirectionWire = "outbound" | "inbound";

export type CallStatusWire =
  | "initiated"
  | "ringing"
  | "answered"
  | "completed"
  | "failed"
  | "canceled";

export type HangupReasonWire =
  | "local"
  | "remote"
  | "max_duration"
  | "voicemail"
  | "rejected";

// ---- Shared ----------------------------------------------------------

/**
 * Address-book match for the single remote party on a phone or text
 * webhook event. Optional — `null` means no contact visible to the
 * receiving identity. Pass `id` to `inkbox.contacts.get()` to hydrate.
 */
export interface WebhookContact {
  id: string;
  name: string;
}

// ---- Mail ------------------------------------------------------------

export type MailWebhookEventType =
  | "message.received"
  | "message.sent"
  | "message.forwarded"
  | "message.delivered"
  | "message.bounced"
  | "message.failed";

/** Which recipient list a mail webhook contact was matched from. */
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
  direction: MessageDirectionWire;
  status: MessageStatus;
  has_attachments: boolean;
  /** ISO 8601 datetime. */
  created_at: string | null;
}

export interface MailWebhookPayload {
  event_type: MailWebhookEventType;
  /** ISO 8601 datetime. */
  timestamp: string;
  data: {
    message: MailWebhookMessage;
    /**
     * Per-recipient matches. Always present, possibly empty. Wire
     * order is `from` → `to` → `cc` → `bcc`, then within each bucket
     * by source-field order; receivers should pair by
     * `(bucket, address)` rather than relying on the order. Up to 50
     * distinct normalized addresses are resolved per event; over-cap
     * inputs and resolver failures both fall back to an empty list.
     */
    contacts: WebhookMailContact[];
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
 * Per-recipient lifecycle state inside an outbound group MMS message.
 */
export interface WebhookRecipientStatus {
  phone_number: string;
  delivery_status: SmsDeliveryStatusWire | null;
  carrier: string | null;
  line_type: string | null;
  error_code: string | null;
  error_detail: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
}

/**
 * Stored text message. `is_blocked` is not part of the wire body —
 * blocked texts never reach the webhook.
 *
 * Group MMS messages set `group_id` and (depending on direction)
 * `recipients_status` (outbound) or `cc_phone_numbers` (inbound). On
 * outbound group rows `remote_phone_number` is `null`; on inbound
 * group rows it carries the sender so receivers can attribute replies.
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
  group_id: string | null;
  recipients_status: WebhookRecipientStatus[] | null;
  cc_phone_numbers: string[] | null;
  delivery_status: SmsDeliveryStatusWire | null;
  origin: TextMessageOriginWire;
  error_code: string | null;
  error_detail: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TextWebhookPayload {
  event_type: TextWebhookEventType;
  timestamp: string;
  data: {
    text_message: TextWebhookMessage;
    contact: WebhookContact | null;
    /**
     * Set only on outbound *group* lifecycle events to name the
     * specific recipient this event is about. `null` on 1:1 events
     * and on `text.received`.
     */
    recipient_phone_number: string | null;
  };
}

// ---- Inbound call (FLAT — no envelope) ------------------------------

/**
 * Inbound call payload. **Flat** — no `{ event_type, timestamp, data }`
 * envelope; `contact` sits at the top level. `is_blocked` is not part
 * of the wire body — blocked calls never reach the webhook.
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
  contact: WebhookContact | null;
}
