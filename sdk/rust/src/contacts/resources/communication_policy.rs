//! Contact communication entries and filtered identity previews.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::contacts::types::Contact;
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
    pub identity_id: String,
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
    pub identity_id: String,
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
    pub contact_id: String,
    pub revision: u64,
    pub defaults: ContactChannelDecisions,
    pub identities: Vec<ContactIdentityDecisions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<ContactVisibilityPolicy>,
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
    pub identity_id: String,
    pub contact: Option<Contact>,
    pub email: bool,
    pub phone: bool,
    pub full_profile: bool,
    #[serde(default)]
    pub visibility: Option<ContactVisibilityResult>,
}

/// Paginated effective contact permissions.
#[derive(Debug, Clone, Deserialize)]
pub struct ContactCommunicationPolicyPage {
    pub items: Vec<ContactCommunicationPreview>,
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::Inkbox;
    use httpmock::prelude::*;
    use serde_json::json;

    #[test]
    fn visibility_replacement_keeps_the_legacy_request_shape() {
        let server = MockServer::start();
        let wire = json!({"expected_revision": 2, "defaults": {"email": "allow", "phone": "allow"}, "identities": [],
            "visibility": {"defaults": {"profile": "allow", "memories": "block"}, "identities": []}});
        let request = server.mock(|when, then| {
            when.method(PUT)
                .path("/api/v1/contacts/contact-1/communication-policy")
                .json_body(wire.clone());
            then.status(200).json_body(
                json!({"contact_id": "contact-1", "revision": 3, "defaults": wire["defaults"],
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
                "contact-1",
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
            saved.visibility.unwrap().defaults.memories,
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
            "identities": [{"identity_id": "22222222-2222-4222-8222-222222222222", "email": "allow", "phone": "block"}]
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
                &loaded.contact_id,
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
            when.method(GET).path("/api/v1/contacts/contact-1/communication-preview").query_param("identity_id", "identity-1");
            then.status(200).json_body(json!({"identity_id": "identity-1", "contact": null, "email": false, "phone": false, "full_profile": false}));
        });
        let page = server.mock(|when, then| {
            when.method(GET).path("/api/v1/identities/sample-agent/contact-communication-policies").query_param("limit", "20").query_param("offset", "40");
            then.status(200).json_body(json!({"limit": 20, "offset": 40, "has_more": true, "items": [{
                "identity_id": "identity-1", "email": true, "phone": false, "full_profile": false,
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
            .preview("contact-1", "identity-1")
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
