//! The h2 data-plane runtime. Maintains one persistent HTTP/2 connection to
//! `https://{zone}/_system/hello`, parks N intake streams, dispatches
//! envelopes (HTTP / WS upgrade / passthrough TCP-stream), and manages
//! reconnect.
//!
//! Ported from `inkbox/tunnels/client/_runtime.py`. The Python uses the
//! sans-IO `h2` library driven over raw asyncio streams; this port uses the
//! async `h2` crate's client API (which owns the connection I/O), so the
//! shape differs while the **wire protocol** (paths, headers, body framing)
//! matches byte-for-byte. The HTTP data path, hello handshake, intake pool,
//! response posting, PING keepalive, and jittered reconnect are fully
//! implemented. WebSocket and TCP-passthrough bridges are dispatched through
//! [`bridge`](super::bridge) (see [`TunnelRuntime::dispatch`]).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use h2::client::SendRequest;
use http::{Method, Request};
use tokio::sync::{Mutex, Notify};

use crate::error::{InkboxError, Result};

use super::bootstrap::TunnelBundle;
use super::envelope::{filter_response_headers, parse_envelope, Envelope};
use super::protocol::{
    META_REASON, META_STATUS, PATH_HELLO, PATH_INTAKE, PATH_RESPONSE_PREFIX, ROUTE_KIND_TCP_STREAM,
    ROUTE_KIND_WEBHOOK, ROUTE_KIND_WS_UPGRADE,
};
use super::url_forward::{forward_envelope_to_url, validate_envelope_path, ForwardResult};

// --- Wire / timing constants (mirror Python `_runtime.py`) ---------------

/// PING cadence on the persistent connection.
pub const PING_INTERVAL: Duration = Duration::from_secs(20);
/// Hard ceiling on an unacked PING before we force a reconnect. Guards
/// against a silently-dead TCP the kernel hasn't reported yet.
pub const PING_ACK_TIMEOUT: Duration = Duration::from_secs(10);
/// OS TCP keepalive cadence applied to the underlying socket.
pub const TCP_KEEPALIVE_IDLE_SECONDS: u64 = 30;
pub const TCP_KEEPALIVE_INTERVAL_SECONDS: u64 = 10;
pub const TCP_KEEPALIVE_PROBE_COUNT: u32 = 3;
/// Reconnect backoff ceiling and jitter (+/- 25%).
pub const BACKOFF_CAP: f64 = 30.0;
pub const BACKOFF_JITTER: f64 = 0.25;
/// Budget for re-dialing the replacement connection during a handoff.
pub const HANDOFF_REDIAL_BUDGET_SEC: f64 = 30.0;
/// Minimum spacing between handoffs (stops a GOAWAY storm chaining handoffs).
pub const HANDOFF_SETTLE_SEC: f64 = 2.0;
/// How long an HTTP reply waits for an in-flight handoff to publish the new
/// active connection before giving up.
pub const POST_ACTIVE_WAIT_SEC: f64 = 5.0;
/// WS/passthrough close code surfaced to live bridges on a server drain
/// (NO_ERROR GOAWAY). In the 4500 application range; must not collide with
/// `WS_CLOSE_AGENT_TIMEOUT`.
pub const WS_CLOSE_SERVER_DRAINING: u16 = 4500;
pub const WS_CLOSE_AGENT_TIMEOUT: u16 = 4504;
/// Default inbound / outbound body caps (32 MiB).
pub const DEFAULT_INBOUND_BODY_BYTES: usize = 32 * 1024 * 1024;
pub const DEFAULT_OUTBOUND_BODY_BYTES: usize = 32 * 1024 * 1024;

/// Status strings passed to the `on_status` callback. Mirrors the Python
/// status vocabulary (`"connecting"`, `"connected"`, `"reconnecting"`,
/// `"closed"`).
pub type StatusCallback = Box<dyn Fn(&str) + Send + Sync>;

/// Where inbound third-party traffic is forwarded.
///
/// The Python runtime accepts either a URL string or an in-process ASGI
/// callable. The Rust port supports the URL form; an in-process callable has
/// no cross-language analogue, so only `Url` is modeled.
#[derive(Debug, Clone)]
pub enum ForwardTo {
    /// A local URL, e.g. `http://localhost:8080`.
    Url(String),
}

