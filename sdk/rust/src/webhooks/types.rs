//! Receiver-side webhook payload types.
//!
//! Wire-shape only: every field is snake_case so a payload deserializes
//! straight off `serde_json` without a transformer. Enum-valued fields are
//! string enums whose `#[serde(rename = ...)]` values match the Python
//! `Literal[...]` unions in `inkbox/webhooks.py` exactly.

use serde::{Deserialize, Serialize};

// ---- Wire union types ----------------------------------------------------

/// Direction of a mail message on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageDirectionWire {
    Inbound,
    Outbound,
}

/// Lifecycle status of a mail message on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageStatus {
    Queued,
    Sent,
    Delivered,
    Bounced,
    Failed,
    Received,
    Deleted,
}

/// Direction of a text message on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextDirectionWire {
    Inbound,
    Outbound,
}

/// Whether a text is an SMS or MMS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextTypeWire {
    Sms,
    Mms,
}

/// Carrier delivery status of an outbound SMS/MMS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SmsDeliveryStatusWire {
    Queued,
    Sent,
    Delivered,
    DeliveryFailed,
    DeliveryUnconfirmed,
    SendingFailed,
}

/// Whether a text was user-initiated or an automatic reply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextMessageOriginWire {
    UserInitiated,
    AutoReply,
}

/// Direction of a phone call on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallDirectionWire {
    Outbound,
    Inbound,
}

/// Lifecycle status of a phone call on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallStatusWire {
    Initiated,
    Ringing,
    Answered,
    Completed,
    Failed,
    Canceled,
}

/// Why a call ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HangupReasonWire {
    Local,
    Remote,
    MaxDuration,
    Voicemail,
    Rejected,
}

/// Where a call originated: the identity's dedicated number or the shared
/// iMessage line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallOriginWire {
    DedicatedNumber,
    SharedImessageNumber,
}

// ---- Nested wire shapes --------------------------------------------------

/// MMS media attachment (snake_case wire shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextMediaItemWire {
    pub content_type: String,
    pub size: i64,
    pub url: String,
}

/// Per-recipient outbound SMS/MMS delivery state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextMessageRecipientWire {
    pub recipient_phone_number: String,
    pub delivery_status: Option<SmsDeliveryStatusWire>,
    pub carrier: Option<String>,
    pub line_type: Option<String>,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    pub sent_at: Option<String>,
    pub delivered_at: Option<String>,
    pub failed_at: Option<String>,
}

/// Org rate-limit snapshot on inbound-call payloads.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitInfoWire {
    pub calls_used: i64,
    pub calls_remaining: i64,
    pub calls_limit: i64,
    pub minutes_used: f64,
    pub minutes_remaining: f64,
    pub minutes_limit: i64,
}

// ---- Shared --------------------------------------------------------------

/// Address-book match for a remote party on a phone or text webhook event.
///
/// Surfaced as a list -- pass `id` to `inkbox.contacts.get()` to hydrate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookContact {
    pub id: String,
    pub name: String,
}

/// Identity match for a remote party on a phone or text webhook event.
///
/// Set when the remote party is an active agent identity in the same org
/// that is visible to the receiver.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookAgentIdentity {
    pub id: String,
    pub agent_handle: String,
    pub display_name: Option<String>,
}

// ---- Conversation context ------------------------------------------------

/// Which conversation grain a context class was resolved over.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebhookContextScopeWire {
    Thread,
    Conversation,
    Contact,
}

/// How a context class was bounded: last-N items or a time window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebhookContextModeWire {
    Count,
    Window,
}

/// Why a configured context class shipped empty.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebhookContextSkipReasonWire {
    NoContact,
    NoResource,
    Unavailable,
}

/// Channel a merged texts-class context item came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebhookContextTextChannelWire {
    Sms,
    Imessage,
}

/// Slim mail context item: metadata + snippet only; bodies are omitted.
///
/// Item-level nullable fields (`subject`/`snippet`) are present-with-`null` on
/// the wire, not omitted; `Option` deserializes either form.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookContextMailItem {
    pub id: String,
    pub direction: String,
    pub from_address: String,
    pub to_addresses: Vec<String>,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}

