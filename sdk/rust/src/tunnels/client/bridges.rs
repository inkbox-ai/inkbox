//! WebSocket-upgrade and TCP-passthrough bridges over h2 extended CONNECT.
//!
//! Ported from `inkbox/tunnels/client/_ws_upstream.py`, `_ws_passthrough.py`,
//! `_url_forward.py` (WS path), `_tls.py` / `_upstream_tls.py` (passthrough TLS
//! termination), and the `_dispatch_ws_upgrade_to_url` / `_pump_ws_url_bridge`
//! / `_dispatch_tcp_stream` paths in `_runtime.py`.
//!
//! ## Extended CONNECT
//!
//! The Python runtime drives a sans-IO `h2` connection and manually opens an
//! Extended-CONNECT stream (`:method CONNECT`, `:protocol inkbox-tunnel-ws`).
//! Here we use the async `h2` crate's client API: a [`Method::CONNECT`] request
//! with an [`h2::ext::Protocol`] inserted into the request extensions causes
//! the client to emit the `:protocol` pseudo-header (the crate's
//! `streams.rs::send_request` calls `request.extensions_mut().remove::<Protocol>()`
//! and forwards it to `Pseudo::request`, which — because the protocol is
//! present — keeps `:scheme`/`:path`/`:authority` derived from the request URI).
//! The server's `ENABLE_CONNECT_PROTOCOL` setting (set up by the runtime
//! connection) lets the peer accept it. `send_request` returns
//! `(ResponseFuture, SendStream<Bytes>)`; the response body is the inbound
//! `RecvStream`. Flow control is the async-h2 idiom: read chunks off the
//! `RecvStream` and `release_capacity` as we drain them, write outbound via
//! `SendStream` (reserving capacity), rather than Python's manual
//! `acknowledge_received_data` crediting.

use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use bytes::Bytes;
use h2::client::SendRequest;
use http::{Method, Request};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::error::{InkboxError, Result};

use super::bridge::{
    bridge_close_code, BridgeStats, BRIDGE_CLEANUP_SEND_TIMEOUT_SEC, BRIDGE_HALF_CLOSE_GRACE_SEC,
    BRIDGE_STATUS_TIMEOUT_SEC,
};
use super::envelope::Envelope;
use super::protocol::{
    is_hop_by_hop_request, is_hop_by_hop_response, PATH_RESPONSE_PREFIX, PATH_TCP_PREFIX,
    PATH_WS_PREFIX, SUBPROTOCOL_TCP, SUBPROTOCOL_WS,
};
use super::url_forward::{join_forward_path, url_split, validate_envelope_path};
use super::wsframe::{
    decode_ws_frames, encode_ws_envelope, encode_ws_frame, OutboundWsMsg, WS_OPCODE_BINARY,
    WS_OPCODE_CLOSE, WS_OPCODE_CONTINUATION, WS_OPCODE_PING, WS_OPCODE_PONG, WS_OPCODE_TEXT,
};

/// WS GUID for `Sec-WebSocket-Accept`, RFC 6455 §1.3.
const WS_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/// Single composite handshake budget for the upstream WS hop, matching
/// `_ws_upstream.UPSTREAM_HANDSHAKE_TIMEOUT_S`.
const UPSTREAM_HANDSHAKE_TIMEOUT_S: f64 = 30.0;

fn tunnel(msg: impl Into<String>) -> InkboxError {
    InkboxError::Tunnel(msg.into())
}

/// Everything a bridge needs from the runtime for one dispatch, captured by
/// value so the bridge task is independent of the runtime borrow.
pub struct BridgeCtx {
    pub zone: String,
    pub tunnel_id: String,
    pub api_key: String,
    pub public_host: String,
    pub forward_to: String,
    pub verify_tls: bool,
    pub ca_bundle: Option<Vec<u8>>,
    pub response_deadline_seconds: Option<f64>,
    pub tls_material: Option<(Vec<u8>, Vec<u8>)>,
    pub send: SendRequest<Bytes>,
}

impl BridgeCtx {
    /// The deadline used to bound bridge-open + upstream handshake, mirroring
    /// the Python `response_deadline_seconds or 30.0` fallback.
    fn handshake_deadline_s(&self) -> f64 {
        match self.response_deadline_seconds {
            Some(d) if d > 0.0 => d,
            _ => UPSTREAM_HANDSHAKE_TIMEOUT_S,
        }
    }
}

// === WebSocket-upgrade bridge ============================================

/// Bridge a third-party WebSocket upgrade to the local `ws://`/`wss://`
/// upstream.
///
/// Validates the path, opens an h1 `Upgrade: websocket` handshake to the
/// upstream (`open_ws_upstream`), posts the third-party-facing upgrade reply
/// (forwarding the upstream 101 headers, stripped of hop-by-hop +
/// ws-handshake-control headers), opens the extended-CONNECT bridge stream,
/// awaits `:status 200`, then runs the bidirectional pump. Mirrors
/// `_dispatch_ws_upgrade` / `_dispatch_ws_upgrade_to_url`.
pub async fn dispatch_ws_upgrade(ctx: BridgeCtx, envelope: Envelope) -> Result<()> {
    let Some(ws_id) = envelope.ws_id.clone() else {
        post_reply(&ctx, &envelope.request_id, 400, Some("missing ws_id"), b"missing ws_id").await?;
        return Ok(());
    };
    // Path-traversal guard. Edge WS upgrades skip the HTTP validate, so we
    // re-apply it here (matches `_dispatch_ws_upgrade`).
    if let Some(reason) = validate_envelope_path(&envelope.path) {
        post_reply(&ctx, &envelope.request_id, 400, Some(&reason), b"invalid path").await?;
        return Ok(());
    }

    // Open the local upstream WS hop. On failure, surface the upstream's
    // status/reason back to the third party as a reject reply.
    let up = match open_ws_upstream(&ctx, &envelope).await {
        Ok(up) => up,
        Err(WsUpstreamError { status, reason }) => {
            post_reply(&ctx, &envelope.request_id, status, Some(&reason), reason.as_bytes()).await?;
            return Ok(());
        }
    };

    // Reconstruct the third-party-facing 101 headers: forward the upstream's
    // response headers minus hop-by-hop, ws handshake-control headers, and
    // pseudo-headers. Matches `_dispatch_ws_upgrade_to_url`.
    let upgrade_reply_headers = filter_upgrade_reply_headers(&up.headers);

    // Post the 200 upgrade reply (the server turns this into the third
    // party's 101). This reply must complete before we open the bridge.
    if let Err(e) =
        post_reply_with_headers(&ctx, &envelope.request_id, 200, &upgrade_reply_headers, b"").await
    {
        // Origin closed mid-handshake: close the SDK-owned upstream socket so
        // it isn't leaked, then propagate.
        let _ = up.shutdown().await;
        return Err(e);
    }

    // Open the extended-CONNECT bridge stream to `/_system/ws/{ws_id}`.
    let (resp_fut, send_stream) =
        match open_connect_bridge(&ctx, &ws_id, PATH_WS_PREFIX, SUBPROTOCOL_WS, "inkbox-ws-id") {
            Ok(pair) => pair,
            Err(e) => {
                let _ = up.shutdown().await;
                return Err(e);
            }
        };

    // Await `:status 200` on the bridge, bounded by the response deadline.
    let recv = match await_connect_200(resp_fut, ctx.handshake_deadline_s()).await {
        Ok(recv) => recv,
        Err(_) => {
            // Bridge open failed — RST the stream so it doesn't sit half-open
            // server-side, and close the upstream socket.
            let mut send_stream = send_stream;
            send_stream.send_reset(h2::Reason::CANCEL);
            let _ = up.shutdown().await;
            return Ok(());
        }
    };

    // Run the bidirectional pump. The reader/writer halves of the upstream
    // socket are owned by the pump.
    let _ = pump_ws_url_bridge(send_stream, recv, up).await;
    Ok(())
}

