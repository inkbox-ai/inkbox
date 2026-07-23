//! Types mirroring the Inkbox iMessage API response models.
//!
//! iMessage messages and conversations are keyed by `conversation_id`.
//! One-to-one rows also expose assignment and remote-number state; dedicated-
//! outbound groups instead expose participant snapshots. Dedicated number
//! ownership is exposed separately through [`IMessageNumber`].

use uuid::Uuid;

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    <Option<T> as serde::Deserialize>::deserialize(deserializer)
}

// `ContactRuleStatus` lives in the mail domain; Python imports it from
// `inkbox.mail.types`, so we re-export the shared type rather than duplicate it.
pub use crate::mail::types::ContactRuleStatus;

/// Role of a dedicated iMessage number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageNumberType {
    DedicatedInbound,
    DedicatedOutbound,
}

impl IMessageNumberType {
    /// The value sent to the API.
    pub fn as_str(&self) -> &'static str {
        match self {
            IMessageNumberType::DedicatedInbound => "dedicated_inbound",
            IMessageNumberType::DedicatedOutbound => "dedicated_outbound",
        }
    }

    /// Whether this number may start a new conversation.
    pub fn can_start_conversation(&self) -> bool {
        matches!(self, IMessageNumberType::DedicatedOutbound)
    }
}

/// Lifecycle state of an iMessage service number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageNumberStatus {
    Active,
    Paused,
}

/// An organization-owned dedicated iMessage number.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessageNumber {
    pub id: Uuid,
    /// E.164 number.
    pub number: String,
    pub r#type: IMessageNumberType,
    pub status: IMessageNumberStatus,
    /// Attached identity, or `None` while the number is available to the org.
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub agent_identity_id: Option<Uuid>,
    /// Attached identity handle, or `None` while the number is available.
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub agent_handle: Option<String>,
}

impl IMessageNumber {
    /// Whether this number may start a new conversation.
    pub fn can_start_conversation(&self) -> bool {
        self.r#type.can_start_conversation()
    }
}

/// Dedicated iMessage number embedded in a detailed identity response.
///
/// This shape is intentionally slimmer than [`IMessageNumber`]: attachment
/// and lifecycle fields are only present on the organization number endpoints.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IdentityIMessageNumber {
    pub id: Uuid,
    /// E.164 number.
    pub number: String,
    pub r#type: IMessageNumberType,
}

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
/// (carried in `custom_emoji`). Sends accept the seven named reactions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageReactionType {
    Love,
    Like,
    Dislike,
    Laugh,
    Emphasize,
    Question,
    Eyes,
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

/// Lifecycle of a local group conversation's initial creation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IMessageGroupCreationStatus {
    /// The initial remote group thread is still being created.
    Creating,
    /// No remote group thread is bound; the next send retries creation.
    NotCreated,
    /// The remote group thread is bound and ready for sends.
    Ready,
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
            IMessageReactionType::Eyes => "eyes",
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

/// An iMessage in a one-to-one or group conversation.
///
/// Group rows have no assignment, carry a best-known participant snapshot,
/// and expose per-recipient outbound delivery state.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessage {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub assignment_id: Option<Uuid>,
    /// "inbound" | "outbound"
    pub direction: String,
    pub remote_number: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sender_number: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub participants: Option<Vec<String>>,
    #[serde(default)]
    pub is_group: bool,
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

/// One iMessage conversation.
///
/// One-to-one rows expose assignment state. Group rows have no assignment and
/// expose a best-known participant snapshot and creation lifecycle instead.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessageConversation {
    pub id: Uuid,
    pub assignment_id: Option<Uuid>,
    pub remote_number: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    // Missing legacy status defaults to active; explicit group null stays None.
    #[serde(default = "default_optional_assignment_status")]
    pub assignment_status: Option<IMessageAssignmentStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub participants: Option<Vec<String>>,
    #[serde(default)]
    pub is_group: bool,
    /// Group lifecycle; `None` for one-to-one conversations and older responses.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_creation_status: Option<IMessageGroupCreationStatus>,
}

/// Conversation list row with latest-message preview.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessageConversationSummary {
    pub id: Uuid,
    pub assignment_id: Option<Uuid>,
    pub remote_number: Option<String>,
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
    #[serde(default = "default_optional_assignment_status")]
    pub assignment_status: Option<IMessageAssignmentStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub participants: Option<Vec<String>>,
    #[serde(default)]
    pub is_group: bool,
    /// Group lifecycle; `None` for one-to-one conversations and older responses.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_creation_status: Option<IMessageGroupCreationStatus>,
}