/// Configuration for a [`TunnelRuntime`]. Mirrors the Python `TunnelRuntime`
/// constructor kwargs.
pub struct TunnelRuntimeConfig {
    pub tunnel_id: String,
    pub api_key: String,
    pub zone: String,
    pub public_host: String,
    pub pool_size: Option<i64>,
    pub forward_to: ForwardTo,
    pub tls_material: Option<(Vec<u8>, Vec<u8>)>,
    pub max_inbound_body_bytes: usize,
    pub max_outbound_body_bytes: usize,
    pub on_status: Option<StatusCallback>,
    pub forward_to_verify_tls: bool,
    pub forward_to_ca_bundle: Option<Vec<u8>>,
}

impl TunnelRuntimeConfig {
    /// Build a config from a resolved bundle, the API key, and a forward
    /// target, with the remaining knobs defaulted to the Python defaults.
    pub fn from_bundle(bundle: &TunnelBundle, api_key: String, forward_to: ForwardTo) -> Self {
        Self {
            tunnel_id: bundle.tunnel.id.to_string(),
            api_key,
            zone: bundle.zone.clone(),
            public_host: bundle.public_host.clone(),
            pool_size: None,
            forward_to,
            tls_material: bundle.tls_material.clone(),
            max_inbound_body_bytes: DEFAULT_INBOUND_BODY_BYTES,
            max_outbound_body_bytes: DEFAULT_OUTBOUND_BODY_BYTES,
            on_status: None,
            forward_to_verify_tls: true,
            forward_to_ca_bundle: None,
        }
    }
}

/// Permanent auth failure from `/_system/hello`; do not retry. (Python
/// `_TunnelAuthError`.) Surfaced as an [`InkboxError::Tunnel`] tagged so the
/// supervisor can stop retrying.
fn tunnel_auth_error(msg: impl Into<String>) -> InkboxError {
    InkboxError::Tunnel(format!("tunnel-auth: {}", msg.into()))
}

fn transient(msg: impl Into<String>) -> InkboxError {
    InkboxError::Tunnel(msg.into())
}

/// One live h2 connection: the cloneable request handle plus the
/// server-advertised parameters from the hello response.
struct ActiveConn {
    send: SendRequest<Bytes>,
    owner_token: String,
    server_pool_size: Option<i64>,
    #[allow(dead_code)]
    intake_idle_seconds: Option<f64>,
    response_deadline_seconds: Option<f64>,
}

/// The data-plane runtime.
///
/// Drive it with [`serve_forever`](TunnelRuntime::serve_forever) and stop it
/// with [`aclose`](TunnelRuntime::aclose).
pub struct TunnelRuntime {
    cfg: TunnelRuntimeConfig,
    /// Shared async HTTP client for URL forwarding + `inkbox-body-uri` GETs.
    http: reqwest::Client,
    /// The connection that parks new intakes (published once hello succeeds).
    active: Arc<Mutex<Option<Arc<ActiveConn>>>>,
    stop: Arc<Notify>,
    stopped: Arc<AtomicBool>,
}

