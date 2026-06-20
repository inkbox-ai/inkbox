//! API key creation surface.
//!
//! The Inkbox server admits two auth types on `POST /api/v1/api-keys`:
//! JWT (console) and admin-scoped API keys. Admin-scoped callers may only
//! mint identity-scoped keys (`scoped_identity_id` required); attempting
//! to mint another admin-scoped key returns HTTP 403.

use std::sync::Arc;

use serde_json::{Map, Value};
use uuid::Uuid;

use crate::api_keys::types::CreatedApiKey;
use crate::error::Result;
use crate::http::{HttpTransport, NO_QUERY};

const BASE: &str = "/api-keys";

/// Create API keys for the caller's organization.
pub struct ApiKeysResource {
    http: Arc<HttpTransport>,
}

impl ApiKeysResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Create a new API key for the caller's organization.
    ///
    /// Admin-scoped API key callers must pass `scoped_identity_id` — the
    /// server rejects attempts to mint another admin-scoped key from an
    /// admin-scoped caller with HTTP 403.
    ///
    /// # Arguments
    /// - `label`: Required human-readable name for the key (1–255 chars).
    /// - `description`: Optional free-text description (≤1000 chars).
    /// - `scoped_identity_id`: Scope this key to a specific agent identity.
    ///   Omit or pass `None` for an admin (unscoped) key with full org-wide
    ///   authority — only allowed for JWT (console) callers.
    ///
    /// # Returns
    /// A [`CreatedApiKey`] containing the full key string (shown once) and
    /// the public metadata record.
    pub fn create(
        &self,
        label: &str,
        description: Option<&str>,
        scoped_identity_id: Option<Uuid>,
    ) -> Result<CreatedApiKey> {
        // Build request body, omitting unset fields so the server sees the
        // documented defaults rather than explicit nulls.
        let mut body = Map::new();
        body.insert("label".into(), Value::String(label.to_string()));
        if let Some(description) = description {
            body.insert("description".into(), Value::String(description.to_string()));
        }
        if let Some(scoped_identity_id) = scoped_identity_id {
            // Serialize the UUID as its string form, matching Python's str().
            body.insert(
                "scoped_identity_id".into(),
                Value::String(scoped_identity_id.to_string()),
            );
        }
        let data = self.http.post(BASE, Some(&Value::Object(body)), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }
}
