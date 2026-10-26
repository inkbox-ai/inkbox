//! Dedicated, approved one-to-one WhatsApp and owned attachments.
use crate::{http::HttpTransport, InkboxError, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;
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
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsAppConversation {
    pub id: Uuid,
    pub agent_identity_id: Uuid,
    pub local_number: String,
    pub remote_number: Option<String>,
    pub participants: Vec<String>,
    pub is_group: bool,
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
        if matches!(&o.to,Some(WhatsAppRecipients::Many(v)) if v.len()!=1) {
            return Err(InkboxError::InvalidArgument(
                "WhatsApp supports exactly one recipient".into(),
            ));
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
        let data = self.http.post_message(
            "/messages",
            &serde_json::to_value(o)?,
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
}
