//! Pre-runtime orchestration: state-file lookup, server lookup, optional CSR
//! sign for passthrough. Resolves a [`TunnelBundle`] the runtime connects with.
//!
//! Tunnels are provisioned atomically by `create_identity(...)`; `connect` is
//! read-only on the control plane (except passthrough CSR signing). Data-plane
//! auth uses the client's API key — no per-tunnel secret is involved.
//!
//! Ported from `inkbox/tunnels/client/_bootstrap.py`.

use std::path::Path;

use crate::error::{InkboxError, Result};
use crate::tunnels::resources::{POOL_SIZE_MAX, POOL_SIZE_MIN};
use crate::tunnels::types::Tunnel;

use super::state::StateEntry;

/// Default tunnel zone — fallback when neither the server response nor the
/// state file specifies one.
pub const PROD_ZONE: &str = "inkboxwire.com";

/// Fully-resolved tunnel ready to connect. The TLS terminator (passthrough)
/// is represented by its cert-chain + key PEM bytes; the runtime builds the
/// rustls config from them.
#[derive(Debug, Clone)]
pub struct TunnelBundle {
    pub tunnel: Tunnel,
    pub public_host: String,
    pub zone: String,
    /// Passthrough only: `(cert_chain_pem, key_pem)`. `None` for edge tunnels.
    pub tls_material: Option<(Vec<u8>, Vec<u8>)>,
}

/// Validate the optional `pool_size` kwarg (1..=32). Mirrors Python's
/// `validate_pool_size`, raising on out-of-range values.
pub fn validate_pool_size(pool_size: Option<i64>) -> Result<()> {
    match pool_size {
        None => Ok(()),
        Some(n) if n < POOL_SIZE_MIN => Err(InkboxError::InvalidArgument(format!(
            "pool_size must be an int >= {POOL_SIZE_MIN} (got {n})"
        ))),
        Some(n) if n > POOL_SIZE_MAX => Err(InkboxError::InvalidArgument(format!(
            "pool_size must be <= {POOL_SIZE_MAX} (got {n})"
        ))),
        Some(_) => Ok(()),
    }
}

/// Pick the zone + public host using the documented precedence.
///
/// `data_plane_zone_override` only overrides the zone (the data-plane h2
/// endpoint). `public_host` always comes from server > state > prod-zone
/// fallback.
///
/// # Arguments
/// * `name` - The tunnel name (= owning identity's agent handle).
/// * `server_zone` / `server_public_host` - Values from the control-plane
///   tunnel record (may be empty).
/// * `state` - The on-disk state entry, if any.
/// * `data_plane_zone_override` - Expert-only zone override.
///
/// # Returns
/// `(zone, public_host)`.
pub fn resolve_zone_and_host(
    name: &str,
    server_zone: Option<&str>,
    server_public_host: Option<&str>,
    state: Option<&StateEntry>,
    data_plane_zone_override: Option<&str>,
) -> (String, String) {
    let public_host = if let Some(h) = server_public_host.filter(|s| !s.is_empty()) {
        h.to_string()
    } else if let Some(h) = state.and_then(|s| s.public_host.as_deref()).filter(|s| !s.is_empty()) {
        h.to_string()
    } else {
        format!("{name}.{PROD_ZONE}")
    };

    let zone = if let Some(z) = data_plane_zone_override.filter(|s| !s.is_empty()) {
        z.to_string()
    } else if let Some(z) = server_zone.filter(|s| !s.is_empty()) {
        z.to_string()
    } else if let Some(z) = state.and_then(|s| s.zone.as_deref()).filter(|s| !s.is_empty()) {
        z.to_string()
    } else {
        PROD_ZONE.to_string()
    };
    (zone, public_host)
}

/// Resolve a tunnel for `connect()`: server lookup + cert dance for
/// passthrough.
///
// TODO(tunnels-runtime): full control-plane bootstrap.
// The Python `bootstrap` does, in order:
//   1. validate_tunnel_name(name); ensure_private_state_dir; load_state.
//   2. If state has a tunnel_id, `tunnels.get(id)` (404 => TunnelRemoved).
//   3. Else `tunnels.list()` and match by `tunnel_name`
//      (none => TunnelNotProvisioned).
//   4. Edge tunnels must be ACTIVE (else TunnelStateConflict 409).
//   5. Passthrough: load_or_create_keypair; if AWAITING_CERT or
//      cert_needs_sign -> build_csr + tunnels.sign_csr + write_cert_chain +
//      re-get tunnel; assert ACTIVE; build the TLS terminator material.
//   6. resolve_zone_and_host; save_state; return TunnelBundle.
// This is wired through `TunnelsResource` (the sync control-plane transport)
// at the `connect` call site rather than here, because this module has no
// transport handle. The runtime's `connect` entry point performs steps 1-6
// and constructs the bundle. The pure helpers above (validate_pool_size,
// resolve_zone_and_host) are the faithful, testable pieces.
pub fn bootstrap(
    _name: &str,
    _state_dir: &Path,
    _data_plane_zone_override: Option<&str>,
) -> Result<TunnelBundle> {
    Err(InkboxError::Tunnel(
        "tunnel bootstrap is driven from TunnelsResource::connect; call that \
         entry point (see TODO in bootstrap.rs)"
            .into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_size_validation() {
        assert!(validate_pool_size(None).is_ok());
        assert!(validate_pool_size(Some(1)).is_ok());
        assert!(validate_pool_size(Some(32)).is_ok());
        assert!(validate_pool_size(Some(0)).is_err());
        assert!(validate_pool_size(Some(-1)).is_err());
        assert!(validate_pool_size(Some(33)).is_err());
    }

    #[test]
    fn zone_host_server_wins() {
        let (zone, host) = resolve_zone_and_host(
            "my-agent",
            Some("zone.example"),
            Some("my-agent.zone.example"),
            None,
            None,
        );
        assert_eq!(zone, "zone.example");
        assert_eq!(host, "my-agent.zone.example");
    }

    #[test]
    fn zone_host_fallback_to_prod() {
        let (zone, host) = resolve_zone_and_host("my-agent", None, None, None, None);
        assert_eq!(zone, PROD_ZONE);
        assert_eq!(host, format!("my-agent.{PROD_ZONE}"));
    }

    #[test]
    fn zone_override_only_changes_zone() {
        let (zone, host) = resolve_zone_and_host(
            "my-agent",
            Some("server.example"),
            Some("my-agent.server.example"),
            None,
            Some("override.example"),
        );
        assert_eq!(zone, "override.example");
        // public_host still comes from server.
        assert_eq!(host, "my-agent.server.example");
    }

    #[test]
    fn state_used_when_server_empty() {
        let state = StateEntry {
            tunnel_id: "id".into(),
            name: "my-agent".into(),
            mode: Some("edge".into()),
            zone: Some("state.example".into()),
            public_host: Some("my-agent.state.example".into()),
        };
        let (zone, host) = resolve_zone_and_host("my-agent", None, None, Some(&state), None);
        assert_eq!(zone, "state.example");
        assert_eq!(host, "my-agent.state.example");
    }
}
