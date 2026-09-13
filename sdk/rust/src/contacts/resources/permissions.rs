//! Effective yes/no permissions for one agent and contact.

use std::{collections::HashMap, sync::Arc};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::http::{HttpTransport, NO_QUERY};

/// Effective access. Phone covers SMS, calls, and iMessage.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ContactPermissions {
    pub emails: HashMap<String, bool>,
    pub phones: HashMap<String, bool>,
    pub profile: bool,
    pub memories: bool,
}

/// Omitted fields and addresses retain their existing settings.
#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateContactPermissions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emails: Option<HashMap<String, bool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phones: Option<HashMap<String, bool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memories: Option<bool>,
}

/// Administrative yes/no access controls.
pub struct ContactPermissionsResource {
    http: Arc<HttpTransport>,
}

impl ContactPermissionsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Read effective access using admin credentials.
    pub fn get(&self, handle: &str, contact_id: &str) -> Result<ContactPermissions> {
        Ok(serde_json::from_value(self.http.get(
            &format!("/identities/{handle}/contacts/{contact_id}/permissions"),
            NO_QUERY,
        )?)?)
    }

    /// Save explicit choices using admin credentials.
    pub fn update(
        &self,
        handle: &str,
        contact_id: &str,
        body: &UpdateContactPermissions,
    ) -> Result<ContactPermissions> {
        Ok(serde_json::from_value(self.http.patch(
            &format!("/identities/{handle}/contacts/{contact_id}/permissions"),
            body,
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
    fn boolean_permissions_preserve_false_empty_maps_and_omitted_settings() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../tests/fixtures/contact_communication_policy.json"
        ))
        .unwrap();
        let server = MockServer::start();
        let contact_id = fixture["policy"]["contact_id"].as_str().unwrap();
        let path = format!("/api/v1/identities/test-agent/contacts/{contact_id}/permissions");
        let get = server.mock(|when, then| {
            when.method(GET).path(&path);
            then.status(200).json_body(fixture["permissions"].clone());
        });
        let patch = server.mock(|when, then| {
            when.method(httpmock::Method::PATCH)
                .path(&path)
                .json_body(fixture["permissions_update"].clone());
            then.status(200).json_body(fixture["permissions"].clone());
        });
        let empty = server.mock(|when, then| {
            when.method(httpmock::Method::PATCH)
                .path(&path)
                .json_body(json!({}));
            then.status(200).json_body(fixture["permissions"].clone());
        });
        let sdk = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let contacts = sdk.contacts();
        let resource = contacts.permissions();
        let loaded = resource.get("test-agent", contact_id).unwrap();
        assert!(loaded.emails["person@example.com"]);
        assert!(!loaded.emails["personal@example.net"]);
        assert!(!loaded.phones["+15555550123"]);
        assert!(loaded.profile);
        assert!(!loaded.memories);
        let saved = resource
            .update(
                "test-agent",
                contact_id,
                &UpdateContactPermissions {
                    emails: Some(HashMap::from([("person@example.com".into(), false)])),
                    phones: Some(HashMap::new()),
                    profile: Some(false),
                    memories: None,
                },
            )
            .unwrap();
        assert_eq!(saved, loaded);
        resource
            .update(
                "test-agent",
                contact_id,
                &UpdateContactPermissions::default(),
            )
            .unwrap();
        get.assert();
        patch.assert();
        empty.assert();
    }
}
