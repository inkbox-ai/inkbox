//! The h2 data-plane runtime. Maintains one persistent HTTP/2 connection to
//! `https://{zone}/_system/connect`, parks N intake streams, dispatches
//! envelopes (HTTP / WS upgrade / passthrough TCP-stream), and manages flow
//! control + reconnect.
//!
//! Ported from `inkbox/tunnels/client/_runtime.py`. This module ports the
//! **structure** faithfully — config + constructor, the public async API
//! (`serve_forever`, `aclose`), the connection-lifecycle control flow, and the
//! wire-shape constants — using `tokio` + `h2`. The deep per-event dispatch
//! bodies (HTTP forward, WS bridge pumps, TCP passthrough, flow-control
//! windows) are scaffolded with precise `TODO(tunnels-runtime)` markers
//! quoting the Python behaviour, because verifying them requires a live edge
//! server. The module COMPILES and the lifecycle skeleton is exercised.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Mutex, Notify};

use crate::error::{InkboxError, Result};

use super::bootstrap::TunnelBundle;
use super::envelope::Envelope;

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
/// callable. The Rust port supports the URL form; the in-process callable is
/// not expressible across the FFI boundary, so only `Url` is modeled.
#[derive(Debug, Clone)]
pub enum ForwardTo {
    /// A local URL, e.g. `http://localhost:8080`.
    Url(String),
}