/// One merged texts-class context item (SMS or iMessage).
///
/// `media` is metadata only (`{"count": N}`), never URLs; kept as a free JSON
/// object. Item-level nullable fields are present-with-`null` on the wire.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookContextTextItem {
    pub id: String,
    pub channel: WebhookContextTextChannelWire,
    pub direction: String,
    pub text: String,
    pub text_truncated: bool,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sender: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<serde_json::Value>,
}

/// One transcript entry: a turn or the abridgment marker.
///
/// Every field is optional; the server omits unset keys. A turn carries
/// `party`/`text`/`ts_ms` (plus `truncated` when char-cut); the abridgment
/// marker carries `marker`/`omitted_turns`/`omitted_ms`. Discriminate on the
/// presence of `marker`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookTranscriptEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub party: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ts_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marker: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub omitted_turns: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub omitted_ms: Option<i64>,
}

/// One calls-class item: metadata plus its (possibly abridged) transcript.
///
/// `remote_number` is the far-end number; `duration` is the call length in
/// whole seconds. Item-level nullable fields are present-with-`null` on the
/// wire.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookContextCallItem {
    pub call_id: String,
    pub abridged: bool,
    pub transcript: Vec<WebhookTranscriptEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_number: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
}

/// A single item in a context block. Untagged: the wire shape has no
/// discriminator, so receivers (and serde) discriminate on field presence —
/// mail carries `from_address`, texts carry `channel`, calls carry `call_id`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WebhookContextItem {
    Mail(WebhookContextMailItem),
    Text(WebhookContextTextItem),
    Call(WebhookContextCallItem),
}

/// One delivered context class under `data.context`.
///
/// Block-level optional fields (`mode`/`requested`/`hours`/`skipped`) are
/// absent (not null) when unset — this differs from item-level nullable fields,
/// which are present-with-`null`. `items` is chronological oldest-first and
/// excludes the trigger; a skipped class ships `items: []` plus `skipped`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookContextBlock {
    pub scope: WebhookContextScopeWire,
    pub items: Vec<WebhookContextItem>,
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<WebhookContextModeWire>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hours: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skipped: Option<WebhookContextSkipReasonWire>,
}

/// `data.context` value — only configured classes appear.
///
/// Present only on received events whose subscription opted in via
/// `context_config`. Capped at 256 KB; over-cap classes drop oldest items and
/// set `truncated: true`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<WebhookContextBlock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub texts: Option<WebhookContextBlock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calls: Option<WebhookContextBlock>,
}

// ---- Mail ----------------------------------------------------------------

/// Mail webhook event-type discriminator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MailWebhookEventType {
    #[serde(rename = "message.received")]
    MessageReceived,
    #[serde(rename = "message.sent")]
    MessageSent,
    #[serde(rename = "message.forwarded")]
    MessageForwarded,
    #[serde(rename = "message.delivered")]
    MessageDelivered,
    #[serde(rename = "message.bounced")]
    MessageBounced,
    #[serde(rename = "message.failed")]
    MessageFailed,
}

/// Which recipient list a mail webhook contact/identity was matched from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MailContactBucket {
    From,
    To,
    Cc,
    Bcc,
}

/// Per-recipient address-book match on a mail webhook event.
///
/// Mail events resolve every relevant recipient (inbound: sender + CC;
/// outbound: every To + CC + BCC) and surface each match as its own entry.
/// Pair to the source field by `(bucket, address)`, not by `address` alone --
/// the same address may appear in multiple buckets on a single send, producing
/// one entry per bucket. The list is sparse: only matched recipients appear.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookMailContact {
    pub bucket: MailContactBucket,
    pub address: String,
    pub id: String,
    pub name: String,
}

/// Per-recipient identity match on a mail webhook event. Same shape as
/// [`WebhookMailContact`] but with `agent_handle` / `display_name` instead of
/// `name`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookMailAgentIdentity {
    pub bucket: MailContactBucket,
    pub address: String,
    pub id: String,
    pub agent_handle: String,
    pub display_name: Option<String>,
}

/// Stored mail message. `message_id` is the RFC 5322 `Message-ID` header value
/// (not Inkbox's row id -- that's `id`). `bcc_addresses` is only populated on
/// outbound events; inbound payloads carry `None` (BCC is not visible to
/// recipients).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailWebhookMessage {
    pub id: String,
    pub mailbox_id: String,
    pub thread_id: Option<String>,
    pub message_id: Option<String>,
    pub from_address: String,
    pub to_addresses: Vec<String>,
    pub cc_addresses: Option<Vec<String>>,
    pub bcc_addresses: Option<Vec<String>>,
    pub subject: Option<String>,
    pub snippet: Option<String>,
    pub direction: MessageDirectionWire,
    pub status: MessageStatus,
    pub has_attachments: bool,
    pub created_at: Option<String>,
}

