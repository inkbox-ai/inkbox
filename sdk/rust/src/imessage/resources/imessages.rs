//! iMessage operations: send, list, conversations, reactions, read
//! receipts, typing indicators, media upload.
//!
//! Unlike SMS, iMessage is not scoped to an org-owned phone number.
//! Recipients are connected to an agent identity over a shared pool line
//! by triage, so every method here keys off `conversation_id` /
//! `agent_identity_id` rather than a `phone_number_id`.

use std::sync::Arc;

use serde_json::json;
use uuid::Uuid;

use crate::error::Result;
use crate::filters::DateRangeFilter;
use crate::http::HttpTransport;
use crate::imessage::types::{
    IMessage, IMessageAssignment, IMessageConversation, IMessageConversationSummary,
    IMessageMarkReadResult, IMessageMediaUpload, IMessageReaction, IMessageReactionType,
    IMessageSendStyle, IMessageTriageNumber,
};

pub struct IMessagesResource {
    http: Arc<HttpTransport>,
}

impl IMessagesResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Return the active triage line and the connect command.
    ///
    /// Recipients text the returned `connect_command` (e.g.
    /// `connect @your-handle`) to the triage `number` to get connected to an
    /// agent identity. Resolve this at runtime instead of hardcoding the
    /// number — the line can change.
    ///
    /// Returns an API error (404) when no triage line is active.
    pub fn get_triage_number(&self) -> Result<IMessageTriageNumber> {
        let data = self.http.get("/triage-number", crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Send an outbound iMessage through an existing assignment.
    ///
    /// Sends only work toward recipients that triage has already connected to
    /// the agent identity — there is no cold outreach over iMessage.
    ///
    /// # Arguments
    /// * `to` - E.164 recipient number. Mutually exclusive with
    ///   `conversation_id`.
    /// * `conversation_id` - Existing conversation UUID to reply into.
    /// * `text` - Message body.
    /// * `media_urls` - Media URLs (at most one). Pass with `text` or by
    ///   themselves. Use [`Self::upload_media`] to turn raw bytes into a
    ///   sendable URL first.
    /// * `send_style` - Optional expressive send style.
    /// * `agent_identity_id` - Identity to send as. Required for org-wide API
    ///   keys when sending by `to`; ignored for identity-scoped keys.
    ///
    /// # Returns
    /// The queued [`IMessage`] row.
    #[allow(clippy::too_many_arguments)]
    pub fn send(
        &self,
        to: Option<&str>,
        conversation_id: Option<&Uuid>,
        text: Option<&str>,
        media_urls: Option<&[String]>,
        send_style: Option<IMessageSendStyle>,
        agent_identity_id: Option<&Uuid>,
    ) -> Result<IMessage> {
        // Build the body inserting only the fields that were supplied.
        let mut body = serde_json::Map::new();
        if let Some(t) = to {
            body.insert("to".to_string(), json!(t));
        }
        if let Some(cid) = conversation_id {
            body.insert("conversation_id".to_string(), json!(cid.to_string()));
        }
        if let Some(t) = text {
            body.insert("text".to_string(), json!(t));
        }
        if let Some(urls) = media_urls {
            body.insert("media_urls".to_string(), json!(urls));
        }
        if let Some(style) = send_style {
            body.insert("send_style".to_string(), json!(style.as_str()));
        }
        let body = serde_json::Value::Object(body);

        // `agent_identity_id` rides as a query param when present.
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(id) = agent_identity_id {
            params.push(("agent_identity_id", id.to_string()));
        }

        let data = self.http.post("/messages", Some(&body), &params)?;
        // The server wraps the row under a "message" key.
        let message = data
            .get("message")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        Ok(serde_json::from_value(message)?)
    }

    /// List iMessages visible to the caller, newest first.
    ///
    /// Identity-scoped API keys never see contact-rule-blocked rows regardless
    /// of `is_blocked` — the server filters them at the access-policy layer.
    ///
    /// # Arguments
    /// * `agent_identity_id` - Narrow to one agent identity. Ignored for
    ///   identity-scoped keys.
    /// * `conversation_id` - Narrow to one conversation.
    /// * `limit` - Max results to return (1–200).
    /// * `offset` - Pagination offset.
    /// * `is_read` - Filter by read state (`None` for all).
    /// * `is_blocked` - Tri-state filter (`None` for all).
    #[allow(clippy::too_many_arguments)]
    pub fn list(
        &self,
        agent_identity_id: Option<&Uuid>,
        conversation_id: Option<&Uuid>,
        limit: i64,
        offset: i64,
        is_read: Option<bool>,
        is_blocked: Option<bool>,
    ) -> Result<Vec<IMessage>> {
        // Delegate with an empty (default) date range — wire-identical to the
        // original list.
        self.list_filtered(
            agent_identity_id,
            conversation_id,
            limit,
            offset,
            is_read,
            is_blocked,
            &DateRangeFilter::default(),
        )
    }

    /// List iMessages, newest first, additionally narrowed by a `created_at`
    /// [`DateRangeFilter`].
    ///
    /// Identical to [`IMessagesResource::list`] but also forwards the filter's
    /// `start_date` / `end_date` / `tz`. A default filter sends nothing extra.
    ///
    /// # Arguments
    /// * `agent_identity_id` / `conversation_id` / `limit` / `offset` /
    ///   `is_read` / `is_blocked` - See [`IMessagesResource::list`].
    /// * `filter` - Optional `created_at` date-range bounds.
    #[allow(clippy::too_many_arguments)]
    pub fn list_filtered(
        &self,
        agent_identity_id: Option<&Uuid>,
        conversation_id: Option<&Uuid>,
        limit: i64,
        offset: i64,
        is_read: Option<bool>,
        is_blocked: Option<bool>,
        filter: &DateRangeFilter,
    ) -> Result<Vec<IMessage>> {
        // limit/offset always sent; httpx renders bools lowercase.
        let mut params: Vec<(&str, String)> =
            vec![("limit", limit.to_string()), ("offset", offset.to_string())];
        if let Some(id) = agent_identity_id {
            params.push(("agent_identity_id", id.to_string()));
        }
        if let Some(cid) = conversation_id {
            params.push(("conversation_id", cid.to_string()));
        }
        if let Some(r) = is_read {
            params.push(("is_read", r.to_string()));
        }
        if let Some(b) = is_blocked {
            params.push(("is_blocked", b.to_string()));
        }
        filter.apply(&mut params);
        let data = self.http.get("/messages", &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// List active iMessage connections, newest first.
    ///
    /// One row per recipient currently connected to an agent identity through
    /// triage. Released connections are not returned.
    ///
    /// # Arguments
    /// * `agent_identity_id` - Narrow to one agent identity. Ignored for
    ///   identity-scoped keys.
    /// * `limit` - Max results to return (1–200).
    /// * `offset` - Pagination offset.
    pub fn list_assignments(
        &self,
        agent_identity_id: Option<&Uuid>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<IMessageAssignment>> {
        let mut params: Vec<(&str, String)> =
            vec![("limit", limit.to_string()), ("offset", offset.to_string())];
        if let Some(id) = agent_identity_id {
            params.push(("agent_identity_id", id.to_string()));
        }
        let data = self.http.get("/assignments", &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// List iMessage conversations with latest-message preview.
    ///
    /// # Arguments
    /// * `agent_identity_id` - Narrow to one agent identity. Ignored for
    ///   identity-scoped keys.
    /// * `limit` - Max results to return (1–200).
    /// * `offset` - Pagination offset.
    /// * `is_blocked` - Tri-state filter applied to the underlying messages
    ///   (`None` for all).
    pub fn list_conversations(
        &self,
        agent_identity_id: Option<&Uuid>,
        limit: i64,
        offset: i64,
        is_blocked: Option<bool>,
    ) -> Result<Vec<IMessageConversationSummary>> {
        // Delegate with an empty (default) date range — wire-identical to the
        // original list_conversations.
        self.list_conversations_filtered(
            agent_identity_id,
            limit,
            offset,
            is_blocked,
            &DateRangeFilter::default(),
        )
    }

    /// List iMessage conversations, additionally narrowed by a `created_at`
    /// [`DateRangeFilter`].
    ///
    /// Identical to [`IMessagesResource::list_conversations`] but also forwards
    /// the filter's `start_date` / `end_date` / `tz`. A default filter sends
    /// nothing extra.
    ///
    /// # Arguments
    /// * `agent_identity_id` / `limit` / `offset` / `is_blocked` - See
    ///   [`IMessagesResource::list_conversations`].
    /// * `filter` - Optional `created_at` date-range bounds.
    pub fn list_conversations_filtered(
        &self,
        agent_identity_id: Option<&Uuid>,
        limit: i64,
        offset: i64,
        is_blocked: Option<bool>,
        filter: &DateRangeFilter,
    ) -> Result<Vec<IMessageConversationSummary>> {
        let mut params: Vec<(&str, String)> =
            vec![("limit", limit.to_string()), ("offset", offset.to_string())];
        if let Some(id) = agent_identity_id {
            params.push(("agent_identity_id", id.to_string()));
        }
        if let Some(b) = is_blocked {
            params.push(("is_blocked", b.to_string()));
        }
        filter.apply(&mut params);
        let data = self.http.get("/conversations", &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Get one iMessage conversation by ID.
    ///
    /// # Arguments
    /// * `conversation_id` - UUID of the conversation.
    /// * `agent_identity_id` - Optional identity assertion; 404s when the
    ///   conversation belongs to a different identity.
    pub fn get_conversation(
        &self,
        conversation_id: &Uuid,
        agent_identity_id: Option<&Uuid>,
    ) -> Result<IMessageConversation> {
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(id) = agent_identity_id {
            params.push(("agent_identity_id", id.to_string()));
        }
        let path = format!("/conversations/{conversation_id}");
        let data = self.http.get(&path, &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Send a tapback reaction to a message.
    ///
    /// # Arguments
    /// * `message_id` - UUID of the message being reacted to.
    /// * `reaction` - Tapback kind. Sends accept the classic six; `custom` is
    ///   inbound-only and rejected with 422.
    /// * `part_index` - Part of a multi-part message to react to.
    pub fn send_reaction(
        &self,
        message_id: &Uuid,
        reaction: IMessageReactionType,
        part_index: i64,
    ) -> Result<IMessageReaction> {
        let body = json!({
            "message_id": message_id.to_string(),
            "reaction": reaction.as_str(),
            "part_index": part_index,
        });
        let data = self
            .http
            .post("/reactions", Some(&body), crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Send a read receipt and mark inbound messages read locally.
    ///
    /// # Arguments
    /// * `conversation_id` - UUID of the conversation.
    ///
    /// # Returns
    /// [`IMessageMarkReadResult`] with the count of rows updated.
    pub fn mark_conversation_read(&self, conversation_id: &Uuid) -> Result<IMessageMarkReadResult> {
        let body = json!({ "conversation_id": conversation_id.to_string() });
        let data = self
            .http
            .post("/mark-read", Some(&body), crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Show a typing indicator to the conversation's recipient.
    ///
    /// # Arguments
    /// * `conversation_id` - UUID of the conversation.
    pub fn send_typing(&self, conversation_id: &Uuid) -> Result<()> {
        let body = json!({ "conversation_id": conversation_id.to_string() });
        self.http
            .post("/typing", Some(&body), crate::http::NO_QUERY)?;
        Ok(())
    }

    /// Upload media and get back a URL usable in `media_urls`.
    ///
    /// # Arguments
    /// * `content` - Raw file bytes (max 10 MiB).
    /// * `filename` - Original filename, used for type inference.
    /// * `content_type` - Optional MIME type; defaults to
    ///   `application/octet-stream`.
    ///
    /// # Returns
    /// [`IMessageMediaUpload`] with the reusable `media_url`.
    pub fn upload_media(
        &self,
        content: Vec<u8>,
        filename: &str,
        content_type: Option<&str>,
    ) -> Result<IMessageMediaUpload> {
        let data = self.http.post_multipart(
            "/media",
            "file",
            filename,
            content,
            content_type.unwrap_or("application/octet-stream"),
        )?;
        Ok(serde_json::from_value(data)?)
    }
}