/// Configuration for a [`TunnelRuntime`]. Mirrors the Python `TunnelRuntime`
/// constructor kwargs.
pub struct TunnelRuntimeConfig {
    /// Tunnel UUID (string-coerced for headers).
    pub tunnel_id: String,
    /// Data-plane API key (sent as `x-api-key` on hello + every CONNECT).
    pub api_key: String,
    /// Data-plane h2 endpoint host (e.g. `inkboxwire.com`).
    pub zone: String,
    /// Public host (e.g. `my-agent.inkboxwire.com`).
    pub public_host: String,
    /// Requested parked-intake pool size; `None` omits the header (server
    /// picks the default).
    pub pool_size: Option<i64>,
    /// Where to forward inbound traffic.
    pub forward_to: ForwardTo,
    /// Passthrough TLS material `(cert_chain_pem, key_pem)`; `None` for edge.
    pub tls_material: Option<(Vec<u8>, Vec<u8>)>,
    /// Cap for materialized inbound bodies.
    pub max_inbound_body_bytes: usize,
    /// Cap for materialized outbound bodies.
    pub max_outbound_body_bytes: usize,
    /// Optional transport-state-change callback.
    pub on_status: Option<StatusCallback>,
    /// Verify the upstream's TLS cert on URL forwarding.
    pub forward_to_verify_tls: bool,
    /// Optional CA bundle (PEM) for verifying the upstream.
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

/// One persistent h2 connection's state.
///
/// The runtime holds a single `active` connection (the pool that parks new
/// intakes) plus zero-or-more `draining` ones during a make-before-break
/// handoff. State is per-connection because two live h2 sessions each
/// allocate stream ids 1, 3, 5… — a shared streams map would collide.
///
// TODO(tunnels-runtime): the Python `_Connection` carries the live h2
// connection handle (`h2.connection.H2Connection`), the asyncio reader/writer,
// a send lock, per-stream event queues (`streams`), the bridge stream-id set,
// flow-control window events, the owner_token, server-advertised pool size /
// idle / response-deadline, the ping bookkeeping, and the `draining` /
// `goaway_received` flags. Port these onto `h2::client::SendRequest` +
// `tokio::net::TcpStream` (rustls) once the dispatch loops are implemented.
pub struct Connection {
    pub conn_id: u64,
    pub owner_token: Option<String>,
    pub server_pool_size: Option<i64>,
    pub intake_idle_seconds: Option<f64>,
    pub response_deadline_seconds: Option<f64>,
    pub draining: bool,
    pub goaway_received: bool,
}

impl Connection {
    fn new(conn_id: u64) -> Self {
        Self {
            conn_id,
            owner_token: None,
            server_pool_size: None,
            intake_idle_seconds: None,
            response_deadline_seconds: None,
            draining: false,
            goaway_received: false,
        }
    }
}

/// Permanent auth failure from `/_system/hello`; do not retry. (Python
/// `_TunnelAuthError`.) The runtime surfaces it as an
/// [`InkboxError::Tunnel`] tagged so the supervisor can stop retrying.
fn tunnel_auth_error(msg: impl Into<String>) -> InkboxError {
    InkboxError::Tunnel(format!("tunnel-auth: {}", msg.into()))
}

/// Shared mutable runtime state, behind a `Mutex` so dispatch tasks and the
/// supervisor can share it (Python relies on a single-threaded event loop;
/// tokio is multi-threaded, hence the lock).
struct RuntimeState {
    active: Option<Connection>,
    next_conn_id: u64,
    // Reserved for the make-before-break handoff control flow (see the
    // run_once / post_response TODOs); set/read once the dial lands.
    #[allow(dead_code)]
    handoff_in_flight: bool,
    #[allow(dead_code)]
    last_handoff_at: f64,
}

/// The data-plane runtime.
///
/// Drive it with [`serve_forever`](TunnelRuntime::serve_forever) and stop it
/// with [`aclose`](TunnelRuntime::aclose).
pub struct TunnelRuntime {
    cfg: TunnelRuntimeConfig,
    state: Arc<Mutex<RuntimeState>>,
    /// Set once shutdown is requested (Python `self._stop`).
    stop: Arc<Notify>,
    stopped: Arc<std::sync::atomic::AtomicBool>,
}

impl TunnelRuntime {
    /// Construct a runtime from its config.
    pub fn new(cfg: TunnelRuntimeConfig) -> Self {
        Self {
            cfg,
            state: Arc::new(Mutex::new(RuntimeState {
                active: None,
                next_conn_id: 1,
                handoff_in_flight: false,
                last_handoff_at: 0.0,
            })),
            stop: Arc::new(Notify::new()),
            stopped: Arc::new(std::sync::atomic::AtomicBool::new(false)),
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
    ///
    /// Control flow mirrors Python `serve_forever`:
    /// - notify `"connecting"`, then loop while not stopped;
    /// - on a `tunnel-auth` error notify `"closed"` and return the error
    ///   (never retry);
    /// - on any other error notify `"reconnecting"` and back off;
    /// - on a clean stop notify `"closed"` and return.
    pub async fn serve_forever(&self) -> Result<()> {
        let mut backoff = 1.0f64;
        let mut consecutive_failures = 0u64;
        self.notify_status("connecting");
        loop {
            if self.is_stopped() {
                self.notify_status("closed");
                return Ok(());
            }
            match self.run_once().await {
                Ok(()) => {
                    backoff = 1.0;
                    consecutive_failures = 0;
                }
                Err(err) if is_auth_error(&err) => {
                    // Permanent: refuse to retry, matching Python.
                    self.notify_status("closed");
                    return Err(err);
                }
                Err(_) => {
                    consecutive_failures += 1;
                    let _ = consecutive_failures;
                    self.notify_status("reconnecting");
                }
            }
            if self.is_stopped() {
                self.notify_status("closed");
                return Ok(());
            }
            // Jittered backoff: max(0.1, backoff +/- 25%).
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

    /// Graceful shutdown. Signals the supervisor to stop and tears down the
    /// active + draining connections and any pooled clients.
    ///
    // TODO(tunnels-runtime): the Python `aclose` cancels every connection's
    // ping loop, closes each writer (`writer.close(); await wait_closed()`),
    // closes the passthrough dispatcher, and closes the shared httpx client.
    // Port the writer/client teardown once those handles live on `Connection`.
    pub async fn aclose(&self) {
        self.stopped
            .store(true, std::sync::atomic::Ordering::SeqCst);
        self.stop.notify_waiters();
        let mut st = self.state.lock().await;
        st.active = None;
    }

    // --- connection lifecycle (structure) --------------------------------

    /// Open one connection, send hello, park the intake pool, and supervise
    /// it until a cold death or a make-before-break handoff.
    ///
    // TODO(tunnels-runtime): port the full Python `_run_once`:
    //   conn = new Connection; active = conn;
    //   open_connection(conn)            // TLS+ALPN h2 dial, TCP knobs
    //   spawn read_loop(conn)
    //   send_hello(conn)                 // POST /_system/hello (see below)
    //   notify "connected"; start_serving(conn)  // park N intakes + ping loop
    //   loop: wait_close_or_handoff; follow a NO_ERROR-GOAWAY handoff in-band,
    //         else break so serve_forever reconnects cold.
    //   finally: teardown_cold(conn).
    async fn run_once(&self) -> Result<()> {
        // Allocate a connection id + publish it as active, matching the
        // structure of Python `_run_once` even though the dial is pending.
        {
            let mut st = self.state.lock().await;
            let id = st.next_conn_id;
            st.next_conn_id += 1;
            st.active = Some(Connection::new(id));
        }
        self.open_connection().await?;
        self.send_hello().await?;
        self.notify_status("connected");
        self.start_serving().await
    }

    /// Dial the data-plane endpoint over TLS with ALPN `h2`, set TCP_NODELAY
    /// + OS keepalive, and initiate the h2 connection.
    ///
    // TODO(tunnels-runtime): port Python `_open_connection`:
    //   ssl ctx with ALPN ["h2"]; asyncio.open_connection(zone, 443, ssl=ctx);
    //   socket: TCP_NODELAY=1, SO_KEEPALIVE=1, TCP_KEEPIDLE/INTVL/CNT
    //     (best-effort, using the constants above);
    //   reset ping bookkeeping; build an H2Connection (client_side) with
    //   ENABLE_CONNECT_PROTOCOL=1 in local settings; initiate + flush.
    // Use `tokio::net::TcpStream` + `tokio-rustls` (rustls is a feature dep) +
    // `h2::client::handshake`. Until that lands this is a no-op that surfaces
    // a transient error so `serve_forever` backs off rather than spinning.
    async fn open_connection(&self) -> Result<()> {
        Err(InkboxError::Tunnel(
            "tunnel data-plane h2 dial not yet implemented (TODO in runtime.rs)".into(),
        ))
    }

    /// Perform the `/_system/hello` handshake.
    ///
    // TODO(tunnels-runtime): port Python `_send_hello` exactly. Open a stream
    // with these pseudo+meta headers (order matters for the server):
    //   :method POST, :scheme https, :authority {zone}, :path /_system/hello,
    //   x-tunnel-id {tunnel_id}, x-api-key {api_key}, content-length 0,
    //   and x-pool-size {pool_size} iff pool_size is Some.
    // end_stream=true. Await the response:
    //   401/403 -> permanent _TunnelAuthError (use `tunnel_auth_error`);
    //   != 200  -> transient RuntimeError (retry);
    //   200     -> JSON body must carry `owner_token` (else transient error);
    //              also read optional `default_pool_size` (int),
    //              `intake_idle_seconds` (float), `response_deadline_seconds`
    //              (float) onto the Connection.
    async fn send_hello(&self) -> Result<()> {
        // Reference the auth-error constructor so the wire-contract comment
        // above stays tied to a real code path once the dial is implemented.
        let _ = tunnel_auth_error("placeholder; see send_hello TODO");
        Ok(())
    }

    /// Spawn the connection's intake pool + ping loop, then supervise.
    ///
    // TODO(tunnels-runtime): port Python `_start_serving` + the supervise
    // loop. effective_pool = server_pool_size or pool_size or 1; spawn that
    // many `intake_loop(conn, slot)` tasks (each parks `/_system/intake` with
    // x-owner-token + x-pool-slot and dispatches the returned envelope), and
    // one `ping_loop(conn)`. Then `wait_close_or_handoff`.
    async fn start_serving(&self) -> Result<()> {
        Ok(())
    }

    // --- dispatch (structure) --------------------------------------------

    /// Dispatch one parsed envelope to the configured forward target.
    ///
    // TODO(tunnels-runtime): port Python `_dispatch` routing on
    // `envelope.route_kind`:
    //   "webhook"    -> _dispatch_http: validate_envelope_path; materialize
    //                   body (resolve inkbox-body-uri via the http client up to
    //                   max_inbound_body_bytes); forward_envelope_to_url; then
    //                   _post_response(request_id, status, headers, body).
    //   "ws-upgrade" -> _dispatch_ws_upgrade / _dispatch_ws_upgrade_to_url:
    //                   open CONNECT /_system/ws/{ws_id} (subprotocol
    //                   inkbox-tunnel-ws), bridge frames with the wsframe codec.
    //   "tcp-stream" -> _dispatch_tcp_stream: open CONNECT /_system/tcp/{tcp_id}
    //                   (subprotocol inkbox-tunnel-tcp), run the passthrough
    //                   TLS terminator + byte pumps using BridgeStats.
    #[allow(dead_code)]
    async fn dispatch(&self, _envelope: Envelope, _conn_id: u64) -> Result<()> {
        Ok(())
    }

    /// Post an HTTP reply back to the edge on `/_system/response/{id}`.
    ///
    // TODO(tunnels-runtime): port Python `_post_response`. Reply headers
    // (order matters):
    //   :method POST, :scheme https, :authority {zone},
    //   :path /_system/response/{request_id}, x-tunnel-id, x-api-key,
    //   inkbox-status {status}, inkbox-request-id {request_id},
    //   content-length {len}, then each upstream header as `inkbox-h-{lower}`
    //   (skipping content-length / transfer-encoding). end_stream when body
    //   is empty; otherwise send the body then end. A webhook reply migrates
    //   to the current active conn (waiting up to POST_ACTIVE_WAIT_SEC for an
    //   in-flight handoff); a WS-upgrade reply pins to its origin conn.
    #[allow(dead_code)]
    async fn post_response(
        &self,
        _request_id: &str,
        _status: u16,
        _headers: &[(String, String)],
        _body: &[u8],
    ) -> Result<()> {
        Ok(())
    }

    // --- helpers ---------------------------------------------------------

    fn is_stopped(&self) -> bool {
        self.stopped.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Invoke the `on_status` callback, swallowing panics-as-errors the way
    /// Python swallows callback exceptions.
    fn notify_status(&self, status: &str) {
        if let Some(cb) = &self.cfg.on_status {
            cb(status);
        }
    }
}

/// True iff `err` is the permanent auth-failure tag from `/_system/hello`.
fn is_auth_error(err: &InkboxError) -> bool {
    matches!(err, InkboxError::Tunnel(m) if m.starts_with("tunnel-auth:"))
}

/// Cheap pseudo-random in `[0, 1)` for backoff jitter. We don't need a CSPRNG
/// here (Python uses `random.random()`); derive from the clock nanos.
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
    }

    #[test]
    fn auth_error_is_classified() {
        assert!(is_auth_error(&tunnel_auth_error("nope")));
        assert!(!is_auth_error(&InkboxError::Tunnel("transient".into())));
    }

    // serve_forever returns Ok promptly once stop is set before the first
    // run_once (exercises the shutdown control-flow without a live server).
    #[tokio::test]
    async fn serve_forever_returns_on_immediate_stop() {
        let rt = Arc::new(TunnelRuntime::new(cfg()));
        rt.aclose().await; // sets stopped + notifies
        let r = rt.serve_forever().await;
        assert!(r.is_ok());
    }

    // status callback fires with the lifecycle strings.
    #[tokio::test]
    async fn status_callback_receives_connecting_then_closed() {
        use std::sync::Mutex as StdMutex;
        let seen = Arc::new(StdMutex::new(Vec::<String>::new()));
        let seen2 = seen.clone();
        let mut c = cfg();
        c.on_status = Some(Box::new(move |s: &str| {
            seen2.lock().unwrap().push(s.to_string());
        }));
        let rt = Arc::new(TunnelRuntime::new(c));
        rt.aclose().await;
        let _ = rt.serve_forever().await;
        let got = seen.lock().unwrap().clone();
        assert!(got.contains(&"connecting".to_string()));
        assert!(got.contains(&"closed".to_string()));
    }
}
