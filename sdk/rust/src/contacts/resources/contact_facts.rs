//! Contact facts and citation resolution.

use std::sync::Arc;

use serde_json::{Map, Value};

use crate::contacts::types::{
    ContactFact, ContactFactCitationDetail, ContactFactDeleteResult, ContactFactKind,
};
use crate::error::{InkboxError, Result};
use crate::http::{HttpTransport, NO_QUERY};

const BASE: &str = "/contacts";

pub struct ContactFactsResource {
    http: Arc<HttpTransport>,
}

impl ContactFactsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List a contact's facts, leaving out context facts that have expired.
    pub fn list(&self, contact_id: &str) -> Result<Vec<ContactFact>> {
        let data = self
            .http
            .get(&format!("{BASE}/{contact_id}/facts"), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// List a contact's facts, including context facts whose `expires_at` has
    /// passed.
    pub fn list_including_expired(&self, contact_id: &str) -> Result<Vec<ContactFact>> {
        let data = self.http.get(
            &format!("{BASE}/{contact_id}/facts"),
            &[("include_expired", "true".to_string())],
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Record a fact by hand. Requires an admin-scoped API key; an
    /// agent-scoped key is rejected with 403.
    ///
    /// Hand-written facts never expire, whatever their kind. The call fails
    /// with 409 when the contact is already at its limit for that kind.
    pub fn create(
        &self,
        contact_id: &str,
        content: &str,
        kind: ContactFactKind,
    ) -> Result<ContactFact> {
        let mut body = Map::new();
        body.insert("content".into(), Value::String(content.to_string()));
        body.insert("kind".into(), Value::String(kind.as_str().to_string()));
        let data = self.http.post(
            &format!("{BASE}/{contact_id}/facts"),
            Some(&Value::Object(body)),
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Edit a fact's content or kind. Requires an admin-scoped API key; an
    /// agent-scoped key is rejected with 403.
    ///
    /// At least one of `content` and `kind` is required. Editing the content
    /// drops the citations and confidence recorded for the old wording;
    /// editing only the kind leaves them in place.
    pub fn update(
        &self,
        contact_id: &str,
        fact_id: &str,
        content: Option<&str>,
        kind: Option<ContactFactKind>,
    ) -> Result<ContactFact> {
        let mut body = Map::new();
        if let Some(content) = content {
            body.insert("content".into(), Value::String(content.to_string()));
        }
        if let Some(kind) = kind {
            body.insert("kind".into(), Value::String(kind.as_str().to_string()));
        }
        if body.is_empty() {
            return Err(InkboxError::InvalidArgument(
                "update() requires content or kind".into(),
            ));
        }
        let data = self.http.patch(
            &format!("{BASE}/{contact_id}/facts/{fact_id}"),
            &Value::Object(body),
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Fetch one active contact fact.
    pub fn get(&self, contact_id: &str, fact_id: &str) -> Result<ContactFact> {
        let data = self
            .http
            .get(&format!("{BASE}/{contact_id}/facts/{fact_id}"), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Resolve an available citation to its source details.
    pub fn resolve_citation(
        &self,
        contact_id: &str,
        fact_id: &str,
        citation_id: &str,
    ) -> Result<ContactFactCitationDetail> {
        let data = self.http.get(
            &format!("{BASE}/{contact_id}/facts/{fact_id}/citations/{citation_id}"),
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Resolve the authorized URL returned on an available citation.
    pub fn resolve_citation_url(&self, source_url: &str) -> Result<ContactFactCitationDetail> {
        let path = if source_url.starts_with("http://") || source_url.starts_with("https://") {
            let parsed = reqwest::Url::parse(source_url)
                .map_err(|_| InkboxError::InvalidArgument("invalid citation source URL".into()))?;
            match parsed.query() {
                Some(query) => format!("{}?{query}", parsed.path()),
                None => parsed.path().to_string(),
            }
        } else {
            source_url.to_string()
        };
        let relative_path = path.strip_prefix("/api/v1").unwrap_or(&path);
        if !relative_path.starts_with("/contacts/") {
            return Err(InkboxError::InvalidArgument(
                "source_url must be a contact citation URL".into(),
            ));
        }
        let data = self.http.get(relative_path, NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Delete a fact using an admin-scoped API key.
    pub fn delete(&self, contact_id: &str, fact_id: &str) -> Result<ContactFactDeleteResult> {
        let data = self
            .http
            .delete_with_response(&format!("{BASE}/{contact_id}/facts/{fact_id}"))?;
        Ok(serde_json::from_value(data)?)
    }
}

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;

    use crate::client::Inkbox;
    use crate::contacts::{ContactFactCitationAvailability, ContactFactKind};

    #[test]
    fn lists_facts_and_parses_citation_availability() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/contacts/11111111-1111-1111-1111-111111111111/facts");
            then.status(200).json_body(json!([{
                "id": "22222222-2222-2222-2222-222222222222",
                "contact_id": "11111111-1111-1111-1111-111111111111",
                "content": "Prefers morning meetings",
                "confidence": "0.90",
                "origin": "generated",
                "locked_at": null,
                "created_at": "2026-07-20T12:00:00Z",
                "updated_at": "2026-07-20T12:00:00Z",
                "citations": [{
                    "source_type": "email",
                    "availability": "source_unavailable_to_caller"
                }]
            }]));
        });

        let sdk = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let facts = sdk
            .contacts()
            .facts()
            .list("11111111-1111-1111-1111-111111111111")
            .unwrap();

        mock.assert();
        assert_eq!(facts.len(), 1);
        assert_eq!(facts[0].confidence, Some(0.90));
        assert_eq!(
            facts[0].citations[0].availability,
            ContactFactCitationAvailability::SourceUnavailableToCaller
        );
    }

    #[test]
    fn creates_updates_and_lists_expired_facts() {
        let server = MockServer::start();
        let fact = json!({
            "id": "22222222-2222-2222-2222-222222222222",
            "contact_id": "11111111-1111-1111-1111-111111111111",
            "content": "Prefers morning meetings",
            "confidence": null,
            "origin": "user",
            "kind": "preference",
            "expires_at": null,
            "locked_at": null,
            "created_at": "2026-07-20T12:00:00Z",
            "updated_at": "2026-07-20T12:00:00Z",
            "citations": []
        });
        let create = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/contacts/contact-1/facts")
                .json_body(json!({"content": "Prefers morning meetings", "kind": "preference"}));
            then.status(201).json_body(fact.clone());
        });
        let update = server.mock(|when, then| {
            when.method(httpmock::Method::PATCH)
                .path("/api/v1/contacts/contact-1/facts/fact-1")
                .json_body(json!({"kind": "profile"}));
            then.status(200).json_body(fact.clone());
        });
        let list = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/contacts/contact-1/facts")
                .query_param("include_expired", "true");
            then.status(200).json_body(json!([{
                "id": "22222222-2222-2222-2222-222222222222",
                "contact_id": "11111111-1111-1111-1111-111111111111",
                "content": "Planning a product launch",
                "confidence": "0.80",
                "origin": "generated",
                "kind": "context",
                "expires_at": "2026-08-19T12:00:00Z",
                "locked_at": null,
                "created_at": "2026-07-20T12:00:00Z",
                "updated_at": "2026-07-20T12:00:00Z",
                "citations": []
            }]));
        });

        let sdk = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let facts = sdk.contacts();
        let facts = facts.facts();

        let created = facts
            .create(
                "contact-1",
                "Prefers morning meetings",
                ContactFactKind::Preference,
            )
            .unwrap();
        let retyped = facts
            .update("contact-1", "fact-1", None, Some(ContactFactKind::Profile))
            .unwrap();
        let expired = facts.list_including_expired("contact-1").unwrap();

        create.assert();
        update.assert();
        list.assert();
        assert_eq!(created.kind, Some(ContactFactKind::Preference));
        assert_eq!(retyped.expires_at, None);
        assert_eq!(expired[0].kind, Some(ContactFactKind::Context));
        assert_eq!(
            expired[0].expires_at.as_deref(),
            Some("2026-08-19T12:00:00Z")
        );
        assert!(facts.update("contact-1", "fact-1", None, None).is_err());
    }

    #[test]
    fn resolves_citation_url_and_deletes_fact() {
        let server = MockServer::start();
        let citation = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/contacts/contact-1/facts/fact-1/citations/citation-1")
                .query_param("view", "source");
            then.status(200).json_body(json!({
                "source_type": "email",
                "source_id": "22222222-2222-2222-2222-222222222222",
                "source_locator": {"part": "body"}
            }));
        });
        let delete = server.mock(|when, then| {
            when.method(DELETE)
                .path("/api/v1/contacts/contact-1/facts/fact-1");
            then.status(200).json_body(json!({
                "deleted_fact_id": "22222222-2222-2222-2222-222222222222",
                "memory_count": 0,
                "latest_memory": null
            }));
        });
        let sdk = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();

        sdk.contacts()
            .facts()
            .resolve_citation_url(
                "/api/v1/contacts/contact-1/facts/fact-1/citations/citation-1?view=source",
            )
            .unwrap();
        let result = sdk
            .contacts()
            .facts()
            .delete("contact-1", "fact-1")
            .unwrap();

        citation.assert();
        delete.assert();
        assert_eq!(result.memory_count, 0);
    }
}
