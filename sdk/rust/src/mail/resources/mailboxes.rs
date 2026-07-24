//! Mailbox read + update + full-text search.
//!
//! Mailboxes are created and deleted exclusively via identity-create /
//! identity-delete cascades — there is no standalone mailbox create or delete
//! surface.

use std::sync::Arc;

use serde_json::Value;

use crate::error::Result;
use crate::http::HttpTransport;
use crate::mail::resources::imports::MailboxImportsResource;
use crate::mail::types::{FilterMode, Mailbox, Message};

const BASE: &str = "/mailboxes";

pub struct MailboxesResource {
    http: Arc<HttpTransport>,
    imports: MailboxImportsResource,
}

impl MailboxesResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self {
            imports: MailboxImportsResource::new(http.clone()),
            http,
        }
    }

    /// Import MBOX, EML, or ZIP-of-EML files into a mailbox.
    pub fn imports(&self) -> &MailboxImportsResource {
        &self.imports
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

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;

    use crate::client::Inkbox;
    use crate::mail::types::FilterMode;

    fn client(server: &MockServer) -> std::sync::Arc<Inkbox> {
        Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap()
    }

    /// A mailbox payload from a storage-caps-aware server.
    fn mailbox_json() -> serde_json::Value {
        json!({
            "id": "11111111-1111-1111-1111-111111111111",
            "email_address": "agent-x@inkboxmail.com",
            "sending_domain": "inkboxmail.com",
            "filter_mode": "blacklist",
            "created_at": "2026-06-01T00:00:00+00:00",
            "updated_at": "2026-06-01T00:00:00+00:00",
            "agent_identity_id": "33333333-3333-3333-3333-333333333333",
            "storage_used_bytes": 1288490188u64,
            "storage_limit_bytes": 2147483648u64
        })
    }

    #[test]
    fn get_parses_storage_fields() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/mail/mailboxes/agent-x@inkboxmail.com");
            then.status(200).json_body(mailbox_json());
        });
        let mailbox = client(&server)
            .mailboxes()
            .get("agent-x@inkboxmail.com")
            .unwrap();
        mock.assert();
        assert_eq!(mailbox.storage_used_bytes, 1_288_490_188);
        // Binary GiB: the Free cap is 2 * 1024^3.
        assert_eq!(mailbox.storage_limit_bytes, Some(2 * 1024 * 1024 * 1024));
    }

    #[test]
    fn list_parses_storage_fields() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/api/v1/mail/mailboxes");
            then.status(200).json_body(json!([mailbox_json()]));
        });
        let mailboxes = client(&server).mailboxes().list().unwrap();
        mock.assert();
        assert_eq!(mailboxes.len(), 1);
        assert_eq!(mailboxes[0].storage_used_bytes, 1_288_490_188);
        assert_eq!(mailboxes[0].storage_limit_bytes, Some(2_147_483_648));
    }

    #[test]
    fn storage_fields_default_when_server_omits_them() {
        // Old server (pre storage caps): neither field on the wire.
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/mail/mailboxes/agent-x@inkboxmail.com");
            then.status(200).json_body(json!({
                "id": "11111111-1111-1111-1111-111111111111",
                "email_address": "agent-x@inkboxmail.com",
                "created_at": "2026-06-01T00:00:00+00:00",
                "updated_at": "2026-06-01T00:00:00+00:00"
            }));
        });
        let mailbox = client(&server)
            .mailboxes()
            .get("agent-x@inkboxmail.com")
            .unwrap();
        assert_eq!(mailbox.storage_used_bytes, 0);
        assert_eq!(mailbox.storage_limit_bytes, None);
        // Existing back-compat defaults still hold.
        assert_eq!(mailbox.sending_domain, "inkboxmail.com");
        assert!(matches!(mailbox.filter_mode, FilterMode::Blacklist));
    }

    #[test]
    fn update_parses_storage_fields() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::PATCH)
                .path("/api/v1/mail/mailboxes/agent-x@inkboxmail.com");
            then.status(200).json_body(mailbox_json());
        });
        let mailbox = client(&server)
            .mailboxes()
            .update("agent-x@inkboxmail.com", Some(FilterMode::Blacklist))
            .unwrap();
        mock.assert();
        assert_eq!(mailbox.storage_limit_bytes, Some(2_147_483_648));
    }
}