/// Wrapper under `MailWebhookPayload.data`.
///
/// `contacts` and `agent_identities` are both always present, possibly empty.
/// Wire order is `from` -> `to` -> `cc` -> `bcc`, then within each bucket by
/// source-field order; receivers should pair by `(bucket, address)` rather
/// than relying on the order. A peer can match both a contact and an agent
/// identity -- two rows are emitted; receivers decide precedence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailWebhookData {
    pub message: MailWebhookMessage,
    pub contacts: Vec<WebhookMailContact>,
    pub agent_identities: Vec<WebhookMailAgentIdentity>,
    // Present only on the channel's `*.received` event, and only when the
    // subscription opted in via `context_config`. Absent on sent /
    // delivery-status events even though this shared type permits the key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<WebhookContext>,
}

/// Top-level mail webhook payload (`{event_type, timestamp, data}` envelope).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailWebhookPayload {
    /// Stable per-event id (`evt_...`); idempotency key, stable across replays.
    // `serde(default)` so payloads that predate this field (older or
    // mixed-deployment servers, recorded fixtures) still deserialize instead of
    // hard-failing on a missing field; an absent id parses to "".
    #[serde(default)]
    pub id: String,
    pub event_type: MailWebhookEventType,
    pub timestamp: String,
    pub data: MailWebhookData,
}

// ---- Text ----------------------------------------------------------------

/// Phone-text webhook event-type discriminator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TextWebhookEventType {
    #[serde(rename = "text.received")]
    TextReceived,
    #[serde(rename = "text.sent")]
    TextSent,
    #[serde(rename = "text.delivered")]
    TextDelivered,
    #[serde(rename = "text.delivery_failed")]
    TextDeliveryFailed,
    #[serde(rename = "text.delivery_unconfirmed")]
    TextDeliveryUnconfirmed,
}

/// Stored text message. `is_blocked` is not part of the wire body -- blocked
/// texts never reach the webhook.
///
/// Field population by traffic shape:
///   * `remote_phone_number`: populated on inbound and on outbound 1:1; `None`
///     on group outbound (per-recipient state lives in `recipients`).
///   * `delivery_status`: populated on outbound. On group outbound this is the
///     message-level rollup across `recipients`; on inbound it is `None`.
///   * Legacy top-level lifecycle details (`error_code`, `error_detail`,
///     `sent_at`, `delivered_at`, `failed_at`): populated only on outbound 1:1.
///     On group outbound the per-recipient values live in `recipients`; on
///     inbound all five are `None`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextWebhookMessage {
    pub id: String,
    pub direction: TextDirectionWire,
    pub local_phone_number: String,
    pub remote_phone_number: Option<String>,
    pub text: Option<String>,
    #[serde(rename = "type")]
    pub type_: TextTypeWire,
    pub media: Option<Vec<TextMediaItemWire>>,
    pub is_read: bool,
    pub delivery_status: Option<SmsDeliveryStatusWire>,
    pub origin: TextMessageOriginWire,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    pub sent_at: Option<String>,
    pub delivered_at: Option<String>,
    pub failed_at: Option<String>,
    pub conversation_id: Option<String>,
    pub sender_phone_number: Option<String>,
    pub recipients: Option<Vec<TextMessageRecipientWire>>,
    pub created_at: String,
    pub updated_at: String,
}

/// Wrapper under `TextWebhookPayload.data`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextWebhookData {
    pub text_message: TextWebhookMessage,
    pub contacts: Vec<WebhookContact>,
    pub agent_identities: Vec<WebhookAgentIdentity>,
    pub recipient_phone_number: Option<String>,
    // Present only on the channel's `*.received` event, and only when the
    // subscription opted in via `context_config`. Absent on sent /
    // delivery-status events even though this shared type permits the key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<WebhookContext>,
}

