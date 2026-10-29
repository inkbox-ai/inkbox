//! Approved WhatsApp conversations, quoted replies, reactions, and owned attachments.
use crate::{http::HttpTransport, InkboxError, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;
/// Effective server limits and independent usage. Unknown public policy keys remain available.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppLimits {
    pub agent_identity_id: Uuid,
    pub limits: std::collections::HashMap<String, i64>,
    pub usage: std::collections::HashMap<String, i64>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WhatsAppDirection {
    Inbound,
    Outbound,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WhatsAppMessageStatus {
    Received,
    Queued,
    Sending,
    Sent,
    Delivered,
    Failed,
    Uncertain,
    Cancelled,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WhatsAppDeliveryState {
    Pending,
    Delivered,
    Unknown,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WhatsAppMediaStatus {
    Pending,
    Ready,
    Unavailable,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WhatsAppGroupCreationStatus {
    Pending,
    Creating,
    Ready,
    Uncertain,
    Failed,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WhatsAppReactionType {
    Love,
    Like,
    Dislike,
    Laugh,
    Emphasize,
    Question,
    Eyes,
    Custom,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WhatsAppReactionStatus {
    Queued,
    Sending,
    Applied,
    Removed,
    Failed,
    Uncertain,
    Superseded,
}
/// A versioned receipt. Queued and uncertain reactions are not applied live state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppReaction {
    pub id: Uuid,
    pub target_message_id: Uuid,
    pub conversation_id: Uuid,
    pub agent_identity_id: Uuid,
    pub direction: WhatsAppDirection,
    pub remote_number: Option<String>,
    pub reaction: WhatsAppReactionType,
    pub custom_emoji: Option<String>,
    pub emoji: String,
    pub status: WhatsAppReactionStatus,
    pub revision: u64,
    pub created_at: String,
    pub updated_at: String,
    pub removed_at: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize)]
pub struct WhatsAppReactionOptions {
    pub message_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reaction: Option<WhatsAppReactionType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_emoji: Option<String>,
    #[serde(skip)]
    pub idempotency_key: String,
    #[serde(skip)]
    pub agent_identity_id: Option<Uuid>,
}
#[derive(Debug, Clone, Default)]
pub struct WhatsAppThreadOptions {
    pub agent_identity_id: Option<Uuid>,
    pub limit: Option<u64>,
    pub cursor: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppThread {
    pub conversation_id: Uuid,
    pub thread_id: Option<Uuid>,
    pub thread_root_message_id: Option<Uuid>,
    pub messages: Vec<WhatsAppMessage>,
    pub next_cursor: Option<String>,
}
fn valid_phone(value: &str) -> bool {
    value.strip_prefix('+').is_some_and(|digits| {
        (7..=15).contains(&digits.len())
            && !digits.starts_with('0')
            && digits.bytes().all(|char| char.is_ascii_digit())
    })
}
fn reaction_key(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.chars().count() > 255 {
        return Err(InkboxError::InvalidArgument(
            "A stable idempotency key is required".into(),
        ));
    }
    Ok(())
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppMedia {
    pub id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size: Option<u64>,
    pub status: WhatsAppMediaStatus,
    pub url: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppRecipient {
    pub remote_number: String,
    pub delivery_status: WhatsAppMessageStatus,
    pub delivery_state: WhatsAppDeliveryState,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    pub sent_at: Option<String>,
    pub delivered_at: Option<String>,
    pub failed_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppMessage {
    pub id: Uuid,
    pub agent_identity_id: Uuid,
    pub conversation_id: Uuid,
    pub direction: WhatsAppDirection,
    pub local_number: String,
    pub remote_number: Option<String>,
    pub sender_number: String,
    pub participants: Vec<String>,
    pub is_group: bool,
    pub content: Option<String>,
    pub media: Vec<WhatsAppMedia>,
    pub status: WhatsAppMessageStatus,
    pub delivery_state: Option<WhatsAppDeliveryState>,
    pub recipients: Vec<WhatsAppRecipient>,
    pub is_read: bool,
    pub is_blocked: bool,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    pub source_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub sent_at: Option<String>,
    pub delivered_at: Option<String>,
    pub failed_at: Option<String>,
    pub status_observed_at: Option<String>,
    pub status_refresh_pending: bool,
    #[serde(default)]
    pub reply_to_message_id: Option<Uuid>,
    #[serde(default)]
    pub thread_id: Option<Uuid>,
    #[serde(default)]
    pub thread_root_message_id: Option<Uuid>,
    #[serde(default)]
    pub reactions: Vec<WhatsAppReaction>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppConversation {
    pub id: Uuid,
    pub agent_identity_id: Uuid,
    pub local_number: String,
    pub remote_number: Option<String>,
    pub participants: Vec<String>,
    pub is_group: bool,
    #[serde(default)]
    pub group_name: Option<String>,
    #[serde(default)]
    pub group_creation_status: Option<WhatsAppGroupCreationStatus>,
    #[serde(default)]
    pub unresolved_participant_count: u64,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppConversationSummary {
    #[serde(flatten)]
    pub conversation: WhatsAppConversation,
    pub latest_text: Option<String>,
    pub latest_message_at: Option<String>,
    pub latest_direction: Option<WhatsAppDirection>,
    pub latest_has_media: bool,
    pub unread_count: u64,
    pub total_count: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppMarkReadResult {
    pub conversation_id: Uuid,
    pub updated_count: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppChannelStatus {
    pub enabled: bool,
    pub number: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WhatsAppRecipients {
    One(String),
    Many(Vec<String>),
}
#[derive(Debug, Clone, Default, Serialize)]
pub struct WhatsAppSendOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<WhatsAppRecipients>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to_message_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Defaults to true. False requires native quoting; unavailable evidence or uncertain sends never trigger a plain replacement.
    pub plain_reply_fallback: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_ids: Option<Vec<Uuid>>,
    #[serde(skip)]
    pub agent_identity_id: Option<Uuid>,
    #[serde(skip)]
    pub idempotency_key: Option<String>,
}
#[derive(Debug, Clone, Default)]
pub struct WhatsAppListOptions {
    pub agent_identity_id: Option<Uuid>,
    pub conversation_id: Option<Uuid>,
    pub thread_id: Option<Uuid>,
    pub include_groups: Option<bool>,
    pub start_datetime: Option<String>,
    pub end_datetime: Option<String>,
    pub tz: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
    pub is_read: Option<bool>,
    pub is_blocked: Option<bool>,
}
fn owner(id: Option<&Uuid>) -> Vec<(&'static str, String)> {
    id.map(|id| vec![("agent_identity_id", id.to_string())])
        .unwrap_or_default()
}
pub struct WhatsAppResource {
    http: Arc<HttpTransport>,
}
impl WhatsAppResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }
    /// Queue one logical send. Reuse its key and owned media IDs after uncertainty.
    pub fn send(&self, o: &WhatsAppSendOptions) -> Result<WhatsAppMessage> {
        if o.to.is_some() == o.conversation_id.is_some() {
            return Err(InkboxError::InvalidArgument(
                "Specify exactly one of to or conversation_id".into(),
            ));
        }
        let recipients: Vec<&str> = match &o.to {
            Some(WhatsAppRecipients::One(value)) => vec![value],
            Some(WhatsAppRecipients::Many(values)) => values.iter().map(String::as_str).collect(),
            None => vec![],
        };
        if o.to.is_some()
            && (recipients.is_empty()
                || recipients.len() > 8
                || recipients.iter().any(|value| !valid_phone(value))
                || recipients
                    .iter()
                    .collect::<std::collections::HashSet<_>>()
                    .len()
                    != recipients.len())
        {
            return Err(InkboxError::InvalidArgument(
                "Provide 1–8 unique E.164 recipients".into(),
            ));
        }
        if o.reply_to_message_id.is_some() && o.conversation_id.is_none() {
            return Err(InkboxError::InvalidArgument(
                "reply_to_message_id requires conversation_id".into(),
            ));
        }
        if let Some(name) = &o.group_name {
            if !matches!(&o.to, Some(WhatsAppRecipients::Many(values)) if values.len() >= 2)
                || name.trim().is_empty()
                || name.chars().count() > 100
            {
                return Err(InkboxError::InvalidArgument(
                    "group_name requires a recipient-list group and 1–100 characters".into(),
                ));
            }
        }
        if o.media_ids.as_ref().is_some_and(|v| v.len() > 1) {
            return Err(InkboxError::InvalidArgument(
                "WhatsApp supports at most one attachment".into(),
            ));
        }
        if o.text.as_ref().map_or(true, |v| v.trim().is_empty())
            && o.media_ids.as_ref().map_or(true, |v| v.is_empty())
        {
            return Err(InkboxError::InvalidArgument(
                "Provide text or one media ID".into(),
            ));
        }
        if o.text.as_ref().is_some_and(|v| v.chars().count() > 4000) {
            return Err(InkboxError::InvalidArgument(
                "WhatsApp text must be at most 4000 characters".into(),
            ));
        }
        let mut body = serde_json::to_value(o)?;
        if o.reply_to_message_id.is_none() || o.plain_reply_fallback != Some(false) {
            body.as_object_mut()
                .expect("send options serialize to an object")
                .remove("plain_reply_fallback");
        }
        let data = self.http.post_message(
            "/messages",
            &body,
            &owner(o.agent_identity_id.as_ref()),
            o.idempotency_key.as_deref(),
        )?;
        Ok(serde_json::from_value(data["message"].clone())?)
    }
    pub fn get(&self, id: &Uuid, identity: Option<&Uuid>) -> Result<WhatsAppMessage> {
        Ok(serde_json::from_value(
            self.http
                .get(&format!("/messages/{id}"), &owner(identity))?,
        )?)
    }
    pub fn list(&self, o: &WhatsAppListOptions) -> Result<Vec<WhatsAppMessage>> {
        let mut p = owner(o.agent_identity_id.as_ref());
        p.push(("limit", o.limit.unwrap_or(50).to_string()));
        p.push(("offset", o.offset.unwrap_or(0).to_string()));
        if let Some(v) = o.conversation_id {
            p.push(("conversation_id", v.to_string()));
        }
        if let Some(v) = o.thread_id {
            if o.conversation_id.is_none() {
                return Err(InkboxError::InvalidArgument(
                    "thread_id requires conversation_id".into(),
                ));
            }
            p.push(("thread_id", v.to_string()));
        }
        p.push((
            "include_groups",
            o.include_groups.unwrap_or(false).to_string(),
        ));
        for (name, value) in [
            ("start_datetime", &o.start_datetime),
            ("end_datetime", &o.end_datetime),
            ("tz", &o.tz),
        ] {
            if let Some(value) = value {
                p.push((name, value.clone()));
            }
        }
        if let Some(v) = o.is_read {
            p.push(("is_read", v.to_string()));
        }
        if let Some(v) = o.is_blocked {
            p.push(("is_blocked", v.to_string()));
        }
        Ok(serde_json::from_value(self.http.get("/messages", &p)?)?)
    }
    pub fn list_conversations(
        &self,
        o: &WhatsAppListOptions,
    ) -> Result<Vec<WhatsAppConversationSummary>> {
        let mut p = owner(o.agent_identity_id.as_ref());
        p.push(("limit", o.limit.unwrap_or(50).to_string()));
        p.push(("offset", o.offset.unwrap_or(0).to_string()));
        p.push((
            "include_groups",
            o.include_groups.unwrap_or(false).to_string(),
        ));
        for (name, value) in [
            ("start_datetime", &o.start_datetime),
            ("end_datetime", &o.end_datetime),
            ("tz", &o.tz),
        ] {
            if let Some(value) = value {
                p.push((name, value.clone()));
            }
        }
        if let Some(v) = o.is_blocked {
            p.push(("is_blocked", v.to_string()));
        }
        Ok(serde_json::from_value(
            self.http.get("/conversations", &p)?,
        )?)
    }
    pub fn get_conversation(
        &self,
        id: &Uuid,
        identity: Option<&Uuid>,
    ) -> Result<WhatsAppConversation> {
        Ok(serde_json::from_value(
            self.http
                .get(&format!("/conversations/{id}"), &owner(identity))?,
        )?)
    }
    pub fn get_thread(&self, id: &Uuid, o: &WhatsAppThreadOptions) -> Result<WhatsAppThread> {
        self.thread_page(&format!("/messages/{id}/thread"), o)
    }
    pub fn get_conversation_thread(
        &self,
        conversation: &Uuid,
        thread: &Uuid,
        o: &WhatsAppThreadOptions,
    ) -> Result<WhatsAppThread> {
        self.thread_page(
            &format!("/conversations/{conversation}/threads/{thread}"),
            o,
        )
    }
    fn thread_page(&self, path: &str, o: &WhatsAppThreadOptions) -> Result<WhatsAppThread> {
        let limit = o.limit.unwrap_or(50);
        if !(1..=200).contains(&limit) {
            return Err(InkboxError::InvalidArgument(
                "Thread limit must be 1–200".into(),
            ));
        }
        let mut params = owner(o.agent_identity_id.as_ref());
        params.push(("limit", limit.to_string()));
        if let Some(cursor) = &o.cursor {
            params.push(("cursor", cursor.clone()));
        }
        Ok(serde_json::from_value(self.http.get(path, &params)?)?)
    }
    pub fn send_reaction(&self, o: &WhatsAppReactionOptions) -> Result<WhatsAppReaction> {
        reaction_key(&o.idempotency_key)?;
        if o.reaction.is_some() == o.custom_emoji.is_some()
            || o.reaction == Some(WhatsAppReactionType::Custom)
        {
            return Err(InkboxError::InvalidArgument(
                "Provide exactly one named reaction or custom_emoji".into(),
            ));
        }
        if let Some(emoji) = &o.custom_emoji {
            if emoji.is_empty()
                || emoji.chars().count() > 32
                || emoji
                    .chars()
                    .any(|value| value.is_whitespace() || value.is_control())
            {
                return Err(InkboxError::InvalidArgument(
                    "custom_emoji must contain 1–32 non-whitespace characters".into(),
                ));
            }
        }
        let result = self.http.post_with_headers(
            "/reactions",
            Some(o),
            &owner(o.agent_identity_id.as_ref()),
            &[("Idempotency-Key", &o.idempotency_key)],
        )?;
        Ok(serde_json::from_value(result["reaction"].clone())?)
    }
    pub fn get_reaction(&self, id: &Uuid, identity: Option<&Uuid>) -> Result<WhatsAppReaction> {
        let result = self
            .http
            .get(&format!("/reactions/{id}"), &owner(identity))?;
        Ok(serde_json::from_value(result["reaction"].clone())?)
    }
    pub fn remove_reaction(
        &self,
        id: &Uuid,
        key: &str,
        identity: Option<&Uuid>,
    ) -> Result<WhatsAppReaction> {
        reaction_key(key)?;
        let result = self.http.delete_with_response_params_and_headers(
            &format!("/reactions/{id}"),
            &owner(identity),
            &[("Idempotency-Key", key)],
        )?;
        Ok(serde_json::from_value(result["reaction"].clone())?)
    }
    pub fn upload_media(
        &self,
        content: Vec<u8>,
        filename: &str,
        content_type: Option<&str>,
        identity: Option<&Uuid>,
    ) -> Result<WhatsAppMedia> {
        if content.len() > 20 * 1024 * 1024 {
            return Err(InkboxError::InvalidArgument(
                "WhatsApp media must be at most 20 MiB".into(),
            ));
        }
        Ok(serde_json::from_value(
            self.http.post_multipart_with_params(
                "/media",
                "file",
                filename,
                content,
                content_type.unwrap_or("application/octet-stream"),
                &owner(identity),
            )?,
        )?)
    }
    pub fn get_media(&self, id: &Uuid, identity: Option<&Uuid>) -> Result<WhatsAppMedia> {
        Ok(serde_json::from_value(
            self.http.get(&format!("/media/{id}"), &owner(identity))?,
        )?)
    }
    /// Mark local history read through an exact visible boundary, without a remote receipt.
    pub fn mark_read(
        &self,
        conversation_id: &Uuid,
        through_message_id: &Uuid,
        identity: Option<&Uuid>,
    ) -> Result<WhatsAppMarkReadResult> {
        Ok(serde_json::from_value(self.http.post(
            "/mark-read",
            Some(
                &json!({"conversation_id":conversation_id,"through_message_id":through_message_id}),
            ),
            &owner(identity),
        )?)?)
    }
    pub fn get_limits(&self, identity: Option<&Uuid>) -> Result<WhatsAppLimits> {
        Ok(serde_json::from_value(
            self.http.get("/limits", &owner(identity))?,
        )?)
    }
}
