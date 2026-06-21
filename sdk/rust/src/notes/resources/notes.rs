//! Notes CRUD + per-note access subresource.
//!
//! Port of `inkbox/notes/resources/notes.py`.

use std::sync::Arc;

use serde_json::{Map, Value};
use uuid::Uuid;

use crate::error::Result;
use crate::http::{HttpTransport, NO_QUERY};
use crate::notes::resources::note_access::NoteAccessResource;
use crate::notes::types::Note;

const BASE: &str = "/notes";

/// Org-scoped notes with per-identity access grants.
pub struct NotesResource {
    http: Arc<HttpTransport>,
    access: NoteAccessResource,
}

impl NotesResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self {
            access: NoteAccessResource::new(http.clone()),
            http,
        }
    }

    /// Per-note access grant subresource.
    pub fn access(&self) -> &NoteAccessResource {
        &self.access
    }

    /// List accessible notes.
    ///
    /// # Arguments
    /// * `q` - Substring search (≤200 chars).
    /// * `identity_id` - Filter to notes visible to a specific identity.
    /// * `limit` - 1–200 (server default 50).
    /// * `offset` - Offset for paging.
    /// * `order` - `"recent"` (default) or `"created"`.
    pub fn list(
        &self,
        q: Option<&str>,
        identity_id: Option<Uuid>,
        limit: Option<i64>,
        offset: Option<i64>,
        order: Option<&str>,
    ) -> Result<Vec<Note>> {
        // Build the query, omitting any params that are `None` (matches Python).
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(q) = q {
            params.push(("q", q.to_string()));
        }
        if let Some(identity_id) = identity_id {
            params.push(("identity_id", identity_id.to_string()));
        }
        if let Some(limit) = limit {
            params.push(("limit", limit.to_string()));
        }
        if let Some(offset) = offset {
            params.push(("offset", offset.to_string()));
        }
        if let Some(order) = order {
            params.push(("order", order.to_string()));
        }
        let data = self.http.get(BASE, &params)?;
        // Unwrap the `{"items": [...]}` envelope if present, else treat as a list.
        let items = match data.get("items") {
            Some(items) => items.clone(),
            None => data,
        };
        Ok(serde_json::from_value(items)?)
    }

    /// Fetch a single note by id.
    pub fn get(&self, note_id: Uuid) -> Result<Note> {
        let data = self.http.get(&format!("{BASE}/{note_id}"), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Create a note.
    ///
    /// Agent-created notes auto-grant the creator. Human-created notes start
    /// with zero grants and are invisible to all agents until granted.
    pub fn create(&self, body: &str, title: Option<&str>) -> Result<Note> {
        let mut payload = Map::new();
        payload.insert("body".to_string(), Value::String(body.to_string()));
        if let Some(title) = title {
            payload.insert("title".to_string(), Value::String(title.to_string()));
        }
        let data = self
            .http
            .post(BASE, Some(&Value::Object(payload)), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// JSON-merge-patch update.
    ///
    /// `title` uses an outer `Option` as the omit/include sentinel: `None`
    /// omits the key entirely; `Some(None)` sends `title: null`, which clears
    /// the title column (200 OK); `Some(Some(v))` sets it. `body` of `None`
    /// omits the key; the body column is required, so the server returns 422 if
    /// you ever send `body: null` (not expressible here).
    ///
    /// # Arguments
    /// * `note_id` - The note to update.
    /// * `title` - Omit (`None`), clear (`Some(None)`), or set (`Some(Some(..))`).
    /// * `body` - Omit (`None`) or set the body (`Some(..)`).
    pub fn update(
        &self,
        note_id: Uuid,
        title: Option<Option<&str>>,
        body: Option<&str>,
    ) -> Result<Note> {
        let mut payload = Map::new();
        // Only insert `title` when the caller passed the sentinel; an explicit
        // `Some(None)` becomes JSON null, mirroring Python's `title=None` clear.
        if let Some(title) = title {
            payload.insert(
                "title".to_string(),
                match title {
                    Some(t) => Value::String(t.to_string()),
                    None => Value::Null,
                },
            );
        }
        if let Some(body) = body {
            payload.insert("body".to_string(), Value::String(body.to_string()));
        }
        let data = self
            .http
            .patch(&format!("{BASE}/{note_id}"), &Value::Object(payload))?;
        Ok(serde_json::from_value(data)?)
    }

    /// Delete a note.
    pub fn delete(&self, note_id: Uuid) -> Result<()> {
        self.http.delete(&format!("{BASE}/{note_id}"))
    }
}
