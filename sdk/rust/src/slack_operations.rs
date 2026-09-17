//! Scoped utility actions and retained history. No automatic pagination or mutation retry.
use crate::error::{InkboxError, Result};
use crate::http::NO_QUERY;
use crate::slack::{base, segment, SlackPageOptions, SlackResource};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackProcessingStatus {
    Active,
    Processing,
    Suspended,
    Closed,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackOperationKind {
    ReactionAdd,
    ReactionRemove,
    PinAdd,
    PinRemove,
    MessageUpdate,
    MessageDelete,
    FileUpload,
    ConversationJoin,
    ConversationLeave,
    ProcessingStatus,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackOperationStatus {
    InProgress,
    Succeeded,
    Failed,
    Unknown,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackOperation {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub operation: SlackOperationKind,
    pub status: SlackOperationStatus,
    pub conversation_id: String,
    pub message_ts: Option<String>,
    pub file_id: Option<String>,
    pub error_code: Option<String>,
    pub retry_after: Option<u32>,
    pub processing_status: Option<SlackProcessingStatus>,
    pub agent_status: Option<SlackProcessingStatus>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackCapability {
    pub required_scopes: Vec<String>,
    pub missing_scopes: Vec<String>,
    pub scopes_satisfied: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackNativeProcessingStatus {
    Unknown,
    MissingScope,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackCapabilitiesResponse {
    pub connection_id: Uuid,
    pub scopes: Vec<String>,
    pub missing_scopes: Vec<String>,
    pub capabilities: HashMap<String, SlackCapability>,
    pub native_processing_status: SlackNativeProcessingStatus,
    pub max_upload_bytes: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackUsersResponse {
    pub users: Vec<Map<String, Value>>,
    pub next_cursor: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackMembersResponse {
    pub members: Vec<String>,
    pub next_cursor: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackPinsResponse {
    pub items: Vec<Map<String, Value>>,
    pub truncated: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackReactionsResponse {
    pub conversation_id: String,
    pub message_ts: String,
    pub reactions: Vec<Map<String, Value>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackMessageContextResponse {
    pub messages: Vec<Map<String, Value>>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    pub window: String,
    pub complete: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackPermalinkResponse {
    pub conversation_id: String,
    pub message_ts: String,
    pub permalink: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackArchiveSettings {
    pub capture_enabled: bool,
    pub retention_days: Option<u32>,
    pub conversation_ids: Vec<String>,
    pub revision: u32,
}
#[derive(Debug, Clone, Default, Serialize)]
pub struct SlackArchiveSettingsOptions {
    pub capture_enabled: bool,
    pub retention_days: Option<u32>,
    pub conversation_ids: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackArchiveSource {
    Event,
    Backfill,
    Action,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackArchivedMessage {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub conversation_id: String,
    pub message_ts: String,
    pub thread_ts: Option<String>,
    pub user_id: Option<String>,
    pub text: String,
    pub files: Vec<Map<String, Value>>,
    pub mentioned: bool,
    pub source: SlackArchiveSource,
    pub source_url: Option<String>,
    pub captured_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackArchiveMessagesResponse {
    pub messages: Vec<SlackArchivedMessage>,
    pub next_cursor: Option<String>,
    pub source: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackArchiveCoverageStatus {
    Observed,
    Pending,
    Running,
    Complete,
    Failed,
    Paused,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackArchiveCoverage {
    pub conversation_id: String,
    pub thread_ts: Option<String>,
    pub status: SlackArchiveCoverageStatus,
    pub imported_count: u64,
    pub oldest_ts: Option<String>,
    pub newest_ts: Option<String>,
    pub error_code: Option<String>,
    pub updated_at: String,
    #[serde(default)]
    pub includes_all_threads: bool,
    #[serde(default)]
    pub access_revoked: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackArchiveCoverageResponse {
    pub coverage: Vec<SlackArchiveCoverage>,
    pub next_cursor: Option<String>,
}
#[derive(Debug, Clone, Default)]
pub struct SlackArchiveMessagesOptions {
    pub conversation_id: Option<String>,
    pub thread_ts: Option<String>,
    pub before_ts: Option<String>,
    pub after_ts: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}
#[derive(Debug, Clone, Default)]
pub struct SlackArchiveSearchOptions {
    pub conversation_id: Option<String>,
    pub user_id: Option<String>,
    pub before_ts: Option<String>,
    pub after_ts: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}
#[derive(Debug, Clone, Default)]
pub struct SlackMessageContextOptions {
    pub thread_ts: Option<String>,
    pub limit: Option<u32>,
}
#[derive(Debug, Clone, Default, Serialize)]
pub struct SlackArchiveBackfillOptions {
    pub restart: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_ts: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
pub struct SlackUploadFileOptions {
    pub conversation_id: String,
    pub filename: String,
    pub content_base64: String,
    #[serde(skip)]
    pub idempotency_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_comment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_ts: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackArchivePurgeResponse {
    pub status: String,
    pub capture_enabled: bool,
}

fn conversation(id: Uuid, channel: &str) -> String {
    format!("{}/conversations/{}", base(id), segment(channel))
}
fn message(id: Uuid, channel: &str, ts: &str) -> String {
    format!("{}/messages/{}", conversation(id, channel), segment(ts))
}
fn page(options: &SlackPageOptions, default: u32) -> Vec<(&'static str, String)> {
    let mut params = vec![("limit", options.limit.unwrap_or(default).to_string())];
    if let Some(cursor) = &options.cursor {
        params.push(("cursor", cursor.clone()));
    }
    params
}
impl SlackResource {
    fn operation_mutation(
        &self,
        method: &str,
        path: &str,
        key: &str,
        body: Option<&Value>,
    ) -> Result<SlackOperation> {
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
        let headers = &[("Idempotency-Key", key)];
        let raw = match method {
            "DELETE" => self.http.delete_with_response_and_headers(path, headers)?,
            "PATCH" => self.http.patch_with_headers(path, &body, headers)?,
            _ => self.http.post_with_headers(path, body, NO_QUERY, headers)?,
        };
        Ok(serde_json::from_value(raw)?)
    }
    pub fn capabilities(&self, id: Uuid) -> Result<SlackCapabilitiesResponse> {
        Ok(serde_json::from_value(
            self.http
                .get(&format!("{}/capabilities", base(id)), NO_QUERY)?,
        )?)
    }
    pub fn list_users(&self, id: Uuid, options: &SlackPageOptions) -> Result<SlackUsersResponse> {
        Ok(serde_json::from_value(self.http.get(
            &format!("{}/users", base(id)),
            &page(options, 100),
        )?)?)
    }
    pub fn get_user(&self, id: Uuid, user: &str) -> Result<Map<String, Value>> {
        Ok(serde_json::from_value(self.http.get(
            &format!("{}/users/{}", base(id), segment(user)),
            NO_QUERY,
        )?)?)
    }
    pub fn list_members(
        &self,
        id: Uuid,
        channel: &str,
        options: &SlackPageOptions,
    ) -> Result<SlackMembersResponse> {
        Ok(serde_json::from_value(self.http.get(
            &format!("{}/members", conversation(id, channel)),
            &page(options, 100),
        )?)?)
    }
    pub fn get_message(
        &self,
        id: Uuid,
        channel: &str,
        ts: &str,
        thread_ts: Option<&str>,
    ) -> Result<Map<String, Value>> {
        let params = thread_ts
            .map(|v| vec![("thread_ts", v.to_string())])
            .unwrap_or_default();
        Ok(serde_json::from_value(
            self.http.get(&message(id, channel, ts), &params)?,
        )?)
    }
    pub fn message_context(
        &self,
        id: Uuid,
        channel: &str,
        ts: &str,
        options: &SlackMessageContextOptions,
    ) -> Result<SlackMessageContextResponse> {
        let mut params = vec![("limit", options.limit.unwrap_or(5).to_string())];
        if let Some(ts) = &options.thread_ts {
            params.push(("thread_ts", ts.clone()));
        }
        Ok(serde_json::from_value(self.http.get(
            &format!("{}/context", message(id, channel, ts)),
            &params,
        )?)?)
    }
    pub fn get_permalink(
        &self,
        id: Uuid,
        channel: &str,
        ts: &str,
    ) -> Result<SlackPermalinkResponse> {
        Ok(serde_json::from_value(self.http.get(
            &format!("{}/permalink", message(id, channel, ts)),
            NO_QUERY,
        )?)?)
    }
    pub fn get_reactions(
        &self,
        id: Uuid,
        channel: &str,
        ts: &str,
    ) -> Result<SlackReactionsResponse> {
        Ok(serde_json::from_value(self.http.get(
            &format!("{}/reactions", message(id, channel, ts)),
            NO_QUERY,
        )?)?)
    }
    pub fn list_pins(&self, id: Uuid, channel: &str) -> Result<SlackPinsResponse> {
        Ok(serde_json::from_value(self.http.get(
            &format!("{}/pins", conversation(id, channel)),
            NO_QUERY,
        )?)?)
    }
    /// Poll only InProgress. Unknown is terminal uncertainty, never a retry instruction.
    pub fn get_operation(&self, id: Uuid, operation_id: Uuid) -> Result<SlackOperation> {
        Ok(serde_json::from_value(self.http.get(
            &format!("{}/operations/{operation_id}", base(id)),
            NO_QUERY,
        )?)?)
    }
    pub fn add_reaction(
        &self,
        id: Uuid,
        channel: &str,
        ts: &str,
        name: &str,
        key: &str,
    ) -> Result<SlackOperation> {
        self.operation_mutation(
            "POST",
            &format!("{}/reactions", message(id, channel, ts)),
            key,
            Some(&json!({"name":name})),
        )
    }
    pub fn remove_reaction(
        &self,
        id: Uuid,
        channel: &str,
        ts: &str,
        name: &str,
        key: &str,
    ) -> Result<SlackOperation> {
        self.operation_mutation(
            "DELETE",
            &format!("{}/reactions/{}", message(id, channel, ts), segment(name)),
            key,
            None,
        )
    }
    pub fn add_pin(&self, id: Uuid, channel: &str, ts: &str, key: &str) -> Result<SlackOperation> {
        self.operation_mutation(
            "POST",
            &format!("{}/pins", conversation(id, channel)),
            key,
            Some(&json!({"message_ts":ts})),
        )
    }
    pub fn remove_pin(
        &self,
        id: Uuid,
        channel: &str,
        ts: &str,
        key: &str,
    ) -> Result<SlackOperation> {
        self.operation_mutation(
            "DELETE",
            &format!("{}/pins/{}", conversation(id, channel), segment(ts)),
            key,
            None,
        )
    }
    /// Slack enforces that the connected agent can only edit its own message.
    pub fn update_message(
        &self,
        id: Uuid,
        channel: &str,
        ts: &str,
        text: &str,
        key: &str,
    ) -> Result<SlackOperation> {
        self.operation_mutation(
            "PATCH",
            &message(id, channel, ts),
            key,
            Some(&json!({"text":text})),
        )
    }
    pub fn delete_message(
        &self,
        id: Uuid,
        channel: &str,
        ts: &str,
        key: &str,
    ) -> Result<SlackOperation> {
        self.operation_mutation("DELETE", &message(id, channel, ts), key, None)
    }
    pub fn join_conversation(&self, id: Uuid, channel: &str, key: &str) -> Result<SlackOperation> {
        self.operation_mutation(
            "POST",
            &format!("{}/join", conversation(id, channel)),
            key,
            None,
        )
    }
    pub fn leave_conversation(&self, id: Uuid, channel: &str, key: &str) -> Result<SlackOperation> {
        self.operation_mutation(
            "POST",
            &format!("{}/leave", conversation(id, channel)),
            key,
            None,
        )
    }
    /// Workspace support is not implied by scopes; no simulated reaction fallback.
    pub fn set_processing_status(
        &self,
        id: Uuid,
        channel: &str,
        thread_ts: &str,
        status: SlackProcessingStatus,
        key: &str,
    ) -> Result<SlackOperation> {
        self.operation_mutation(
            "POST",
            &format!("{}/processing-status", conversation(id, channel)),
            key,
            Some(&json!({"thread_ts":thread_ts,"status":status})),
        )
    }
    /// Standard base64 of any file type, bounded to 1 byte..10 MiB decoded.
    pub fn upload_file(
        &self,
        id: Uuid,
        options: &SlackUploadFileOptions,
    ) -> Result<SlackOperation> {
        self.operation_mutation(
            "POST",
            &format!("{}/files", base(id)),
            &options.idempotency_key,
            Some(&serde_json::to_value(options)?),
        )
    }
    pub fn get_archive_settings(&self, id: Uuid) -> Result<SlackArchiveSettings> {
        Ok(serde_json::from_value(self.http.get(
            &format!("{}/archive/settings", base(id)),
            NO_QUERY,
        )?)?)
    }
    /// Organization management only. Replaces capture settings; None retention has no time limit.
    pub fn update_archive_settings(
        &self,
        id: Uuid,
        options: &SlackArchiveSettingsOptions,
    ) -> Result<SlackArchiveSettings> {
        Ok(serde_json::from_value(self.http.patch(
            &format!("{}/archive/settings", base(id)),
            options,
        )?)?)
    }
    pub fn list_archived_messages(
        &self,
        id: Uuid,
        options: &SlackArchiveMessagesOptions,
    ) -> Result<SlackArchiveMessagesResponse> {
        let mut params = vec![("limit", options.limit.unwrap_or(50).to_string())];
        for (key, value) in [
            ("conversation_id", &options.conversation_id),
            ("thread_ts", &options.thread_ts),
            ("before_ts", &options.before_ts),
            ("after_ts", &options.after_ts),
            ("cursor", &options.cursor),
        ] {
            if let Some(v) = value {
                params.push((key, v.clone()));
            }
        }
        Ok(serde_json::from_value(self.http.get(
            &format!("{}/archive/messages", base(id)),
            &params,
        )?)?)
    }
    pub fn search_archived_messages(
        &self,
        id: Uuid,
        q: &str,
        options: &SlackArchiveSearchOptions,
    ) -> Result<SlackArchiveMessagesResponse> {
        let mut params = vec![
            ("limit", options.limit.unwrap_or(50).to_string()),
            ("q", q.to_string()),
        ];
        for (key, value) in [
            ("conversation_id", &options.conversation_id),
            ("user_id", &options.user_id),
            ("before_ts", &options.before_ts),
            ("after_ts", &options.after_ts),
            ("cursor", &options.cursor),
        ] {
            if let Some(v) = value {
                params.push((key, v.clone()));
            }
        }
        Ok(serde_json::from_value(
            self.http
                .get(&format!("{}/archive/search", base(id)), &params)?,
        )?)
    }
    pub fn archive_backfill(
        &self,
        id: Uuid,
        channel: &str,
        options: &SlackArchiveBackfillOptions,
    ) -> Result<SlackArchiveCoverage> {
        let mut body = serde_json::to_value(options)?;
        body["conversation_id"] = json!(channel);
        Ok(serde_json::from_value(self.http.post(
            &format!("{}/archive/backfill", base(id)),
            Some(&body),
            NO_QUERY,
        )?)?)
    }
    pub fn list_archive_coverage(
        &self,
        id: Uuid,
        options: &SlackPageOptions,
    ) -> Result<SlackArchiveCoverageResponse> {
        Ok(serde_json::from_value(self.http.get(
            &format!("{}/archive/coverage", base(id)),
            &page(options, 100),
        )?)?)
    }
    /// Organization management only; disables capture and queues retained-content deletion.
    pub fn purge_archive(&self, id: Uuid) -> Result<SlackArchivePurgeResponse> {
        Ok(serde_json::from_value(
            self.http
                .delete_with_response(&format!("{}/archive", base(id)))?,
        )?)
    }
}
