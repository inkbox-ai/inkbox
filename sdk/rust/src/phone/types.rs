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
    /// Blocked pre-carrier by the Inkbox outbound spam filter; appears on
    /// stored rows (list/get), never on delivery webhooks.
    BlockedSpamFilter,
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

/// Where an outbound (or observed) call originates.
///
/// `dedicated_number` rides an identity's own provisioned phone number;
/// `shared_imessage_number` rides the shared iMessage line and is scoped by
/// agent identity instead. Defaults to `dedicated_number`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CallOrigin {
    #[default]
    DedicatedNumber,
    SharedImessageNumber,
}

impl CallOrigin {
    /// The wire string value (`"dedicated_number"` / `"shared_imessage_number"`).
    pub fn as_str(&self) -> &'static str {
        match self {
            CallOrigin::DedicatedNumber => "dedicated_number",
            CallOrigin::SharedImessageNumber => "shared_imessage_number",
        }
    }
}

/// Routing decision applied to inbound calls for an agent identity.
///
/// `hosted_agent` answers with Inkbox Voice AI and is the
/// only action that requires neither a WebSocket nor a webhook URL.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IncomingCallAction {
    AutoAccept,
    AutoReject,
    Webhook,
    HostedAgent,
}

impl IncomingCallAction {
    /// The wire string value (`"auto_accept"` / `"auto_reject"` / `"webhook"`
    /// / `"hosted_agent"`).
    pub fn as_str(&self) -> &'static str {
        match self {
            IncomingCallAction::AutoAccept => "auto_accept",
            IncomingCallAction::AutoReject => "auto_reject",
            IncomingCallAction::Webhook => "webhook",
            IncomingCallAction::HostedAgent => "hosted_agent",
        }
    }
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

/// Deserialize a `CallOrigin` treating an explicit `null` as the default, so
/// `"origin": null` parses like a missing key (the Python parser coerces
/// null/missing origins to `dedicated_number` for back-compat).
fn deserialize_call_origin_null_default<'de, D>(deserializer: D) -> Result<CallOrigin, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<CallOrigin>::deserialize(deserializer)?.unwrap_or_default())
}

fn default_call_mode_client_websocket() -> String {
    // Older server responses predate the `mode` field; default to the
    // client-driven mode for backwards compatibility.
    "client_websocket".to_string()
}

/// Deserialize a call `mode` treating an explicit `null` like a missing key
/// (coerced to `client_websocket` for back-compat).
fn deserialize_call_mode_null_default<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?
        .unwrap_or_else(default_call_mode_client_websocket))
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
    /// `None` when `origin == shared_imessage_number` (the shared line has no
    /// dedicated local number). Defaults to `None` when absent.
    #[serde(default)]
    pub local_phone_number: Option<String>,
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
    /// Where the call originated. Defaults to `dedicated_number` when absent
    /// or null (older server responses predate the field).
    #[serde(default, deserialize_with = "deserialize_call_origin_null_default")]
    pub origin: CallOrigin,
    /// Who drove the call (`"client_websocket"` / `"hosted_agent"`). Defaults
    /// to `client_websocket` when absent or null (older server responses
    /// predate the field).
    #[serde(
        default = "default_call_mode_client_websocket",
        deserialize_with = "deserialize_call_mode_null_default"
    )]
    pub mode: String,
    /// Outbound Voice AI brief; `None` on inbound and client-driven calls.
    #[serde(default)]
    pub reason: Option<String>,
    /// Open action items Voice AI recorded, `seq`-ascending. Empty for
    /// client-driven calls and Voice AI calls with no open items.
    #[serde(default)]
    pub post_call_action_items: Vec<PostCallActionItem>,
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

/// Inbound-call routing config for an agent identity.
///
/// `client_websocket_url` is populated when the action bridges accepted calls
/// to a socket; `incoming_call_webhook_url` when the action is `webhook`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingCallActionConfig {
    pub agent_identity_id: Uuid,
    pub incoming_call_action: IncomingCallAction,
    #[serde(default)]
    pub client_websocket_url: Option<String>,
    #[serde(default)]
    pub incoming_call_webhook_url: Option<String>,
}

/// Per-identity Inkbox Voice AI configuration.
///
/// `voice` / `model` / `instructions` are all nullable — `None` means the
/// server default applies for that field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostedAgentConfig {
    pub agent_identity_id: Uuid,
    #[serde(default)]
    pub voice: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub instructions: Option<String>,
}

