//! Control-plane reads + update + sign-csr for tunnels.
//!
//! Ported from `inkbox/tunnels/resources/tunnels.py`. Tunnels are created and
//! deleted exclusively via identity-create / identity-delete cascades; there
//! is no standalone create / delete / restore / force-delete / rotate-secret
//! surface.

use std::sync::{Arc, Weak};

use serde_json::{json, Value};

use crate::error::{InkboxError, Result};
use crate::http::{HttpTransport, NO_QUERY};
use crate::tunnels::exceptions::map_sign_csr_error;
use crate::tunnels::types::{SignedCert, Tunnel};

const BASE: &str = "/tunnels";

/// The cert issuance flow runs synchronously inside the request and can take
/// up to a few minutes; Python bumps this call's timeout well above the
/// standard one. The Rust [`HttpTransport`] does not yet expose a per-request
/// timeout override, so [`TunnelsResource::sign_csr`] issues the call on the
/// shared transport. The constant is kept for parity / future wiring.
#[allow(dead_code)]
const SIGN_CSR_TIMEOUT_SECONDS: f64 = 180.0;

/// Lower bound for the optional `pool_size` kwarg on `connect()`. Validated in
/// the data-plane connect surface, but the constant lives here so the resource
/// module is the single source of truth.
pub const POOL_SIZE_MIN: i64 = 1;
/// Upper bound for the optional `pool_size` kwarg on `connect()`.
pub const POOL_SIZE_MAX: i64 = 32;

/// Read + edit wrapper for `/api/v1/tunnels/*` plus the `connect()` data-plane
/// entry point.
///
/// Tunnel lifecycle is owned by identity-create / identity-delete; there is no
/// create / delete / restore / force-delete / rotate-secret surface here.
///
/// Holds both the HTTP transport and a back-reference to the owning
/// [`Inkbox`](crate::client::Inkbox) client (used to launch the data-plane
/// runtime). The back-ref is a [`Weak`] to avoid a reference cycle (the client
/// owns the resource).
pub struct TunnelsResource {
    http: Arc<HttpTransport>,
    /// Back-ref to the owning client; `Weak` breaks the client -> resource ->
    /// client cycle. Used only by the data-plane `connect()` path.
    #[allow(dead_code)]
    inkbox: Weak<crate::client::Inkbox>,
}

impl TunnelsResource {
    /// Construct a tunnels resource.
    ///
    /// # Arguments
    /// * `http` - The shared HTTP transport for the `/tunnels` sub-base.
    /// * `inkbox` - A weak back-reference to the owning client (used to launch
    ///   the data-plane runtime; held weakly to avoid a reference cycle).
    pub fn new(http: Arc<HttpTransport>, inkbox: Weak<crate::client::Inkbox>) -> Self {
        Self { http, inkbox }
    }

    // --- Reads -----------------------------------------------------------

    /// List all tunnels for your organisation.
    pub fn list(&self) -> Result<Vec<Tunnel>> {
        let data = self.http.get(&format!("{BASE}/"), NO_QUERY)?;
        // The server may wrap the list as `{"tunnels": [...]}` or return a bare
        // array; handle both, matching Python.
        let items: &[Value] = match &data {
            Value::Object(map) => match map.get("tunnels") {
                Some(Value::Array(arr)) => arr.as_slice(),
                _ => &[],
            },
            Value::Array(arr) => arr.as_slice(),
            _ => &[],
        };
        items.iter().map(Tunnel::from_value).collect()
    }

    /// Fetch a tunnel by id.
    ///
    /// # Arguments
    /// * `tunnel_id` - The tunnel's id (UUID or its string form).
    pub fn get(&self, tunnel_id: &str) -> Result<Tunnel> {
        let data = self.http.get(&format!("{BASE}/{tunnel_id}"), NO_QUERY)?;
        Tunnel::from_value(&data)
    }

    // --- Writes ----------------------------------------------------------

    /// Update a tunnel's metadata.
    ///
    /// `metadata` is the only mutable field on the tunnel; other attributes are
    /// derived from the owning identity.
    ///
    /// The argument is modeled `Option<Option<...>>` to mirror the Python
    /// `_UNSET` sentinel:
    /// - `None` (outer) — omit `metadata` from the body entirely (leave
    ///   unchanged).
    /// - `Some(None)` — send `metadata: null` (clears to `{}` server-side).
    /// - `Some(Some(map))` — send the given object.
    ///
    /// `Some(None)` and `Some(Some({}))` both clear to `{}`: the server's
    /// column is non-nullable and collapses both forms on the wire.
    ///
    /// # Arguments
    /// * `tunnel_id` - The tunnel's id.
    /// * `metadata` - The new metadata bag (see the sentinel semantics above).
    pub fn update(
        &self,
        tunnel_id: &str,
        metadata: Option<Option<serde_json::Map<String, Value>>>,
    ) -> Result<Tunnel> {
        // Build the body conditionally, matching Python's "omit when _UNSET".
        let mut body = serde_json::Map::new();
        if let Some(m) = metadata {
            // `metadata=None` -> JSON null; `metadata={...}` -> the object.
            body.insert(
                "metadata".to_string(),
                match m {
                    Some(map) => Value::Object(map),
                    None => Value::Null,
                },
            );
        }
        let data = self
            .http
            .patch(&format!("{BASE}/{tunnel_id}"), &Value::Object(body))?;
        Tunnel::from_value(&data)
    }

