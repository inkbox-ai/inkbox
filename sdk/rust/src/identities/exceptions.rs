//! Typed errors for the identities surface.
//!
//! Port of `inkbox/identities/exceptions.py`. The Rust SDK funnels every
//! server error through the single [`crate::error::InkboxError`] enum rather
//! than a Python-style exception hierarchy, so the Python `HandleUnavailableError`
//! (an `InkboxAPIError` subclass) is reproduced here as a lightweight view over
//! an [`InkboxError::Api`] 409 plus a mapping helper:
//!
//! * [`map_identity_conflict_error`] is the analogue of the Python helper of
//!   the same name. Because there is no dedicated `InkboxError` variant for a
//!   handle collision, it returns the error unchanged (a 409 stays an
//!   [`InkboxError::Api`]); callers wanting the typed view call
//!   [`HandleUnavailableError::from_error`].
//! * [`HandleUnavailableError`] extracts the `blocking_namespace` from a 409
//!   `detail`, exactly as the Python constructor did.

use crate::error::{ApiErrorDetail, InkboxError};

/// Which side of the unified global namespace rejected a handle, as reported by
/// the server's 409 `detail.blocking_namespace`. `None` when the server did not
/// set the field (older deploys; treat as opaque). Mirrors the Python
/// `BlockingNamespace = Literal["identities", "tunnels", "mail", None]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockingNamespace {
    Identities,
    Tunnels,
    Mail,
}

impl BlockingNamespace {
    /// The exact wire string (`"identities"` / `"tunnels"` / `"mail"`).
    pub fn as_str(&self) -> &'static str {
        match self {
            BlockingNamespace::Identities => "identities",
            BlockingNamespace::Tunnels => "tunnels",
            BlockingNamespace::Mail => "mail",
        }
    }
}

/// Typed view of a 409 from identity-create / identity-rename when the
/// requested `agent_handle` collides with the unified global namespace.
///
/// `blocking_namespace` reports which side rejected; it is `None` when the
/// server did not set the field.
#[derive(Debug, Clone)]
pub struct HandleUnavailableError {
    pub status_code: u16,
    pub detail: ApiErrorDetail,
    pub blocking_namespace: Option<BlockingNamespace>,
}

impl HandleUnavailableError {
    /// Build the typed view from a borrowed [`InkboxError`], if it is a 409
    /// [`InkboxError::Api`]; otherwise `None`. The `blocking_namespace` is read
    /// from `detail.blocking_namespace`, matching the Python
    /// `_read_blocking_namespace`.
    pub fn from_error(err: &InkboxError) -> Option<Self> {
        if let InkboxError::Api {
            status_code,
            detail,
        } = err
        {
            if *status_code == 409 {
                return Some(Self {
                    status_code: *status_code,
                    detail: detail.clone(),
                    blocking_namespace: read_blocking_namespace(detail),
                });
            }
        }
        None
    }
}

/// Read `blocking_namespace` off a structured 409 `detail`, returning `None`
/// for any value other than the three known literals (mirrors the Python
/// `_read_blocking_namespace`).
fn read_blocking_namespace(detail: &ApiErrorDetail) -> Option<BlockingNamespace> {
    let obj = detail.as_object()?;
    match obj.get("blocking_namespace").and_then(|v| v.as_str()) {
        Some("identities") => Some(BlockingNamespace::Identities),
        Some("tunnels") => Some(BlockingNamespace::Tunnels),
        Some("mail") => Some(BlockingNamespace::Mail),
        _ => None,
    }
}

/// If `err` is a 409 collision from the identities surface, this is where the
/// Python SDK would re-raise it as a `HandleUnavailableError`. The Rust SDK has
/// no separate exception type, so the error is returned unchanged — a 409 stays
/// an [`InkboxError::Api`]. Call [`HandleUnavailableError::from_error`] on the
/// result for the typed `blocking_namespace` view.
///
/// Kept as a named pass-through so call sites read identically to the Python
/// (`map_identity_conflict_error(err)`), documenting that the 409 here is
/// always a handle collision.
pub fn map_identity_conflict_error(err: InkboxError) -> InkboxError {
    err
}
