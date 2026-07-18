//! iMessage operations: send, list, conversations, reactions, read
//! receipts, typing indicators, media upload.
//!
//! Messages and conversations remain assignment-scoped. Dedicated number
//! ownership is managed through [`IMessagesResource::list_numbers`] and
//! [`IMessagesResource::claim_number`].

use std::sync::Arc;

use serde_json::json;
use uuid::Uuid;

use crate::error::Result;
use crate::filters::DateRangeFilter;
use crate::http::{validate_idempotency_key, HttpTransport};
use crate::imessage::types::{
    IMessage, IMessageAssignment, IMessageConversation, IMessageConversationSummary,
    IMessageMarkReadResult, IMessageMediaUpload, IMessageNumber, IMessageNumberType,
    IMessageReaction, IMessageReactionType, IMessageSendStyle, IMessageTriageNumber,
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

    /// List the organization's dedicated iMessage numbers, including numbers that
    /// are not currently attached to an identity.
    pub fn list_numbers(&self) -> Result<Vec<IMessageNumber>> {
        let data = self.http.get("/numbers", crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Claim a dedicated iMessage number for the organization.
    ///
    /// The returned number is initially unattached. Pass its id to a number-aware
    /// identity update to attach it, or claim and attach atomically through an
    /// identity create/update operation.
    ///
    /// `idempotency_key` must contain 1–255 characters. Reuse the same key when
    /// retrying an ambiguous result so the original claim is replayed.
    pub fn claim_number(
        &self,
        number_type: IMessageNumberType,
        idempotency_key: &str,
    ) -> Result<IMessageNumber> {
        validate_idempotency_key(idempotency_key)?;
        let body = json!({ "type": number_type.as_str() });
        let headers = [("Idempotency-Key", idempotency_key)];
        let data = self.http.post_with_headers(
            "/numbers",
            Some(&body),
            crate::http::NO_QUERY,
            &headers,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Send an outbound iMessage through an existing assignment.
    ///
    /// Shared and dedicated-inbound numbers require the recipient to connect
    /// first. An identity attached to a dedicated-outbound number may initiate a
    /// conversation, subject to server-side consent and rate limits.
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
    /// `start_datetime` / `end_datetime` / `tz`. A default filter sends nothing extra.
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
    /// the filter's `start_datetime` / `end_datetime` / `tz`. A default filter sends
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

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;

    use crate::client::Inkbox;
    use crate::error::InkboxError;
    use crate::imessage::types::{IMessageNumberStatus, IMessageNumberType};

    fn client(server: &MockServer) -> std::sync::Arc<Inkbox> {
        Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap()
    }

    fn number_json() -> serde_json::Value {
        json!({
            "id": "11111111-1111-1111-1111-111111111111",
            "number": "+15550001111",
            "type": "dedicated_outbound",
            "status": "active",
            "agent_identity_id": null,
            "agent_handle": null
        })
    }

    #[test]
    fn list_numbers_parses_unattached_number() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/api/v1/imessage/numbers");
            then.status(200).json_body(json!([number_json()]));
        });

        let numbers = client(&server).imessages().list_numbers().unwrap();
        mock.assert();
        assert_eq!(numbers.len(), 1);
        assert_eq!(numbers[0].r#type, IMessageNumberType::DedicatedOutbound);
        assert_eq!(numbers[0].status, IMessageNumberStatus::Active);
        assert!(numbers[0].can_start_conversation());
        assert_eq!(numbers[0].agent_identity_id, None);
        assert_eq!(numbers[0].agent_handle, None);
    }

    #[test]
    fn claim_number_sends_exact_number_type_and_key() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/imessage/numbers")
                .header("Idempotency-Key", "claim-123")
                .json_body(json!({ "type": "dedicated_outbound" }));
            then.status(201).json_body(number_json());
        });

        let number = client(&server)
            .imessages()
            .claim_number(IMessageNumberType::DedicatedOutbound, "claim-123")
            .unwrap();
        mock.assert();
        assert_eq!(number.r#type, IMessageNumberType::DedicatedOutbound);
    }

    #[test]
    fn claim_number_parses_quota_error() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/api/v1/imessage/numbers");
            then.status(402).json_body(json!({
                "detail": {
                    "error": "dedicated_imessage_number_quota_exceeded",
                    "message": "Number allowance reached.",
                    "number_type": "dedicated_inbound",
                    "limit": 1,
                    "current": 1,
                    "upgrade_url": "https://inkbox.ai/billing",
                    "contact_email": "contact@inkbox.ai"
                }
            }));
        });

        let error = client(&server)
            .imessages()
            .claim_number(IMessageNumberType::DedicatedInbound, "claim-quota")
            .unwrap_err();
        mock.assert();
        match error {
            InkboxError::DedicatedIMessageNumberQuotaExceeded {
                number_type,
                limit,
                current,
                ..
            } => {
                assert_eq!(number_type.as_ref(), "dedicated_inbound");
                assert_eq!(limit, 1);
                assert_eq!(current, 1);
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn claim_number_parses_inventory_retry_after() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path("/api/v1/imessage/numbers");
            then.status(503)
                .header("Retry-After", "3600")
                .json_body(json!({
                    "detail": {
                        "error": "dedicated_imessage_number_inventory_pending",
                        "message": "More numbers are being added.",
                        "number_type": "dedicated_outbound",
                        "retry_after_seconds": 86400
                    }
                }));
        });

        let error = client(&server)
            .imessages()
            .claim_number(IMessageNumberType::DedicatedOutbound, "claim-inventory")
            .unwrap_err();
        mock.assert();
        match error {
            InkboxError::DedicatedIMessageNumberInventoryPending {
                retry_after_seconds,
                retry_after_header,
                ..
            } => {
                assert_eq!(retry_after_seconds, 3_600);
                assert_eq!(retry_after_header, Some(3_600));
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn claim_number_rejects_invalid_idempotency_key() {
        let server = MockServer::start();
        let error = client(&server)
            .imessages()
            .claim_number(IMessageNumberType::DedicatedInbound, "")
            .unwrap_err();
        assert!(matches!(error, InkboxError::InvalidArgument(_)));

        let too_long = "x".repeat(256);
        let error = client(&server)
            .imessages()
            .claim_number(IMessageNumberType::DedicatedInbound, &too_long)
            .unwrap_err();
        assert!(matches!(error, InkboxError::InvalidArgument(_)));
    }

    #[test]
    fn claim_number_parses_idempotency_conflict() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/imessage/numbers")
                .header("Idempotency-Key", "claim-conflict");
            then.status(409).json_body(json!({
                "detail": {
                    "error": "idempotency_key_reused",
                    "message": "This key was already used with a different request."
                }
            }));
        });

        let error = client(&server)
            .imessages()
            .claim_number(IMessageNumberType::DedicatedInbound, "claim-conflict")
            .unwrap_err();
        mock.assert();
        assert!(matches!(error, InkboxError::IdempotencyKeyReused { .. }));
    }
}
