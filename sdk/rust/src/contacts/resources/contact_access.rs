//! Selected-agent visibility and communication access, plus compatibility metadata.

use std::sync::Arc;

use serde_json::Value;

use crate::contacts::types::{ContactAccess, ContactAccessSettings, UpdateContactAccess};
use crate::error::{InkboxError, Result};
use crate::http::{HttpTransport, NO_QUERY};

const BASE: &str = "/contacts";

pub struct ContactAccessResource {
    http: Arc<HttpTransport>,
}

impl ContactAccessResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Read group visibility and contactable addresses using admin credentials.
    pub fn get(&self, handle: &str, contact_id: &str) -> Result<ContactAccessSettings> {
        Ok(serde_json::from_value(self.http.get(
            &format!("/identities/{handle}/contacts/{contact_id}/access"),
            NO_QUERY,
        )?)?)
    }

    /// Save partial access choices using admin credentials.
    pub fn update(
        &self,
        handle: &str,
        contact_id: &str,
        body: &UpdateContactAccess,
    ) -> Result<ContactAccessSettings> {
        body.validate()
            .map_err(|message| InkboxError::InvalidArgument(message.into()))?;
        Ok(serde_json::from_value(self.http.patch(
            &format!("/identities/{handle}/contacts/{contact_id}/access"),
            body,
        )?)?)
    }

    /// List deprecated read-only compatibility metadata for a contact.
    ///
    /// Communication policies, not these records, control contact visibility.
    pub fn list(&self, contact_id: &str) -> Result<Vec<ContactAccess>> {
        let data = self
            .http
            .get(&format!("{BASE}/{contact_id}/access"), NO_QUERY)?;
        // The server may wrap the rows in `{ "items": [...] }` or return a bare array.
        let items = unwrap_items(data);
        Ok(serde_json::from_value(items)?)
    }
}

/// Mirror Python's `data["items"] if "items" in data else data`.
fn unwrap_items(data: Value) -> Value {
    match data {
        Value::Object(mut map) if map.contains_key("items") => {
            map.remove("items").unwrap_or(Value::Null)
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use crate::contacts::{
        ContactChannelAccessUpdate, ContactCreatePermissions, CreateContactParams,
        UpdateContactAccess,
    };
    use crate::Inkbox;
    use httpmock::prelude::*;
    use serde_json::json;

    #[test]
    fn group_access_preserves_nested_omission_and_atomic_creation() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../tests/fixtures/contact_communication_policy.json"
        ))
        .unwrap();
        let server = MockServer::start();
        let contact_id = fixture["policy"]["contact_id"].as_str().unwrap();
        let path = format!("/api/v1/identities/test-agent/contacts/{contact_id}/access");
        let get = server.mock(|when, then| {
            when.method(GET).path(&path);
            then.status(200).json_body(fixture["access"].clone());
        });
        let patch = server.mock(|when, then| {
            when.method(httpmock::Method::PATCH)
                .path(&path)
                .json_body(fixture["access_update"].clone());
            then.status(200).json_body(fixture["access"].clone());
        });
        let empty = server.mock(|when, then| {
            when.method(httpmock::Method::PATCH)
                .path(&path)
                .json_body(json!({}));
            then.status(200).json_body(fixture["access"].clone());
        });
        let nested = server.mock(|when, then| {
            when.method(httpmock::Method::PATCH)
                .path(&path)
                .json_body(json!({"email": {}}));
            then.status(200).json_body(fixture["access"].clone());
        });
        let create = server.mock(|when, then| {
            when.method(POST).path("/api/v1/contacts/with-permissions").json_body(json!({"given_name": "Ada", "permissions": {
                "identity_id": fixture["policy"]["identity_id"], "profile": true,
                "email": {"visible": true, "contactable": []},
            }}));
            then.status(201).json_body(json!({"id": contact_id, "created_at": "2026-09-11T00:00:00Z", "updated_at": "2026-09-11T00:00:00Z"}));
        });
        let sdk = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let contacts = sdk.contacts();
        let access = contacts.access();
        let loaded = access.get("test-agent", contact_id).unwrap();
        assert!(loaded.email.visible && loaded.phone.visible);
        assert_eq!(loaded.email.contactable, ["person@example.com"]);
        assert!(loaded.phone.contactable.is_empty());
        assert!(!loaded.profile && loaded.memories);
        let email = ContactChannelAccessUpdate {
            visible: Some(true),
            contactable: Some(vec![]),
        };
        assert_eq!(
            access
                .update(
                    "test-agent",
                    contact_id,
                    &UpdateContactAccess {
                        email: Some(ContactChannelAccessUpdate {
                            visible: Some(false),
                            contactable: Some(vec![]),
                        }),
                        phone: Some(ContactChannelAccessUpdate {
                            visible: Some(false),
                            ..Default::default()
                        }),
                        profile: Some(false),
                        memories: Some(false),
                    }
                )
                .unwrap(),
            loaded
        );
        access
            .update("test-agent", contact_id, &UpdateContactAccess::default())
            .unwrap();
        access
            .update(
                "test-agent",
                contact_id,
                &UpdateContactAccess {
                    email: Some(Default::default()),
                    ..Default::default()
                },
            )
            .unwrap();
        contacts
            .create(&CreateContactParams {
                given_name: Some("Ada".into()),
                permissions: Some(ContactCreatePermissions {
                    identity_id: fixture["policy"]["identity_id"]
                        .as_str()
                        .unwrap()
                        .parse()
                        .unwrap(),
                    email: Some(email),
                    profile: Some(true),
                    ..Default::default()
                }),
                ..Default::default()
            })
            .unwrap();
        assert!(access
            .update(
                "test-agent",
                contact_id,
                &UpdateContactAccess {
                    profile: Some(false),
                    memories: Some(true),
                    ..Default::default()
                },
            )
            .is_err());
        get.assert();
        patch.assert();
        empty.assert();
        nested.assert();
        create.assert();
    }
}
