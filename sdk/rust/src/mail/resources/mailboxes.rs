//! Mailbox read + update + full-text search.
//!
//! Mailboxes are created and deleted exclusively via identity-create /
//! identity-delete cascades — there is no standalone mailbox create or delete
//! surface.

use std::sync::Arc;

use serde_json::Value;

use crate::error::Result;
use crate::http::HttpTransport;
use crate::mail::types::{FilterMode, Mailbox, Message};

const BASE: &str = "/mailboxes";

pub struct MailboxesResource {
    http: Arc<HttpTransport>,
}

impl MailboxesResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List all mailboxes for your organisation.
    pub fn list(&self) -> Result<Vec<Mailbox>> {
        let data = self.http.get(BASE, crate::http::NO_QUERY)?;
        // Each row needs the `sending_domain` backfill, so map per element.
        let raw: Vec<Value> = serde_json::from_value(data)?;
        raw.into_iter().map(Mailbox::from_value).collect()
    }

    /// Get a mailbox by its email address.
    ///
    /// # Arguments
    /// * `email_address` - Full email address of the mailbox (e.g.
    ///   `"abc-xyz@inkboxmail.com"`).
    pub fn get(&self, email_address: &str) -> Result<Mailbox> {
        let data = self
            .http
            .get(&format!("{BASE}/{email_address}"), crate::http::NO_QUERY)?;
        Mailbox::from_value(data)
    }

    /// Update mutable mailbox fields.
    ///
    /// Only provided fields are applied; omitted fields are left unchanged.
    /// Pass `None` for `filter_mode` to leave it untouched (mirrors the Python
    /// `_UNSET` sentinel: the key is never sent).
    ///
    /// # Arguments
    /// * `email_address` - Full email address of the mailbox to update.
    /// * `filter_mode` - `Whitelist` or `Blacklist`. Admin-only on the server —
    ///   agent-scoped keys will receive 403.
    ///
    /// # Returns
    /// The updated mailbox. When `filter_mode` was supplied and the value
    /// actually changed, `mailbox.filter_mode_change_notice` is populated;
    /// otherwise it's `None`.
    pub fn update(&self, email_address: &str, filter_mode: Option<FilterMode>) -> Result<Mailbox> {
        let mut body = serde_json::Map::new();
        if let Some(fm) = filter_mode {
            body.insert("filter_mode".into(), Value::String(fm.as_str().to_string()));
        }
        let data = self
            .http
            .patch(&format!("{BASE}/{email_address}"), &Value::Object(body))?;
        Mailbox::from_value(data)
    }

    /// Full-text search across messages in a mailbox.
    ///
    /// # Arguments
    /// * `email_address` - Full email address of the mailbox to search.
    /// * `q` - Search query string.
    /// * `limit` - Maximum number of results (1–100).
    ///
    /// # Returns
    /// Matching messages ranked by relevance.
    pub fn search(&self, email_address: &str, q: &str, limit: i64) -> Result<Vec<Message>> {
        let params = [("q", q.to_string()), ("limit", limit.to_string())];
        let data = self
            .http
            .get(&format!("{BASE}/{email_address}/search"), &params)?;
        // Search responses are always wrapped in an `{"items": [...]}` envelope.
        let items = data.get("items").cloned().unwrap_or(Value::Array(vec![]));
        Ok(serde_json::from_value(items)?)
    }
}

/// Default search result limit, matching the Python `limit: int = 50`.
pub const DEFAULT_SEARCH_LIMIT: i64 = 50;