/// Result of a successful upstream WS handshake (Python `WsUpstream`).
struct WsUpstream {
    stream: UpstreamStream,
    /// Bytes the upstream sent past the 101 head (possibly an eager frame).
    leftover: Vec<u8>,
    /// All 101 response headers, lowercased keys, in arrival order.
    headers: Vec<(String, String)>,
}

impl WsUpstream {
    async fn shutdown(self) -> std::io::Result<()> {
        self.stream.shutdown().await
    }
}

/// A connected upstream socket — plaintext TCP or TLS-wrapped — that the pump
/// reads from and writes to. Boxed so both arms share one type.
enum UpstreamStream {
    Plain(tokio::net::TcpStream),
    Tls(Box<tokio_rustls::client::TlsStream<tokio::net::TcpStream>>),
}

impl UpstreamStream {
    async fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            UpstreamStream::Plain(s) => s.read(buf).await,
            UpstreamStream::Tls(s) => s.read(buf).await,
        }
    }
    async fn write_all(&mut self, buf: &[u8]) -> std::io::Result<()> {
        match self {
            UpstreamStream::Plain(s) => s.write_all(buf).await,
            UpstreamStream::Tls(s) => s.write_all(buf).await,
        }
    }
    async fn shutdown(mut self) -> std::io::Result<()> {
        match &mut self {
            UpstreamStream::Plain(s) => s.shutdown().await,
            UpstreamStream::Tls(s) => s.shutdown().await,
        }
    }
}

/// HTTP-style failure of the upstream WS hop (Python `WsUpstreamError`).
struct WsUpstreamError {
    status: u16,
    reason: String,
}

/// Open a TCP/TLS connection to `forward_to` and complete an h1
/// `Upgrade: websocket` handshake. Returns the connected stream + the
/// negotiated 101 headers on success. Mirrors `open_ws_upstream`.
async fn open_ws_upstream(
    ctx: &BridgeCtx,
    envelope: &Envelope,
) -> std::result::Result<WsUpstream, WsUpstreamError> {
    let target_url = join_forward_path(&ctx.forward_to, &envelope.path);
    let parsed = url_split(&target_url);
    let host = if parsed.host.is_empty() { "localhost".to_string() } else { parsed.host.clone() };
    let port = upstream_port(&parsed.netloc, &parsed.scheme);
    let mut path_only = if parsed.path.is_empty() { "/".to_string() } else { parsed.path.clone() };
    if !parsed.query.is_empty() {
        path_only = format!("{path_only}?{}", parsed.query);
    }
    let is_tls = parsed.scheme == "https";

    let ws_subprotocol = first_header(&envelope.forwarded_headers, "sec-websocket-protocol");
    let deadline = tokio::time::Instant::now() + Duration::from_secs_f64(ctx.handshake_deadline_s());

    // --- connect (single composite budget, like the Python helper) -------
    let connect = tokio::net::TcpStream::connect((host.as_str(), port));
    let tcp = match tokio::time::timeout_at(deadline, connect).await {
        Err(_) => return Err(WsUpstreamError { status: 504, reason: "upstream-connect-timeout".into() }),
        Ok(Err(e)) => return Err(WsUpstreamError { status: 502, reason: format!("upstream-unreachable: {e}") }),
        Ok(Ok(s)) => s,
    };
    let _ = tcp.set_nodelay(true);

    // Optionally TLS-wrap for wss:// upstreams.
    let mut stream = if is_tls {
        let connector = build_upstream_tls_connector(ctx.verify_tls, ctx.ca_bundle.as_deref())
            .map_err(|e| WsUpstreamError { status: 502, reason: format!("upstream-tls-setup: {e}") })?;
        let server_name = rustls::pki_types::ServerName::try_from(host.clone())
            .map_err(|_| WsUpstreamError { status: 502, reason: "upstream-tls-bad-host".into() })?;
        let connect = connector.connect(server_name, tcp);
        match tokio::time::timeout_at(deadline, connect).await {
            Err(_) => return Err(WsUpstreamError { status: 504, reason: "upstream-connect-timeout".into() }),
            Ok(Err(e)) => return Err(WsUpstreamError { status: 502, reason: format!("upstream-tls: {e}") }),
            Ok(Ok(s)) => UpstreamStream::Tls(Box::new(s)),
        }
    } else {
        UpstreamStream::Plain(tcp)
    };

    // --- write the h1 Upgrade request ------------------------------------
    let ws_key = b64_random_key();
    let upgrade_bytes = build_upstream_handshake(
        &path_only,
        &parsed.netloc,
        &ws_key,
        ws_subprotocol.as_deref(),
        &ctx.public_host,
        envelope.forwarded_for_ip.as_deref(),
        &envelope.forwarded_headers,
    );
    match tokio::time::timeout_at(deadline, stream.write_all(&upgrade_bytes)).await {
        Err(_) => return Err(WsUpstreamError { status: 504, reason: "upstream-write-timeout".into() }),
        Ok(Err(e)) => return Err(WsUpstreamError { status: 502, reason: format!("upstream-write: {e}") }),
        Ok(Ok(())) => {}
    }

    // --- read the response head ------------------------------------------
    let mut head_buf: Vec<u8> = Vec::new();
    loop {
        if find_head_end(&head_buf).is_some() {
            break;
        }
        let mut chunk = [0u8; 4096];
        let n = match tokio::time::timeout_at(deadline, stream.read(&mut chunk)).await {
            Err(_) => return Err(WsUpstreamError { status: 504, reason: "upstream-handshake-timeout".into() }),
            Ok(Err(e)) => return Err(WsUpstreamError { status: 502, reason: format!("upstream-read: {e}") }),
            Ok(Ok(0)) => return Err(WsUpstreamError { status: 502, reason: "upstream closed before response".into() }),
            Ok(Ok(n)) => n,
        };
        head_buf.extend_from_slice(&chunk[..n]);
        if head_buf.len() > 65536 {
            return Err(WsUpstreamError { status: 502, reason: "upstream response head too large".into() });
        }
    }

    let head_end = find_head_end(&head_buf).expect("head end present");
    let head_text = String::from_utf8_lossy(&head_buf[..head_end - 4]).into_owned();
    let leftover = head_buf[head_end..].to_vec();
    let lines: Vec<&str> = head_text.split("\r\n").collect();
    if lines.is_empty() {
        return Err(WsUpstreamError { status: 502, reason: "empty response".into() });
    }
    // Status line: "HTTP/1.1 101 ...".
    let status: u16 = lines[0]
        .split(' ')
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(502);
    if status != 101 {
        return Err(WsUpstreamError { status, reason: format!("upstream returned {status}") });
    }

    let mut response_headers: Vec<(String, String)> = Vec::new();
    let mut upstream_accept: Option<String> = None;
    let mut upstream_extensions: Option<String> = None;
    let mut upstream_subprotocol: Option<String> = None;
    for line in &lines[1..] {
        let Some((k, v)) = line.split_once(':') else { continue };
        let kl = k.trim().to_ascii_lowercase();
        let vs = v.trim().to_string();
        match kl.as_str() {
            "sec-websocket-accept" => upstream_accept = Some(vs.clone()),
            "sec-websocket-extensions" => upstream_extensions = Some(vs.clone()),
            "sec-websocket-protocol" => upstream_subprotocol = Some(vs.clone()),
            _ => {}
        }
        response_headers.push((kl, vs));
    }

    // Validate Sec-WebSocket-Accept (RFC 6455 §1.3).
    if upstream_accept.as_deref() != Some(&compute_ws_accept(&ws_key)) {
        return Err(WsUpstreamError { status: 502, reason: "upstream Sec-WebSocket-Accept mismatch".into() });
    }
    // We never offer extensions; refuse a confirmed one (no codec wired).
    if upstream_extensions.as_deref().is_some_and(|s| !s.is_empty()) {
        return Err(WsUpstreamError {
            status: 502,
            reason: format!("upstream negotiated unsupported extensions: {}", upstream_extensions.unwrap()),
        });
    }
    // Selected subprotocol must be one we offered (RFC 6455 §4.1).
    if let Some(sub) = upstream_subprotocol.as_deref().filter(|s| !s.is_empty()) {
        let offered = parse_subprotocol_offer(ws_subprotocol.as_deref());
        if !offered.iter().any(|o| o == sub) {
            return Err(WsUpstreamError { status: 502, reason: format!("upstream-subprotocol-not-offered: {sub}") });
        }
    }

    Ok(WsUpstream { stream, leftover, headers: response_headers })
}

