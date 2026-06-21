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
}

/// Top-level mail webhook payload (`{event_type, timestamp, data}` envelope).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailWebhookPayload {
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
}

/// Top-level phone-text webhook payload (`{event_type, timestamp, data}`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextWebhookPayload {
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
}

/// Top-level iMessage webhook payload (`{event_type, timestamp, data}`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IMessageWebhookPayload {
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
