//! Notes domain: org-scoped notes with per-identity access grants.

pub mod resources;
pub mod types;

pub use resources::note_access::NoteAccessResource;
pub use resources::notes::NotesResource;
pub use types::{Note, NoteAccess};
