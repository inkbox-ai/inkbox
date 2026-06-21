//! Types mirroring the Inkbox iMessage API response models.
//!
//! iMessage routes by assignment, not by a number the org owns: a
//! recipient is connected to an agent identity over a shared pool line,
//! and every agent-facing shape is keyed by `conversation_id` /
//! `remote_number`. The local pool number is never exposed.

use uuid::Uuid;

// `ContactRuleStatus` lives in the mail domain; Python imports it from
// `inkbox.mail.types`, so we re-export the shared type rather than duplicate it.
pub use crate::mail::types::ContactRuleStatus;

/// Transport a message actually went over (iMessage may downgrade).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageService {
    Imessage,
    Sms,
    Rcs,
}

/// Provider-facing delivery lifecycle for an iMessage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageDeliveryStatus {
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

/// Tapback reaction kinds.
///
/// `Custom` is inbound-only: recipients can react with any emoji
/// (carried in `custom_emoji`), but sends accept the classic six.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageReactionType {
    Love,
    Like,
    Dislike,
    Laugh,
    Emphasize,
    Question,
    Custom,
}

/// Expressive send style applied to an outbound iMessage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageSendStyle {
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

/// Lifecycle of a recipient's triage-created connection to an agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageAssignmentStatus {
    Active,
    Released,
}

/// Whether a matching remote number is allowed through or blocked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageRuleAction {
    Allow,
    Block,
}

impl IMessageRuleAction {
    /// The wire string value, matching the Python enum `.value`.
    pub fn as_str(&self) -> &'static str {
        match self {
            IMessageRuleAction::Allow => "allow",
            IMessageRuleAction::Block => "block",
        }
    }
}

/// What an iMessage contact rule matches on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageRuleMatchType {
    ExactNumber,
}

impl IMessageRuleMatchType {
    /// The wire string value, matching the Python enum `.value`.
    pub fn as_str(&self) -> &'static str {
        match self {
            IMessageRuleMatchType::ExactNumber => "exact_number",
        }
    }
}

impl IMessageSendStyle {
    /// The wire string value, matching the Python enum `.value`.
    pub fn as_str(&self) -> &'static str {
        match self {
            IMessageSendStyle::Celebration => "celebration",
            IMessageSendStyle::ShootingStar => "shooting_star",
            IMessageSendStyle::Fireworks => "fireworks",
            IMessageSendStyle::Lasers => "lasers",
            IMessageSendStyle::Love => "love",
            IMessageSendStyle::Confetti => "confetti",
            IMessageSendStyle::Balloons => "balloons",
            IMessageSendStyle::Spotlight => "spotlight",
            IMessageSendStyle::Echo => "echo",
            IMessageSendStyle::Invisible => "invisible",
            IMessageSendStyle::Gentle => "gentle",
            IMessageSendStyle::Loud => "loud",
            IMessageSendStyle::Slam => "slam",
        }
    }
}

impl IMessageReactionType {
    /// The wire string value, matching the Python enum `.value`.
    pub fn as_str(&self) -> &'static str {
        match self {
            IMessageReactionType::Love => "love",
            IMessageReactionType::Like => "like",
            IMessageReactionType::Dislike => "dislike",
            IMessageReactionType::Laugh => "laugh",
            IMessageReactionType::Emphasize => "emphasize",
            IMessageReactionType::Question => "question",
            IMessageReactionType::Custom => "custom",
        }
    }
}

/// Media attachment on an iMessage.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessageMediaItem {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<i64>,
}

/// Per-recipient outbound delivery state for an iMessage.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessageRecipient {
    pub remote_number: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_status: Option<IMessageDeliveryStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service: Option<IMessageService>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_detail: Option<String>,
    // ISO-8601 timestamp strings (see PORTING_CONTRACT: ISO strings stay String).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sent_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivered_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed_at: Option<String>,
}

