//! Per-contact access grant management.
//!
//! Port of `inkbox/contacts/resources/contact_access.py`.

use std::sync::Arc;

use serde_json::{json, Value};

use crate::contacts::types::ContactAccess;
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

    /// List grants for a single contact.
    ///
    /// Returns 404 from the server if the caller can't see the contact.
    pub fn list(&self, contact_id: &str) -> Result<Vec<ContactAccess>> {
        let data = self
            .http
            .get(&format!("{BASE}/{contact_id}/access"), NO_QUERY)?;
        // The server may wrap the rows in `{ "items": [...] }` or return a bare array.
        let items = unwrap_items(data);
        Ok(serde_json::from_value(items)?)
    }

    /// Grant access on a contact. Admin + JWT only.
    ///
    /// # Arguments
    /// * `identity_id` - Identity to grant. Mutually exclusive with `wildcard`.
    /// * `wildcard` - If true, reset the contact to the wildcard grant (every
    ///   active identity sees the contact).
    pub fn grant(
        &self,
        contact_id: &str,
        identity_id: Option<&str>,
        wildcard: bool,
    ) -> Result<ContactAccess> {
        if wildcard && identity_id.is_some() {
            return Err(InkboxError::InvalidArgument(
                "Pass either identity_id or wildcard=True, not both.".into(),
            ));
        }
        // `identity_id` is null for a wildcard grant, otherwise the supplied id.
        let identity = if wildcard { None } else { identity_id };
        let body = json!({ "identity_id": identity });
        let data = self.http.post(
            &format!("{BASE}/{contact_id}/access"),
            Some(&body),
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Revoke a specific identity's access on a contact.
    ///
    /// Claimed-agent keys may only revoke their own grant; peer revokes
    /// receive 403.
    pub fn revoke(&self, contact_id: &str, identity_id: &str) -> Result<()> {
        self.http
            .delete(&format!("{BASE}/{contact_id}/access/{identity_id}"))
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
