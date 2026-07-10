//! Text message (SMS/MMS) operations: list, get, update, search, conversations.

use std::sync::Arc;

use serde_json::{json, Map, Value};

use crate::error::Result;
use crate::filters::DateRangeFilter;
use crate::http::HttpTransport;
use crate::phone::types::{TextConversationSummary, TextConversationUpdateResult, TextMessage};

/// The `to` argument of [`TextsResource::send`]: a single destination number or
/// a list of numbers for a conversation-centric group send.
pub enum TextRecipients {
    /// A single E.164 destination number.
    One(String),
    /// Multiple E.164 numbers (group send).
    Many(Vec<String>),
}

impl TextRecipients {
    /// Render to the JSON shape the server expects (`str` or `list[str]`).
    fn to_json(&self) -> Value {
        match self {
            TextRecipients::One(s) => Value::String(s.clone()),
            TextRecipients::Many(v) => json!(v),
        }
    }
}

pub struct TextsResource {
    http: Arc<HttpTransport>,
}

impl TextsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Send an outbound SMS/MMS from a phone number.
    ///
    /// # Arguments
    /// * `to` - E.164 destination number, or a list of numbers for a
    ///   conversation-centric group send. Mutually exclusive with
    ///   `conversation_id`.
    /// * `conversation_id` - Existing conversation UUID to reply into.
    /// * `text` - Message body.
    /// * `media_urls` - MMS media URLs. Pass with `text` or by themselves.
    ///
    /// # Returns
    /// The queued `TextMessage` row.
    ///
    /// Returns [`InkboxError::RecipientBlocked`](crate::error::InkboxError) when
    /// the destination is blocked by an outbound contact rule on the sender, or
    /// an API error for other 4xx/5xx errors (stable `error` codes live in the
    /// structured detail, e.g. `recipient_not_opted_in`, `sender_sms_pending`).
    pub fn send(
        &self,
        phone_number_id: &str,
        to: Option<TextRecipients>,
        conversation_id: Option<&str>,
        text: Option<&str>,
        media_urls: Option<&[String]>,
    ) -> Result<TextMessage> {
        // Build body conditionally, omitting any argument left as None.
        let mut body = Map::new();
        if let Some(recipients) = to {
            body.insert("to".into(), recipients.to_json());
        }
        if let Some(cid) = conversation_id {
            body.insert("conversation_id".into(), cid.into());
        }
        if let Some(t) = text {
            body.insert("text".into(), t.into());
        }
        if let Some(urls) = media_urls {
            body.insert("media_urls".into(), json!(urls));
        }
        let data = self.http.post(
            &format!("/numbers/{phone_number_id}/texts"),
            Some(&body),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// List text messages for a phone number, newest first.
    ///
    /// # Arguments
    /// * `limit` - Max results to return (1-200).
    /// * `offset` - Pagination offset.
    /// * `is_read` - Filter by read state (`Some`/`None` for all).
    /// * `is_blocked` - Tri-state filter — `Some(true)` only blocked,
    ///   `Some(false)` only non-blocked, `None` all.
    pub fn list(
        &self,
        phone_number_id: &str,
        limit: i64,
        offset: i64,
        is_read: Option<bool>,
        is_blocked: Option<bool>,
    ) -> Result<Vec<TextMessage>> {
        // Delegate with an empty (default) date range — wire-identical to the
        // original list.
        self.list_filtered(
            phone_number_id,
            limit,
            offset,
            is_read,
            is_blocked,
            &DateRangeFilter::default(),
        )
    }

    /// List text messages, newest first, additionally narrowed by a
    /// `created_at` [`DateRangeFilter`].
    ///
    /// Identical to [`TextsResource::list`] but also forwards the filter's
    /// `start_datetime` / `end_datetime` / `tz`. A default filter sends nothing extra.
    ///
    /// # Arguments
    /// * `phone_number_id` / `limit` / `offset` / `is_read` / `is_blocked` -
    ///   See [`TextsResource::list`].
    /// * `filter` - Optional `created_at` date-range bounds.
    #[allow(clippy::too_many_arguments)]
    pub fn list_filtered(
        &self,
        phone_number_id: &str,
        limit: i64,
        offset: i64,
        is_read: Option<bool>,
        is_blocked: Option<bool>,
        filter: &DateRangeFilter,
    ) -> Result<Vec<TextMessage>> {
        let mut params: Vec<(&str, String)> =
            vec![("limit", limit.to_string()), ("offset", offset.to_string())];
        if let Some(r) = is_read {
            params.push(("is_read", r.to_string()));
        }
        if let Some(b) = is_blocked {
            params.push(("is_blocked", b.to_string()));
        }
        filter.apply(&mut params);
        let data = self
            .http
            .get(&format!("/numbers/{phone_number_id}/texts"), &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Get a single text message by ID.
    pub fn get(&self, phone_number_id: &str, text_id: &str) -> Result<TextMessage> {
        let data = self.http.get(
            &format!("/numbers/{phone_number_id}/texts/{text_id}"),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Update a text message (mark as read).
    ///
    /// # Arguments
    /// * `is_read` - Mark as read (`true`) or unread (`false`).
    pub fn update(
        &self,
        phone_number_id: &str,
        text_id: &str,
        is_read: Option<bool>,
    ) -> Result<TextMessage> {
        let mut body = Map::new();
        if let Some(r) = is_read {
            body.insert("is_read".into(), r.into());
        }
        let data = self.http.patch(
            &format!("/numbers/{phone_number_id}/texts/{text_id}"),
            &body,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Full-text search across text messages for a phone number.
    ///
    /// # Arguments
    /// * `q` - Search query string.
    /// * `limit` - Max results to return (1-200).
    /// * `is_blocked` - Tri-state filter — `Some(true)` only blocked,
    ///   `Some(false)` only non-blocked, `None` all.
    pub fn search(
        &self,
        phone_number_id: &str,
        q: &str,
        limit: i64,
        is_blocked: Option<bool>,
    ) -> Result<Vec<TextMessage>> {
        let mut params: Vec<(&str, String)> =
            vec![("q", q.to_string()), ("limit", limit.to_string())];
        if let Some(b) = is_blocked {
            params.push(("is_blocked", b.to_string()));
        }
        let data = self
            .http
            .get(&format!("/numbers/{phone_number_id}/texts/search"), &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// List conversation summaries with latest message preview.
    ///
    /// # Arguments
    /// * `limit` - Max results to return (1-200).
    /// * `offset` - Pagination offset.
    /// * `is_blocked` - Tri-state filter applied to the underlying messages.
    /// * `include_groups` - Include group conversations. The param is only sent
    ///   when `true`, matching the Python default-omit behaviour.
    pub fn list_conversations(
        &self,
        phone_number_id: &str,
        limit: i64,
        offset: i64,
        is_blocked: Option<bool>,
        include_groups: bool,
    ) -> Result<Vec<TextConversationSummary>> {
        // Delegate with an empty (default) date range — wire-identical to the
        // original list_conversations.
        self.list_conversations_filtered(
            phone_number_id,
            limit,
            offset,
            is_blocked,
            include_groups,
            &DateRangeFilter::default(),
        )
    }

    /// List conversation summaries, additionally narrowed by a `created_at`
    /// [`DateRangeFilter`].
    ///
    /// Identical to [`TextsResource::list_conversations`] but also forwards the
    /// filter's `start_datetime` / `end_datetime` / `tz`. A default filter sends
    /// nothing extra.
    ///
    /// # Arguments
    /// * `phone_number_id` / `limit` / `offset` / `is_blocked` /
    ///   `include_groups` - See [`TextsResource::list_conversations`].
    /// * `filter` - Optional `created_at` date-range bounds.
    #[allow(clippy::too_many_arguments)]
    pub fn list_conversations_filtered(
        &self,
        phone_number_id: &str,
        limit: i64,
        offset: i64,
        is_blocked: Option<bool>,
        include_groups: bool,
        filter: &DateRangeFilter,
    ) -> Result<Vec<TextConversationSummary>> {
        let mut params: Vec<(&str, String)> =
            vec![("limit", limit.to_string()), ("offset", offset.to_string())];
        if let Some(b) = is_blocked {
            params.push(("is_blocked", b.to_string()));
        }
        if include_groups {
            params.push(("include_groups", true.to_string()));
        }
        filter.apply(&mut params);
        let data = self.http.get(
            &format!("/numbers/{phone_number_id}/texts/conversations"),
            &params,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Get all messages in a conversation, newest first.
    ///
    /// # Arguments
    /// * `remote_number` - E.164 one-to-one remote number, or conversation UUID.
    /// * `limit` - Max results to return (1-200).
    /// * `offset` - Pagination offset.
    pub fn get_conversation(
        &self,
        phone_number_id: &str,
        remote_number: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<TextMessage>> {
        let params: Vec<(&str, String)> =
            vec![("limit", limit.to_string()), ("offset", offset.to_string())];
        let data = self.http.get(
            &format!("/numbers/{phone_number_id}/texts/conversations/{remote_number}"),
            &params,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Update the read state for all messages in a conversation.
    ///
    /// # Arguments
    /// * `remote_number` - E.164 one-to-one remote number, or conversation UUID.
    /// * `is_read` - Mark all messages as read (`true`) or unread (`false`).
    ///
    /// # Returns
    /// `TextConversationUpdateResult` with `conversation_id`,
    /// `remote_phone_number`, `is_read`, and `updated_count`.
    pub fn update_conversation(
        &self,
        phone_number_id: &str,
        remote_number: &str,
        is_read: bool,
    ) -> Result<TextConversationUpdateResult> {
        let body = json!({ "is_read": is_read });
        let data = self.http.patch(
            &format!("/numbers/{phone_number_id}/texts/conversations/{remote_number}"),
            &body,
        )?;
        Ok(serde_json::from_value(data)?)
    }
}
