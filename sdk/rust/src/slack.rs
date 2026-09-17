//! Live Slack reads and durable sends; use invitation URLs for browser onboarding.
use crate::error::{InkboxError, Result};
use crate::http::{HttpTransport, NO_QUERY};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackMessageKind {
    Dm,
    GroupDm,
    Mention,
    Channel,
    Thread,
}
/// Selectors combine with AND; message kinds with OR. Null means all.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SlackWebhookFilter {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_ids: Option<Vec<Uuid>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_kinds: Option<Vec<SlackMessageKind>>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackConnectionStatus {
    Connected,
    Disconnected,
    ReauthorizationRequired,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackConnection {
    pub id: Uuid,
    pub identity_id: Uuid,
    pub workspace_id: String,
    pub workspace_name: String,
    pub bot_user_id: String,
    pub status: SlackConnectionStatus,
    pub scopes: Vec<String>,
    pub created_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackConnectionsResponse {
    pub connections: Vec<SlackConnection>,
    pub installation_available: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackInvitation {
    pub id: Uuid,
    pub identity_id: Uuid,
    pub status: String,
    pub expires_at: String,
    #[serde(default)]
    pub invitation_url: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackInstallation {
    pub authorization_url: String,
    pub expires_at: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackActionStatus {
    Sending,
    Sent,
    Failed,
    Unknown,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackAction {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub status: SlackActionStatus,
    pub conversation_id: String,
    #[serde(default)]
    pub message_ts: Option<String>,
    #[serde(default)]
    pub thread_ts: Option<String>,
    #[serde(default)]
    pub error_code: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackConversationsResponse {
    pub conversations: Vec<serde_json::Map<String, Value>>,
    #[serde(default)]
    pub next_cursor: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackMessagesResponse {
    pub messages: Vec<serde_json::Map<String, Value>>,
    #[serde(default)]
    pub next_cursor: Option<String>,
    #[serde(default)]
    pub has_more: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackFile {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub mimetype: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub downloadable: bool,
}
#[derive(Debug, Clone, Default)]
pub struct SlackPageOptions {
    pub limit: Option<u32>,
    pub cursor: Option<String>,
}
#[derive(Debug, Clone, Default)]
pub struct SlackMessagesOptions {
    pub limit: Option<u32>,
    pub cursor: Option<String>,
    pub thread_ts: Option<String>,
}
#[derive(Debug, Clone)]
pub struct SlackSendMessageOptions {
    pub conversation_id: String,
    pub text: String,
    pub idempotency_key: String,
    pub thread_ts: Option<String>,
}
pub(crate) fn base(id: Uuid) -> String {
    format!("/slack/connections/{id}")
}
pub(crate) fn segment(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}
#[derive(Clone)]
pub struct SlackResource {
    pub(crate) http: Arc<HttpTransport>,
}
impl SlackResource {
    pub(crate) fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }
    pub fn list_connections(&self, identity_id: Uuid) -> Result<SlackConnectionsResponse> {
        Ok(serde_json::from_value(self.http.get(
            "/slack/connections",
            &[("identity_id", identity_id.to_string())],
        )?)?)
    }
    /// Open the one-time invitation_url in a browser. Organization management only.
    pub fn create_invitation(
        &self,
        identity_id: Uuid,
        expires_in_seconds: Option<u32>,
    ) -> Result<SlackInvitation> {
        Ok(serde_json::from_value(self.http.post("/slack/invitations", Some(&json!({"identity_id":identity_id, "expires_in_seconds":expires_in_seconds.unwrap_or(86400)})), NO_QUERY)?)?)
    }
    /// Open the short-lived opaque URL in a browser; do not log it. Organization management only.
    pub fn start_installation(
        &self,
        identity_id: Uuid,
        workspace_id: Option<&str>,
    ) -> Result<SlackInstallation> {
        let mut body = json!({"identity_id":identity_id});
        if let Some(workspace) = workspace_id {
            body["workspace_id"] = json!(workspace);
        }
        Ok(serde_json::from_value(self.http.post(
            "/slack/installations",
            Some(&body),
            NO_QUERY,
        )?)?)
    }
    pub fn list_invitations(&self, identity_id: Uuid) -> Result<Vec<SlackInvitation>> {
        Ok(serde_json::from_value(self.http.get(
            "/slack/invitations",
            &[("identity_id", identity_id.to_string())],
        )?)?)
    }
    pub fn revoke_invitation(&self, id: Uuid) -> Result<SlackInvitation> {
        Ok(serde_json::from_value(self.http.post::<Value>(
            &format!("/slack/invitations/{id}/revoke"),
            None,
            NO_QUERY,
        )?)?)
    }
    /// Remove Inkbox authority locally; this does not uninstall the Slack app.
    pub fn disconnect(&self, connection_id: Uuid) -> Result<SlackConnection> {
        Ok(serde_json::from_value(self.http.post::<Value>(
            &format!("{}/disconnect", base(connection_id)),
            None,
            NO_QUERY,
        )?)?)
    }
    pub fn list_conversations(
        &self,
        connection_id: Uuid,
        options: &SlackPageOptions,
    ) -> Result<SlackConversationsResponse> {
        let mut params = vec![("limit", options.limit.unwrap_or(100).to_string())];
        if let Some(cursor) = &options.cursor {
            params.push(("cursor", cursor.clone()));
        }
        Ok(serde_json::from_value(self.http.get(
            &format!("{}/conversations", base(connection_id)),
            &params,
        )?)?)
    }
    pub fn open_conversation(
        &self,
        connection_id: Uuid,
        user_ids: &[String],
    ) -> Result<serde_json::Map<String, Value>> {
        Ok(serde_json::from_value(self.http.post(
            &format!("{}/conversations", base(connection_id)),
            Some(&json!({"user_ids":user_ids})),
            NO_QUERY,
        )?)?)
    }
    pub fn get_conversation(
        &self,
        connection_id: Uuid,
        conversation_id: &str,
    ) -> Result<serde_json::Map<String, Value>> {
        Ok(serde_json::from_value(self.http.get(
            &format!(
                "{}/conversations/{}",
                base(connection_id),
                segment(conversation_id)
            ),
            NO_QUERY,
        )?)?)
    }
    pub fn list_messages(
        &self,
        connection_id: Uuid,
        conversation_id: &str,
        options: &SlackMessagesOptions,
    ) -> Result<SlackMessagesResponse> {
        let mut params = vec![("limit", options.limit.unwrap_or(15).to_string())];
        if let Some(cursor) = &options.cursor {
            params.push(("cursor", cursor.clone()));
        }
        if let Some(ts) = &options.thread_ts {
            params.push(("thread_ts", ts.clone()));
        }
        Ok(serde_json::from_value(self.http.get(
            &format!(
                "{}/conversations/{}/messages",
                base(connection_id),
                segment(conversation_id)
            ),
            &params,
        )?)?)
    }
    /// Keep a stable key for this exact message. Poll get_action while sending. Unknown is terminal uncertainty; never blindly resend.
    pub fn send_message(
        &self,
        connection_id: Uuid,
        options: &SlackSendMessageOptions,
    ) -> Result<SlackAction> {
        let key = &options.idempotency_key;
        if key.is_empty()
            || key.len() > 128
            || !key
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c))
        {
            return Err(InkboxError::InvalidArgument(
                "idempotency_key must be 1..128 letters, digits, '.', '_', ':', or '-'".into(),
            ));
        }
        let mut body = json!({"conversation_id":options.conversation_id,"text":options.text});
        if let Some(ts) = &options.thread_ts {
            body["thread_ts"] = json!(ts);
        }
        Ok(serde_json::from_value(self.http.post_with_headers(
            &format!("{}/messages", base(connection_id)),
            Some(&body),
            NO_QUERY,
            &[("Idempotency-Key", key)],
        )?)?)
    }
    pub fn get_action(&self, connection_id: Uuid, action_id: Uuid) -> Result<SlackAction> {
        Ok(serde_json::from_value(self.http.get(
            &format!("{}/actions/{action_id}", base(connection_id)),
            NO_QUERY,
        )?)?)
    }
    pub fn get_file(&self, connection_id: Uuid, file_id: &str) -> Result<SlackFile> {
        Ok(serde_json::from_value(self.http.get(
            &format!("{}/files/{}", base(connection_id), segment(file_id)),
            NO_QUERY,
        )?)?)
    }
    pub fn download_file(&self, connection_id: Uuid, file_id: &str) -> Result<Vec<u8>> {
        self.http.get_bytes(
            &format!("{}/files/{}/content", base(connection_id), segment(file_id)),
            "application/octet-stream",
            NO_QUERY,
        )
    }
}
