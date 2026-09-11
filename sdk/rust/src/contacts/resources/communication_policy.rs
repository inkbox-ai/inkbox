//! Contact communication entries and filtered identity previews.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::contacts::resources::contacts::ListContactsParams;
use crate::contacts::types::{Contact, ContactEmail, ContactPhone, ContactReviewStatus};
use crate::error::Result;
use crate::http::{HttpTransport, NO_QUERY};

/// Whether the contact contributes to the active communication list.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContactDecision {
    #[default]
    Inherit,
    Allow,
    Block,
}

/// Email and phone entries; phone includes SMS, calls, and iMessage.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ContactChannelDecisions {
    pub email: ContactDecision,
    pub phone: ContactDecision,
}

/// One identity's overrides of the contact defaults.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactIdentityDecisions {
    pub identity_id: uuid::Uuid,
    pub email: ContactDecision,
    pub phone: ContactDecision,
}

/// Independent profile and memory visibility decisions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactVisibilityDecisions {
    pub profile: ContactDecision,
    pub memories: ContactDecision,
}

/// One identity's visibility overrides.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactIdentityVisibilityDecisions {
    pub identity_id: uuid::Uuid,
    pub profile: ContactDecision,
    pub memories: ContactDecision,
}

/// Complete visibility settings within the contact policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactVisibilityPolicy {
    pub defaults: ContactVisibilityDecisions,
    pub identities: Vec<ContactIdentityVisibilityDecisions>,
}

/// Effective permissions, including groups without stored content.
#[derive(Debug, Clone, Deserialize)]
pub struct ContactVisibilityResult {
    pub profile: bool,
    pub memories: bool,
}

/// Complete contact communication settings and optimistic revision.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactCommunicationPolicy {
    pub contact_id: uuid::Uuid,
    pub revision: u64,
    pub defaults: ContactChannelDecisions,
    pub identities: Vec<ContactIdentityDecisions>,
    pub visibility: ContactVisibilityPolicy,
}

/// Complete replacement; a stale expected revision returns HTTP 409.
#[derive(Debug, Clone, Serialize)]
pub struct ReplaceContactCommunicationPolicy {
    pub expected_revision: u64,
    pub defaults: ContactChannelDecisions,
    pub identities: Vec<ContactIdentityDecisions>,
}

/// Replace communication and visibility settings under one revision.
#[derive(Debug, Clone, Serialize)]
pub struct ReplaceContactCommunicationPolicyWithVisibility {
    #[serde(flatten)]
    pub communication: ReplaceContactCommunicationPolicy,
    pub visibility: ContactVisibilityPolicy,
}

/// The contact data visible to a selected identity.
#[derive(Debug, Clone, Deserialize)]
pub struct ContactCommunicationPreview {
    pub identity_id: uuid::Uuid,
    pub contact: Option<Contact>,
    pub email: bool,
    pub phone: bool,
    pub full_profile: bool,
    pub visibility: ContactVisibilityResult,
}

/// Paginated effective contact permissions.
#[derive(Debug, Clone, Deserialize)]
pub struct ContactCommunicationPolicyPage {
    pub items: Vec<ContactCommunicationPreview>,
    pub limit: u64,
    pub offset: u64,
    pub has_more: bool,
}

/// Effective access across a contact's current identifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IdentifierPermission {
    All,
    Some,
    None,
    NoIdentifiers,
}

/// Compact contact identification for permission management.
#[derive(Debug, Clone, Deserialize)]
pub struct ContactPermissionSummary {
    pub id: uuid::Uuid,
    pub preferred_name: Option<String>,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    pub company_name: Option<String>,
    pub review_status: ContactReviewStatus,
    pub emails: Vec<ContactEmail>,
    pub phones: Vec<ContactPhone>,
}

/// Visibility defaults and one selected identity's overrides.
#[derive(Debug, Clone, Deserialize)]
pub struct ContactPermissionVisibility {
    pub defaults: ContactVisibilityDecisions,
    pub identity_override: ContactVisibilityDecisions,
}

/// Identifier coverage and independent content permissions.
#[derive(Debug, Clone, Deserialize)]
pub struct ContactPermissionEffective {
    pub email: IdentifierPermission,
    pub phone: IdentifierPermission,
    pub profile: bool,
    pub memories: bool,
}

/// Human-managed permissions, including contacts hidden from the identity.
#[derive(Debug, Clone, Deserialize)]
pub struct ContactPermissionEntry {
    pub contact: ContactPermissionSummary,
    pub revision: u64,
    pub defaults: ContactChannelDecisions,
    pub identity_override: ContactChannelDecisions,
    pub visibility: ContactPermissionVisibility,
    pub effective: ContactPermissionEffective,
}

