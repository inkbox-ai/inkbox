//! The Inkbox tunnels **data-plane runtime** (`tunnels/client/` in Python).
//!
//! This is the local reverse-proxy agent: it holds a persistent HTTP/2
//! connection to the Inkbox edge, parks intake streams, and forwards inbound
//! third-party requests to a local upstream (HTTP/1.1, WebSocket passthrough,
//! and raw TCP passthrough).
//!
//! Gated behind the `tunnels-runtime` cargo feature (it pulls in
//! `tokio`/`rustls`/`h2`). The control-plane REST surface (list/get/update/
//! sign-csr) lives in [`crate::tunnels`] and is always available.
//!
//! ## Port status
//!
//! - **Fully faithful** (with `#[cfg(test)]` vectors mirroring the Python
//!   tests): [`protocol`], [`envelope`], [`wsframe`], [`bridge`], [`state`],
//!   [`url_forward`], [`cert`] (EC P-256 keys + PKCS#10 CSR), and the pure
//!   helpers in [`bootstrap`].
//! - **Implemented**: [`runtime`] HTTP data path (TLS h2 dial, hello, intake
//!   pool, forward, post-response, PING, reconnect) and the [`bridges`]
//!   WebSocket-upgrade + TCP-passthrough extended-CONNECT pumps.

pub mod bootstrap;
pub mod bridge;
pub mod bridges;
pub mod cert;
pub mod envelope;
pub mod protocol;
pub mod runtime;
pub mod state;
pub mod url_forward;
pub mod wsframe;

// Re-export the most useful surface.
pub use bootstrap::{resolve_zone_and_host, validate_pool_size, TunnelBundle};
pub use envelope::{filter_response_headers, parse_envelope, Envelope};
pub use runtime::{ForwardTo, StatusCallback, TunnelRuntime, TunnelRuntimeConfig};
pub use state::{load_state, save_state, StateEntry};
pub use url_forward::{
    build_forward_headers, forward_envelope_to_url, join_forward_path, validate_envelope_path,
    validate_forward_target, ForwardResult,
};
pub use wsframe::{decode_ws_frames, encode_ws_envelope, encode_ws_frame, OutboundWsMsg};
