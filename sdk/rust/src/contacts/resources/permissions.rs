//! Effective yes/no permissions for one agent and contact.

use std::{collections::HashMap, sync::Arc};

use serde::{Deserialize, Serialize};

use crate::error::{InkboxError, Result};
use crate::http::{HttpTransport, NO_QUERY};

/// Effective access. Phone covers SMS, calls, and iMessage.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ContactPermissions {
    pub emails: HashMap<String, bool>,
    pub phones: HashMap<String, bool>,
    pub profile: bool,
    pub memories: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(from = "DirectionalPermissionsWire")]
pub struct DirectionalContactPermissions {
    pub permissions: ContactPermissions,
    pub inbound_emails: HashMap<String, bool>,
    pub outbound_emails: HashMap<String, bool>,
    pub inbound_phones: HashMap<String, bool>,
    pub outbound_phones: HashMap<String, bool>,
}

#[derive(Deserialize)]
struct DirectionalPermissionsWire {
    #[serde(flatten)]
    permissions: ContactPermissions,
    inbound_emails: Option<HashMap<String, bool>>,
    outbound_emails: Option<HashMap<String, bool>>,
    inbound_phones: Option<HashMap<String, bool>>,
    outbound_phones: Option<HashMap<String, bool>>,
}

impl From<DirectionalPermissionsWire> for DirectionalContactPermissions {
    fn from(wire: DirectionalPermissionsWire) -> Self {
        Self {
            inbound_emails: wire
                .inbound_emails
                .unwrap_or_else(|| wire.permissions.emails.clone()),
            outbound_emails: wire
                .outbound_emails
                .unwrap_or_else(|| wire.permissions.emails.clone()),
            inbound_phones: wire
                .inbound_phones
                .unwrap_or_else(|| wire.permissions.phones.clone()),
            outbound_phones: wire
                .outbound_phones
                .unwrap_or_else(|| wire.permissions.phones.clone()),
            permissions: wire.permissions,
        }
    }
}

impl std::ops::Deref for DirectionalContactPermissions {
    type Target = ContactPermissions;
    fn deref(&self) -> &Self::Target {
        &self.permissions
    }
}

/// Omitted addresses preserve their permission on the named side.
#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateDirectionalContactPermissions {
    #[serde(flatten)]
    pub permissions: UpdateContactPermissions,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inbound_emails: Option<HashMap<String, bool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outbound_emails: Option<HashMap<String, bool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inbound_phones: Option<HashMap<String, bool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outbound_phones: Option<HashMap<String, bool>>,
}

impl UpdateDirectionalContactPermissions {
    pub(crate) fn validate(&self) -> Result<()> {
        self.permissions
            .validate()
            .map_err(|m| InkboxError::InvalidArgument(m.into()))?;
        for (shared, inbound, outbound) in [
            (
                &self.permissions.emails,
                &self.inbound_emails,
                &self.outbound_emails,
            ),
            (
                &self.permissions.phones,
                &self.inbound_phones,
                &self.outbound_phones,
            ),
        ] {
            if shared.is_some() && (inbound.is_some() || outbound.is_some()) {
                return Err(InkboxError::InvalidArgument(
                    "shared and directional permissions cannot be combined for the same channel"
                        .into(),
                ));
            }
            if self.permissions.profile == Some(false)
                && [inbound, outbound]
                    .into_iter()
                    .flatten()
                    .any(|v| v.values().any(|v| *v))
            {
                return Err(InkboxError::InvalidArgument(
                    "Profile cannot be disabled while email or phone is enabled".into(),
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DirectionalContactInitialPermissions {
    pub identity_id: uuid::Uuid,
    #[serde(flatten)]
    pub permissions: UpdateDirectionalContactPermissions,
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

impl UpdateContactPermissions {
    fn validate(&self) -> std::result::Result<(), &'static str> {
        if self.profile == Some(false)
            && (self.memories == Some(true)
                || self
                    .emails
                    .as_ref()
                    .is_some_and(|values| values.values().any(|allowed| *allowed))
                || self
                    .phones
                    .as_ref()
                    .is_some_and(|values| values.values().any(|allowed| *allowed)))
        {
            return Err("Profile cannot be disabled while email, phone, or memories is enabled");
        }
        Ok(())
    }
}

/// Administrative yes/no access controls.
pub struct ContactPermissionsResource {
    http: Arc<HttpTransport>,
}

impl ContactPermissionsResource {
    pub fn get_with_options(
        &self,
        handle: &str,
        contact_id: &str,
    ) -> Result<DirectionalContactPermissions> {
        Ok(serde_json::from_value(self.http.get(
            &format!("/identities/{handle}/contacts/{contact_id}/permissions"),
            NO_QUERY,
        )?)?)
    }

    pub fn update_with_options(
        &self,
        handle: &str,
        contact_id: &str,
        options: &UpdateDirectionalContactPermissions,
    ) -> Result<DirectionalContactPermissions> {
        options.validate()?;
        Ok(serde_json::from_value(self.http.patch(
            &format!("/identities/{handle}/contacts/{contact_id}/permissions"),
            options,
        )?)?)
    }
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
        body.validate()
            .map_err(|message| InkboxError::InvalidArgument(message.into()))?;
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
        assert!(resource
            .update(
                "test-agent",
                contact_id,
                &UpdateContactPermissions {
                    emails: Some(HashMap::from([("person@example.com".into(), true)])),
                    profile: Some(false),
                    ..Default::default()
                },
            )
            .is_err());
        get.assert();
        patch.assert();
        empty.assert();
    }
}
