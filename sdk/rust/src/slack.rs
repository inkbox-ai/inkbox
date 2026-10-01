//! Slack workspace setup, live reads, and durable sends.
//! Slack enums reject unrecognized values; a newer SDK may be required.
//! Action/operation `Unknown` means terminal uncertainty, not a catch-all.
use crate::error::{InkboxError, Result};
use crate::http::{HttpTransport, NO_QUERY};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackApplicationStatus {
    Provisioning,
    Ready,
    Failed,
    Deleting,
    DeleteFailed,
    Deleted,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackApplication {
    pub id: Uuid,
    pub identity_id: Uuid,
    pub app_id: Option<String>,
    pub status: SlackApplicationStatus,
    pub provisioning_workspace_id: Uuid,
    pub created_at: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackAppDeletionStatus {
    WaitingForCreation,
    Pending,
    Running,
    Failed,
    Deleted,
    ManuallyConfirmed,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackAppDeletion {
    pub id: Uuid,
    pub identity_id: Uuid,
    pub application_id: Uuid,
    pub app_id: Option<String>,
    pub app_name: String,
    pub provisioning_workspace_id: Uuid,
    pub status: SlackAppDeletionStatus,
    pub attempts: u32,
    pub retry_at: Option<String>,
    pub error_code: Option<String>,
    pub management_url: String,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackApplicationState {
    pub application: Option<SlackApplication>,
    pub deletion: Option<SlackAppDeletion>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackAppDeletionsResponse {
    pub deletions: Vec<SlackAppDeletion>,
    pub next_cursor: Option<Uuid>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackMessageKind {
    Dm,
    GroupDm,
    Mention,
    Channel,
    Thread,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup: Option<SlackSetupStatus>,
    /// App existence, independent of identity enablement or workspace connections.
    #[serde(default)]
    pub application_created: bool,
    #[serde(default)]
    pub provisioning_workspace: Option<SlackProvisioningWorkspace>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackSetupState {
    NotStarted,
    Pending,
    Ready,
    Failed,
    Unavailable,
    NeedsCredentials,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackSetupStatus {
    pub status: SlackSetupState,
    #[serde(default)]
    pub retry_at: Option<String>,
    #[serde(default)]
    pub error_code: Option<String>,
    #[serde(default)]
    pub provisioning_workspace_id: Option<Uuid>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackProvisioningWorkspaceStatus {
    Ready,
    ReauthorizationRequired,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackProvisioningWorkspace {
    pub id: Uuid,
    pub workspace_id: String,
    pub workspace_name: String,
    pub user_id: String,
    pub status: SlackProvisioningWorkspaceStatus,
    pub token_expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
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
    /// Immediate rate-limit delay in seconds; absent from stored action reads.
    #[serde(default)]
    pub retry_after: Option<u32>,
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
    /// Read app and cleanup status without creating an app or polling.
    pub fn get_application(&self, identity_id: Uuid) -> Result<SlackApplicationState> {
        Ok(serde_json::from_value(self.http.get(
            "/slack/applications",
            &[("identity_id", identity_id.to_string())],
        )?)?)
    }
    /// Permanently remove every installation, retaining saved history. Requires a human organization JWT.
    /// Agent and management API keys cannot perform this action. Pending is not confirmed deletion.
    pub fn delete_application(&self, application_id: Uuid) -> Result<SlackAppDeletion> {
        Ok(serde_json::from_value(self.http.delete_with_response(
            &format!("/slack/applications/{application_id}"),
        )?)?)
    }
    /// One cleanup page including deleted identities; requires a human organization JWT.
    pub fn list_application_deletions(
        &self,
        options: &SlackPageOptions,
    ) -> Result<SlackAppDeletionsResponse> {
        let mut params = vec![("limit", options.limit.unwrap_or(50).to_string())];
        if let Some(cursor) = &options.cursor {
            params.push(("cursor", cursor.clone()));
        }
        Ok(serde_json::from_value(
            self.http.get("/slack/application-deletions", &params)?,
        )?)
    }
    /// Retry after credential repair or manual removal; requires a human organization JWT.
    pub fn retry_application_deletion(&self, deletion_id: Uuid) -> Result<SlackAppDeletion> {
        Ok(serde_json::from_value(self.http.post(
            &format!("/slack/application-deletions/{deletion_id}/retry"),
            Some(&json!({})),
            NO_QUERY,
        )?)?)
    }
    /// Human attestation for unknown creation after quarantine, not provider verification.
    pub fn confirm_manual_app_removal(
        &self,
        deletion_id: Uuid,
        confirmation: &str,
    ) -> Result<SlackAppDeletion> {
        Ok(serde_json::from_value(self.http.post(
            &format!("/slack/application-deletions/{deletion_id}/confirm-manual-removal"),
            Some(&json!({"confirmation": confirmation})),
            NO_QUERY,
        )?)?)
    }
    pub fn list_connections(&self, identity_id: Uuid) -> Result<SlackConnectionsResponse> {
        Ok(serde_json::from_value(self.http.get(
            "/slack/connections",
            &[("identity_id", identity_id.to_string())],
        )?)?)
    }
    /// List saved workspace metadata; credentials are never returned.
    pub fn list_provisioning_workspaces(&self) -> Result<Vec<SlackProvisioningWorkspace>> {
        #[derive(Deserialize)]
        struct Workspaces {
            workspaces: Vec<SlackProvisioningWorkspace>,
        }
        let response: Workspaces =
            serde_json::from_value(self.http.get("/slack/provisioning-workspaces", NO_QUERY)?)?;
        Ok(response.workspaces)
    }
    /// Verify and save configuration credentials for your organization. Claimed agent keys are supported.
    pub fn save_provisioning_workspace(
        &self,
        access_token: &str,
        refresh_token: &str,
    ) -> Result<SlackProvisioningWorkspace> {
        Ok(serde_json::from_value(self.http.post(
            "/slack/provisioning-workspaces",
            Some(&json!({"access_token": access_token, "refresh_token": refresh_token})),
            NO_QUERY,
        )?)?)
    }
    /// Prepare the identity app in a saved workspace; read list_connections for status.
    pub fn start_setup(
        &self,
        identity_id: Uuid,
        provisioning_workspace_id: Uuid,
    ) -> Result<SlackSetupStatus> {
        Ok(serde_json::from_value(self.http.post(
            "/slack/applications/setup",
            Some(&json!({"identity_id": identity_id, "provisioning_workspace_id": provisioning_workspace_id})),
            NO_QUERY,
        )?)?)
    }
    /// Claimed agent keys can install only their own identity.
    /// Open the short-lived opaque URL in a browser; do not log it.
    pub fn start_installation(
        &self,
        identity_id: Uuid,
        workspace_id: Option<&str>,
    ) -> Result<SlackInstallation> {
        self.start_installation_with_return_url(identity_id, workspace_id, None)
    }
    /// Start installation with an optional approved Console completion URL.
    /// None uses the default completion page. Open the returned opaque URL in a browser;
    /// do not log it. Claimed agent keys can install only their own identity.
    pub fn start_installation_with_return_url(
        &self,
        identity_id: Uuid,
        workspace_id: Option<&str>,
        return_url: Option<&str>,
    ) -> Result<SlackInstallation> {
        let mut body = json!({"identity_id":identity_id});
        if let Some(workspace) = workspace_id {
            body["workspace_id"] = json!(workspace);
        }
        if let Some(url) = return_url {
            body["return_url"] = json!(url);
        }
        Ok(serde_json::from_value(self.http.post(
            "/slack/installations",
            Some(&body),
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
    /// Read a send without resending; a 404 does not prove no send occurred.
    pub fn get_action_by_key(
        &self,
        connection_id: Uuid,
        idempotency_key: &str,
    ) -> Result<SlackAction> {
        Ok(serde_json::from_value(self.http.get_with_headers(
            &format!("{}/actions/by-key", base(connection_id)),
            NO_QUERY,
            &[("Idempotency-Key", idempotency_key)],
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
