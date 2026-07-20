//! Contact facts and citation resolution.

use std::sync::Arc;

use crate::contacts::types::{ContactFact, ContactFactCitationDetail};
use crate::error::Result;
use crate::http::{HttpTransport, NO_QUERY};

const BASE: &str = "/contacts";

pub struct ContactFactsResource {
    http: Arc<HttpTransport>,
}

impl ContactFactsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List active facts for a contact.
    pub fn list(&self, contact_id: &str) -> Result<Vec<ContactFact>> {
        let data = self
            .http
            .get(&format!("{BASE}/{contact_id}/facts"), NO_QUERY)?;
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
}

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;

    use crate::client::Inkbox;
    use crate::contacts::ContactFactCitationAvailability;

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
                "confidence": 0.9,
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
        assert_eq!(
            facts[0].citations[0].availability,
            ContactFactCitationAvailability::SourceUnavailableToCaller
        );
    }
}