/// Build the h1 `Upgrade: websocket` request bytes for the upstream hop.
/// Mirrors the `upgrade_lines` construction in `open_ws_upstream`.
fn build_upstream_handshake(
    path_only: &str,
    host_header: &str,
    ws_key: &str,
    ws_subprotocol: Option<&str>,
    public_host: &str,
    forwarded_for_ip: Option<&str>,
    request_headers: &[(String, String)],
) -> Vec<u8> {
    let mut lines: Vec<String> = vec![
        format!("GET {path_only} HTTP/1.1"),
        format!("Host: {host_header}"),
        "Connection: Upgrade".to_string(),
        "Upgrade: websocket".to_string(),
        "Sec-WebSocket-Version: 13".to_string(),
        format!("Sec-WebSocket-Key: {ws_key}"),
    ];
    if let Some(sub) = ws_subprotocol {
        lines.push(format!("Sec-WebSocket-Protocol: {sub}"));
    }
    lines.push(format!("X-Forwarded-Host: {public_host}"));
    lines.push("X-Forwarded-Proto: https".to_string());
    if let Some(ip) = forwarded_for_ip {
        lines.push(format!("X-Forwarded-For: {ip}"));
    }
    // Headers we set ourselves (or that are per-hop) are skipped.
    const SEEN_SKIP: &[&str] = &[
        "host",
        "x-forwarded-host",
        "x-forwarded-proto",
        "x-forwarded-for",
        "forwarded",
        "sec-websocket-key",
        "sec-websocket-version",
        "sec-websocket-protocol",
        "sec-websocket-extensions",
        "upgrade",
        "connection",
    ];
    for (k, v) in request_headers {
        let kl = k.to_ascii_lowercase();
        if is_hop_by_hop_request(&kl) || kl.starts_with(':') {
            continue;
        }
        if SEEN_SKIP.contains(&kl.as_str()) {
            continue;
        }
        lines.push(format!("{k}: {v}"));
    }
    let mut out = lines.join("\r\n");
    out.push_str("\r\n\r\n");
    out.into_bytes()
}

/// Filter the upstream 101 headers down to the third-party-facing upgrade
/// reply set: drop hop-by-hop, ws handshake-control headers, and pseudo
/// headers. Mirrors `_dispatch_ws_upgrade_to_url`'s `ws_handshake_strip`.
fn filter_upgrade_reply_headers(up_headers: &[(String, String)]) -> Vec<(String, String)> {
    const WS_HANDSHAKE_STRIP: &[&str] = &[
        "sec-websocket-accept",
        "sec-websocket-extensions",
        "sec-websocket-key",
        "sec-websocket-version",
    ];
    up_headers
        .iter()
        .filter(|(hk, _)| {
            !hk.starts_with(':')
                && !is_hop_by_hop_response(hk)
                && !WS_HANDSHAKE_STRIP.contains(&hk.as_str())
        })
        .cloned()
        .collect()
}

