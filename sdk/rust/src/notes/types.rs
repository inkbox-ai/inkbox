//! Types for the Notes API.
//!
//! Port of `inkbox/notes/types.py`. Wire field names are already snake_case so
//! no serde renames are needed. Timestamps arrive as ISO strings, so they are
//! kept as `String` (per the porting contract — no chrono).

use uuid::Uuid;

/// A single grant on a note. No wildcard for notes — every grant is explicit.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NoteAccess {
    pub id: Uuid,
    pub note_id: Uuid,
    pub identity_id: Uuid,
    pub created_at: String,
}

/// An org-scoped note (free-form markdown body).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Note {
    pub id: Uuid,
    pub organization_id: String,
    pub created_by: String,
    // `title` is nullable on the wire (Python `str | None`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub body: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    // `access` may be absent/null on the wire; default to an empty list,
    // mirroring Python's `d.get("access") or []`.
    #[serde(default)]
    pub access: Vec<NoteAccess>,
}
