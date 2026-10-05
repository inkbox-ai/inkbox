//! Optional cached context for retained Slack messages.
use crate::error::Result;
use crate::http::NO_QUERY;
use crate::slack::{base, segment, SlackResource};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

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