/// The bidirectional WS pump (Python `_pump_ws_url_bridge`).
///
/// Bridge → upstream: outer WS BINARY frames carry length-prefixed JSON
/// envelopes (`text`/`binary`/`close`) → encode RFC 6455 frame (masked,
/// client) → write to upstream socket.
///
/// Upstream → bridge: read RFC 6455 frames (server, unmasked), reassemble
/// fragments, answer PING locally, map CLOSE → an end-stream close envelope,
/// wrap `websocket.send` envelopes in outer masked BINARY frames.
async fn pump_ws_url_bridge(
    send_stream: h2::SendStream<Bytes>,
    recv: h2::RecvStream,
    up: WsUpstream,
) -> Result<()> {
    let WsUpstream { stream, leftover, .. } = up;
    let (mut up_read, up_write) = split_upstream(stream);

    // Shared outbound WS SendStream guarded by a mutex (both directions may
    // write: bridge→upstream writes PONGs back on the bridge, upstream→bridge
    // sends envelopes). h2's SendStream is !Sync-safe only single-threaded, so
    // a tokio Mutex serializes sends.
    let send = Arc::new(tokio::sync::Mutex::new(send_stream));
    let up_write = Arc::new(tokio::sync::Mutex::new(up_write));

    // upstream → bridge: reassemble RFC 6455 fragments → JSON envelopes.
    let send_u2b = send.clone();
    let up_write_u2b = up_write.clone();
    let upstream_to_bridge = async move {
        let mut buf: Vec<u8> = leftover;
        let mut message_opcode: Option<u8> = None;
        let mut message_chunks: Vec<u8> = Vec::new();
        loop {
            let frames = decode_ws_frames(&mut buf);
            if frames.is_empty() {
                let mut chunk = [0u8; 4096];
                let n = match up_read.read(&mut chunk).await {
                    Ok(0) | Err(_) => return,
                    Ok(n) => n,
                };
                buf.extend_from_slice(&chunk[..n]);
                continue;
            }
            for (opcode, payload, fin) in frames {
                match opcode {
                    WS_OPCODE_PING => {
                        // Answer directly to upstream; don't propagate.
                        let frame = encode_ws_frame(WS_OPCODE_PONG, &payload, true, true);
                        if up_write_u2b.lock().await.write_all(&frame).await.is_err() {
                            return;
                        }
                        continue;
                    }
                    WS_OPCODE_PONG => continue,
                    WS_OPCODE_CLOSE => {
                        let code = close_code(&payload);
                        let env = encode_ws_envelope(&OutboundWsMsg::Close { code, reason: String::new() });
                        let frame = encode_ws_frame(WS_OPCODE_BINARY, &env, true, true);
                        let mut s = send_u2b.lock().await;
                        let _ = s.send_data(Bytes::from(frame), true);
                        return;
                    }
                    WS_OPCODE_TEXT | WS_OPCODE_BINARY => {
                        if message_opcode.is_some() {
                            return; // RFC 6455 §5.4 violation.
                        }
                        message_opcode = Some(opcode);
                        message_chunks = payload;
                    }
                    WS_OPCODE_CONTINUATION => {
                        if message_opcode.is_none() {
                            return;
                        }
                        message_chunks.extend_from_slice(&payload);
                    }
                    _ => continue, // unknown opcode — ignore.
                }
                if fin {
                    if let Some(started) = message_opcode.take() {
                        let full = std::mem::take(&mut message_chunks);
                        let env = if started == WS_OPCODE_TEXT {
                            match String::from_utf8(full) {
                                Ok(text) => encode_ws_envelope(&OutboundWsMsg::SendText(text)),
                                Err(_) => return,
                            }
                        } else {
                            encode_ws_envelope(&OutboundWsMsg::SendBytes(full))
                        };
                        let frame = encode_ws_frame(WS_OPCODE_BINARY, &env, true, true);
                        if send_u2b.lock().await.send_data(Bytes::from(frame), false).is_err() {
                            return;
                        }
                    }
                }
            }
        }
    };

    // bridge → upstream: outer WS frames → inner JSON envelopes → RFC 6455.
    let send_b2u = send.clone();
    let up_write_b2u = up_write.clone();
    let bridge_to_upstream = async move {
        let mut recv = recv;
        let mut wire_buf: Vec<u8> = Vec::new();
        let mut env_buf: Vec<u8> = Vec::new();
        let mut recv_done = false;
        while !recv_done {
            let chunk = match recv.data().await {
                Some(Ok(c)) => c,
                Some(Err(_)) | None => break,
            };
            // Release the inbound window as we consume (async-h2 idiom; the
            // sans-IO Python does the equivalent via acknowledge_received_data).
            let _ = recv.flow_control().release_capacity(chunk.len());
            wire_buf.extend_from_slice(&chunk);
            for (opcode, payload, _fin) in decode_ws_frames(&mut wire_buf) {
                match opcode {
                    WS_OPCODE_PING => {
                        let frame = encode_ws_frame(WS_OPCODE_PONG, &payload, true, true);
                        let _ = send_b2u.lock().await.send_data(Bytes::from(frame), false);
                    }
                    WS_OPCODE_PONG => {}
                    WS_OPCODE_CLOSE => {
                        recv_done = true;
                        break;
                    }
                    WS_OPCODE_BINARY | WS_OPCODE_TEXT => env_buf.extend_from_slice(&payload),
                    _ => {}
                }
            }
            // Drain complete length-prefixed JSON envelopes.
            while !recv_done {
                if env_buf.len() < 4 {
                    break;
                }
                let length = u32::from_be_bytes([env_buf[0], env_buf[1], env_buf[2], env_buf[3]]) as usize;
                if env_buf.len() < 4 + length {
                    break;
                }
                let env_bytes = env_buf[4..4 + length].to_vec();
                env_buf.drain(..4 + length);
                let Ok(msg) = serde_json::from_slice::<serde_json::Value>(&env_bytes) else {
                    continue;
                };
                match msg.get("type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        let text = msg.get("data").and_then(|d| d.as_str()).unwrap_or("");
                        let frame = encode_ws_frame(WS_OPCODE_TEXT, text.as_bytes(), true, true);
                        if up_write_b2u.lock().await.write_all(&frame).await.is_err() {
                            recv_done = true;
                            break;
                        }
                    }
                    Some("binary") => {
                        let data_b64 = msg.get("data").and_then(|d| d.as_str()).unwrap_or("");
                        let Ok(payload) = base64::engine::general_purpose::STANDARD.decode(data_b64) else {
                            continue;
                        };
                        let frame = encode_ws_frame(WS_OPCODE_BINARY, &payload, true, true);
                        if up_write_b2u.lock().await.write_all(&frame).await.is_err() {
                            recv_done = true;
                            break;
                        }
                    }
                    Some("close") => {
                        let code = msg.get("code").and_then(|c| c.as_i64()).unwrap_or(1000) as u16;
                        let frame = encode_ws_frame(WS_OPCODE_CLOSE, &code.to_be_bytes(), true, true);
                        let _ = up_write_b2u.lock().await.write_all(&frame).await;
                        recv_done = true;
                        break;
                    }
                    _ => {}
                }
            }
        }
    };

    // Run both directions; finish when either completes.
    tokio::select! {
        _ = upstream_to_bridge => {}
        _ = bridge_to_upstream => {}
    }

    // Best-effort graceful END_STREAM on the bridge + close the upstream
    // socket (Python's `finally` does both).
    {
        let mut s = send.lock().await;
        let _ = s.send_data(Bytes::new(), true);
    }
    if let Ok(w) = Arc::try_unwrap(up_write) {
        let _ = w.into_inner().shutdown().await;
    }
    Ok(())
}

// === TCP-passthrough bridge ==============================================

/// Bridge a third-party raw-TCP passthrough stream to the local upstream.
///
/// Opens the extended-CONNECT bridge (`inkbox-tunnel-tcp`), TLS-terminates the
/// third party's bytes with the tunnel's server cert/key (the SDK is the TLS
/// server, mirroring `TLSTerminator`), connects to the local upstream TCP, and
/// byte-pumps both directions. Mirrors `_dispatch_tcp_stream`.
pub async fn dispatch_tcp_stream(ctx: BridgeCtx, envelope: Envelope) -> Result<()> {
    // Passthrough requires TLS material (the server should not route a
    // tcp-stream to an edge-mode tunnel).
    let Some((cert_pem, key_pem)) = ctx.tls_material.clone() else {
        return Ok(());
    };
    let Some(tcp_id) = envelope.tcp_id.clone() else {
        return Ok(());
    };
    let sni_host = envelope.sni_host.clone().unwrap_or_default();

    // Open the extended-CONNECT bridge stream to `/_system/tcp/{tcp_id}`.
    let (resp_fut, send_stream) =
        open_connect_bridge(&ctx, &tcp_id, PATH_TCP_PREFIX, SUBPROTOCOL_TCP, "inkbox-tcp-id")?;

    // Await `:status 200`, bounded by BRIDGE_STATUS_TIMEOUT_SEC.
    let recv = match await_connect_200(resp_fut, BRIDGE_STATUS_TIMEOUT_SEC).await {
        Ok(recv) => recv,
        Err(_) => {
            let mut send_stream = send_stream;
            send_stream.send_reset(h2::Reason::CANCEL);
            return Ok(());
        }
    };

    // Build the in-memory TLS terminator (SDK is the server).
    let server_config = build_terminator_config(&cert_pem, &key_pem)
        .map_err(|e| tunnel(format!("tls terminator: {e}")))?;
    let tls = rustls::ServerConnection::new(Arc::new(server_config))
        .map_err(|e| tunnel(format!("tls server conn: {e}")))?;

    let mut stats = BridgeStats::new(tcp_id, 0, sni_host.clone());
    let close_reason = run_tcp_bridge(&ctx, send_stream, recv, tls, &mut stats).await;
    stats.close_reason = close_reason;
    Ok(())
}