    /// Sign a CSR for a passthrough tunnel.
    ///
    /// The server performs DNS validation and cert issuance synchronously
    /// inside this request, which can take up to a few minutes, so this call
    /// uses the elevated [`SIGN_CSR_TIMEOUT_SECONDS`] (180s) timeout, matching
    /// the Python SDK.
    ///
    /// # Arguments
    /// * `tunnel_id` - The tunnel's id.
    /// * `csr_pem` - PEM-encoded CSR. The CN must equal the tunnel hostname.
    pub fn sign_csr(&self, tunnel_id: &str, csr_pem: &str) -> Result<SignedCert> {
        let body = json!({ "csr_pem": csr_pem });
        match self.http.post_with_timeout(
            &format!("{BASE}/{tunnel_id}/sign-csr"),
            Some(&body),
            NO_QUERY,
            SIGN_CSR_TIMEOUT_SECONDS,
        ) {
            // Reclassify a 409 onto the right tunnel subclass (edge/TLS-mode
            // vs CSR-state), matching Python's `_map_sign_csr_error`.
            Err(err) => Err(map_sign_csr_error(err)),
            Ok(data) => SignedCert::from_value(&data),
        }
    }

    // --- Data plane ------------------------------------------------------

    /// Bring a tunnel online from this process.
    ///
    /// Launches the data-plane runtime via the owning client. The runtime is
    /// gated behind the `tunnels-runtime` feature; without it this is a stub
    /// that returns an error (matching the non-POSIX Python `connect` guard in
    /// spirit — the data plane is unavailable).
    ///
    /// # Arguments
    /// * `name` - The tunnel name (= the owning identity's agent handle).
    /// * `forward_to` - A local URL to forward inbound traffic to, e.g.
    ///   `http://localhost:8080`.
    ///
    /// # Returns
    /// Runs until shutdown; `Ok(())` on clean stop, `Err` on a permanent
    /// failure (e.g. the API key is rejected by `/_system/hello`).
    #[cfg(feature = "tunnels-runtime")]
    pub fn connect(&self, name: &str, forward_to: &str) -> Result<()> {
        use crate::tunnels::client::bootstrap::{
            resolve_zone_and_host, validate_pool_size, TunnelBundle,
        };
        use crate::tunnels::client::cert::{
            build_csr, cert_needs_sign, key_pem_bytes, load_or_create_keypair, write_cert_chain,
        };
        use crate::tunnels::client::runtime::{ForwardTo, TunnelRuntime, TunnelRuntimeConfig};
        use crate::tunnels::client::state::{
            ensure_private_state_dir, load_state, save_state, StateEntry, CERT_FILE,
        };
        use crate::tunnels::client::url_forward::validate_forward_target;
        use crate::tunnels::types::{TLSMode, TunnelStatus, TunnelStatusValue};

        // Read the owning client (Weak -> Arc) to source the API key. The
        // Python `connect` reads `inkbox._api_key`.
        let client = self
            .inkbox
            .upgrade()
            .ok_or_else(|| InkboxError::Tunnel("owning Inkbox client was dropped".into()))?;
        let api_key = client.api_key().to_string();

        // Local fast-fail validations, mirroring Python `connect` + `bootstrap`.
        crate::tunnels::validation::validate_tunnel_name(name)?;
        validate_pool_size(None)?;
        validate_forward_target(forward_to, false)
            .map_err(|e| InkboxError::InvalidArgument(e.to_string()))?;

        // State dir: ~/.inkbox/tunnels/{name} (Python default). Holds the
        // passthrough key/cert + the learned zone/public_host.
        let home = std::env::var_os("HOME")
            .map(std::path::PathBuf::from)
            .ok_or_else(|| InkboxError::Tunnel("HOME not set; cannot resolve state dir".into()))?;
        let state_dir = home.join(".inkbox").join("tunnels").join(name);
        ensure_private_state_dir(&state_dir).map_err(|e| InkboxError::Tunnel(e.to_string()))?;
        let state = load_state(&state_dir);

        // Resolve the tunnel: prefer the state's tunnel_id (a `get`), else look
        // it up by name (the server lists only live tunnels). Mirrors `bootstrap`.
        let mut tunnel = match state.as_ref().map(|s| s.tunnel_id.clone()) {
            Some(id) if !id.is_empty() => match self.get(&id) {
                Ok(t) => t,
                Err(InkboxError::Api {
                    status_code: 404, ..
                }) => {
                    return Err(InkboxError::Tunnel(format!(
                        "TunnelRemoved: tunnel {name:?} (id={id}) has been removed; clear \
                         {} and call create_identity({name:?}) to start fresh",
                        state_dir.display()
                    )));
                }
                Err(e) => return Err(e),
            },
            _ => self
                .list()?
                .into_iter()
                .find(|t| t.tunnel_name == name)
                .ok_or_else(|| {
                    InkboxError::Tunnel(format!(
                        "TunnelNotProvisioned: no tunnel named {name:?} exists in this org; \
                         provision one via create_identity({name:?})"
                    ))
                })?,
        };

        let is_active = |t: &crate::tunnels::types::Tunnel| {
            matches!(&t.status, TunnelStatusValue::Known(TunnelStatus::Active))
        };

        // Edge tunnels must be ACTIVE before opening the data plane.
        // Passthrough has its own AWAITING_CERT branch below.
        if tunnel.tls_mode == TLSMode::Edge && !is_active(&tunnel) {
            return Err(InkboxError::Api {
                status_code: 409,
                detail: crate::error::ApiErrorDetail::Message(format!(
                    "tunnel {name:?} is not active; expected active before opening the data plane"
                )),
            });
        }

        // Cert dance for passthrough: load/create the P-256 key, sign a CSR if
        // the tunnel is awaiting a cert or the stored cert needs renewal, then
        // assemble the TLS material the runtime terminates with.
        let mut tls_material: Option<(Vec<u8>, Vec<u8>)> = None;
        if tunnel.tls_mode == TLSMode::Passthrough {
            let (_zone, public_host) = resolve_zone_and_host(
                name,
                Some(&tunnel.zone),
                Some(&tunnel.public_host),
                state.as_ref(),
                None,
            );
            let key = load_or_create_keypair(&state_dir)?;
            let awaiting = matches!(
                &tunnel.status,
                TunnelStatusValue::Known(TunnelStatus::AwaitingCert)
            );
            let chain_bytes = if awaiting || cert_needs_sign(&state_dir, &key) {
                let csr_pem = build_csr(&key, &public_host)?;
                let signed = self.sign_csr(&tunnel.id.to_string(), &csr_pem)?;
                let chain = write_cert_chain(&state_dir, &signed.cert_pem, &signed.chain_pem)?;
                // Refresh to pick up the new ACTIVE status.
                tunnel = self.get(&tunnel.id.to_string())?;
                chain
            } else {
                std::fs::read(state_dir.join(CERT_FILE))
                    .map_err(|e| InkboxError::Tunnel(format!("read cert chain: {e}")))?
            };
            if !is_active(&tunnel) {
                return Err(InkboxError::Api {
                    status_code: 409,
                    detail: crate::error::ApiErrorDetail::Message(format!(
                        "tunnel {name:?} is not active after CSR sign"
                    )),
                });
            }
            tls_material = Some((chain_bytes, key_pem_bytes(&key)?));
        }

        // Final zone/public_host (server > state > prod fallback) + persist.
        let (zone, public_host) = resolve_zone_and_host(
            name,
            Some(&tunnel.zone),
            Some(&tunnel.public_host),
            state.as_ref(),
            None,
        );
        let _ = save_state(
            &state_dir,
            &StateEntry {
                tunnel_id: tunnel.id.to_string(),
                name: name.to_string(),
                mode: Some(
                    match tunnel.tls_mode {
                        TLSMode::Edge => "edge",
                        TLSMode::Passthrough => "passthrough",
                    }
                    .to_string(),
                ),
                zone: Some(zone.clone()),
                public_host: Some(public_host.clone()),
            },
        );

        let bundle = TunnelBundle {
            tunnel,
            public_host,
            zone,
            tls_material,
        };

        let cfg = TunnelRuntimeConfig::from_bundle(
            &bundle,
            api_key,
            ForwardTo::Url(forward_to.to_string()),
        );
        let runtime = std::sync::Arc::new(TunnelRuntime::new(cfg));

        // The runtime is async; the resource surface is sync (mirrors the
        // Python `TunnelListener` running the runtime on its own loop). Build
        // a multi-thread tokio runtime and drive `serve_forever` to
        // completion.
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(|e| InkboxError::Tunnel(format!("could not start async runtime: {e}")))?;
        rt.block_on(runtime.serve_forever())
    }

    /// Bring a tunnel online from this process.
    ///
    /// The data-plane runtime is gated behind the `tunnels-runtime` feature;
    /// without it this returns an error.
    #[cfg(not(feature = "tunnels-runtime"))]
    pub fn connect(&self, _name: &str, _forward_to: &str) -> Result<()> {
        let _ = &self.inkbox; // silence unused without the runtime feature
        Err(InkboxError::Tunnel(
            "the tunnels data-plane runtime requires the `tunnels-runtime` cargo feature".into(),
        ))
    }
}
