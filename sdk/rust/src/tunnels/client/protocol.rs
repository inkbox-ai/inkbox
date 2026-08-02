//! Single source of truth for the tunnel data-plane wire protocol.
//!
//! Ported from the TS SDK's `_protocol.ts` (which mirrors the server-side
//! definitions in `servers/src/data_models/tunnel.py`). The constants here
//! match `sdk/typescript/protocol/tunnel_protocol_constants.json`
//! byte-for-byte. When the protocol changes, update both in lockstep.

/// Namespace prefix on every inkbox-defined meta header.
pub const INKBOX_NAMESPACE_PREFIX: &str = "inkbox-";
/// Prefix marking a forwarded third-party request header.
pub const INKBOX_FORWARDED_HEADER_PREFIX: &str = "inkbox-h-";

// --- Meta headers exchanged on the intake / response streams -------------

pub const META_REQUEST_ID: &str = "inkbox-request-id";
pub const META_METHOD: &str = "inkbox-method";
pub const META_PATH: &str = "inkbox-path";
pub const META_ROUTE_KIND: &str = "inkbox-route-kind";
pub const META_STATUS: &str = "inkbox-status";
pub const META_WS_ID: &str = "inkbox-ws-id";
pub const META_TCP_ID: &str = "inkbox-tcp-id";
pub const META_SNI_HOST: &str = "inkbox-sni-host";
pub const META_BODY_URI: &str = "inkbox-body-uri";
pub const META_FORWARDED_FOR: &str = "inkbox-forwarded-for";
pub const META_REASON: &str = "inkbox-reason";

// --- Values for the `inkbox-route-kind` meta header ----------------------

pub const ROUTE_KIND_WEBHOOK: &str = "webhook";
pub const ROUTE_KIND_WS_UPGRADE: &str = "ws-upgrade";
pub const ROUTE_KIND_TCP_STREAM: &str = "tcp-stream";

// --- ALPN-style subprotocols on extended-CONNECT bridge streams ----------

pub const SUBPROTOCOL_WS: &str = "inkbox-tunnel-ws";
pub const SUBPROTOCOL_TCP: &str = "inkbox-tunnel-tcp";

// --- Control-plane HTTP/2 paths exposed by the tunnel server -------------

pub const PATH_HELLO: &str = "/_system/hello";
pub const PATH_INTAKE: &str = "/_system/intake";
pub const PATH_RESPONSE_PREFIX: &str = "/_system/response/";
pub const PATH_WS_PREFIX: &str = "/_system/ws/";
pub const PATH_TCP_PREFIX: &str = "/_system/tcp/";

// --- SDK-side request headers on every control-plane stream --------------

pub const HEADER_TUNNEL_ID: &str = "x-tunnel-id";
pub const HEADER_API_KEY: &str = "x-api-key";
pub const HEADER_OWNER_TOKEN: &str = "x-owner-token";
pub const HEADER_POOL_SLOT: &str = "x-pool-slot";
pub const HEADER_POOL_SIZE: &str = "x-pool-size";

/// Hop-by-hop request headers stripped before forwarding upstream.
pub const HOP_BY_HOP_REQUEST: &[&str] = &[
    "host",
    "connection",
    "upgrade",
    "keep-alive",
    "te",
    "trailer",
    "transfer-encoding",
    "proxy-authenticate",
    "proxy-authorization",
    "sec-websocket-key",
    "sec-websocket-version",
    "sec-websocket-extensions",
];

/// Hop-by-hop response headers stripped before forwarding back.
pub const HOP_BY_HOP_RESPONSE: &[&str] = &[
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
];

/// True iff `name` (already lowercased) is a hop-by-hop response header.
pub fn is_hop_by_hop_response(name_lower: &str) -> bool {
    HOP_BY_HOP_RESPONSE.contains(&name_lower)
}

/// True iff `name` (already lowercased) is a hop-by-hop request header.
pub fn is_hop_by_hop_request(name_lower: &str) -> bool {
    HOP_BY_HOP_REQUEST.contains(&name_lower)
}