/// Pump the passthrough TCP bridge: decrypt inbound WS-BINARY-wrapped TLS
/// records to plaintext, forward to the upstream TCP, encrypt upstream
/// plaintext back into WS BINARY frames. Returns the close reason.
async fn run_tcp_bridge(
    ctx: &BridgeCtx,
    send_stream: h2::SendStream<Bytes>,
    mut recv: h2::RecvStream,
    mut tls: rustls::ServerConnection,
    stats: &mut BridgeStats,
) -> String {
    let send = Arc::new(tokio::sync::Mutex::new(send_stream));

    // Connect to the local upstream TCP (host:port from forward_to).
    let parsed = url_split(&ctx.forward_to);
    let host = if parsed.host.is_empty() { "localhost".to_string() } else { parsed.host.clone() };
    let port = upstream_port(&parsed.netloc, &parsed.scheme);
    let upstream = match tokio::net::TcpStream::connect((host.as_str(), port)).await {
        Ok(s) => s,
        Err(_) => {
            let _ = finish_tcp_bridge(&send, &mut tls, "outbound-error").await;
            return "outbound-error".to_string();
        }
    };
    let _ = upstream.set_nodelay(true);
    let (mut up_read, mut up_write) = upstream.into_split();

    let mut wire_buf: Vec<u8> = Vec::new();
    let mut pending_frags: Option<Vec<u8>> = None;
    let mut close_reason = "clean-eof".to_string();
    let mut up_read_buf = [0u8; 16384];

    loop {
        tokio::select! {
            // Inbound: WS frames from the bridge carrying TLS records.
            inbound = recv.data() => {
                let chunk = match inbound {
                    Some(Ok(c)) => c,
                    Some(Err(_)) => { close_reason = "inbound-error".to_string(); break; }
                    None => break, // clean EOF
                };
                let _ = recv.flow_control().release_capacity(chunk.len());
                wire_buf.extend_from_slice(&chunk);
                let mut fatal = false;
                for (opcode, payload, fin) in decode_ws_frames(&mut wire_buf) {
                    match opcode {
                        WS_OPCODE_PING => {
                            let frame = encode_ws_frame(WS_OPCODE_PONG, &payload, true, true);
                            let _ = send.lock().await.send_data(Bytes::from(frame), false);
                            continue;
                        }
                        WS_OPCODE_CLOSE => { fatal = true; break; }
                        WS_OPCODE_PONG => continue,
                        WS_OPCODE_TEXT => { close_reason = "protocol-error".to_string(); fatal = true; break; }
                        WS_OPCODE_CONTINUATION => {
                            match pending_frags.as_mut() {
                                Some(b) => { b.extend_from_slice(&payload); stats.continuation_frames += 1; }
                                None => { close_reason = "protocol-error".to_string(); fatal = true; break; }
                            }
                        }
                        WS_OPCODE_BINARY => {
                            if pending_frags.is_some() {
                                close_reason = "protocol-error".to_string();
                                fatal = true;
                                break;
                            }
                            pending_frags = Some(payload);
                        }
                        _ => { close_reason = "protocol-error".to_string(); fatal = true; break; }
                    }
                    if !fin {
                        continue;
                    }
                    // A complete message: feed the TLS engine.
                    let record = pending_frags.take().unwrap_or_default();
                    match feed_tls(&mut tls, &record) {
                        Ok((plaintext, handshake_out)) => {
                            if !handshake_out.is_empty() {
                                let frame = encode_ws_frame(WS_OPCODE_BINARY, &handshake_out, true, true);
                                let _ = send.lock().await.send_data(Bytes::from(frame), false);
                                stats.outbound_frames += 1;
                                stats.encrypted_bytes += handshake_out.len() as u64;
                            }
                            if !plaintext.is_empty() && up_write.write_all(&plaintext).await.is_err() {
                                close_reason = "outbound-error".to_string();
                                fatal = true;
                                break;
                            }
                            stats.inbound_frames += 1;
                            stats.decrypted_bytes += plaintext.len() as u64;
                            if !stats.tls_handshake_done && !tls.is_handshaking() {
                                stats.tls_handshake_done = true;
                            }
                        }
                        Err(_) => { close_reason = "tls-error".to_string(); fatal = true; break; }
                    }
                }
                if fatal {
                    break;
                }
            }
            // Outbound: plaintext from the upstream → encrypt → WS BINARY.
            up = up_read.read(&mut up_read_buf) => {
                match up {
                    Ok(0) => break, // upstream half-close → clean EOF
                    Ok(n) => {
                        match encrypt_tls(&mut tls, &up_read_buf[..n]) {
                            Ok(encrypted) if !encrypted.is_empty() => {
                                let frame = encode_ws_frame(WS_OPCODE_BINARY, &encrypted, true, true);
                                if send.lock().await.send_data(Bytes::from(frame), false).is_err() {
                                    close_reason = "outbound-error".to_string();
                                    break;
                                }
                                stats.outbound_frames += 1;
                                stats.encrypted_bytes += encrypted.len() as u64;
                            }
                            Ok(_) => {}
                            Err(_) => { close_reason = "tls-error".to_string(); break; }
                        }
                    }
                    Err(_) => { close_reason = "outbound-error".to_string(); break; }
                }
            }
        }
    }

    // Half-close grace: let the upstream flush whatever it had queued.
    let _ = tokio::time::timeout(Duration::from_secs_f64(BRIDGE_HALF_CLOSE_GRACE_SEC), async {
        let _ = up_write.shutdown().await;
    })
    .await;

    finish_tcp_bridge(&send, &mut tls, &close_reason).await;

    // Drain the inbound half until the edge ends the stream. Dropping `recv`
    // while the edge still considers the stream open makes h2 emit RST_STREAM,
    // which the edge propagates as a TCP reset to the third party — truncating
    // its TLS session before our close_notify lands (curl reports error 56 on
    // connection-close-delimited bodies). Mirrors Python's
    // `_drain_and_ack_pending`: read to EOF (bounded) so the close is graceful.
    let _ = tokio::time::timeout(
        Duration::from_secs_f64(BRIDGE_HALF_CLOSE_GRACE_SEC),
        async {
            while let Some(Ok(chunk)) = recv.data().await {
                let _ = recv.flow_control().release_capacity(chunk.len());
            }
        },
    )
    .await;
    close_reason
}

/// Send the TLS close-notify tail (if any) + a WS CLOSE with the mapped code,
/// then END_STREAM the bridge. Mirrors `_dispatch_tcp_stream`'s `finally`.
async fn finish_tcp_bridge(
    send: &Arc<tokio::sync::Mutex<h2::SendStream<Bytes>>>,
    tls: &mut rustls::ServerConnection,
    close_reason: &str,
) {
    let ws_close_code = bridge_close_code(close_reason).unwrap_or(1011);
    // TLS close_notify tail.
    tls.send_close_notify();
    let mut tail = Vec::new();
    while tls.write_tls(&mut tail).unwrap_or(0) > 0 {}
    if !tail.is_empty() {
        let frame = encode_ws_frame(WS_OPCODE_BINARY, &tail, true, true);
        let _ = tokio::time::timeout(
            Duration::from_secs_f64(BRIDGE_CLEANUP_SEND_TIMEOUT_SEC),
            async { send.lock().await.send_data(Bytes::from(frame), false) },
        )
        .await;
    }
    // WS CLOSE (code + truncated reason) with END_STREAM.
    let mut reason_bytes = close_reason.as_bytes().to_vec();
    reason_bytes.truncate(123);
    let mut close_payload = ws_close_code.to_be_bytes().to_vec();
    close_payload.extend_from_slice(&reason_bytes);
    let frame = encode_ws_frame(WS_OPCODE_CLOSE, &close_payload, true, true);
    let _ = tokio::time::timeout(
        Duration::from_secs_f64(BRIDGE_CLEANUP_SEND_TIMEOUT_SEC),
        async { send.lock().await.send_data(Bytes::from(frame), true) },
    )
    .await;
}