/// A bounded management roster.
#[derive(Debug, Clone, Deserialize)]
pub struct ContactPermissionPage {
    pub items: Vec<ContactPermissionEntry>,
    pub limit: u64,
    pub offset: u64,
    pub has_more: bool,
}

/// Administrative policy writes and permission-filtered contact reads.
pub struct ContactCommunicationPolicyResource {
    http: Arc<HttpTransport>,
}

impl ContactCommunicationPolicyResource {
    /// Use the client's authenticated transport.
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Read a contact policy using admin credentials.
    pub fn get(&self, contact_id: &str) -> Result<ContactCommunicationPolicy> {
        Ok(serde_json::from_value(self.http.get(
            &format!("/contacts/{contact_id}/communication-policy"),
            NO_QUERY,
        )?)?)
    }

    /// Atomically replace the policy using its last observed revision.
    pub fn replace(
        &self,
        contact_id: &str,
        body: &ReplaceContactCommunicationPolicy,
    ) -> Result<ContactCommunicationPolicy> {
        Ok(serde_json::from_value(self.http.put(
            &format!("/contacts/{contact_id}/communication-policy"),
            body,
        )?)?)
    }

    /// Replace all four groups; use `replace` to preserve existing visibility.
    pub fn replace_with_visibility(
        &self,
        contact_id: &str,
        body: &ReplaceContactCommunicationPolicyWithVisibility,
    ) -> Result<ContactCommunicationPolicy> {
        Ok(serde_json::from_value(self.http.put(
            &format!("/contacts/{contact_id}/communication-policy"),
            body,
        )?)?)
    }

    /// Preview one identity's contact visibility using admin credentials.
    pub fn preview(
        &self,
        contact_id: &str,
        identity_id: &str,
    ) -> Result<ContactCommunicationPreview> {
        Ok(serde_json::from_value(self.http.get(
            &format!("/contacts/{contact_id}/communication-preview"),
            &[("identity_id", identity_id.to_string())],
        )?)?)
    }

    /// List contact permissions for an identity.
    pub fn list_for_identity(
        &self,
        handle: &str,
        limit: u64,
        offset: u64,
    ) -> Result<ContactCommunicationPolicyPage> {
        Ok(serde_json::from_value(self.http.get(
            &format!("/identities/{handle}/contact-communication-policies"),
            &[("limit", limit.to_string()), ("offset", offset.to_string())],
        )?)?)
    }

