//! Typed exceptions for the Tunnels SDK surface.
//!
//! Ported from `inkbox/tunnels/exceptions.py`. The Python module defines two
//! families of tunnel errors:
//!
//! 1. **Local (non-wire)** errors, subclasses of `TunnelError` (itself an
//!    `InkboxError`): `TunnelNameInvalid`, `TunnelRemoved`,
//!    `TunnelNotProvisioned`.
//! 2. **Wire (409)** errors, subclasses of `InkboxAPIError`:
//!    `TunnelStateConflict`, `TunnelTLSModeMismatch`, and
//!    `TunnelCSRStateConflict` (a subclass of `TunnelStateConflict`).
//!
//! ## How the hierarchy is modeled in Rust
//!
//! The crate already collapses the whole exception hierarchy into the single
//! [`InkboxError`] enum (see `crate::error`). Rather than add a parallel error
//! type, this module keeps a lightweight [`TunnelError`] enum **purely as a
//! tag / constructor set** that records *which* Python subclass a given
//! failure corresponds to, and converts into the canonical [`InkboxError`]:
//!
//! - Local errors become [`InkboxError::Tunnel`] (the `TunnelError` base, which
//!   the contract maps to `InkboxError::Tunnel(String)`). The message is
//!   prefixed with the Python class name so callers can still discriminate.
//! - Wire 409 errors become [`InkboxError::Api`] with `status_code = 409` and
//!   the server's `detail`, preserving the exact wire surface. The
//!   classification (state-conflict vs TLS-mode-mismatch vs CSR-state-conflict)
//!   is recovered by [`map_sign_csr_error`] from the 409 `detail` text, exactly
//!   as the Python `_map_sign_csr_error` does.
//!
//! This keeps a single error channel (`Result<T, InkboxError>`) everywhere
//! while still naming every Python subclass for parity and discoverability.

use crate::error::{ApiErrorDetail, InkboxError};

/// Tag for the tunnel-specific error subclasses from the Python SDK.
///
/// Each variant carries the data needed to build the canonical
/// [`InkboxError`]. Construct one and call [`TunnelError::into_inkbox`] (or
/// rely on the `From` impl) to surface it.
#[derive(Debug, Clone)]
pub enum TunnelError {
    /// `TunnelNameInvalid` — local validation: `tunnel_name` failed the SDK's
    /// regex/length check. Fast-fail before the request is sent. Distinct from
    /// the server-side 409 (`HandleUnavailableError`) on the unified handle
    /// namespace.
    NameInvalid(String),

    /// `TunnelRemoved` — the on-disk state file references a tunnel that has
    /// been finalized (server returned 404 for the stored `tunnel_id`). Clear
    /// the state directory and call `create_identity(...)` to start fresh.
    Removed(String),

    /// `TunnelNotProvisioned` — raised by `connect` when no tunnel exists for
    /// the supplied name in the calling org. Tunnels are provisioned
    /// atomically as part of `create_identity(...)`.
    NotProvisioned(String),

    /// `TunnelStateConflict` — 409 from a tunnel operation against a tunnel in
    /// an incompatible status.
    StateConflict {
        status_code: u16,
        detail: ApiErrorDetail,
    },

    /// `TunnelTLSModeMismatch` — 409 from `sign_csr` against an *edge* tunnel.
    /// CSR signing is only meaningful on passthrough tunnels.
    TLSModeMismatch {
        status_code: u16,
        detail: ApiErrorDetail,
    },

    /// `TunnelCSRStateConflict` — 409 from `sign_csr` against a tunnel in the
    /// wrong status (a subclass of `TunnelStateConflict`).
    CSRStateConflict {
        status_code: u16,
        detail: ApiErrorDetail,
    },
}

impl TunnelError {
    /// Convert into the canonical [`InkboxError`].
    ///
    /// Local subclasses become [`InkboxError::Tunnel`] (message prefixed with
    /// the Python class name); 409 subclasses become [`InkboxError::Api`] with
    /// the original status code and detail.
    pub fn into_inkbox(self) -> InkboxError {
        match self {
            TunnelError::NameInvalid(m) => InkboxError::Tunnel(format!("TunnelNameInvalid: {m}")),
            TunnelError::Removed(m) => InkboxError::Tunnel(format!("TunnelRemoved: {m}")),
            TunnelError::NotProvisioned(m) => {
                InkboxError::Tunnel(format!("TunnelNotProvisioned: {m}"))
            }
            TunnelError::StateConflict {
                status_code,
                detail,
            }
            | TunnelError::TLSModeMismatch {
                status_code,
                detail,
            }
            | TunnelError::CSRStateConflict {
                status_code,
                detail,
            } => InkboxError::Api {
                status_code,
                detail,
            },
        }
    }
}

impl From<TunnelError> for InkboxError {
    fn from(e: TunnelError) -> Self {
        e.into_inkbox()
    }
}

/// Extract the human-readable text from an error `detail`, mirroring Python's
/// `_detail_text`: a plain string is returned as-is; a `{"detail": "..."}`
/// object yields its inner string; anything else is rendered via `Display`.
fn detail_text(detail: &ApiErrorDetail) -> String {
    match detail {
        ApiErrorDetail::Message(s) => s.clone(),
        ApiErrorDetail::Structured(v) => {
            if let Some(inner) = v.get("detail").and_then(|d| d.as_str()) {
                inner.to_string()
            } else {
                v.to_string()
            }
        }
    }
}

/// Map an API error from `sign_csr` onto the right tunnel subclass.
///
/// Faithful port of Python's `_map_sign_csr_error`:
/// - non-409 errors pass through unchanged;
/// - a 409 whose `detail` text mentions `edge`, `tls_mode`, or `passthrough`
///   becomes a `TunnelTLSModeMismatch`;
/// - any other 409 becomes a `TunnelCSRStateConflict`.
///
/// # Arguments
/// * `err` - The error raised by the underlying HTTP transport.
///
/// # Returns
/// The mapped [`InkboxError`] (a 409 reclassified as a tunnel subclass, or the
/// original error untouched).
pub fn map_sign_csr_error(err: InkboxError) -> InkboxError {
    // Only API 409s are reclassified; everything else (transport, decode,
    // other status codes) passes through verbatim.
    let (status_code, detail) = match &err {
        InkboxError::Api {
            status_code,
            detail,
        } if *status_code == 409 => (*status_code, detail.clone()),
        _ => return err,
    };

    let text = detail_text(&detail).to_lowercase();
    if text.contains("edge") || text.contains("tls_mode") || text.contains("passthrough") {
        TunnelError::TLSModeMismatch {
            status_code,
            detail,
        }
        .into()
    } else {
        TunnelError::CSRStateConflict {
            status_code,
            detail,
        }
        .into()
    }
}
