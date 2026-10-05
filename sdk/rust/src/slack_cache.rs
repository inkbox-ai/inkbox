//! Optional cached context for retained Slack messages.
use crate::error::Result;
use crate::http::NO_QUERY;
use crate::slack::{
    base, segment, SlackConnection, SlackProvisioningWorkspace, SlackResource, SlackSetupStatus,
};
use crate::slack_operations::{
    SlackArchiveMessagesOptions, SlackArchivePageBoundary, SlackArchivedMessage,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use uuid::Uuid;

/// Connection metadata plus the optional installation version used by display caches.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackEnrichedConnection {
    #[serde(flatten)]
    pub connection: SlackConnection,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation: Option<u64>,
}
impl std::ops::Deref for SlackEnrichedConnection {
    type Target = SlackConnection;
    fn deref(&self) -> &Self::Target {
        &self.connection
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackEnrichedConnectionsResponse {
    pub connections: Vec<SlackEnrichedConnection>,
    pub installation_available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup: Option<SlackSetupStatus>,
    #[serde(default)]
    pub application_created: bool,
    #[serde(default)]
    pub provisioning_workspace: Option<SlackProvisioningWorkspace>,
}
/// Retained message with optional display context, leaving legacy message literals unchanged.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackEnrichedArchivedMessage {
    #[serde(flatten)]
    pub message: SlackArchivedMessage,
    #[serde(
        default,
        deserialize_with = "crate::sender_access::deserialize_optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub sender_access: Option<crate::SenderAccess>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bot_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtype: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edited_ts: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocks: Option<Vec<Map<String, Value>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<Map<String, Value>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_reply: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reactions: Option<Vec<SlackCachedReaction>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reactions_complete: Option<bool>,
}
impl std::ops::Deref for SlackEnrichedArchivedMessage {
    type Target = SlackArchivedMessage;
    fn deref(&self) -> &Self::Target {
        &self.message
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackEnrichedArchiveMessagesResponse {
    pub messages: Vec<SlackEnrichedArchivedMessage>,
    pub next_cursor: Option<String>,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_boundary: Option<SlackArchivePageBoundary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub included: Option<SlackArchiveIncluded>,
}
/// Opt-in archive context and root filtering, alongside the existing pagination options.
#[derive(Debug, Clone, Default)]
pub struct SlackEnrichedArchiveMessagesOptions {
    pub archive: SlackArchiveMessagesOptions,
    pub roots_only: Option<bool>,
    pub include: Option<Vec<SlackArchiveInclude>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackArchiveInclude {
    Conversation,
    Sender,
    Reactions,
    Files,
}
impl SlackArchiveInclude {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Conversation => "conversation",
            Self::Sender => "sender",
            Self::Reactions => "reactions",
            Self::Files => "files",
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackCachedMediaKind {
    User,
    Bot,
    Emoji,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackCachedActorKind {
    User,
    Bot,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackCachedConversationType {
    Im,
    Mpim,
    Channel,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackCachedActor {
    pub id: String,
    pub kind: SlackCachedActorKind,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub avatar_cached: bool,
    pub deleted: Option<bool>,
    pub status: String,
    pub fetched_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackCachedConversation {
    pub id: String,
    pub name: Option<String>,
    pub title: Option<String>,
    #[serde(rename = "type")]
    pub conversation_type: Option<SlackCachedConversationType>,
    pub topic: Option<String>,
    pub purpose: Option<String>,
    pub counterpart_user_id: Option<String>,
    pub member_ids: Option<Vec<String>>,
    pub members_complete: Option<bool>,
    pub is_archived: Option<bool>,
    pub is_private: Option<bool>,
    pub status: String,
    pub fetched_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackCachedEmoji {
    pub name: String,
    pub alias_of: Option<String>,
    pub image_url: Option<String>,
    #[serde(default)]
    pub image_cached: bool,
    pub status: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackCachedFile {
    pub id: String,
    pub name: Option<String>,
    pub title: Option<String>,
    pub mimetype: Option<String>,
    pub size: Option<u64>,
    #[serde(default)]
    pub content_cached: bool,
    #[serde(default)]
    pub preview_cached: bool,
    pub preview_url: Option<String>,
    pub status: String,
    pub error_code: Option<String>,
}
/// Unknown totals stay None; known users need not be the complete actor set.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackCachedReaction {
    pub name: String,
    pub count: Option<u64>,
    #[serde(default)]
    pub users: Vec<String>,
    #[serde(default)]
    pub users_complete: bool,
    pub reacted: Option<bool>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SlackArchiveIncluded {
    #[serde(default)]
    pub conversations: HashMap<String, SlackCachedConversation>,
    #[serde(default)]
    pub actors: HashMap<String, SlackCachedActor>,
    #[serde(default)]
    pub emoji: HashMap<String, SlackCachedEmoji>,
    #[serde(default)]
    pub files: HashMap<String, SlackCachedFile>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackCachedEmojiPage {
    pub emoji: Vec<SlackCachedEmoji>,
    pub next_cursor: Option<String>,
    pub status: String,
    pub error_code: Option<String>,
}
#[derive(Debug, Clone, Default)]
pub struct SlackCachedEmojiOptions {
    pub q: Option<String>,
    pub limit: Option<u32>,
    pub cursor: Option<String>,
}
impl SlackResource {
    /// List connection metadata with optional installation generations.
    /// Existing `list_connections` retains its original response types.
    pub fn list_enriched_connections(
        &self,
        identity_id: Uuid,
    ) -> Result<SlackEnrichedConnectionsResponse> {
        Ok(serde_json::from_value(self.http.get(
            "/slack/connections",
            &[("identity_id", identity_id.to_string())],
        )?)?)
    }
    /// Read retained messages with explicitly selected cached display context.
    /// None leaves each new query option omitted, including for older API versions.
    ///
    /// ```no_run
    /// # fn example(client: &inkbox::Inkbox, id: uuid::Uuid) -> inkbox::Result<()> {
    /// use inkbox::{SlackArchiveInclude, SlackArchiveMessagesOptions, SlackEnrichedArchiveMessagesOptions};
    /// let page = client.slack().list_enriched_archived_messages(id, &SlackEnrichedArchiveMessagesOptions {
    ///     archive: SlackArchiveMessagesOptions {
    ///         conversation_id: Some("CEXAMPLE".into()), ..Default::default()
    ///     },
    ///     roots_only: Some(true),
    ///     include: Some(vec![SlackArchiveInclude::Sender, SlackArchiveInclude::Reactions]),
    /// })?;
    /// let first_body = page.messages.first().map(|entry| &entry.message.text);
    /// # Ok(()) }
    /// ```
    pub fn list_enriched_archived_messages(
        &self,
        id: Uuid,
        options: &SlackEnrichedArchiveMessagesOptions,
    ) -> Result<SlackEnrichedArchiveMessagesResponse> {
        let mut params = options.archive.query_params();
        if let Some(roots) = options.roots_only {
            params.push(("roots_only", roots.to_string()));
        }
        if let Some(include) = &options.include {
            params.push((
                "include",
                include
                    .iter()
                    .map(|item| item.as_str())
                    .collect::<Vec<_>>()
                    .join(","),
            ));
        }
        Ok(serde_json::from_value(self.http.get(
            &format!("{}/archive/messages", base(id)),
            &params,
        )?)?)
    }
    pub fn list_cached_emoji(
        &self,
        id: Uuid,
        options: &SlackCachedEmojiOptions,
    ) -> Result<SlackCachedEmojiPage> {
        let mut params = vec![("limit", options.limit.unwrap_or(100).to_string())];
        for (key, value) in [("q", &options.q), ("cursor", &options.cursor)] {
            if let Some(value) = value {
                params.push((key, value.clone()));
            }
        }
        Ok(serde_json::from_value(
            self.http.get(&format!("{}/emoji", base(id)), &params)?,
        )?)
    }
    /// Download an authenticated cached avatar or emoji by ID, not a remote URL.
    pub fn download_cached_media(
        &self,
        id: Uuid,
        kind: SlackCachedMediaKind,
        resource_id: &str,
    ) -> Result<Vec<u8>> {
        let kind = match kind {
            SlackCachedMediaKind::User => "user",
            SlackCachedMediaKind::Bot => "bot",
            SlackCachedMediaKind::Emoji => "emoji",
        };
        self.http.get_bytes(
            &format!("{}/cached-media/{kind}/{}", base(id), segment(resource_id)),
            "image/*",
            NO_QUERY,
        )
    }
    pub fn download_file_preview(&self, id: Uuid, file_id: &str) -> Result<Vec<u8>> {
        self.http.get_bytes(
            &format!("{}/files/{}/preview", base(id), segment(file_id)),
            "image/*",
            NO_QUERY,
        )
    }
}
