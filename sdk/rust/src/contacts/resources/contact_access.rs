//! Read-only compatibility access rows for contacts.

use std::sync::Arc;

use serde_json::Value;

use crate::contacts::types::ContactAccess;
use crate::error::Result;
use crate::http::{HttpTransport, NO_QUERY};

const BASE: &str = "/contacts";

pub struct ContactAccessResource {
    http: Arc<HttpTransport>,
}

impl ContactAccessResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List compatibility access rows for a single contact.
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