/// Top-level phone-text webhook payload (`{event_type, timestamp, data}`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextWebhookPayload {
    /// Stable per-event id (`evt_...`); idempotency key, stable across replays.
    // `serde(default)` so payloads that predate this field (older or
    // mixed-deployment servers, recorded fixtures) still deserialize instead of
    // hard-failing on a missing field; an absent id parses to "".
    #[serde(default)]
    pub id: String,
    pub event_type: TextWebhookEventType,
    pub timestamp: String,
    pub data: TextWebhookData,
}

// ---- iMessage ------------------------------------------------------------

/// iMessage webhook event-type discriminator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IMessageWebhookEventType {
    #[serde(rename = "imessage.received")]
    Received,
    #[serde(rename = "imessage.reaction_received")]
    ReactionReceived,
    #[serde(rename = "imessage.sent")]
    Sent,
    #[serde(rename = "imessage.delivered")]
    Delivered,
    #[serde(rename = "imessage.delivery_failed")]
    DeliveryFailed,
}

/// Direction of an iMessage on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageDirectionWire {
    Inbound,
    Outbound,
}

/// Transport service used for an iMessage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageServiceWire {
    Imessage,
    Sms,
    Rcs,
}

/// Whether an iMessage payload is a plain message or a carousel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageTypeWire {
    Message,
    Carousel,
}

/// Delivery status of an iMessage on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageDeliveryStatusWire {
    Registered,
    Pending,
    Queued,
    Accepted,
    Sent,
    Delivered,
    Declined,
    Error,
    Received,
}

/// Tapback reaction kind on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageReactionTypeWire {
    Love,
    Like,
    Dislike,
    Laugh,
    Emphasize,
    Question,
    Custom,
}

/// iMessage send-style effect on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageSendStyleWire {
    Celebration,
    ShootingStar,
    Fireworks,
    Lasers,
    Love,
    Confetti,
    Balloons,
    Spotlight,
    Echo,
    Invisible,
    Gentle,
    Loud,
    Slam,
}

/// iMessage media attachment (snake_case wire shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IMessageMediaItemWire {
    pub content_type: Option<String>,
    pub size: Option<i64>,
    pub url: String,
}

/// Per-recipient outbound iMessage delivery state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IMessageRecipientWire {
    pub remote_number: String,
    pub delivery_status: Option<IMessageDeliveryStatusWire>,
    pub service: Option<IMessageServiceWire>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub error_reason: Option<String>,
    pub error_detail: Option<String>,
    pub sent_at: Option<String>,
    pub delivered_at: Option<String>,
    pub failed_at: Option<String>,
}

/// A live tapback attached to a message (snake_case wire shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IMessageMessageReactionWire {
    pub id: String,
    pub direction: IMessageDirectionWire,
    pub reaction: IMessageReactionTypeWire,
    pub custom_emoji: Option<String>,
    pub remote_number: String,
    pub part_index: i64,
    pub created_at: String,
}

/// Stored iMessage. `is_blocked` is not part of the wire body -- blocked
/// messages never reach the webhook. There is no local-number field: shared
/// pool lines are hidden from agents, so the message is identified by
/// `conversation_id` and the counterparty `remote_number` only.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IMessageWebhookMessage {
    pub id: String,
    pub conversation_id: String,
    pub assignment_id: String,
    pub direction: IMessageDirectionWire,
    pub remote_number: String,
    pub content: Option<String>,
    pub message_type: IMessageTypeWire,
    pub service: IMessageServiceWire,
    pub send_style: Option<IMessageSendStyleWire>,
    pub media: Option<Vec<IMessageMediaItemWire>>,
    pub was_downgraded: Option<bool>,
    pub status: Option<IMessageDeliveryStatusWire>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub error_reason: Option<String>,
    pub error_detail: Option<String>,
    pub is_read: bool,
    pub recipients: Option<Vec<IMessageRecipientWire>>,
    pub reactions: Option<Vec<IMessageMessageReactionWire>>,
    pub created_at: String,
    pub updated_at: String,
}

/// A tapback reaction on an iMessage (snake_case wire shape).
///
/// `custom_emoji` carries the literal emoji when `reaction` is `"custom"`;
/// `None` for the classic six.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IMessageWebhookReaction {
    pub id: String,
    pub conversation_id: String,
    pub assignment_id: String,
    pub target_message_id: String,
    pub direction: IMessageDirectionWire,
    pub reaction: IMessageReactionTypeWire,
    pub custom_emoji: Option<String>,
    pub remote_number: String,
    pub part_index: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Wrapper under `IMessageWebhookPayload.data`.