/// A tapback reaction on an iMessage.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IMessageReaction {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub assignment_id: Option<Uuid>,
    pub target_message_id: Uuid,
    /// "inbound" | "outbound"
    pub direction: String,
    pub reaction: IMessageReactionType,
    pub remote_number: String,
    pub created_at: String,
    pub updated_at: String,
    /// Literal emoji when reaction is "custom"; None for named reactions.
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

/// Default for `assignment_status` when an older response omits it.
fn default_assignment_status() -> IMessageAssignmentStatus {
    IMessageAssignmentStatus::Active
}

fn default_optional_assignment_status() -> Option<IMessageAssignmentStatus> {
    Some(default_assignment_status())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn reaction_types_keep_named_eyes_distinct_from_inbound_custom() {
        assert_eq!(IMessageReactionType::Eyes.as_str(), "eyes");
        assert_eq!(
            serde_json::from_value::<IMessageReactionType>(json!("custom")).unwrap(),
            IMessageReactionType::Custom
        );
    }

    #[test]
    fn number_type_serializes_to_wire_value() {
        assert_eq!(
            serde_json::to_value(IMessageNumberType::DedicatedInbound).unwrap(),
            json!("dedicated_inbound")
        );
        assert_eq!(
            serde_json::to_value(IMessageNumberType::DedicatedOutbound).unwrap(),
            json!("dedicated_outbound")
        );
    }

    #[test]
    fn outbound_capability_is_derived_from_number_type() {
        assert!(!IMessageNumberType::DedicatedInbound.can_start_conversation());
        assert!(IMessageNumberType::DedicatedOutbound.can_start_conversation());
    }

    #[test]
    fn number_attachment_fields_accept_null() {
        let number: IMessageNumber = serde_json::from_value(json!({
            "id": "11111111-1111-1111-1111-111111111111",
            "number": "+15550001111",
            "type": "dedicated_inbound",
            "status": "paused",
            "agent_identity_id": null,
            "agent_handle": null
        }))
        .unwrap();
        assert_eq!(number.agent_identity_id, None);
        assert_eq!(number.agent_handle, None);
    }

    #[test]
    fn number_attachment_fields_are_required() {
        let result = serde_json::from_value::<IMessageNumber>(json!({
            "id": "11111111-1111-1111-1111-111111111111",
            "number": "+15550001111",
            "type": "dedicated_inbound",
            "status": "active"
        }));
        assert!(result.is_err());
    }

    #[test]
    fn group_message_fields_deserialize_without_an_assignment() {
        let message: IMessage = serde_json::from_value(json!({
            "id": "22222222-2222-2222-2222-222222222222",
            "conversation_id": "33333333-3333-3333-3333-333333333333",
            "assignment_id": null,
            "direction": "inbound",
            "remote_number": "+15550001111",
            "sender_number": "+15550001111",
            "participants": ["+15550001111", "+15550002222"],
            "is_group": true,
            "message_type": "message",
            "service": "imessage",
            "is_read": false,
            "created_at": "2026-07-22T00:00:00Z",
            "updated_at": "2026-07-22T00:00:00Z"
        }))
        .unwrap();

        assert!(message.is_group);
        assert_eq!(message.assignment_id, None);
        assert_eq!(message.remote_number.as_deref(), Some("+15550001111"));
        assert_eq!(message.sender_number.as_deref(), Some("+15550001111"));
        assert_eq!(message.participants.unwrap().len(), 2);
    }

    #[test]
    fn missing_legacy_assignment_status_stays_active_but_group_null_stays_null() {
        let legacy: IMessageConversation = serde_json::from_value(json!({
            "id": "33333333-3333-3333-3333-333333333333",
            "assignment_id": "44444444-4444-4444-4444-444444444444",
            "remote_number": "+15550001111",
            "created_at": "2026-07-22T00:00:00Z",
            "updated_at": "2026-07-22T00:00:00Z"
        }))
        .unwrap();
        assert_eq!(
            legacy.assignment_status,
            Some(IMessageAssignmentStatus::Active)
        );

        let group: IMessageConversation = serde_json::from_value(json!({
            "id": "33333333-3333-3333-3333-333333333333",
            "assignment_id": null,
            "assignment_status": null,
            "remote_number": null,
            "participants": ["+15550001111", "+15550002222"],
            "is_group": true,
            "group_creation_status": "not_created",
            "created_at": "2026-07-22T00:00:00Z",
            "updated_at": "2026-07-22T00:00:00Z"
        }))
        .unwrap();
        assert_eq!(group.assignment_status, None);
        assert!(group.is_group);
        assert_eq!(
            group.group_creation_status,
            Some(IMessageGroupCreationStatus::NotCreated)
        );
    }
}