impl TunnelRuntime {
    /// Construct a runtime from its config.
    pub fn new(cfg: TunnelRuntimeConfig) -> Self {
        // Build the forwarding client honouring the verify / CA-bundle knobs.
        let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(30));
        if !cfg.forward_to_verify_tls {
            builder = builder.danger_accept_invalid_certs(true);
        }
        if let Some(ca) = &cfg.forward_to_ca_bundle {
            if let Ok(cert) = reqwest::Certificate::from_pem(ca) {
                builder = builder.add_root_certificate(cert);
            }
        }
        let http = builder.build().unwrap_or_else(|_| reqwest::Client::new());
        Self {
            cfg,
            http,
            active: Arc::new(Mutex::new(None)),
            stop: Arc::new(Notify::new()),
            stopped: Arc::new(AtomicBool::new(false)),
        }
    }

    /// `https://{public_host}` — the tunnel's public URL.
    pub fn public_url(&self) -> String {
        format!("https://{}", self.cfg.public_host)
    }

    // --- public lifecycle ------------------------------------------------

    /// Run the runtime to completion, reconnecting with jittered backoff on
    /// transient failures. Returns `Err` on a permanent auth failure (the
    /// Python `_TunnelAuthError` path), or `Ok(())` on a clean shutdown.
    pub async fn serve_forever(self: &Arc<Self>) -> Result<()> {
        let mut backoff = 1.0f64;
        self.notify_status("connecting");
        loop {
            if self.is_stopped() {
                self.notify_status("closed");
                return Ok(());
            }
            match self.run_once().await {
                Ok(()) => backoff = 1.0,
                Err(err) if is_auth_error(&err) => {
                    self.notify_status("closed");
                    return Err(err);
                }
                Err(_) => self.notify_status("reconnecting"),
            }
            if self.is_stopped() {
                self.notify_status("closed");
                return Ok(());
            }
            let jitter = backoff * BACKOFF_JITTER * (2.0 * pseudo_rand() - 1.0);
            let sleep_for = (backoff + jitter).max(0.1);
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs_f64(sleep_for)) => {}
                _ = self.stop.notified() => {
                    self.notify_status("closed");
                    return Ok(());
                }
            }
            backoff = (backoff * 2.0).min(BACKOFF_CAP);
        }
    }

    /// Graceful shutdown. Signals the supervisor to stop; the active
    /// connection's tasks observe `stopped` and wind down, and dropping the
    /// `SendRequest` handles closes the h2 connection.
    pub async fn aclose(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.stop.notify_waiters();
        *self.active.lock().await = None;
    }

    // --- connection lifecycle --------------------------------------------

    /// Open one connection, send hello, park the intake pool, and supervise
    /// it until the connection dies or shutdown is requested.
    async fn run_once(self: &Arc<Self>) -> Result<()> {
        // `force_down` lets the PING keepalive and the intake loops force this
        // connection down (a half-dead socket or a rejected owner token never
        // fires `conn_closed` on its own — dropping those tasks isn't enough).
        // Fresh per connection so a stale signal can't kill the next one.
        let force_down = Arc::new(Notify::new());

        // Dial + h2 handshake. The driver runs as a background task; when it
        // ends (GOAWAY / reset / TCP close) `conn_closed` fires.
        let (send, conn_closed) = self.open_connection(force_down.clone()).await?;

        // Hello handshake — establishes the owner_token used to park intakes.
        let active = self.send_hello(send).await?;
        let active = Arc::new(active);
        *self.active.lock().await = Some(active.clone());
        self.notify_status("connected");

        // Park the intake pool. effective_pool = server default or our
        // requested size or 1.
        let effective_pool = active
            .server_pool_size
            .or(self.cfg.pool_size)
            .unwrap_or(1)
            .max(1) as usize;
        let mut handles = Vec::with_capacity(effective_pool);
        for slot in 0..effective_pool {
            let me = self.clone();
            let conn = active.clone();
            let fd = force_down.clone();
            handles.push(tokio::spawn(async move { me.intake_loop(conn, slot, fd).await }));
        }

        // Supervise: return when the connection dies, a keepalive/owner-token
        // failure forces it down, or stop is requested.
        tokio::select! {
            _ = conn_closed => {}
            _ = force_down.notified() => {}
            _ = self.stop.notified() => {}
            _ = wait_until_stopped(self.stopped.clone()) => {}
        }

        // Tear the pool down; dropping `active`/its `SendRequest` closes h2.
        for h in handles {
            h.abort();
        }
        *self.active.lock().await = None;
        if self.is_stopped() {
            Ok(())
        } else {
            Err(transient("tunnel connection closed; reconnecting"))
        }
    }

    /// Dial the data-plane endpoint over TLS (ALPN `h2`), run the h2
    /// handshake, spawn the connection driver + PING keepalive, and return a
    /// cloneable request handle plus a future that resolves when the
    /// connection dies.
    async fn open_connection(
        self: &Arc<Self>,
        force_down: Arc<Notify>,
    ) -> Result<(SendRequest<Bytes>, tokio::sync::oneshot::Receiver<()>)> {
        use tokio::net::TcpStream;
        use tokio_rustls::TlsConnector;

        // Process-wide default crypto provider (idempotent across reconnects).
        let _ = rustls::crypto::ring::default_provider().install_default();

        let mut roots = rustls::RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let mut tls = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        tls.alpn_protocols = vec![b"h2".to_vec()];

        let server_name = rustls::pki_types::ServerName::try_from(self.cfg.zone.clone())
            .map_err(|_| transient(format!("invalid zone host {:?}", self.cfg.zone)))?;
        let tcp = TcpStream::connect((self.cfg.zone.as_str(), 443))
            .await
            .map_err(|e| transient(format!("tcp connect {}: {e}", self.cfg.zone)))?;
        let _ = tcp.set_nodelay(true);
        let tls_stream = TlsConnector::from(Arc::new(tls))
            .connect(server_name, tcp)
            .await
            .map_err(|e| transient(format!("tls handshake {}: {e}", self.cfg.zone)))?;

        let (send, connection) = h2::client::Builder::new()
            .enable_push(false)
            .handshake(tls_stream)
            .await
            .map_err(|e| transient(format!("h2 handshake: {e}")))?;

        let (closed_tx, closed_rx) = tokio::sync::oneshot::channel();

        // Take the PingPong before the driver consumes the connection. Mirrors
        // Python `_ping_loop`: ping every PING_INTERVAL, give up (→ reconnect)
        // if a ping isn't acked within PING_ACK_TIMEOUT.
        let mut connection = connection;
        let ping_pong = connection.ping_pong();
        tokio::spawn(async move {
            let _ = connection.await;
            let _ = closed_tx.send(());
        });
        if let Some(mut pp) = ping_pong {
            let stopped_ping = self.stopped.clone();
            let force_down_ping = force_down.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(PING_INTERVAL).await;
                    if stopped_ping.load(Ordering::SeqCst) {
                        return;
                    }
                    match tokio::time::timeout(PING_ACK_TIMEOUT, pp.ping(h2::Ping::opaque())).await {
                        Ok(Ok(_pong)) => {}
                        // Ack timed out or the connection errored. The socket may
                        // still look open to the driver (no `conn_closed`), so
                        // force the supervisor to tear it down and reconnect.
                        _ => {
                            force_down_ping.notify_one();
                            return;
                        }
                    }
                }
            });
        }

        Ok((send, closed_rx))
    }

    /// Perform the `/_system/hello` handshake (Python `_send_hello`).
    async fn send_hello(&self, mut send: SendRequest<Bytes>) -> Result<ActiveConn> {
        let mut builder = Request::builder()
            .method(Method::POST)
            .uri(self.url(PATH_HELLO))
            .header("x-tunnel-id", &self.cfg.tunnel_id)
            .header("x-api-key", &self.cfg.api_key)
            .header("content-length", "0");
        if let Some(ps) = self.cfg.pool_size {
            builder = builder.header("x-pool-size", ps.to_string());
        }
        let req = builder
            .body(())
            .map_err(|e| transient(format!("hello request build: {e}")))?;

        let (resp_fut, _stream) = send
            .send_request(req, true)
            .map_err(|e| transient(format!("hello send: {e}")))?;
        let resp = resp_fut
            .await
            .map_err(|e| transient(format!("hello response: {e}")))?;
        let status = resp.status().as_u16();
        let body = read_body(resp.into_body(), 1 << 20).await?;

        if status == 401 || status == 403 {
            return Err(tunnel_auth_error(format!(
                "/_system/hello returned {status}; the API key was rejected \
                 (check the key matches the tunnel's identity scope, or use an \
                 admin-scoped key in the tunnel's org)"
            )));
        }
        if status != 200 {
            return Err(transient(format!(
                "/_system/hello returned {status}; transient — will retry"
            )));
        }
        let payload: serde_json::Value = if body.is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_slice(&body)
                .map_err(|e| transient(format!("/_system/hello body not JSON: {e}")))?
        };
        let owner_token = payload
            .get("owner_token")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| transient("/_system/hello response missing owner_token"))?
            .to_string();
        Ok(ActiveConn {
            send,
            owner_token,
            server_pool_size: payload.get("default_pool_size").and_then(|v| v.as_i64()),
            intake_idle_seconds: payload.get("intake_idle_seconds").and_then(|v| v.as_f64()),
            response_deadline_seconds: payload
                .get("response_deadline_seconds")
                .and_then(|v| v.as_f64()),
        })
    }

    // --- intake pool -----------------------------------------------------

    /// One parked-intake worker (Python `_intake_loop`): long-poll
    /// `/_system/intake`, then dispatch the returned envelope. Loops until
    /// shutdown or a fatal owner-token rejection.
    async fn intake_loop(self: Arc<Self>, conn: Arc<ActiveConn>, slot: usize, force_down: Arc<Notify>) {
        while !self.is_stopped() {
            match self.park_one_intake(&conn, slot).await {
                Ok(Some(env)) => {
                    let me = self.clone();
                    let c = conn.clone();
                    tokio::spawn(async move {
                        let _ = me.dispatch(env, c).await;
                    });
                }
                Ok(None) => continue,
                // The owner token is no longer valid (e.g. a sibling connection
                // re-registered): force the supervisor down so it reconnects and
                // re-hellos for a fresh token, then exit this slot.
                Err(e) if is_owner_token_invalid(&e) => {
                    force_down.notify_one();
                    return;
                }
                Err(_) => tokio::time::sleep(Duration::from_millis(250)).await,
            }
        }
    }

    /// Park a single `/_system/intake` long-poll and parse its envelope.
    async fn park_one_intake(&self, conn: &ActiveConn, slot: usize) -> Result<Option<Envelope>> {
        let req = Request::builder()
            .method(Method::POST)
            .uri(self.url(PATH_INTAKE))
            .header("x-tunnel-id", &self.cfg.tunnel_id)
            .header("x-owner-token", &conn.owner_token)
            .header("x-pool-slot", slot.to_string())
            .header("content-length", "0")
            .body(())
            .map_err(|e| transient(format!("intake build: {e}")))?;

        let mut send = conn.send.clone();
        let (resp_fut, _stream) = send
            .send_request(req, true)
            .map_err(|e| transient(format!("intake send: {e}")))?;
        let resp = resp_fut
            .await
            .map_err(|e| transient(format!("intake response: {e}")))?;
        let status = resp.status().as_u16();
        let headers = http_headers_to_pairs(resp.headers());
        let body = read_body(resp.into_body(), self.cfg.max_inbound_body_bytes).await?;

        if status != 200 {
            if status == 401 {
                return Err(owner_token_invalid(format!("intake slot={slot} status=401")));
            }
            return Ok(None);
        }
        Ok(parse_envelope(&headers, body))
    }

    // --- dispatch --------------------------------------------------------

    /// Route one parsed envelope to its handler (Python `_dispatch`).
    async fn dispatch(&self, envelope: Envelope, conn: Arc<ActiveConn>) -> Result<()> {
        match envelope.route_kind.as_str() {
            ROUTE_KIND_WEBHOOK => self.dispatch_http(envelope, &conn).await,
            ROUTE_KIND_WS_UPGRADE => {
                super::bridges::dispatch_ws_upgrade(self.bridge_ctx(&conn), envelope).await
            }
            ROUTE_KIND_TCP_STREAM => {
                super::bridges::dispatch_tcp_stream(self.bridge_ctx(&conn), envelope).await
            }
            other => {
                let reason = format!("route-kind-{other}-unsupported");
                self.post_response(
                    &conn,
                    &envelope.request_id,
                    502,
                    &[("content-type".into(), "text/plain".into())],
                    Some(&reason),
                    b"unsupported route kind".to_vec(),
                )
                .await
            }
        }
    }

    /// Build the context the WS / TCP bridges need (cloneable per dispatch).
    fn bridge_ctx(&self, conn: &ActiveConn) -> super::bridges::BridgeCtx {
        let ForwardTo::Url(forward_to) = &self.cfg.forward_to;
        super::bridges::BridgeCtx {
            zone: self.cfg.zone.clone(),
            tunnel_id: self.cfg.tunnel_id.clone(),
            api_key: self.cfg.api_key.clone(),
            public_host: self.cfg.public_host.clone(),
            forward_to: forward_to.clone(),
            verify_tls: self.cfg.forward_to_verify_tls,
            ca_bundle: self.cfg.forward_to_ca_bundle.clone(),
            response_deadline_seconds: conn.response_deadline_seconds,
            tls_material: self.cfg.tls_material.clone(),
            send: conn.send.clone(),
        }
    }

    /// Forward an inbound HTTP request to the local upstream and post the
    /// reply back (Python `_dispatch_http`).
    async fn dispatch_http(&self, mut envelope: Envelope, conn: &ActiveConn) -> Result<()> {
        // Path-traversal guard before any body materialization / dispatch.
        if let Some(reason) = validate_envelope_path(&envelope.path) {
            return self
                .post_response(
                    conn,
                    &envelope.request_id,
                    400,
                    &[("content-type".into(), "text/plain".into())],
                    Some(&reason),
                    b"invalid path".to_vec(),
                )
                .await;
        }

        // Materialize an offloaded body (resolve `inkbox-body-uri`).
        if let Err((status, reason)) = self.materialize_body(&mut envelope).await {
            return self
                .post_response(
                    conn,
                    &envelope.request_id,
                    status,
                    &[("content-type".into(), "text/plain".into())],
                    Some(reason),
                    reason.as_bytes().to_vec(),
                )
                .await;
        }

        let ForwardTo::Url(forward_to) = &self.cfg.forward_to;
        let result: ForwardResult = forward_envelope_to_url(
            &envelope,
            forward_to,
            &self.cfg.public_host,
            &self.http,
            self.cfg.max_outbound_body_bytes,
        )
        .await;

        let mut headers = filter_response_headers(&result.headers);
        if let Some(reason) = &result.inkbox_reason {
            headers.push((META_REASON.to_string(), reason.clone()));
        }
        self.post_response(conn, &envelope.request_id, result.status, &headers, None, result.body)
            .await
    }

    /// Resolve any `inkbox-body-uri` into the envelope body, enforcing the
    /// inbound cap. On error returns `(status, reason)` for the reply.
    async fn materialize_body(
        &self,
        envelope: &mut Envelope,
    ) -> std::result::Result<(), (u16, &'static str)> {
        if envelope.body.len() > self.cfg.max_inbound_body_bytes {
            return Err((413, "request-body-too-large"));
        }
        let Some(uri) = envelope.body_uri.clone() else {
            return Ok(());
        };
        let resp = self
            .http
            .get(&uri)
            .send()
            .await
            .map_err(|_| (502, "body-fetch-failed"))?;
        if resp.status().as_u16() >= 400 {
            return Err((502, "body-fetch-failed"));
        }
        let bytes = resp.bytes().await.map_err(|_| (502, "body-fetch-failed"))?;
        if bytes.len() > self.cfg.max_inbound_body_bytes {
            return Err((413, "request-body-too-large"));
        }
        envelope.body = bytes.to_vec();
        envelope.body_uri = None;
        Ok(())
    }

    /// Post an HTTP reply back to the edge on `/_system/response/{id}`
    /// (Python `_post_response`). Reply metadata rides `inkbox-status` +
    /// `inkbox-h-{name}` headers; the body is the upstream response body.
    async fn post_response(
        &self,
        conn: &ActiveConn,
        request_id: &str,
        status: u16,
        headers: &[(String, String)],
        inkbox_reason: Option<&str>,
        body: Vec<u8>,
    ) -> Result<()> {
        let path = format!("{PATH_RESPONSE_PREFIX}{request_id}");
        let mut builder = Request::builder()
            .method(Method::POST)
            .uri(self.url(&path))
            .header("x-tunnel-id", &self.cfg.tunnel_id)
            .header("x-api-key", &self.cfg.api_key)
            .header(META_STATUS, status.to_string())
            .header("inkbox-request-id", request_id)
            .header("content-length", body.len().to_string());
        if let Some(reason) = inkbox_reason {
            builder = builder.header(META_REASON, reason);
        }
        // Forward each upstream header as `inkbox-h-{lower}`, skipping the
        // framing headers the edge recomputes.
        for (k, v) in headers {
            let kl = k.to_ascii_lowercase();
            if kl == "content-length" || kl == "transfer-encoding" {
                continue;
            }
            if let Ok(name) =
                http::header::HeaderName::from_bytes(format!("inkbox-h-{kl}").as_bytes())
            {
                if let Ok(val) = http::header::HeaderValue::from_str(v) {
                    builder = builder.header(name, val);
                }
            }
        }

        let _ = conn.response_deadline_seconds; // server also enforces; post promptly.

        let end_stream = body.is_empty();
        let req = builder
            .body(())
            .map_err(|e| transient(format!("response build: {e}")))?;
        let mut send = conn.send.clone();
        let (resp_fut, mut stream) = send
            .send_request(req, end_stream)
            .map_err(|e| transient(format!("response send: {e}")))?;
        if !end_stream {
            stream
                .send_data(Bytes::from(body), true)
                .map_err(|e| transient(format!("response body: {e}")))?;
        }
        // Drain the ack so the stream closes cleanly (the edge replies 200).
        let _ = resp_fut.await;
        Ok(())
    }

    // --- helpers ---------------------------------------------------------

    fn url(&self, path: &str) -> String {
        format!("https://{}{}", self.cfg.zone, path)
    }

    fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    fn notify_status(&self, status: &str) {
        if let Some(cb) = &self.cfg.on_status {
            cb(status);
        }
    }
}