// === extended-CONNECT helpers ============================================

/// Open an extended-CONNECT bridge stream. Builds a `CONNECT` request to
/// `https://{zone}{path_prefix}{id}` with `:protocol = subprotocol` (via the
/// `h2::ext::Protocol` request extension), the auth headers, and the bridge-id
/// header. Returns the `(ResponseFuture, SendStream)` pair.
fn open_connect_bridge(
    ctx: &BridgeCtx,
    id: &str,
    path_prefix: &str,
    subprotocol: &str,
    id_header: &str,
) -> Result<(h2::client::ResponseFuture, h2::SendStream<Bytes>)> {
    let uri = format!("https://{}{}{}", ctx.zone, path_prefix, id);
    let mut req = Request::builder()
        .method(Method::CONNECT)
        .uri(&uri)
        // The edge routes the bridge by subprotocol: it requires the
        // `inkbox-tunnel-{ws,tcp}` value in `sec-websocket-protocol` (which it
        // reads into the ASGI `subprotocols` list). Omitting it makes the
        // handler close pre-accept, which Hypercorn surfaces as HTTP 403.
        .header("sec-websocket-version", "13")
        .header("sec-websocket-protocol", subprotocol)
        .header("x-tunnel-id", &ctx.tunnel_id)
        .header("x-api-key", &ctx.api_key)
        .header(id_header, id)
        .body(())
        .map_err(|e| tunnel(format!("connect request build: {e}")))?;
    // The `:protocol` pseudo-header rides the request extensions; the h2 client
    // pulls it out via `extensions_mut().remove::<Protocol>()`.
    req.extensions_mut().insert(h2::ext::Protocol::from(subprotocol));

    let mut send = ctx.send.clone();
    let (resp_fut, send_stream) = send
        .send_request(req, false)
        .map_err(|e| tunnel(format!("connect send: {e}")))?;
    Ok((resp_fut, send_stream))
}

/// Await the CONNECT response, requiring `:status 200`, bounded by `deadline_s`.
/// Returns the inbound `RecvStream` on success.
async fn await_connect_200(
    resp_fut: h2::client::ResponseFuture,
    deadline_s: f64,
) -> Result<h2::RecvStream> {
    let resp = tokio::time::timeout(Duration::from_secs_f64(deadline_s.max(0.0)), resp_fut)
        .await
        .map_err(|_| tunnel("connect bridge: status timeout"))?
        .map_err(|e| tunnel(format!("connect bridge: response error: {e}")))?;
    if resp.status().as_u16() != 200 {
        return Err(tunnel(format!("connect bridge: status={}", resp.status().as_u16())));
    }
    Ok(resp.into_body())
}

/// Post a reply on `/_system/response/{request_id}` with optional reason +
/// body, no extra `inkbox-h-*` headers. Used for WS reject/error replies.
async fn post_reply(
    ctx: &BridgeCtx,
    request_id: &str,
    status: u16,
    reason: Option<&str>,
    body: &[u8],
) -> Result<()> {
    let headers: Vec<(String, String)> = vec![("content-type".into(), "text/plain".into())];
    post_reply_inner(ctx, request_id, status, &headers, reason, body).await
}

/// Post a 200 upgrade reply forwarding `headers` as `inkbox-h-*` (no reason).
async fn post_reply_with_headers(
    ctx: &BridgeCtx,
    request_id: &str,
    status: u16,
    headers: &[(String, String)],
    body: &[u8],
) -> Result<()> {
    post_reply_inner(ctx, request_id, status, headers, None, body).await
}

/// Build + send a `POST /_system/response/{request_id}` with `inkbox-status`,
/// optional `inkbox-reason`, and `inkbox-h-*` headers. Replicates the header
/// construction in `runtime.rs::post_response`.
async fn post_reply_inner(
    ctx: &BridgeCtx,
    request_id: &str,
    status: u16,
    headers: &[(String, String)],
    reason: Option<&str>,
    body: &[u8],
) -> Result<()> {
    let path = format!("{PATH_RESPONSE_PREFIX}{request_id}");
    let uri = format!("https://{}{}", ctx.zone, path);
    let mut builder = Request::builder()
        .method(Method::POST)
        .uri(&uri)
        .header("x-tunnel-id", &ctx.tunnel_id)
        .header("x-api-key", &ctx.api_key)
        .header("inkbox-status", status.to_string())
        .header("inkbox-request-id", request_id)
        .header("content-length", body.len().to_string());
    if let Some(r) = reason {
        builder = builder.header("inkbox-reason", r);
    }
    // Forward each header as `inkbox-h-{lower}`, skipping framing headers the
    // edge recomputes.
    for (k, v) in headers {
        let kl = k.to_ascii_lowercase();
        if kl == "content-length" || kl == "transfer-encoding" {
            continue;
        }
        if let Ok(name) = http::header::HeaderName::from_bytes(format!("inkbox-h-{kl}").as_bytes()) {
            if let Ok(val) = http::header::HeaderValue::from_str(v) {
                builder = builder.header(name, val);
            }
        }
    }

    let end_stream = body.is_empty();
    let req = builder.body(()).map_err(|e| tunnel(format!("reply build: {e}")))?;
    let mut send = ctx.send.clone();
    let (resp_fut, mut stream) = send
        .send_request(req, end_stream)
        .map_err(|e| tunnel(format!("reply send: {e}")))?;
    if !end_stream {
        stream
            .send_data(Bytes::copy_from_slice(body), true)
            .map_err(|e| tunnel(format!("reply body: {e}")))?;
    }
    // Drain the ack so the stream closes cleanly.
    let _ = resp_fut.await;
    Ok(())
}

// === TLS helpers =========================================================

/// Build the outbound (client) TLS connector for a `wss://` upstream,
/// honouring the verify / CA-bundle knobs. Mirrors `build_upstream_tls_context`.
fn build_upstream_tls_connector(
    verify: bool,
    ca_bundle: Option<&[u8]>,
) -> std::result::Result<tokio_rustls::TlsConnector, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let config = if !verify {
        // verify=false: accept any cert (local dev with self-signed certs).
        rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoVerify))
            .with_no_client_auth()
    } else {
        let mut roots = rustls::RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        if let Some(pem) = ca_bundle {
            let mut rd = std::io::BufReader::new(pem);
            for cert in rustls_pemfile::certs(&mut rd).flatten() {
                let _ = roots.add(cert);
            }
        }
        rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth()
    };
    Ok(tokio_rustls::TlsConnector::from(Arc::new(config)))
}

/// A certificate verifier that accepts everything (used only when the caller
/// explicitly disables verification via `forward_to_verify_tls=false`).
#[derive(Debug)]
struct NoVerify;

impl rustls::client::danger::ServerCertVerifier for NoVerify {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> std::result::Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> std::result::Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> std::result::Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        use rustls::SignatureScheme::*;
        vec![
            RSA_PKCS1_SHA256, RSA_PKCS1_SHA384, RSA_PKCS1_SHA512, ECDSA_NISTP256_SHA256,
            ECDSA_NISTP384_SHA384, RSA_PSS_SHA256, RSA_PSS_SHA384, RSA_PSS_SHA512, ED25519,
        ]
    }
}

