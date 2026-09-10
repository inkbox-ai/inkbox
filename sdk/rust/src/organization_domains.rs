//! Organization domain control and agent affiliation.

use crate::error::Result;
use crate::http::{HttpTransport, NO_QUERY};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainAffiliation {
    pub domain: String,
    pub verifier: String,
    pub last_success_at: String,
    pub valid_until: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainTxtRecord {
    #[serde(rename = "type")]
    pub record_type: String,
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganizationDomain {
    pub id: String,
    pub domain: String,
    pub state: String,
    pub dns_record: DomainTxtRecord,
    pub verified_at: Option<String>,
    pub last_checked_at: Option<String>,
    pub last_success_at: Option<String>,
    pub valid_until: Option<String>,
    pub pending_expires_at: Option<String>,
    pub next_check_at: Option<String>,
    pub last_check_result: Option<String>,
    #[serde(default)]
    pub ownership_conflict: bool,
    #[serde(default)]
    pub transfer_eligible: bool,
    pub recovery_action: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganizationDomainPage {
    pub items: Vec<OrganizationDomain>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityDomainAffiliation {
    pub domain_claim_id: Option<String>,
    pub domain: Option<String>,
    #[serde(default)]
    pub publish_publicly: bool,
    pub affiliation: Option<DomainAffiliation>,
}

#[derive(Debug, Clone, Default)]
pub struct OrganizationDomainListOptions {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

pub(crate) fn path_segment(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
                char::from(byte).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

pub struct OrganizationDomainsResource {
    http: Arc<HttpTransport>,
}

impl OrganizationDomainsResource {
    pub(crate) fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    pub fn create(&self, domain: &str) -> Result<OrganizationDomain> {
        Ok(serde_json::from_value(self.http.post(
            "/organization-domains",
            Some(&json!({"domain": domain})),
            NO_QUERY,
        )?)?)
    }

    pub fn list(&self, options: &OrganizationDomainListOptions) -> Result<OrganizationDomainPage> {
        let mut params = vec![("limit", options.limit.unwrap_or(50).to_string())];
        if let Some(cursor) = &options.cursor {
            params.push(("cursor", cursor.clone()));
        }
        Ok(serde_json::from_value(
            self.http.get("/organization-domains", &params)?,
        )?)
    }

    pub fn get(&self, claim_id: &str) -> Result<OrganizationDomain> {
        Ok(serde_json::from_value(self.http.get(
            &format!("/organization-domains/{}", path_segment(claim_id)),
            NO_QUERY,
        )?)?)
    }

    pub fn verify(&self, claim_id: &str) -> Result<OrganizationDomain> {
        Ok(serde_json::from_value(self.http.post::<Value>(
            &format!("/organization-domains/{}/verify", path_segment(claim_id)),
            None,
            NO_QUERY,
        )?)?)
    }

    pub fn transfer(&self, claim_id: &str) -> Result<OrganizationDomain> {
        Ok(serde_json::from_value(self.http.post::<Value>(
            &format!("/organization-domains/{}/transfer", path_segment(claim_id)),
            None,
            NO_QUERY,
        )?)?)
    }

    pub fn delete(&self, claim_id: &str) -> Result<()> {
        self.http
            .delete(&format!("/organization-domains/{}", path_segment(claim_id)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{a2a::A2ADirectoryListOptions, Inkbox};
    use httpmock::prelude::*;

    fn claim() -> Value {
        serde_json::from_str(r#"{"id": "OrganizationDomainClaim_00000000-0000-4000-8000-000000000001", "domain": "example.com", "state": "verified", "dns_record": {"type": "TXT", "name": "_inkbox.example.com", "value": "inkbox-domain-verification=example-proof"}, "verified_at": "2026-09-10T00:00:00Z", "last_checked_at": "2026-09-10T00:00:00Z", "last_success_at": "2026-09-10T00:00:00Z", "valid_until": "2026-09-11T00:00:00Z", "pending_expires_at": null, "next_check_at": "2026-09-10T01:00:00Z", "last_check_result": "present", "ownership_conflict": false, "transfer_eligible": false, "recovery_action": null, "created_at": "2026-09-10T00:00:00Z"}"#).unwrap()
    }

    #[test]
    fn claim_lifecycle_and_identity_wire_contract() {
        let server = MockServer::start();
        let client = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let create = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/organization-domains")
                .json_body(json!({"domain":"example.com"}));
            then.status(201).json_body(claim());
        });
        assert_eq!(
            client
                .organization_domains()
                .create("example.com")
                .unwrap()
                .domain,
            "example.com"
        );
        create.assert();
        for action in ["get", "verify", "transfer"] {
            let path = format!(
                "/api/v1/organization-domains/claim%2Fid{}",
                if action == "get" {
                    String::new()
                } else {
                    format!("/{action}")
                }
            );
            let expected = server.mock(|when, then| {
                when.method(if action == "get" { GET } else { POST })
                    .path(path);
                then.status(200).json_body(claim());
            });
            let result = match action {
                "get" => client.organization_domains().get("claim/id"),
                "verify" => client.organization_domains().verify("claim/id"),
                _ => client.organization_domains().transfer("claim/id"),
            };
            assert_eq!(result.unwrap().dns_record.record_type, "TXT");
            expected.assert();
        }
        let affiliation = server.mock(|when, then| {
            when.method(PUT).path("/api/v1/identities/%40helper/domain-affiliation")
                .json_body(json!({"domain_claim_id":"claim", "publish_publicly":false}));
            then.status(200).json_body(json!({"domain_claim_id":"claim", "domain":"example.com", "publish_publicly":false, "affiliation":null}));
        });
        assert!(client
            .identities()
            .set_domain_affiliation("@helper", "claim", false)
            .unwrap()
            .affiliation
            .is_none());
        affiliation.assert();
        let remove = server.mock(|when, then| {
            when.method(DELETE)
                .path("/api/v1/identities/%40helper/domain-affiliation");
            then.status(204);
        });
        client
            .identities()
            .remove_domain_affiliation("@helper")
            .unwrap();
        remove.assert();
        let release = server.mock(|when, then| {
            when.method(DELETE)
                .path("/api/v1/organization-domains/claim");
            then.status(204);
        });
        client.organization_domains().delete("claim").unwrap();
        release.assert();
        let mut future = claim();
        future["state"] = json!("future_state");
        assert_eq!(
            serde_json::from_value::<OrganizationDomain>(future)
                .unwrap()
                .state,
            "future_state"
        );
    }

    #[test]
    fn public_filter_is_sent_and_rejected_for_organization_directory() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(GET)
                .path("/a2a/directory")
                .query_param("verified_domain", "example.com")
                .query_param("cursor", "next");
            then.status(200)
                .json_body(json!({"items":[], "next_cursor":null}));
        });
        let client = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let options = A2ADirectoryListOptions {
            verified_domain: Some("example.com".into()),
            cursor: Some("next".into()),
            ..Default::default()
        };
        client.a2a().public_directory(&options).unwrap();
        request.assert();
        assert!(client.a2a().organization_directory(&options).is_err());
    }
}