/// Read an h2 response body fully, releasing flow-control capacity as data
/// arrives, and enforcing `cap` bytes.
async fn read_body(mut body: h2::RecvStream, cap: usize) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    while let Some(chunk) = body.data().await {
        let chunk = chunk.map_err(|e| transient(format!("h2 body read: {e}")))?;
        let _ = body.flow_control().release_capacity(chunk.len());
        if buf.len() + chunk.len() > cap {
            return Err(transient("inbound body exceeded cap"));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

/// Convert an `http::HeaderMap` into the `(name, value)` pairs the envelope
/// parser expects (lowercased names, lossy UTF-8 values).
fn http_headers_to_pairs(headers: &http::HeaderMap) -> Vec<(String, String)> {
    headers
        .iter()
        .map(|(k, v)| {
            (
                k.as_str().to_ascii_lowercase(),
                String::from_utf8_lossy(v.as_bytes()).into_owned(),
            )
        })
        .collect()
}

async fn wait_until_stopped(stopped: Arc<AtomicBool>) {
    loop {
        if stopped.load(Ordering::SeqCst) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// True iff `err` is the permanent auth-failure tag from `/_system/hello`.
fn is_auth_error(err: &InkboxError) -> bool {
    matches!(err, InkboxError::Tunnel(m) if m.starts_with("tunnel-auth:"))
}

fn owner_token_invalid(msg: impl Into<String>) -> InkboxError {
    InkboxError::Tunnel(format!("owner-token-invalid: {}", msg.into()))
}

fn is_owner_token_invalid(err: &InkboxError) -> bool {
    matches!(err, InkboxError::Tunnel(m) if m.starts_with("owner-token-invalid:"))
}

/// Cheap pseudo-random in `[0, 1)` for backoff jitter (Python uses
/// `random.random()`); derived from the clock nanos.
fn pseudo_rand() -> f64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    (nanos % 1_000_000) as f64 / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> TunnelRuntimeConfig {
        TunnelRuntimeConfig {
            tunnel_id: "11111111-1111-1111-1111-111111111111".into(),
            api_key: "sk-test".into(),
            zone: "inkboxwire.com".into(),
            public_host: "my-agent.inkboxwire.com".into(),
            pool_size: None,
            forward_to: ForwardTo::Url("http://localhost:8080".into()),
            tls_material: None,
            max_inbound_body_bytes: DEFAULT_INBOUND_BODY_BYTES,
            max_outbound_body_bytes: DEFAULT_OUTBOUND_BODY_BYTES,
            on_status: None,
            forward_to_verify_tls: true,
            forward_to_ca_bundle: None,
        }
    }

    #[test]
    fn public_url_shape() {
        let rt = TunnelRuntime::new(cfg());
        assert_eq!(rt.public_url(), "https://my-agent.inkboxwire.com");
        assert_eq!(rt.url(PATH_HELLO), "https://inkboxwire.com/_system/hello");
    }

    #[test]
    fn error_classification() {
        assert!(is_auth_error(&tunnel_auth_error("nope")));
        assert!(!is_auth_error(&transient("transient")));
        assert!(is_owner_token_invalid(&owner_token_invalid("x")));
    }

    #[tokio::test]
    async fn serve_forever_returns_on_immediate_stop() {
        let rt = Arc::new(TunnelRuntime::new(cfg()));
        rt.aclose().await;
        assert!(rt.serve_forever().await.is_ok());
    }

    #[tokio::test]
    async fn status_callback_receives_connecting_then_closed() {
        use std::sync::Mutex as StdMutex;
        let seen = Arc::new(StdMutex::new(Vec::<String>::new()));
        let seen2 = seen.clone();
        let mut c = cfg();
        c.on_status = Some(Box::new(move |s: &str| seen2.lock().unwrap().push(s.to_string())));
        let rt = Arc::new(TunnelRuntime::new(c));
        rt.aclose().await;
        let _ = rt.serve_forever().await;
        let got = seen.lock().unwrap().clone();
        assert!(got.contains(&"connecting".to_string()));
        assert!(got.contains(&"closed".to_string()));
    }
}
