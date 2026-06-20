//! Per-note access grant management. No wildcards.
//!
//! Port of `inkbox/notes/resources/note_access.py`.

use std::sync::Arc;

use uuid::Uuid;

use crate::error::Result;
use crate::http::{HttpTransport, NO_QUERY};
use crate::notes::types::NoteAccess;

const BASE: &str = "/notes";

pub struct NoteAccessResource {
    http: Arc<HttpTransport>,
}

impl NoteAccessResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List grants on a note.
    pub fn list(&self, note_id: Uuid) -> Result<Vec<NoteAccess>> {
        let data = self
            .http
            .get(&format!("{BASE}/{note_id}/access"), NO_QUERY)?;
        // Unwrap the `{"items": [...]}` envelope if present, else treat as a list.
        let items = match data.get("items") {
            Some(items) => items.clone(),
            None => data,
        };
        Ok(serde_json::from_value(items)?)
    }

    /// Grant access on a note. Admin + JWT only.
    ///
    /// # Arguments
    /// * `note_id` - The note to grant access on.
    /// * `identity_id` - The identity receiving the grant.
    ///
    /// # Returns
    /// The created [`NoteAccess`] grant.
    pub fn grant(&self, note_id: Uuid, identity_id: Uuid) -> Result<NoteAccess> {
        let body = serde_json::json!({ "identity_id": identity_id.to_string() });
        let data = self
            .http
            .post(&format!("{BASE}/{note_id}/access"), Some(&body), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Revoke a specific identity's access on a note.
    ///
    /// Claimed-agent keys may only revoke their own grant.
    pub fn revoke(&self, note_id: Uuid, identity_id: Uuid) -> Result<()> {
        self.http
            .delete(&format!("{BASE}/{note_id}/access/{identity_id}"))
    }
}