/// An action item Inkbox Voice AI recorded during a call.
///
/// Surfaced inline on the call resource via `calls().get(...).post_call_action_items`
/// (open items only, `seq`-ascending), mirroring the `call.ended` webhook.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostCallActionItem {
    pub id: Uuid,
    pub seq: i64,
    pub action: String,
    #[serde(default)]
    pub details: Option<String>,
    pub status: String,
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
///
/// Returned by the **legacy** per-number routes
/// ([`crate::phone::resources::contact_rules::PhoneContactRulesResource`]). The
/// forward-looking, identity-keyed shape is [`PhoneIdentityContactRule`].
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

/// A phone allow/block rule scoped to an **agent identity** (voice + SMS).
///
/// Returned by the identity-keyed routes
/// ([`crate::phone::resources::identity_contact_rules::PhoneIdentityContactRulesResource`]
/// / `identity.list_phone_contact_rules()`). Same shape as [`PhoneContactRule`]
/// but keyed by `agent_identity_id` instead of `phone_number_id`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoneIdentityContactRule {
    pub id: Uuid,
    pub agent_identity_id: Uuid,
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// Minimal valid `PhoneCall` payload; tests mutate a copy per case.
    fn call_json() -> serde_json::Value {
        json!({
            "id": "22222222-2222-2222-2222-222222222222",
            "local_phone_number": "+15550001111",
            "remote_phone_number": "+15550002222",
            "direction": "outbound",
            "status": "completed",
            "created_at": "2026-06-01T00:00:00+00:00",
            "updated_at": "2026-06-01T00:00:01+00:00",
            "is_blocked": false,
            "origin": "dedicated_number"
        })
    }

    #[test]
    fn phone_call_dedicated_has_local_number_string() {
        let call: PhoneCall = serde_json::from_value(call_json()).unwrap();
        assert_eq!(call.local_phone_number.as_deref(), Some("+15550001111"));
        assert_eq!(call.origin, CallOrigin::DedicatedNumber);
    }

    #[test]
    fn phone_call_shared_has_null_local_number() {
        // Shared-line calls have no dedicated local number on the wire.
        let mut v = call_json();
        v["local_phone_number"] = serde_json::Value::Null;
        v["origin"] = json!("shared_imessage_number");
        let call: PhoneCall = serde_json::from_value(v).unwrap();
        assert_eq!(call.local_phone_number, None);
        assert_eq!(call.origin, CallOrigin::SharedImessageNumber);
    }

    #[test]
    fn phone_call_missing_local_number_key_defaults_to_none() {
        let mut v = call_json();
        v.as_object_mut().unwrap().remove("local_phone_number");
        let call: PhoneCall = serde_json::from_value(v).unwrap();
        assert_eq!(call.local_phone_number, None);
    }

    #[test]
    fn phone_call_missing_origin_key_defaults_to_dedicated() {
        // Older server responses predate the field entirely.
        let mut v = call_json();
        v.as_object_mut().unwrap().remove("origin");
        let call: PhoneCall = serde_json::from_value(v).unwrap();
        assert_eq!(call.origin, CallOrigin::DedicatedNumber);
    }

    #[test]
    fn phone_call_null_origin_defaults_to_dedicated() {
        // Parity with the Python parser, which coerces a *null* origin (not
        // just a missing key) to dedicated for back-compat.
        let mut v = call_json();
        v["origin"] = serde_json::Value::Null;
        let call: PhoneCall = serde_json::from_value(v).unwrap();
        assert_eq!(call.origin, CallOrigin::DedicatedNumber);
    }

    #[test]
    fn phone_call_tolerates_unknown_fields() {
        let mut v = call_json();
        v["some_future_field"] = json!({"nested": true});
        let call: PhoneCall = serde_json::from_value(v).unwrap();
        assert_eq!(call.status, "completed");
    }

    #[test]
    fn phone_call_with_rate_limit_flatten_round_trip() {
        // The wire shape is one flat object: call fields + rate_limit.
        let mut v = call_json();
        v["rate_limit"] = json!({
            "calls_used": 1,
            "calls_remaining": 9,
            "calls_limit": 10,
            "minutes_used": 1.5,
            "minutes_remaining": 58.5,
            "minutes_limit": 60
        });
        let parsed: PhoneCallWithRateLimit = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(parsed.call.remote_phone_number, "+15550002222");
        let rl = parsed.rate_limit.as_ref().expect("rate_limit present");
        assert_eq!(rl.calls_remaining, 9);
        assert_eq!(rl.minutes_remaining, 58.5);
        // Re-serialization stays flat: no `call` wrapper key, ids at top level.
        let back = serde_json::to_value(&parsed).unwrap();
        assert!(back.get("call").is_none());
        assert_eq!(back["id"], v["id"]);
        assert_eq!(back["rate_limit"]["calls_limit"], 10);
    }

    #[test]
    fn phone_call_with_rate_limit_tolerates_missing_rate_limit() {
        let parsed: PhoneCallWithRateLimit = serde_json::from_value(call_json()).unwrap();
        assert!(parsed.rate_limit.is_none());
    }

    #[test]
    fn phone_transcript_deserializes() {
        let seg: PhoneTranscript = serde_json::from_value(json!({
            "id": "55555555-5555-5555-5555-555555555555",
            "call_id": "22222222-2222-2222-2222-222222222222",
            "seq": 3,
            "ts_ms": 1450,
            "party": "agent",
            "text": "Hello!",
            "created_at": "2026-06-01T00:00:02+00:00"
        }))
        .unwrap();
        assert_eq!(seg.seq, 3);
        assert_eq!(seg.ts_ms, 1450);
        assert_eq!(seg.party, "agent");
        assert_eq!(seg.text, "Hello!");
    }

    #[test]
    fn incoming_call_action_wire_strings_round_trip() {
        let cases = [
            (IncomingCallAction::AutoAccept, "auto_accept"),
            (IncomingCallAction::AutoReject, "auto_reject"),
            (IncomingCallAction::Webhook, "webhook"),
            (IncomingCallAction::HostedAgent, "hosted_agent"),
        ];
        for (variant, wire) in cases {
            assert_eq!(variant.as_str(), wire);
            assert_eq!(serde_json::to_value(variant).unwrap(), json!(wire));
            let parsed: IncomingCallAction = serde_json::from_value(json!(wire)).unwrap();
            assert_eq!(parsed, variant);
        }
    }

    #[test]
    fn phone_call_missing_mode_key_defaults_to_client_websocket() {
        // Older server responses predate the field entirely.
        let call: PhoneCall = serde_json::from_value(call_json()).unwrap();
        assert_eq!(call.mode, "client_websocket");
        assert_eq!(call.reason, None);
    }

    #[test]
    fn phone_call_null_mode_defaults_to_client_websocket() {
        let mut v = call_json();
        v["mode"] = serde_json::Value::Null;
        let call: PhoneCall = serde_json::from_value(v).unwrap();
        assert_eq!(call.mode, "client_websocket");
    }

    #[test]
    fn phone_call_hosted_mode_and_reason_parse() {
        let mut v = call_json();
        v["mode"] = json!("hosted_agent");
        v["reason"] = json!("Book a cleaning next week");
        let call: PhoneCall = serde_json::from_value(v).unwrap();
        assert_eq!(call.mode, "hosted_agent");
        assert_eq!(call.reason.as_deref(), Some("Book a cleaning next week"));
    }

    #[test]
    fn hosted_agent_config_parses_values_and_nulls() {
        let cfg: HostedAgentConfig = serde_json::from_value(json!({
            "agent_identity_id": "33333333-3333-3333-3333-333333333333",
            "voice": "warm-voice",
            "model": null,
            "instructions": "Be brief."
        }))
        .unwrap();
        assert_eq!(cfg.voice.as_deref(), Some("warm-voice"));
        assert_eq!(cfg.model, None);
        assert_eq!(cfg.instructions.as_deref(), Some("Be brief."));
    }

    #[test]
    fn post_call_action_item_parses_with_null_details() {
        let action: PostCallActionItem = serde_json::from_value(json!({
            "id": "44444444-4444-4444-4444-444444444444",
            "seq": 2,
            "action": "Send pricing PDF",
            "details": null,
            "status": "open"
        }))
        .unwrap();
        assert_eq!(action.seq, 2);
        assert_eq!(action.details, None);
        assert_eq!(action.status, "open");
    }

    #[test]
    fn call_origin_wire_strings_round_trip() {
        let cases = [
            (CallOrigin::DedicatedNumber, "dedicated_number"),
            (CallOrigin::SharedImessageNumber, "shared_imessage_number"),
        ];
        for (variant, wire) in cases {
            assert_eq!(variant.as_str(), wire);
            assert_eq!(serde_json::to_value(variant).unwrap(), json!(wire));
            let parsed: CallOrigin = serde_json::from_value(json!(wire)).unwrap();
            assert_eq!(parsed, variant);
        }
    }
}