    /// Manage organization contact permissions using admin credentials.
    pub fn list_management_for_identity(
        &self,
        handle: &str,
        params: &ListContactsParams,
    ) -> Result<ContactPermissionPage> {
        let mut query = Vec::new();
        if let Some(q) = &params.q {
            query.push(("q", q.clone()));
        }
        if let Some(order) = &params.order {
            query.push(("order", order.clone()));
        }
        if let Some(limit) = params.limit {
            query.push(("limit", limit.to_string()));
        }
        if let Some(offset) = params.offset {
            query.push(("offset", offset.to_string()));
        }
        for status in &params.review_status {
            query.push(("review_status", status.as_str().to_string()));
        }
        Ok(serde_json::from_value(self.http.get(
            &format!("/identities/{handle}/contact-permissions"),
            &query,
        )?)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::Inkbox;
    use httpmock::prelude::*;
    use serde_json::json;

    #[test]
    fn shared_wire_fixture_through_http_transport() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../tests/fixtures/contact_communication_policy.json"
        ))
        .unwrap();
        let server = MockServer::start();
        let contact_id = fixture["policy"]["contact_id"].as_str().unwrap();
        let identity_id = fixture["preview"]["identity_id"].as_str().unwrap();
        let get = server.mock(|when, then| {
            when.method(GET).path(format!(
                "/api/v1/contacts/{contact_id}/communication-policy"
            ));
            then.status(200).json_body(fixture["policy"].clone());
        });
        let put = server.mock(|when, then| {
            when.method(PUT)
                .path(format!(
                    "/api/v1/contacts/{contact_id}/communication-policy"
                ))
                .json_body(fixture["update"].clone());
            then.status(200).json_body(fixture["policy"].clone());
        });
        let preview = server.mock(|when, then| {
            when.method(GET)
                .path(format!(
                    "/api/v1/contacts/{contact_id}/communication-preview"
                ))
                .query_param("identity_id", identity_id);
            then.status(200).json_body(fixture["preview"].clone());
        });
        let sdk = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let contacts = sdk.contacts();
        let resource = contacts.communication_policy();
        let policy = resource.get(contact_id).unwrap();
        let saved = resource
            .replace_with_visibility(
                contact_id,
                &ReplaceContactCommunicationPolicyWithVisibility {
                    communication: ReplaceContactCommunicationPolicy {
                        expected_revision: 7,
                        defaults: policy.defaults,
                        identities: policy.identities,
                    },
                    visibility: policy.visibility,
                },
            )
            .unwrap();
        assert_eq!(saved.contact_id.to_string(), contact_id);
        let projected = resource.preview(contact_id, identity_id).unwrap();
        assert!(projected.contact.is_none());
        assert!(!projected.visibility.profile);
        get.assert();
        put.assert();
        preview.assert();
    }

    #[test]
    fn management_roster_preserves_partial_access_and_query_filters() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(GET).path("/api/v1/identities/test-agent/contact-permissions")
                .query_param("q", "Person").query_param("order", "name")
                .query_param("limit", "1").query_param("offset", "2").query_param("review_status", "confirmed");
            then.status(200).json_body(json!({"items": [{
                "contact": {"id": "33333333-3333-4333-8333-333333333333", "preferred_name": "Person", "given_name": null,
                    "family_name": null, "company_name": null, "review_status": "confirmed", "emails": [], "phones": []},
                "revision": 8, "defaults": {"email": "inherit", "phone": "inherit"},
                "identity_override": {"email": "allow", "phone": "block"},
                "visibility": {"defaults": {"profile": "inherit", "memories": "inherit"},
                    "identity_override": {"profile": "allow", "memories": "block"}},
                "effective": {"email": "some", "phone": "no_identifiers", "profile": true, "memories": false}
            }], "limit": 1, "offset": 2, "has_more": true}));
        });
        let sdk = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let page = sdk
            .contacts()
            .communication_policy()
            .list_management_for_identity(
                "test-agent",
                &ListContactsParams {
                    q: Some("Person".into()),
                    order: Some("name".into()),
                    limit: Some(1),
                    offset: Some(2),
                    review_status: vec![ContactReviewStatus::Confirmed],
                },
            )
            .unwrap();
        assert!(page.has_more);
        assert_eq!(page.items[0].revision, 8);
        assert_eq!(page.items[0].effective.email, IdentifierPermission::Some);
        assert!(page.items[0].effective.profile);
        request.assert();
    }

    #[test]
    fn rule_contacts_parse_absent_null_populated_and_filtered_cards() {
        for channel in ["mail", "phone", "imessage"] {
            for shape in ["absent", "null", "card", "filtered"] {
                let mut payload = json!({
                    "id": "11111111-1111-4111-8111-111111111111", "agent_identity_id": "22222222-2222-4222-8222-222222222222",
                    "action": "allow", "status": "active", "match_type": if channel == "mail" { "exact_email" } else { "exact_number" },
                    "match_target": if channel == "mail" { "person@example.com" } else { "+15555550123" },
                    "created_at": "2026-09-11T00:00:00Z", "updated_at": "2026-09-11T00:00:00Z"
                });
                if shape == "null" {
                    payload["contact"] = json!(null);
                }
                if shape == "card" || shape == "filtered" {
                    payload["contact"] = json!({"id": "33333333-3333-4333-8333-333333333333",
                        "preferred_name": if shape == "card" { Some("Person") } else { None },
                        "emails": [{"value": "person@example.com", "is_primary": true}],
                        "created_at": "2026-09-11T00:00:00Z", "updated_at": "2026-09-11T00:00:00Z"});
                }
                let card = match channel {
                    "mail" => {
                        serde_json::from_value::<crate::mail::types::MailIdentityContactRule>(
                            payload,
                        )
                        .unwrap()
                        .contact
                    }
                    "phone" => {
                        serde_json::from_value::<crate::phone::types::PhoneIdentityContactRule>(
                            payload,
                        )
                        .unwrap()
                        .contact
                    }
                    _ => {
                        serde_json::from_value::<crate::imessage::types::IMessageContactRule>(
                            payload,
                        )
                        .unwrap()
                        .contact
                    }
                };
                if shape == "card" || shape == "filtered" {
                    let card = card.unwrap();
                    assert_eq!(
                        card.preferred_name.as_deref(),
                        if shape == "card" {
                            Some("Person")
                        } else {
                            None
                        }
                    );
                    assert_eq!(card.emails[0].value, "person@example.com");
                } else {
                    assert!(card.is_none());
                }
            }
        }
    }

    #[test]
    fn visibility_replacement_keeps_the_legacy_request_shape() {
        let server = MockServer::start();
        let wire = json!({"expected_revision": 2, "defaults": {"email": "allow", "phone": "allow"}, "identities": [],
            "visibility": {"defaults": {"profile": "allow", "memories": "block"}, "identities": []}});
        let request = server.mock(|when, then| {
            when.method(PUT)
                .path("/api/v1/contacts/11111111-1111-4111-8111-111111111111/communication-policy")
                .json_body(wire.clone());
            then.status(200).json_body(
                json!({"contact_id": "11111111-1111-4111-8111-111111111111", "revision": 3, "defaults": wire["defaults"],
                "identities": [], "visibility": wire["visibility"]}),
            );
        });
        let sdk = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let legacy = ReplaceContactCommunicationPolicy {
            expected_revision: 2,
            defaults: ContactChannelDecisions {
                email: ContactDecision::Allow,
                phone: ContactDecision::Allow,
            },
            identities: vec![],
        };
        assert!(serde_json::to_value(&legacy)
            .unwrap()
            .get("visibility")
            .is_none());
        let saved = sdk
            .contacts()
            .communication_policy()
            .replace_with_visibility(
                "11111111-1111-4111-8111-111111111111",
                &ReplaceContactCommunicationPolicyWithVisibility {
                    communication: legacy,
                    visibility: ContactVisibilityPolicy {
                        defaults: ContactVisibilityDecisions {
                            profile: ContactDecision::Allow,
                            memories: ContactDecision::Block,
                        },
                        identities: vec![],
                    },
                },
            )
            .unwrap();
        assert!(matches!(
            saved.visibility.defaults.memories,
            ContactDecision::Block
        ));
        request.assert();
    }

    #[test]
    fn policy_replacement_sends_revision_and_complete_overrides() {
        let server = MockServer::start();
        let policy = json!({
            "contact_id": "11111111-1111-4111-8111-111111111111", "revision": 1,
            "defaults": {"email": "block", "phone": "block"},
            "identities": [{"identity_id": "22222222-2222-4222-8222-222222222222", "email": "allow", "phone": "block"}],
            "visibility": {"defaults": {"profile": "inherit", "memories": "inherit"}, "identities": []}
        });
        let get = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/contacts/11111111-1111-4111-8111-111111111111/communication-policy");
            then.status(200).json_body(policy.clone());
        });
        let put = server.mock(|when, then| {
            when.method(PUT).path("/api/v1/contacts/11111111-1111-4111-8111-111111111111/communication-policy")
                .json_body(json!({"expected_revision": 1, "defaults": policy["defaults"], "identities": policy["identities"]}));
            then.status(200).json_body(policy.clone());
        });
        let sdk = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let contacts = sdk.contacts();
        let resource = contacts.communication_policy();
        let loaded = resource
            .get("11111111-1111-4111-8111-111111111111")
            .unwrap();
        let saved = resource
            .replace(
                &loaded.contact_id.to_string(),
                &ReplaceContactCommunicationPolicy {
                    expected_revision: loaded.revision,
                    defaults: loaded.defaults,
                    identities: loaded.identities,
                },
            )
            .unwrap();
        assert!(matches!(saved.identities[0].phone, ContactDecision::Block));
        get.assert();
        put.assert();
    }

    #[test]
    fn previews_and_pages_parse_hidden_and_partial_contacts() {
        let server = MockServer::start();
        let preview = server.mock(|when, then| {
            when.method(GET).path("/api/v1/contacts/11111111-1111-4111-8111-111111111111/communication-preview").query_param("identity_id", "22222222-2222-4222-8222-222222222222");
            then.status(200).json_body(json!({"identity_id": "22222222-2222-4222-8222-222222222222", "contact": null, "email": false, "phone": false, "full_profile": false,
                "visibility": {"profile": false, "memories": false}}));
        });
        let page = server.mock(|when, then| {
            when.method(GET).path("/api/v1/identities/sample-agent/contact-communication-policies").query_param("limit", "20").query_param("offset", "40");
            then.status(200).json_body(json!({"limit": 20, "offset": 40, "has_more": true, "items": [{
                "identity_id": "22222222-2222-4222-8222-222222222222", "email": true, "phone": false, "full_profile": false,
                "visibility": {"profile": false, "memories": false},
                "contact": {"id": "11111111-1111-4111-8111-111111111111", "preferred_name": null,
                    "emails": [{"value": "person@example.com", "label": null}], "phones": [],
                    "created_at": "2026-09-10T12:00:00Z", "updated_at": "2026-09-10T12:00:00Z"}
            }]}));
        });
        let sdk = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let contacts = sdk.contacts();
        let resource = contacts.communication_policy();
        assert!(resource
            .preview(
                "11111111-1111-4111-8111-111111111111",
                "22222222-2222-4222-8222-222222222222"
            )
            .unwrap()
            .contact
            .is_none());
        let listed = resource.list_for_identity("sample-agent", 20, 40).unwrap();
        let contact = listed.items[0].contact.as_ref().unwrap();
        assert!(listed.has_more);
        assert!(contact.preferred_name.is_none());
        assert!(contact.phones.is_empty());
        assert_eq!(contact.emails[0].value, "person@example.com");
        preview.assert();
        page.assert();
    }
}