/// Build the in-memory TLS-server config from the tunnel's cert chain + key
/// PEM, advertising `http/1.1` ALPN. Mirrors `TLSTerminator.__init__`.
fn build_terminator_config(
    cert_pem: &[u8],
    key_pem: &[u8],
) -> std::result::Result<rustls::ServerConfig, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut cert_rd = std::io::BufReader::new(cert_pem);
    let certs: Vec<rustls::pki_types::CertificateDer<'static>> =
        rustls_pemfile::certs(&mut cert_rd).flatten().collect();
    if certs.is_empty() {
        return Err("no certs in cert chain PEM".into());
    }
    let mut key_rd = std::io::BufReader::new(key_pem);
    let key = rustls_pemfile::private_key(&mut key_rd)
        .map_err(|e| format!("key read: {e}"))?
        .ok_or_else(|| "no private key in key PEM".to_string())?;
    let mut config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|e| format!("with_single_cert: {e}"))?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(config)
}

/// Feed encrypted bytes into the TLS server engine; return
/// `(plaintext, encrypted_to_send)`. Mirrors `TLSSession.feed`.
fn feed_tls(
    tls: &mut rustls::ServerConnection,
    encrypted: &[u8],
) -> std::result::Result<(Vec<u8>, Vec<u8>), rustls::Error> {
    if !encrypted.is_empty() {
        let mut rd = encrypted;
        // read_tls only returns io::Error on buffer issues; loop to drain all.
        while !rd.is_empty() {
            match tls.read_tls(&mut rd) {
                Ok(0) => break,
                Ok(_) => {}
                Err(_) => break,
            }
        }
    }
    tls.process_new_packets()?;
    // Drain decrypted plaintext.
    let mut plaintext = Vec::new();
    use std::io::Read;
    let mut tmp = [0u8; 16384];
    loop {
        match tls.reader().read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => plaintext.extend_from_slice(&tmp[..n]),
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
            Err(_) => break,
        }
    }
    // Drain any handshake / alert bytes the engine produced.
    let mut encrypted_out = Vec::new();
    while tls.write_tls(&mut encrypted_out).unwrap_or(0) > 0 {}
    Ok((plaintext, encrypted_out))
}

/// Encrypt outbound plaintext; return encrypted bytes for the wire. Mirrors
/// `TLSSession.send`.
fn encrypt_tls(
    tls: &mut rustls::ServerConnection,
    plaintext: &[u8],
) -> std::result::Result<Vec<u8>, std::io::Error> {
    use std::io::Write;
    if !plaintext.is_empty() {
        tls.writer().write_all(plaintext)?;
    }
    let mut encrypted = Vec::new();
    while tls.write_tls(&mut encrypted).unwrap_or(0) > 0 {}
    Ok(encrypted)
}

// === small pure helpers ==================================================

/// Split the upstream stream into read + write halves the pump owns
/// independently. Boxed reader/writer trait objects keep both TLS / plain arms
/// behind one type.
fn split_upstream(stream: UpstreamStream) -> (UpstreamReadHalf, UpstreamWriteHalf) {
    match stream {
        UpstreamStream::Plain(s) => {
            let (r, w) = s.into_split();
            (UpstreamReadHalf::Plain(r), UpstreamWriteHalf::Plain(w))
        }
        UpstreamStream::Tls(s) => {
            let (r, w) = tokio::io::split(*s);
            (UpstreamReadHalf::Tls(r), UpstreamWriteHalf::Tls(w))
        }
    }
}

enum UpstreamReadHalf {
    Plain(tokio::net::tcp::OwnedReadHalf),
    Tls(tokio::io::ReadHalf<tokio_rustls::client::TlsStream<tokio::net::TcpStream>>),
}
impl UpstreamReadHalf {
    async fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            UpstreamReadHalf::Plain(r) => r.read(buf).await,
            UpstreamReadHalf::Tls(r) => r.read(buf).await,
        }
    }
}
enum UpstreamWriteHalf {
    Plain(tokio::net::tcp::OwnedWriteHalf),
    Tls(tokio::io::WriteHalf<tokio_rustls::client::TlsStream<tokio::net::TcpStream>>),
}
impl UpstreamWriteHalf {
    async fn write_all(&mut self, buf: &[u8]) -> std::io::Result<()> {
        match self {
            UpstreamWriteHalf::Plain(w) => w.write_all(buf).await,
            UpstreamWriteHalf::Tls(w) => w.write_all(buf).await,
        }
    }
    async fn shutdown(&mut self) -> std::io::Result<()> {
        match self {
            UpstreamWriteHalf::Plain(w) => w.shutdown().await,
            UpstreamWriteHalf::Tls(w) => w.shutdown().await,
        }
    }
}

/// RFC 6455 §1.3 `Sec-WebSocket-Accept`. Mirrors `compute_ws_accept`.
fn compute_ws_accept(key: &str) -> String {
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(key.as_bytes());
    hasher.update(WS_GUID.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(hasher.finalize())
}

/// 16 random bytes, base64-encoded — the `Sec-WebSocket-Key` we offer.
fn b64_random_key() -> String {
    let mut bytes = [0u8; 16];
    if !super::wsframe::fill_os_random(&mut bytes) {
        // Fallback: time-seeded (never expected on POSIX).
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0)
            .to_le_bytes();
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = nanos[i % 4];
        }
    }
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Split a `Sec-WebSocket-Protocol` value into offered tokens. Mirrors
/// `_parse_subprotocol_offer`.
fn parse_subprotocol_offer(offer: Option<&str>) -> Vec<String> {
    match offer {
        None => Vec::new(),
        Some(s) => s.split(',').map(|t| t.trim()).filter(|t| !t.is_empty()).map(|t| t.to_string()).collect(),
    }
}

/// First header value (case-insensitive name match), or `None`.
fn first_header(headers: &[(String, String)], name: &str) -> Option<String> {
    let nl = name.to_ascii_lowercase();
    headers.iter().find(|(k, _)| k.to_ascii_lowercase() == nl).map(|(_, v)| v.clone())
}

/// WS CLOSE code from a close payload (first 2 bytes BE), default 1000.
fn close_code(payload: &[u8]) -> i64 {
    if payload.len() >= 2 {
        u16::from_be_bytes([payload[0], payload[1]]) as i64
    } else {
        1000
    }
}

/// The end offset of the `\r\n\r\n` head terminator (inclusive of the 4 bytes).
fn find_head_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|i| i + 4)
}

