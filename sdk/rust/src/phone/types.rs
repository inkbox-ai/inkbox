//! Structs and enums mirroring the Inkbox Phone API response models.
//!
//! Faithful port of `inkbox/phone/types.py`. Field names are already snake_case
//! and match the wire JSON, so no serde renames are needed on structs. Enums
//! carry per-variant renames to reproduce each Python `.value` exactly.
//!
//! Timestamps arrive as ISO strings and are kept as `String` (the contract
//! forbids inventing chrono). Optional/absent fields are `Option<T>` with
//! `#[serde(default)]` so older server responses that predate a field parse
//! cleanly.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Shared mail-domain types.
//
// `inkbox/phone/types.py` imports `ContactRuleStatus`, `FilterMode`, and
// `FilterModeChangeNotice` from `inkbox.mail.types`. The mail domain is not
// yet ported to Rust, so they are defined here against the same wire shape.
// When mail lands these can be re-exported from there instead.
// ---------------------------------------------------------------------------

/// Contact-rule filter mode on a mailbox or phone number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterMode {
    /// Only contacts matching an `allow` rule are delivered; everything else
    /// is blocked.
    Whitelist,
    /// Everything is delivered except contacts matching a `block` rule. Default.
    Blacklist,
}

/// Whether a contact rule is currently enforced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContactRuleStatus {
    Active,
    Paused,
}

/// Summary returned on PATCH when `filter_mode` actually changed.
///
/// Reports how many existing active rules are now redundant under the new mode
/// so the caller can prompt for cleanup.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterModeChangeNotice {
    /// The mode the resource was just flipped to.
    pub new_filter_mode: FilterMode,
    /// The action whose rules are now redundant — `"block"` under whitelist,
    /// `"allow"` under blacklist. Free-form to tolerate new server values.
    pub redundant_rule_action: String,
    /// Count of active rules whose action equals `redundant_rule_action`.
    pub redundant_rule_count: i64,
}

// ---------------------------------------------------------------------------
// Phone enums.
// ---------------------------------------------------------------------------

/// Whether a matching phone number is allowed through or blocked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhoneRuleAction {
    Allow,
    Block,
}

impl PhoneRuleAction {
    /// The wire string value (`"allow"` / `"block"`), for use as a query param.
    pub fn as_str(&self) -> &'static str {
        match self {
            PhoneRuleAction::Allow => "allow",
            PhoneRuleAction::Block => "block",
        }
    }
}

/// What a phone contact rule matches on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhoneRuleMatchType {
    ExactNumber,
}

impl PhoneRuleMatchType {
    /// The wire string value (`"exact_number"`), for use as a query param.
    pub fn as_str(&self) -> &'static str {
        match self {
            PhoneRuleMatchType::ExactNumber => "exact_number",
        }
    }
}

/// Outbound SMS provisioning readiness for a phone number.
///
/// `pending` means the 10DLC campaign / TFV propagation is still running on the
/// carrier side; `ready` means the number can send SMS; `assignment_failed`
/// means provisioning retries were exhausted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SmsStatus {
    Pending,
    Ready,
    AssignmentFailed,
}

/// Carrier-facing outbound delivery lifecycle for a text message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SmsDeliveryStatus {
    Queued,
    Sent,
    Delivered,
    DeliveryFailed,
    DeliveryUnconfirmed,
    SendingFailed,
}

/// Whether a text was user-initiated or an internal auto-reply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TextMessageOrigin {
    // Matches the Python dataclass default of `USER_INITIATED`.
    #[default]
    UserInitiated,
    AutoReply,
}

/// Consent state of a receiver number for the calling org.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SmsOptInStatus {
    OptedIn,
    OptedOut,
}

impl SmsOptInStatus {
    /// The wire string value, for use as a query param.
    pub fn as_str(&self) -> &'static str {
        match self {
            SmsOptInStatus::OptedIn => "opted_in",
            SmsOptInStatus::OptedOut => "opted_out",
        }
    }
}

/// Channel that recorded the consent transition.
///
/// `api` rows came from an org with its own active, customer-managed 10DLC
/// campaign calling the opt-in / opt-out endpoints directly. `sms` rows came
/// from inbound STOP/START.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SmsOptInSource {
    Sms,
    Api,
}

// ---------------------------------------------------------------------------
// Helper for the `sms_status` / `origin` defaults that older servers omit.
// ---------------------------------------------------------------------------

fn default_sms_status_ready() -> SmsStatus {
    // Older server responses predate the `sms_status` field; default to READY
    // for backwards compatibility, matching the Python parser.
    SmsStatus::Ready
}

fn default_filter_mode_blacklist() -> FilterMode {
    FilterMode::Blacklist
}

// ---------------------------------------------------------------------------
// Phone structs.
// ---------------------------------------------------------------------------

/// A phone number owned by your organisation.
///
/// `agent_identity_id` is the UUID of the owning agent identity, or `None` only
/// for the pool / released states. SMS-readiness fields reflect 10DLC / TFV
/// provisioning progress.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoneNumber {
    pub id: Uuid,
    pub number: String,
    pub r#type: String,
    pub status: String,
    /// Outbound SMS readiness — gate `send_text` on `ready`. Defaults to
    /// `ready` when absent (older server responses).
    #[serde(default = "default_sms_status_ready")]
    pub sms_status: SmsStatus,
    pub incoming_call_action: String,
    #[serde(default)]
    pub client_websocket_url: Option<String>,
    #[serde(default)]
    pub incoming_call_webhook_url: Option<String>,
    /// A single value governs both inbound voice and SMS. Defaults to
    /// `blacklist` when absent.
    #[serde(default = "default_filter_mode_blacklist")]
    pub filter_mode: FilterMode,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sms_error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sms_error_detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sms_ready_at: Option<String>,
    /// 2-letter US state abbreviation (e.g. `"NY"`); null if not set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_identity_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_mode_change_notice: Option<FilterModeChangeNotice>,
}

