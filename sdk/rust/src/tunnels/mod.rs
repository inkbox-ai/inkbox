//! The Inkbox **tunnels** domain: the control-plane REST surface for tunnels
//! (reads, metadata update, CSR signing) plus tunnel-name / agent-handle
//! validation and typed exceptions.
//!
//! Ported from `inkbox/tunnels/` in the Python SDK. The wire shape (JSON field
//! names, enum string values, request bodies, query params, paths) matches the
//! Python source exactly.
//!
//! The data-plane runtime (`tunnels/client/` in Python) is ported separately
//! and lives behind the `tunnels-runtime` feature.

pub mod exceptions;
pub mod resources;
pub mod types;
pub mod validation;

/// Data-plane runtime (`connect`/`serve`). Ported separately; declared gated
/// so the crate builds without it.
#[cfg(feature = "tunnels-runtime")]
pub mod client;

// Re-export the public types.
pub use types::{SignedCert, TLSMode, Tunnel, TunnelStatus, TunnelStatusValue};

// Re-export the exception surface.
pub use exceptions::{map_sign_csr_error, TunnelError};

// Re-export validation helpers.
pub use validation::{normalize_agent_handle, validate_agent_handle, validate_tunnel_name};

// Re-export the resource + its bounds constants.
pub use resources::{TunnelsResource, POOL_SIZE_MAX, POOL_SIZE_MIN};