///
/// Exactly one of `message` (`imessage.received` and the delivery lifecycle
/// events `imessage.sent` / `imessage.delivered` / `imessage.delivery_failed`)
/// or `reaction` (`imessage.reaction_received`) is populated. `contacts` and
/// `agent_identities` resolve the remote number against the assigned identity's
/// visible contact book and identity graph; both are always present, possibly
/// empty.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IMessageWebhookData {
    pub message: Option<IMessageWebhookMessage>,
    pub reaction: Option<IMessageWebhookReaction>,
    pub contacts: Vec<WebhookContact>,
    pub agent_identities: Vec<WebhookAgentIdentity>,
    // Present only on the channel's `*.received` event, and only when the
    // subscription opted in via `context_config`. Absent on sent /
    // delivery-status / reaction events even though this shared type permits
    // the key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<WebhookContext>,
}

/// Top-level iMessage webhook payload (`{event_type, timestamp, data}`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IMessageWebhookPayload {
    /// Stable per-event id (`evt_...`); idempotency key, stable across replays.
    // `serde(default)` so payloads that predate this field (older or
    // mixed-deployment servers, recorded fixtures) still deserialize instead of
    // hard-failing on a missing field; an absent id parses to "".
    #[serde(default)]
    pub id: String,
    pub event_type: IMessageWebhookEventType,
    pub timestamp: String,
    pub data: IMessageWebhookData,
}

// ---- Inbound call (FLAT - no envelope) -----------------------------------

/// Inbound call payload. **Flat** -- no `{event_type, timestamp, data}`
/// envelope; `contacts` / `agent_identities` sit at the top level.
/// `is_blocked` is not part of the wire body -- blocked calls never reach the
/// webhook. `direction` is always `"inbound"`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoneIncomingCallWebhookPayload {
    pub id: String,
    pub local_phone_number: String,
    pub remote_phone_number: String,
    pub direction: CallDirectionWire,
    pub status: CallStatusWire,
    pub client_websocket_url: Option<String>,
    pub use_inkbox_tts: Option<bool>,
    pub use_inkbox_stt: Option<bool>,
    pub hangup_reason: Option<HangupReasonWire>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub rate_limit: Option<RateLimitInfoWire>,
    pub contacts: Vec<WebhookContact>,
    pub agent_identities: Vec<WebhookAgentIdentity>,
}

// ---- Call lifecycle (post-call fan-out) ----------------------------------

/// Post-call lifecycle webhook event-type discriminator.
///
/// Delivered to an agent-identity-owned `call.ended` subscription;
/// fire-and-forget and replayable (unlike the synchronous
/// `phone.incoming_call` control-plane callback).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CallLifecycleWebhookEventType {
    #[serde(rename = "call.ended")]
    CallEnded,
}

/// Stored phone call embedded in a call-lifecycle webhook payload.
///
/// Mirrors `PhoneCallResponse` minus `is_blocked` (blocked calls never reach
/// the webhook). `local_phone_number` is `None` and `origin` is
/// `SharedImessageNumber` on shared-line hosted calls. `use_inkbox_agent` is
/// `true` when the platform hosted the realtime voice agent for the call.
/// `duration_seconds` is the connected length in whole seconds, or `None` when
/// the call never connected.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookPhoneCall {
    pub id: String,
    pub origin: CallOriginWire,
    pub local_phone_number: Option<String>,
    pub remote_phone_number: String,
    pub direction: CallDirectionWire,
    pub status: CallStatusWire,
    pub hangup_reason: Option<HangupReasonWire>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub use_inkbox_agent: bool,
    pub duration_seconds: Option<i64>,
}

/// Inline transcript block on a `call.ended` payload.
///
/// Present only for platform-hosted realtime calls. `entries` reuses the
/// shared middle-cut [`WebhookTranscriptEntry`] shape -- discriminate a turn
/// from the abridgment marker on the presence of `marker`. `abridged` is
/// `true` when the middle was cut. `url` points at the authoritative verbatim
/// transcript (the same value as `transcript_url` on the data wrapper).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookCallTranscript {
    pub entries: Vec<WebhookTranscriptEntry>,
    pub abridged: bool,
    pub url: String,
}

