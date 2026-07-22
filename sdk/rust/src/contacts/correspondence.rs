//! Unified contact correspondence models.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CorrespondenceChannel {
    Email,
    Sms,
    IMessage,
    Calls,
}

impl CorrespondenceChannel {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Email => "email",
            Self::Sms => "sms",
            Self::IMessage => "imessage",
            Self::Calls => "calls",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CorrespondenceContentMode {
    Metadata,
    #[default]
    Preview,
    Full,
}

impl CorrespondenceContentMode {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Metadata => "metadata",
            Self::Preview => "preview",
            Self::Full => "full",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CorrespondenceTranscriptMode {
    #[default]
    None,
    Abridged,
    Full,
}

impl CorrespondenceTranscriptMode {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Abridged => "abridged",
            Self::Full => "full",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CorrespondenceOrder {
    Asc,
    #[default]
    Desc,
}

impl CorrespondenceOrder {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Asc => "asc",
            Self::Desc => "desc",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CorrespondenceChannelStatus {
    Available,
    NoIdentifier,
    NoResource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CorrespondenceDirection {
    Inbound,
    Outbound,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrespondenceMediaMetadata {
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrespondenceAttachmentMetadata {
    #[serde(default)]
    pub filename: Option<String>,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrespondenceTranscriptEntry {
    #[serde(default)]
    pub id: Option<Uuid>,
    #[serde(default)]
    pub seq: Option<u64>,
    #[serde(default)]
    pub party: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub ts_ms: Option<u64>,
    #[serde(default)]
    pub marker: Option<CorrespondenceTranscriptMarker>,
    #[serde(default)]
    pub omitted_turns: Option<u64>,
    #[serde(default)]
    pub omitted_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CorrespondenceTranscriptMarker {
    Abridged,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrespondenceItemBase {
    pub source_id: Uuid,
    pub direction: CorrespondenceDirection,
    pub occurred_at: String,
    pub identity_id: Uuid,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub detail_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailCorrespondenceItem {
    #[serde(flatten)]
    pub common: CorrespondenceItemBase,
    pub mailbox_email: String,
    #[serde(default)]
    pub thread_id: Option<Uuid>,
    pub from_address: String,
    pub to_addresses: Vec<String>,
    #[serde(default)]
    pub cc_addresses: Vec<String>,
    #[serde(default)]
    pub bcc_addresses: Vec<String>,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub snippet: Option<String>,
    #[serde(default)]
    pub body_text: Option<String>,
    #[serde(default)]
    pub content_unavailable: bool,
    #[serde(default)]
    pub attachments: Vec<CorrespondenceAttachmentMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmsCorrespondenceItem {
    #[serde(flatten)]
    pub common: CorrespondenceItemBase,
    pub conversation_id: Uuid,
    pub local_resource_id: Uuid,
    pub local_phone_number: String,
    #[serde(default)]
    pub sender_phone_number: Option<String>,
    pub participants: Vec<String>,
    pub matched_contact_phone: String,
    pub is_group: bool,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub media: Option<CorrespondenceMediaMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IMessageCorrespondenceItem {
    #[serde(flatten)]
    pub common: CorrespondenceItemBase,
    pub conversation_id: Uuid,
    pub remote_handle: String,
    pub service: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub media: Option<CorrespondenceMediaMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallCorrespondenceItem {
    #[serde(flatten)]
    pub common: CorrespondenceItemBase,
    pub remote_phone_number: String,
    #[serde(default)]
    pub local_phone_number: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub ended_at: Option<String>,
    #[serde(default)]
    pub duration_seconds: Option<u64>,
    #[serde(default)]
    pub transcript: Option<Vec<CorrespondenceTranscriptEntry>>,
    #[serde(default)]
    pub transcript_abridged: bool,
    #[serde(default)]
    pub transcript_unavailable: bool,
}

/// A correspondence item parsed by its `channel` discriminator.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "channel", rename_all = "lowercase")]
pub enum CorrespondenceItem {
    Email(EmailCorrespondenceItem),
    Sms(SmsCorrespondenceItem),
    IMessage(IMessageCorrespondenceItem),
    Calls(CallCorrespondenceItem),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrespondenceChannelResult {
    pub channel: CorrespondenceChannel,
    pub status: CorrespondenceChannelStatus,
    pub returned: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactCorrespondence {
    pub contact_id: Uuid,
    pub identity_id: Uuid,
    pub items: Vec<CorrespondenceItem>,
    pub channels: Vec<CorrespondenceChannelResult>,
    #[serde(default)]
    pub next_cursor: Option<String>,
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Map, Value};

    use super::CorrespondenceItem;

    fn item(channel: &str, fields: Value) -> Value {
        let mut value = Map::from_iter([
            ("channel".into(), channel.into()),
            (
                "source_id".into(),
                "11111111-1111-1111-1111-111111111111".into(),
            ),
            ("direction".into(), "inbound".into()),
            ("occurred_at".into(), "2026-07-20T12:00:00Z".into()),
            (
                "identity_id".into(),
                "22222222-2222-2222-2222-222222222222".into(),
            ),
        ]);
        value.extend(fields.as_object().unwrap().clone());
        Value::Object(value)
    }

    #[test]
    fn parses_each_channel_by_tag() {
        let cases = [
            item(
                "email",
                json!({"mailbox_email": "agent@example.com", "from_address": "person@example.com", "to_addresses": []}),
            ),
            item(
                "sms",
                json!({"conversation_id": "33333333-3333-3333-3333-333333333333", "local_resource_id": "44444444-4444-4444-4444-444444444444", "local_phone_number": "+15550000001", "participants": ["+15550000002"], "matched_contact_phone": "+15550000002", "is_group": false}),
            ),
            item(
                "imessage",
                json!({"conversation_id": "33333333-3333-3333-3333-333333333333", "remote_handle": "+15550000002", "service": "imessage"}),
            ),
            item("calls", json!({"remote_phone_number": "+15550000002"})),
        ];

        assert!(matches!(
            serde_json::from_value(cases[0].clone()).unwrap(),
            CorrespondenceItem::Email(_)
        ));
        assert!(matches!(
            serde_json::from_value(cases[1].clone()).unwrap(),
            CorrespondenceItem::Sms(_)
        ));
        assert!(matches!(
            serde_json::from_value(cases[2].clone()).unwrap(),
            CorrespondenceItem::IMessage(_)
        ));
        assert!(matches!(
            serde_json::from_value(cases[3].clone()).unwrap(),
            CorrespondenceItem::Calls(_)
        ));
    }
}