/// A live tapback attached to a message in read responses.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessageMessageReaction {
    pub id: Uuid,
    /// "inbound" | "outbound"
    pub direction: String,
    pub reaction: IMessageReactionType,
    pub remote_number: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_emoji: Option<String>,
    #[serde(default)]
    pub part_index: i64,
}

/// An iMessage in an assignment-routed conversation.
///
/// There is no local-number field: shared pool lines are hidden from
/// agents, so messages are identified by `conversation_id` and the
/// counterparty `remote_number` only.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessage {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub assignment_id: Uuid,
    /// "inbound" | "outbound"
    pub direction: String,
    pub remote_number: String,
    #[serde(default)]
    pub content: Option<String>,
    /// "message" | "carousel"
    pub message_type: String,
    pub service: IMessageService,
    pub is_read: bool,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub send_style: Option<IMessageSendStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<Vec<IMessageMediaItem>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub was_downgraded: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<IMessageDeliveryStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_detail: Option<String>,
    #[serde(default)]
    pub is_blocked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipients: Option<Vec<IMessageRecipient>>,
    /// Live (non-removed) tapbacks targeting this message, oldest first.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reactions: Option<Vec<IMessageMessageReaction>>,
}

/// One assignment-scoped iMessage conversation.
///
/// `assignment_status` reflects the current connection: non-active
/// means the recipient is disconnected and the agent cannot reply until
/// they reconnect through triage.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessageConversation {
    pub id: Uuid,
    pub assignment_id: Uuid,
    pub remote_number: String,
    pub created_at: String,
    pub updated_at: String,
    // Python defaults a missing/null `assignment_status` to "active".
    #[serde(default = "default_assignment_status")]
    pub assignment_status: IMessageAssignmentStatus,
}

/// Conversation list row with latest-message preview.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessageConversationSummary {
    pub id: Uuid,
    pub assignment_id: Uuid,
    pub remote_number: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_message_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_direction: Option<String>,
    #[serde(default)]
    pub latest_has_media: bool,
    #[serde(default)]
    pub unread_count: i64,
    #[serde(default)]
    pub total_count: i64,
    #[serde(default = "default_assignment_status")]
    pub assignment_status: IMessageAssignmentStatus,
}

/// A tapback reaction on an iMessage.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessageReaction {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub assignment_id: Uuid,
    pub target_message_id: Uuid,
    /// "inbound" | "outbound"
    pub direction: String,
    pub reaction: IMessageReactionType,
    pub remote_number: String,
    pub created_at: String,
    pub updated_at: String,
    /// Literal emoji when reaction is "custom"; None for the classic six.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_emoji: Option<String>,
    #[serde(default)]
    pub part_index: i64,
}

/// Result of marking a conversation's inbound messages read.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessageMarkReadResult {
    pub conversation_id: Uuid,
    pub updated_count: i64,
}

/// A reusable media URL returned by the iMessage media upload.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessageMediaUpload {
    pub media_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<i64>,
}

/// An active connection between one recipient and one agent identity.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessageAssignment {
    pub id: Uuid,
    pub remote_number: String,
    pub agent_identity_id: Uuid,
    pub organization_id: String,
    pub status: IMessageAssignmentStatus,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub released_at: Option<String>,
}

/// The active triage line and how recipients start a connection.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessageTriageNumber {
    pub number: String,
    pub connect_command: String,
}

/// An allow/block rule scoped to an agent identity for iMessage.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessageContactRule {
    pub id: Uuid,
    pub agent_identity_id: Uuid,
    pub action: IMessageRuleAction,
    pub match_type: IMessageRuleMatchType,
    pub match_target: String,
    pub status: ContactRuleStatus,
    pub created_at: String,
    pub updated_at: String,
}

/// Default for `assignment_status` when the server omits it (Python coalesces
/// a missing/null value to `"active"`).
fn default_assignment_status() -> IMessageAssignmentStatus {
    IMessageAssignmentStatus::Active
}
