//! Mailbox read + update + full-text search.
//!
//! Mailboxes are created and deleted exclusively via identity-create /
//! identity-delete cascades — there is no standalone mailbox create or delete
//! surface.

use std::sync::Arc;

use serde_json::Value;

use crate::error::Result;
use crate::http::HttpTransport;
use crate::identities::types::Unset;
use crate::mail::resources::imports::MailboxImportsResource;
use crate::mail::types::{FilterMode, Mailbox, Message};

/// Partial mailbox update. Omitted fields are unchanged; explicit null clears content.
/// Setting content or enabling signatures requires an eligible paid plan.
#[derive(Debug, Clone, Default)]
pub struct MailboxUpdateOptions {
    pub filter_mode: Option<FilterMode>,
    /// HTML fragment. Updating HTML without text generates a text fallback.
    pub signature_html: Unset<String>,
    /// Plain text. Clearing allows sending to derive text from saved HTML.
    pub signature_text: Unset<String>,
    pub signature_enabled: Option<bool>,
}

const BASE: &str = "/mailboxes";

pub struct MailboxesResource {
    http: Arc<HttpTransport>,
    imports: MailboxImportsResource,
}

impl MailboxesResource {
    pub fn get_with_options(
        &self,
        email_address: &str,
    ) -> Result<crate::identities::DirectionalChannel<Mailbox>> {
        let value = self
            .http
            .get(&format!("{BASE}/{email_address}"), crate::http::NO_QUERY)?;
        let mut response: crate::identities::DirectionalChannel<Mailbox> =
            serde_json::from_value(value.clone())?;
        response.channel = Mailbox::from_value(value)?;
        Ok(response)
    }

    pub fn list_with_options(&self) -> Result<Vec<crate::identities::DirectionalChannel<Mailbox>>> {
        let values: Vec<Value> =
            serde_json::from_value(self.http.get(BASE, crate::http::NO_QUERY)?)?;
        values
            .into_iter()
            .map(|value| {
                let mut response: crate::identities::DirectionalChannel<Mailbox> =
                    serde_json::from_value(value.clone())?;
                response.channel = Mailbox::from_value(value)?;
                Ok(response)
            })
            .collect()
    }
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self {
            imports: MailboxImportsResource::new(http.clone()),
            http,
        }
    }

    /// Import an MBOX or EML file, or a ZIP holding either, into a mailbox.
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
        self.update_with_options(
            email_address,
            &MailboxUpdateOptions {
                filter_mode,
                ..Default::default()
            },
        )
    }

    /// Update filter mode and/or the saved signature, preserving omitted fields.
    pub fn update_with_options(
        &self,
        email_address: &str,
        options: &MailboxUpdateOptions,
    ) -> Result<Mailbox> {
        let mut body = serde_json::Map::new();
        if let Some(fm) = options.filter_mode {
            body.insert("filter_mode".into(), Value::String(fm.as_str().to_string()));
        }
        for (key, field) in [
            ("signature_html", &options.signature_html),
            ("signature_text", &options.signature_text),
        ] {
            if let Unset::Value(value) = field {
                body.insert(key.into(), serde_json::to_value(value)?);
            }
        }
        if let Some(enabled) = options.signature_enabled {
            body.insert("signature_enabled".into(), Value::Bool(enabled));
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
    #[test]
    fn signature_updates_preserve_omission_clear_and_disabled() {
        use crate::identities::types::{IdentityMailbox, Unset};
        use crate::mail::MailboxUpdateOptions;
        let server = MockServer::start();
        let options = [
            (MailboxUpdateOptions::default(), json!({})),
            (
                MailboxUpdateOptions {
                    signature_html: Unset::Value(Some("<b>Alex</b>".into())),
                    signature_enabled: Some(true),
                    ..Default::default()
                },
                json!({"signature_html": "<b>Alex</b>", "signature_enabled": true}),
            ),
            (
                MailboxUpdateOptions {
                    signature_html: Unset::Value(None),
                    signature_text: Unset::Value(None),
                    signature_enabled: Some(false),
                    ..Default::default()
                },
                json!({"signature_html": null, "signature_text": null, "signature_enabled": false}),
            ),
        ];
        for (options, wire) in options {
            let mut mock = server.mock(|when, then| {
                when.method(httpmock::Method::PATCH)
                    .path("/api/v1/mail/mailboxes/alex@example.com")
                    .json_body(wire);
                then.status(200).json_body(mailbox_json());
            });
            let result = client(&server)
                .mailboxes()
                .update_with_options("alex@example.com", &options)
                .unwrap();
            mock.assert();
            assert!(!result.signature_enabled);
            assert_eq!(result.signature_html, None);
            mock.delete();
        }
        let mut data = mailbox_json();
        data["signature_html"] = json!("<b>Alex</b>");
        data["signature_text"] = json!("Alex");
        data["signature_enabled"] = json!(true);
        let mailbox = crate::mail::Mailbox::from_value(data.clone()).unwrap();
        assert!(mailbox.signature_enabled);
        assert_eq!(mailbox.signature_text.as_deref(), Some("Alex"));
        let nested = IdentityMailbox::from_value(data).unwrap();
        assert!(nested.signature_enabled);
        assert_eq!(nested.signature_html.as_deref(), Some("<b>Alex</b>"));
        assert!(
            !IdentityMailbox::from_value(mailbox_json())
                .unwrap()
                .signature_enabled
        );
    }
}
