//! Per-bridge runtime state for passthrough TCP streams.
//!
//! The actual pump loops live in the runtime (they need h2 / send_lock /
//! flow-control); the structs + close-code mapping live here.
//!
//! Ported from `inkbox/tunnels/client/_bridge.py`.

pub const BRIDGE_STATUS_TIMEOUT_SEC: f64 = 10.0;
pub const BRIDGE_HALF_CLOSE_GRACE_SEC: f64 = 5.0;
pub const BRIDGE_CLEANUP_SEND_TIMEOUT_SEC: f64 = 1.0;

/// Map a bridge close reason onto its WS close code. Mirrors the Python
/// `BRIDGE_CLOSE_CODE` dict.
///
/// # Arguments
/// * `reason` - One of `clean-eof`, `protocol-error`, `inbound-error`,
///   `outbound-error`, `tls-error`, `cancelled`.
///
/// # Returns
/// The WS close code, or `None` for an unrecognized reason.
pub fn bridge_close_code(reason: &str) -> Option<u16> {
    match reason {
        "clean-eof" => Some(1000),
        "protocol-error" => Some(1002),
        "inbound-error" => Some(1011),
        "outbound-error" => Some(1011),
        "tls-error" => Some(1011),
        "cancelled" => Some(1001),
        _ => None,
    }
}

/// Counters + flags tracked per passthrough TCP bridge.
#[derive(Debug, Clone, Default)]
pub struct BridgeStats {
    pub tcp_id: String,
    pub stream_id: i64,
    pub sni_host: String,
    pub inbound_frames: u64,
    pub outbound_frames: u64,
    pub decrypted_bytes: u64,
    pub encrypted_bytes: u64,
    pub continuation_frames: u64,
    pub tls_handshake_done: bool,
    pub close_reason: String,
}

impl BridgeStats {
    /// Create a fresh stats record for a bridge.
    pub fn new(tcp_id: String, stream_id: i64, sni_host: String) -> Self {
        Self {
            tcp_id,
            stream_id,
            sni_host,
            ..Default::default()
        }
    }
}

/// Raised by the inbound pump on a wire-format violation.
#[derive(Debug)]
pub struct BridgeProtocolError(pub String);

/// Raised when `CONNECT /_system/tcp/{tcp_id}` returns non-200.
#[derive(Debug)]
pub struct BridgeOpenFailed(pub String);

/// Raised when the inbound pump sees an h2 RST_STREAM event.
#[derive(Debug)]
pub struct BridgeStreamReset(pub String);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_code_mapping() {
        assert_eq!(bridge_close_code("clean-eof"), Some(1000));
        assert_eq!(bridge_close_code("protocol-error"), Some(1002));
        assert_eq!(bridge_close_code("inbound-error"), Some(1011));
        assert_eq!(bridge_close_code("outbound-error"), Some(1011));
        assert_eq!(bridge_close_code("tls-error"), Some(1011));
        assert_eq!(bridge_close_code("cancelled"), Some(1001));
        assert_eq!(bridge_close_code("nope"), None);
    }
}