/// Resolve the upstream port from the netloc (`host:port`) and scheme.
fn upstream_port(netloc: &str, scheme: &str) -> u16 {
    // Strip userinfo, then take the port after the last ':' that isn't inside
    // a bracketed IPv6 literal.
    let hostport = netloc.rsplit('@').next().unwrap_or(netloc);
    let port_str = if let Some(rest) = hostport.strip_prefix('[') {
        rest.split_once(']').and_then(|(_, after)| after.strip_prefix(':'))
    } else {
        hostport.rsplit_once(':').map(|(_, p)| p)
    };
    port_str
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(if scheme == "https" { 443 } else { 80 })
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- inner-envelope encode/decode roundtrip ---------------------------

    /// Encode an inbound bridge envelope the way the server does: a 4-byte BE
    /// length prefix + compact JSON. Test-only mirror of the decode the
    /// bridge→upstream pump performs.
    fn encode_inbound_envelope(json: &str) -> Vec<u8> {
        let mut out = (json.len() as u32).to_be_bytes().to_vec();
        out.extend_from_slice(json.as_bytes());
        out
    }

    #[test]
    fn inbound_text_envelope_roundtrip() {
        let wire = encode_inbound_envelope(r#"{"type":"text","data":"hello"}"#);
        let len = u32::from_be_bytes([wire[0], wire[1], wire[2], wire[3]]) as usize;
        let msg: serde_json::Value = serde_json::from_slice(&wire[4..4 + len]).unwrap();
        assert_eq!(msg.get("type").unwrap(), "text");
        assert_eq!(msg.get("data").unwrap(), "hello");
    }

    #[test]
    fn inbound_binary_envelope_base64_decodes() {
        // base64 of 0x00010203 == "AAECAw==".
        let wire = encode_inbound_envelope(r#"{"type":"binary","data":"AAECAw=="}"#);
        let len = u32::from_be_bytes([wire[0], wire[1], wire[2], wire[3]]) as usize;
        let msg: serde_json::Value = serde_json::from_slice(&wire[4..4 + len]).unwrap();
        let b64 = msg.get("data").unwrap().as_str().unwrap();
        let decoded = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
        assert_eq!(decoded, vec![0, 1, 2, 3]);
    }

    #[test]
    fn outbound_envelope_matches_python_text() {
        // The outbound (upstream→bridge) shape must match the Python
        // `encode_ws_envelope({"type":"websocket.send","text":...})`, which the
        // shared wsframe encoder produces as {"type":"text","data":...}.
        let out = encode_ws_envelope(&OutboundWsMsg::SendText("hi".into()));
        assert_eq!(&out[4..], br#"{"type":"text","data":"hi"}"#);
    }

    // --- upstream h1 handshake request bytes ------------------------------

    #[test]
    fn upstream_handshake_request_shape() {
        let headers = vec![
            ("x-custom".to_string(), "v1".to_string()),
            ("host".to_string(), "drop-me".to_string()),
            ("connection".to_string(), "Upgrade".to_string()),
            ("sec-websocket-key".to_string(), "drop".to_string()),
        ];
        let bytes = build_upstream_handshake(
            "/chat?room=1",
            "localhost:8080",
            "dGhlIHNhbXBsZSBub25jZQ==",
            Some("chat"),
            "my-agent.inkboxwire.com",
            Some("1.2.3.4"),
            &headers,
        );
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.starts_with("GET /chat?room=1 HTTP/1.1\r\n"));
        assert!(text.contains("Host: localhost:8080\r\n"));
        assert!(text.contains("Connection: Upgrade\r\n"));
        assert!(text.contains("Upgrade: websocket\r\n"));
        assert!(text.contains("Sec-WebSocket-Version: 13\r\n"));
        assert!(text.contains("Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"));
        assert!(text.contains("Sec-WebSocket-Protocol: chat\r\n"));
        assert!(text.contains("X-Forwarded-Host: my-agent.inkboxwire.com\r\n"));
        assert!(text.contains("X-Forwarded-Proto: https\r\n"));
        assert!(text.contains("X-Forwarded-For: 1.2.3.4\r\n"));
        assert!(text.contains("x-custom: v1\r\n"));
        // Skipped: inbound host / connection / sec-websocket-key dupes.
        assert!(!text.contains("drop-me"));
        assert!(!text.contains("\r\nconnection: Upgrade"));
        assert!(!text.contains("Sec-WebSocket-Key: drop"));
        // Ends with a blank line.
        assert!(text.ends_with("\r\n\r\n"));
    }

    #[test]
    fn compute_ws_accept_rfc6455_vector() {
        // RFC 6455 §1.3 worked example.
        assert_eq!(
            compute_ws_accept("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }

    // --- upgrade-reply header filtering -----------------------------------

    #[test]
    fn upgrade_reply_strips_handshake_and_hop_by_hop() {
        let up_headers = vec![
            (":status".to_string(), "101".to_string()),
            ("sec-websocket-accept".to_string(), "abc".to_string()),
            ("sec-websocket-extensions".to_string(), "permessage-deflate".to_string()),
            ("connection".to_string(), "Upgrade".to_string()),
            ("upgrade".to_string(), "websocket".to_string()),
            ("set-cookie".to_string(), "sid=1".to_string()),
            ("x-use-inkbox-speech".to_string(), "on".to_string()),
        ];
        let out = filter_upgrade_reply_headers(&up_headers);
        let names: Vec<&str> = out.iter().map(|(k, _)| k.as_str()).collect();
        assert!(names.contains(&"set-cookie"));
        assert!(names.contains(&"x-use-inkbox-speech"));
        assert!(!names.contains(&":status"));
        assert!(!names.contains(&"sec-websocket-accept"));
        assert!(!names.contains(&"sec-websocket-extensions"));
        assert!(!names.contains(&"connection"));
        assert!(!names.contains(&"upgrade"));
    }

    // --- RFC 6455 fragment reassembly -------------------------------------

    #[test]
    fn fragment_reassembly_text() {
        // TEXT(FIN=0) "ab" + CONTINUATION(FIN=1) "cd" reassemble to "abcd".
        let mut buf = encode_ws_frame(WS_OPCODE_TEXT, b"ab", false, false);
        buf.extend_from_slice(&encode_ws_frame(WS_OPCODE_CONTINUATION, b"cd", false, true));
        let frames = decode_ws_frames(&mut buf);
        let mut message_opcode: Option<u8> = None;
        let mut chunks: Vec<u8> = Vec::new();
        let mut completed: Option<(u8, Vec<u8>)> = None;
        for (opcode, payload, fin) in frames {
            match opcode {
                WS_OPCODE_TEXT | WS_OPCODE_BINARY => {
                    message_opcode = Some(opcode);
                    chunks = payload;
                }
                WS_OPCODE_CONTINUATION => chunks.extend_from_slice(&payload),
                _ => {}
            }
            if fin {
                if let Some(op) = message_opcode.take() {
                    completed = Some((op, std::mem::take(&mut chunks)));
                }
            }
        }
        let (op, data) = completed.unwrap();
        assert_eq!(op, WS_OPCODE_TEXT);
        assert_eq!(data, b"abcd");
    }

    // --- pure helpers ------------------------------------------------------

    #[test]
    fn upstream_port_defaults_and_explicit() {
        assert_eq!(upstream_port("localhost:8080", "http"), 8080);
        assert_eq!(upstream_port("localhost", "http"), 80);
        assert_eq!(upstream_port("localhost", "https"), 443);
        assert_eq!(upstream_port("[::1]:9000", "http"), 9000);
        assert_eq!(upstream_port("[::1]", "https"), 443);
    }

    #[test]
    fn parse_subprotocol_offer_splits() {
        assert_eq!(parse_subprotocol_offer(None), Vec::<String>::new());
        assert_eq!(parse_subprotocol_offer(Some("a, b ,c")), vec!["a", "b", "c"]);
        assert_eq!(parse_subprotocol_offer(Some(" , ")), Vec::<String>::new());
    }

    #[test]
    fn close_code_parsing() {
        assert_eq!(close_code(&[]), 1000);
        assert_eq!(close_code(&1001u16.to_be_bytes()), 1001);
    }

    #[test]
    fn find_head_end_locates_terminator() {
        // 12 status bytes + "\r\n\r\n" (4) => terminator ends at offset 16.
        assert_eq!(find_head_end(b"HTTP/1.1 101\r\n\r\nXYZ"), Some(16));
        assert_eq!(find_head_end(b"incomplete\r\n"), None);
    }
}