/// Wrapper under `CallEndedWebhookPayload.data`.
///
/// `contacts` / `agent_identities` resolve the caller and are always present,
/// possibly empty. `transcript` is present-with-`null`: the inline (possibly
/// abridged) block is populated only when the call used platform-hosted
/// realtime voice (`call.use_inkbox_agent`), otherwise `None`.
/// `transcript_url` is **always** present and is the authoritative verbatim
/// record (fetch with an admin API key).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallEndedWebhookData {
    pub call: WebhookPhoneCall,
    pub contacts: Vec<WebhookContact>,
    pub agent_identities: Vec<WebhookAgentIdentity>,
    #[serde(default)]
    pub transcript: Option<WebhookCallTranscript>,
    pub transcript_url: String,
}

/// Top-level `call.ended` webhook payload (`{event_type, timestamp, data}`
/// envelope).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallEndedWebhookPayload {
    /// Stable per-event id (`evt_...`); idempotency key, stable across replays.
    // `serde(default)` so payloads that predate this field still deserialize.
    #[serde(default)]
    pub id: String,
    pub event_type: CallLifecycleWebhookEventType,
    pub timestamp: String,
    pub data: CallEndedWebhookData,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_call_ended_with_inline_transcript() {
        let raw = r#"{
            "id": "evt_abc",
            "event_type": "call.ended",
            "timestamp": "2026-07-06T18:22:41Z",
            "data": {
                "call": {
                    "id": "c1", "origin": "dedicated_number",
                    "local_phone_number": "+14155550100",
                    "remote_phone_number": "+14155550999",
                    "direction": "inbound", "status": "completed",
                    "hangup_reason": "remote", "started_at": "t0", "ended_at": "t1",
                    "created_at": "t0", "updated_at": "t1",
                    "use_inkbox_agent": true, "duration_seconds": 123
                },
                "contacts": [{"id": "ct1", "name": "Jane"}],
                "agent_identities": [],
                "transcript": {
                    "entries": [
                        {"party": "remote", "text": "hi", "ts_ms": 0},
                        {"marker": "abridged", "omitted_turns": 12, "omitted_ms": 40100}
                    ],
                    "abridged": true,
                    "url": "https://x/api/v1/phone/calls/c1/transcripts"
                },
                "transcript_url": "https://x/api/v1/phone/calls/c1/transcripts"
            }
        }"#;
        let payload: CallEndedWebhookPayload = serde_json::from_str(raw).unwrap();
        assert_eq!(payload.event_type, CallLifecycleWebhookEventType::CallEnded);
        assert_eq!(payload.data.call.origin, CallOriginWire::DedicatedNumber);
        assert!(payload.data.call.use_inkbox_agent);
        assert_eq!(payload.data.call.duration_seconds, Some(123));
        let transcript = payload.data.transcript.expect("inline transcript present");
        assert!(transcript.abridged);
        assert_eq!(transcript.url, payload.data.transcript_url);
        // The abridgment marker entry carries omitted_turns.
        assert_eq!(transcript.entries[1].marker.as_deref(), Some("abridged"));
        assert_eq!(transcript.entries[1].omitted_turns, Some(12));
    }

    #[test]
    fn call_ended_omits_transcript_on_non_hosted_call() {
        // Shared-line, non-hosted call: local_phone_number null, transcript null.
        let raw = r#"{
            "id": "evt_def",
            "event_type": "call.ended",
            "timestamp": "2026-07-06T18:22:41Z",
            "data": {
                "call": {
                    "id": "c2", "origin": "shared_imessage_number",
                    "local_phone_number": null,
                    "remote_phone_number": "+14155550999",
                    "direction": "inbound", "status": "completed",
                    "hangup_reason": null, "started_at": null, "ended_at": "t1",
                    "created_at": "t0", "updated_at": "t1",
                    "use_inkbox_agent": false, "duration_seconds": null
                },
                "contacts": [],
                "agent_identities": [],
                "transcript": null,
                "transcript_url": "https://x/api/v1/phone/calls/c2/transcripts"
            }
        }"#;
        let payload: CallEndedWebhookPayload = serde_json::from_str(raw).unwrap();
        assert_eq!(
            payload.data.call.origin,
            CallOriginWire::SharedImessageNumber
        );
        assert!(payload.data.call.local_phone_number.is_none());
        assert!(payload.data.transcript.is_none());
        // transcript_url is always present.
        assert!(payload.data.transcript_url.ends_with("/transcripts"));
    }
}