/// A phone call record.
///
/// `is_blocked` is `true` when this call was rejected by a contact rule or
/// default-block before connect. Identity-scoped (agent) API keys never observe
/// `is_blocked=true` rows.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoneCall {
    pub id: Uuid,
    pub local_phone_number: String,
    pub remote_phone_number: String,
    pub direction: String,
    pub status: String,
    #[serde(default)]
    pub client_websocket_url: Option<String>,
    #[serde(default)]
    pub use_inkbox_tts: Option<bool>,
    #[serde(default)]
    pub use_inkbox_stt: Option<bool>,
    #[serde(default)]
    pub hangup_reason: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub ended_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Defaults to `false` for older server responses without this field.
    #[serde(default)]
    pub is_blocked: bool,
}

/// Rate limit snapshot for an organisation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitInfo {
    pub calls_used: i64,
    pub calls_remaining: i64,
    pub calls_limit: i64,
    pub minutes_used: f64,
    pub minutes_remaining: f64,
    pub minutes_limit: i64,
}

/// `PhoneCall` extended with the caller's current rate limit snapshot.
///
/// Returned by the place-call endpoint. The base call fields are flattened so
/// the wire shape is a single object, matching the Python subclass.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoneCallWithRateLimit {
    #[serde(flatten)]
    pub call: PhoneCall,
    /// `None` only if the server omits `rate_limit` (the Python parser tolerates
    /// a missing/empty value).
    #[serde(default)]
    pub rate_limit: Option<RateLimitInfo>,
}

/// A single media attachment in an MMS message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextMediaItem {
    pub content_type: String,
    pub size: i64,
    pub url: String,
}

/// Per-recipient delivery state for an outbound text message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextMessageRecipient {
    pub recipient_phone_number: String,
    #[serde(default)]
    pub delivery_status: Option<SmsDeliveryStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub carrier: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sent_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivered_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed_at: Option<String>,
}

/// A text message (SMS or MMS).
///
/// Outbound-only lifecycle fields (`delivery_status`, `error_code`,
/// `error_detail`, `sent_at`, `delivered_at`, `failed_at`) are `None` on
/// inbound rows. `is_blocked` is `true` when this text was rejected by a
/// contact rule or default-block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextMessage {
    pub id: Uuid,
    pub direction: String,
    pub local_phone_number: String,
    #[serde(default)]
    pub remote_phone_number: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    pub r#type: String,
    #[serde(default)]
    pub media: Option<Vec<TextMediaItem>>,
    pub is_read: bool,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub delivery_status: Option<SmsDeliveryStatus>,
    /// Defaults to `user_initiated` when absent.
    #[serde(default)]
    pub origin: TextMessageOrigin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sent_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivered_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed_at: Option<String>,
    /// Defaults to `false` for older server responses that predate the field.
    #[serde(default)]
    pub is_blocked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sender_phone_number: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipients: Option<Vec<TextMessageRecipient>>,
}

/// One row per text conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextConversationSummary {
    #[serde(default)]
    pub remote_phone_number: Option<String>,
    pub latest_text: Option<String>,
    pub latest_direction: String,
    pub latest_type: String,
    pub latest_message_at: String,
    pub unread_count: i64,
    pub total_count: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub participants: Option<Vec<String>>,
    /// Defaults to `false` when absent.
    #[serde(default)]
    pub is_group: bool,
    /// Defaults to `false` when absent.
    #[serde(default)]
    pub latest_has_media: bool,
}

/// Result from updating a text conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextConversationUpdateResult {
    #[serde(default)]
    pub remote_phone_number: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<Uuid>,
    pub is_read: bool,
    pub updated_count: i64,
}

/// A transcript segment from a phone call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoneTranscript {
    pub id: Uuid,
    pub call_id: Uuid,
    pub seq: i64,
    pub ts_ms: i64,
    pub party: String,
    pub text: String,
    pub created_at: String,
}

/// A per-(org, receiver) SMS consent row.
///
/// `receiver_number` is E.164 (`+15551234567`). Only one of `opted_in_at` /
/// `opted_out_at` is populated at a time — the one matching the current
/// `status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmsOptIn {
    pub id: Uuid,
    pub organization_id: String,
    pub receiver_number: String,
    pub status: SmsOptInStatus,
    pub source: SmsOptInSource,
    #[serde(default)]
    pub opted_in_at: Option<String>,
    #[serde(default)]
    pub opted_out_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// An inbound/outbound allow/block rule scoped to a phone number.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoneContactRule {
    pub id: Uuid,
    pub phone_number_id: Uuid,
    pub action: PhoneRuleAction,
    pub match_type: PhoneRuleMatchType,
    pub match_target: String,
    /// Defaults to `active` when absent.
    #[serde(default = "default_contact_rule_status_active")]
    pub status: ContactRuleStatus,
    pub created_at: String,
    pub updated_at: String,
}

fn default_contact_rule_status_active() -> ContactRuleStatus {
    ContactRuleStatus::Active
}
