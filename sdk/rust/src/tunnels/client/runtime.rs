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

use std::future::Future;
use std::panic::{catch_unwind, AssertUnwindSafe};
#[cfg(test)]
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use bytes::Bytes;
use h2::client::SendRequest;
use http::{Method, Request};
use tokio::sync::{oneshot, watch, Mutex, Notify};
use tokio::task::JoinHandle;
use tokio::time::Instant;

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
/// Aggregate budget for TCP, TLS, and HTTP/2 establishment.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Budget for sending HELLO and reading its complete response.
pub const HELLO_TIMEOUT: Duration = Duration::from_secs(15);
/// Group budget for stopping connection-owned background tasks.
pub const TASK_TEARDOWN_TIMEOUT: Duration = Duration::from_secs(5);
/// Initial cold reconnect delay before jitter.
pub const INITIAL_BACKOFF: Duration = Duration::from_secs(1);
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

/// Signals that another client connected to this tunnel and took over: this
/// client must stop and not reconnect. Delivered as a dedicated GOAWAY error
/// code (the reliable channel this runtime keys on) plus matching reason
/// strings on the intake / hello responses. Must stay in lockstep with the server.
pub const SUPERSEDED_GOAWAY_ERROR_CODE: u32 = 0x1201;
const INTAKE_REASON_SUPERSEDED: &str = "intake-superseded";
const HELLO_REASON_SUPERSEDED: &str = "hello-superseded";

/// Status strings passed to the `on_status` callback. Mirrors the Python
/// status vocabulary (`"connecting"`, `"connected"`, `"reconnecting"`,
/// `"closed"`, `"superseded"`).
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
    generation: u64,
    owner_token: String,
    server_pool_size: Option<i64>,
    #[allow(dead_code)]
    intake_idle_seconds: Option<f64>,
    response_deadline_seconds: Option<f64>,
}

struct ConnectionTasks {
    driver: Option<JoinHandle<()>>,
    ping: Option<JoinHandle<()>>,
}

impl ConnectionTasks {
    fn take_owned(&mut self) -> Vec<OwnedTask> {
        let mut tasks = Vec::with_capacity(2);
        if let Some(driver) = self.driver.take() {
            tasks.push(OwnedTask::new("connection driver", driver));
        }
        if let Some(ping) = self.ping.take() {
            tasks.push(OwnedTask::new("PING monitor", ping));
        }
        tasks
    }

    async fn shutdown(&mut self, timeout: Duration) -> Vec<OwnedTask> {
        let mut tasks = self.take_owned();
        shutdown_owned_tasks(&mut tasks, timeout).await;
        tasks
    }
}

impl Drop for ConnectionTasks {
    fn drop(&mut self) {
        if let Some(driver) = &self.driver {
            driver.abort();
        }
        if let Some(ping) = &self.ping {
            ping.abort();
        }
    }
}

struct OpenConnection {
    send: SendRequest<Bytes>,
    closed: oneshot::Receiver<()>,
    tasks: ConnectionTasks,
}

struct OwnedTask {
    name: &'static str,
    handle: JoinHandle<()>,
}

impl OwnedTask {
    fn new(name: &'static str, handle: JoinHandle<()>) -> Self {
        Self { name, handle }
    }
}

impl Drop for OwnedTask {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

#[derive(Clone, Copy)]
struct RuntimeTimings {
    connect: Duration,
    hello: Duration,
    teardown: Duration,
    ping_interval: Duration,
    ping_ack: Duration,
    initial_backoff: Duration,
    backoff_cap: f64,
    backoff_jitter: f64,
}

impl Default for RuntimeTimings {
    fn default() -> Self {
        Self {
            connect: CONNECT_TIMEOUT,
            hello: HELLO_TIMEOUT,
            teardown: TASK_TEARDOWN_TIMEOUT,
            ping_interval: PING_INTERVAL,
            ping_ack: PING_ACK_TIMEOUT,
            initial_backoff: INITIAL_BACKOFF,
            backoff_cap: BACKOFF_CAP,
            backoff_jitter: BACKOFF_JITTER,
        }
    }
}

#[cfg(test)]
type TestOpenFuture = Pin<Box<dyn Future<Output = Result<OpenConnection>> + Send>>;
#[cfg(test)]
type TestConnector = Arc<
    dyn Fn(Instant, RuntimeTimings, Arc<AtomicBool>, Arc<Notify>, Arc<AtomicBool>) -> TestOpenFuture
        + Send
        + Sync
        + 'static,
>;
#[cfg(test)]
type TestSleepFuture = Pin<Box<dyn Future<Output = ()> + Send>>;
#[cfg(test)]
type TestSleeper = Arc<dyn Fn(Duration) -> TestSleepFuture + Send + Sync + 'static>;

#[cfg(test)]
#[derive(Default)]
struct RuntimeTestHooks {
    connector: Option<TestConnector>,
    sleeper: Option<TestSleeper>,
    random: Option<Arc<dyn Fn() -> f64 + Send + Sync>>,
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
    stop: watch::Sender<bool>,
    stopped: Arc<AtomicBool>,
    successful_connections: AtomicU64,
    generation: AtomicU64,
    last_notified_status: StdMutex<Option<String>>,
    lingering_tasks: StdMutex<Vec<OwnedTask>>,
    timings: RuntimeTimings,
    #[cfg(test)]
    test_hooks: RuntimeTestHooks,
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
            stop: watch::channel(false).0,
            stopped: Arc::new(AtomicBool::new(false)),
            successful_connections: AtomicU64::new(0),
            generation: AtomicU64::new(0),
            last_notified_status: StdMutex::new(None),
            lingering_tasks: StdMutex::new(Vec::new()),
            timings: RuntimeTimings::default(),
            #[cfg(test)]
            test_hooks: RuntimeTestHooks::default(),
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
        let mut backoff = self.timings.initial_backoff.as_secs_f64();
        let mut attempt = 0u64;
        self.notify_status("connecting");
        loop {
            if self.is_stopped() {
                self.notify_status("closed");
                return Ok(());
            }
            attempt += 1;
            log::info!("tunnel connection attempt {attempt} starting");
            let connected_before = self.successful_connections.load(Ordering::SeqCst);
            match self.run_once().await {
                Ok(()) => backoff = self.timings.initial_backoff.as_secs_f64(),
                Err(err) if is_auth_error(&err) => {
                    self.notify_status("closed");
                    return Err(err);
                }
                // Another client connected to this tunnel and took over: stop
                // and do not reconnect. Surface it terminally (like auth) so an
                // accidental second instance on the same identity is visible.
                Err(err) if is_superseded_error(&err) => {
                    self.notify_status("superseded");
                    return Err(err);
                }
                Err(err) => {
                    if let Some(phase) = timeout_phase(&err) {
                        log::warn!("tunnel connection attempt {attempt} timed out during {phase}");
                    } else {
                        log::warn!("tunnel connection attempt {attempt} failed: {err}");
                    }
                }
            }
            if self.successful_connections.load(Ordering::SeqCst) > connected_before {
                backoff = self.timings.initial_backoff.as_secs_f64();
            }
            if self.is_stopped() {
                self.notify_status("closed");
                return Ok(());
            }
            let jitter =
                backoff * self.timings.backoff_jitter * (2.0 * self.random_fraction() - 1.0);
            let sleep_for = (backoff + jitter).max(0.1);
            if !self.sleep_or_stop(Duration::from_secs_f64(sleep_for)).await {
                self.notify_status("closed");
                return Ok(());
            }
            backoff = (backoff * 2.0).min(self.timings.backoff_cap);
        }
    }

    /// Graceful shutdown. Signals the supervisor to stop; the active
    /// connection's tasks observe `stopped` and wind down, and dropping the
    /// `SendRequest` handles closes the h2 connection.
    pub async fn aclose(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.stop.send_replace(true);
        *self.active.lock().await = None;
        let mut lingering = std::mem::take(&mut *self.lingering());
        shutdown_owned_tasks(&mut lingering, self.timings.teardown).await;
        self.retain_tasks(&mut lingering);
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

        // Reason channel: `force_down` is payloadless, so a takeover observed
        // by the connection driver (GOAWAY code) or an intake loop (409 reason)
        // is recorded here for the supervisor to read after the select.
        let superseded = Arc::new(AtomicBool::new(false));

        // Dial + h2 handshake. The driver runs as a background task; when it
        // ends (GOAWAY / reset / TCP close) `conn_closed` fires.
        let connect_deadline = Instant::now() + self.timings.connect;
        let open = self
            .wait_for_stop(self.establish_connection(
                connect_deadline,
                force_down.clone(),
                superseded.clone(),
            ))
            .await;
        let OpenConnection {
            send,
            mut closed,
            mut tasks,
        } = match open {
            None => return Ok(()),
            Some(Ok(open)) => open,
            Some(Err(err)) => {
                self.notify_reconnecting();
                return Err(err);
            }
        };

        // Hello handshake — establishes the owner_token used to park intakes.
        // A displaced-during-hello loser returns the superseded tag here.
        let hello_deadline = Instant::now() + self.timings.hello;
        let mut stop_rx = self.stop.subscribe();
        let hello = if *stop_rx.borrow() {
            None
        } else {
            tokio::select! {
                biased;
                _ = stop_rx.changed() => None,
                _ = &mut closed => {
                    Some(Err(if superseded.load(Ordering::SeqCst) {
                        superseded_error("another client connected to this tunnel")
                    } else {
                        transient("tunnel connection closed during hello")
                    }))
                }
                result = with_phase_timeout(
                    hello_deadline,
                    "hello",
                    self.send_hello(send),
                ) => Some(result),
            }
        };
        let active = match hello {
            None => {
                self.shutdown_connection_tasks(&mut tasks).await;
                return Ok(());
            }
            Some(Ok(active)) => active,
            Some(Err(e)) => {
                if !superseded.load(Ordering::SeqCst)
                    && !is_auth_error(&e)
                    && !is_superseded_error(&e)
                {
                    self.notify_reconnecting();
                }
                self.shutdown_connection_tasks(&mut tasks).await;
                if self.is_stopped() {
                    return Ok(());
                }
                // A takeover GOAWAY can land mid-hello: the driver sets the
                // flag while the hello itself fails as a plain transient error.
                // Honor the flag so we stop instead of redialing and booting
                // the client that replaced us.
                if superseded.load(Ordering::SeqCst) {
                    return Err(superseded_error("another client connected to this tunnel"));
                }
                return Err(e);
            }
        };

        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let dispatch_handles = Arc::new(StdMutex::new(Vec::new()));

        // Park the intake pool before publishing connected state. A status
        // callback may block without delaying intake task creation.
        let mut active = active;
        active.generation = generation;
        let active = Arc::new(active);
        let effective_pool = active
            .server_pool_size
            .or(self.cfg.pool_size)
            .unwrap_or(1)
            .max(1) as usize;
        let mut intake_tasks = Vec::with_capacity(effective_pool);
        let mut intake_started = Vec::with_capacity(effective_pool);
        for slot in 0..effective_pool {
            let me = self.clone();
            let conn = active.clone();
            let fd = force_down.clone();
            let sup = superseded.clone();
            let dispatches = dispatch_handles.clone();
            let (started_tx, started_rx) = oneshot::channel();
            intake_started.push(started_rx);
            intake_tasks.push(OwnedTask::new(
                "intake worker",
                tokio::spawn(async move {
                    me.intake_loop(conn, slot, fd, sup, dispatches, started_tx)
                        .await
                }),
            ));
        }
        for started in intake_started {
            let _ = started.await;
        }

        *self.active.lock().await = Some(active.clone());
        let connection_number = self.successful_connections.fetch_add(1, Ordering::SeqCst);
        if connection_number == 0 {
            log::info!("tunnel connection established");
        } else {
            log::info!("tunnel connection recovered");
        }
        self.notify_status("connected");

        let mut stop_rx = self.stop.subscribe();
        if !*stop_rx.borrow() {
            tokio::select! {
                _ = &mut closed => {}
                _ = force_down.notified() => {}
                _ = stop_rx.changed() => {}
            }
        }

        let terminal_superseded = superseded.load(Ordering::SeqCst);
        let stopping = self.is_stopped();
        self.generation.fetch_add(1, Ordering::SeqCst);
        if !terminal_superseded && !stopping {
            self.notify_reconnecting();
        }

        *self.active.lock().await = None;
        let dispatch_tasks = {
            let mut handles = dispatch_handles
                .lock()
                .unwrap_or_else(|err| err.into_inner());
            handles.drain(..).collect::<Vec<_>>()
        };
        intake_tasks.extend(dispatch_tasks);
        intake_tasks.extend(tasks.take_owned());
        shutdown_owned_tasks(&mut intake_tasks, self.timings.teardown).await;
        self.retain_tasks(&mut intake_tasks);
        drop(active);

        if terminal_superseded {
            Err(superseded_error("another client connected to this tunnel"))
        } else if stopping {
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
        deadline: Instant,
        force_down: Arc<Notify>,
        superseded: Arc<AtomicBool>,
    ) -> Result<OpenConnection> {
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
        let tcp = with_phase_timeout(deadline, "tcp", async {
            TcpStream::connect((self.cfg.zone.as_str(), 443))
                .await
                .map_err(|e| transient(format!("tcp connect {}: {e}", self.cfg.zone)))
        })
        .await?;
        let _ = tcp.set_nodelay(true);
        let tls_stream = with_phase_timeout(deadline, "tls", async {
            TlsConnector::from(Arc::new(tls))
                .connect(server_name, tcp)
                .await
                .map_err(|e| transient(format!("tls handshake {}: {e}", self.cfg.zone)))
        })
        .await?;

        start_h2_connection(
            tls_stream,
            deadline,
            self.timings,
            self.stopped.clone(),
            force_down,
            superseded,
        )
        .await
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
        // Displaced during hello: another client won the race for this tunnel.
        // Terminal (stop, don't reconnect) so we don't redial and boot the
        // client that replaced us. Rust reconnects cold-sequentially, so there
        // is no draining predecessor to guard against.
        if status == 409 {
            let reason = serde_json::from_slice::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("reason").and_then(|r| r.as_str()).map(str::to_string))
                .unwrap_or_default();
            if reason == HELLO_REASON_SUPERSEDED {
                return Err(superseded_error(
                    "another client connected to this tunnel during hello",
                ));
            }
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
            generation: 0,
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
    async fn intake_loop(
        self: Arc<Self>,
        conn: Arc<ActiveConn>,
        slot: usize,
        force_down: Arc<Notify>,
        superseded: Arc<AtomicBool>,
        dispatch_handles: Arc<StdMutex<Vec<OwnedTask>>>,
        started: oneshot::Sender<()>,
    ) {
        let _ = started.send(());
        while !self.is_stopped() {
            match self.park_one_intake(&conn, slot).await {
                Ok(Some(env)) => {
                    let me = self.clone();
                    let c = conn.clone();
                    let handle = tokio::spawn(async move {
                        let _ = me.dispatch(env, c).await;
                    });
                    dispatch_handles
                        .lock()
                        .unwrap_or_else(|err| err.into_inner())
                        .push(OwnedTask::new("request dispatch", handle));
                }
                Ok(None) => continue,
                // Another client took over: record it (force_down is
                // payloadless) so the supervisor stops instead of reconnecting.
                Err(e) if is_superseded_error(&e) => {
                    superseded.store(true, Ordering::SeqCst);
                    force_down.notify_one();
                    return;
                }
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
            let reason = headers
                .iter()
                .find(|(k, _)| k == META_REASON)
                .map(|(_, v)| v.as_str())
                .unwrap_or("");
            // Another client took over this tunnel: terminal (a drain uses a
            // different reason and falls through to re-park as Ok(None)).
            if reason == INTAKE_REASON_SUPERSEDED {
                return Err(superseded_error(format!("intake slot={slot}: taken over")));
            }
            if status == 401 {
                return Err(owner_token_invalid(format!(
                    "intake slot={slot} status=401"
                )));
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
        self.post_response(
            conn,
            &envelope.request_id,
            result.status,
            &headers,
            None,
            result.body,
        )
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
        if self.generation.load(Ordering::SeqCst) != conn.generation {
            return Err(transient("response belongs to a closed tunnel connection"));
        }
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

    async fn establish_connection(
        self: &Arc<Self>,
        deadline: Instant,
        force_down: Arc<Notify>,
        superseded: Arc<AtomicBool>,
    ) -> Result<OpenConnection> {
        #[cfg(test)]
        if let Some(connector) = &self.test_hooks.connector {
            return with_phase_timeout(
                deadline,
                "tcp",
                connector(
                    deadline,
                    self.timings,
                    self.stopped.clone(),
                    force_down,
                    superseded,
                ),
            )
            .await;
        }
        self.open_connection(deadline, force_down, superseded).await
    }

    async fn wait_for_stop<T, F>(&self, future: F) -> Option<T>
    where
        F: Future<Output = T>,
    {
        let mut stop_rx = self.stop.subscribe();
        if *stop_rx.borrow() {
            return None;
        }
        tokio::select! {
            biased;
            _ = stop_rx.changed() => None,
            result = future => Some(result),
        }
    }

    async fn sleep_or_stop(&self, duration: Duration) -> bool {
        #[cfg(test)]
        let sleep = if let Some(sleeper) = &self.test_hooks.sleeper {
            sleeper(duration)
        } else {
            Box::pin(tokio::time::sleep(duration)) as TestSleepFuture
        };
        #[cfg(not(test))]
        let sleep = tokio::time::sleep(duration);
        self.wait_for_stop(sleep).await.is_some()
    }

    fn random_fraction(&self) -> f64 {
        #[cfg(test)]
        if let Some(random) = &self.test_hooks.random {
            return random();
        }
        pseudo_rand()
    }

    fn notify_reconnecting(&self) {
        if !self.is_stopped() {
            self.notify_status("reconnecting");
        }
    }

    async fn shutdown_connection_tasks(&self, tasks: &mut ConnectionTasks) {
        let mut pending = tasks.shutdown(self.timings.teardown).await;
        self.retain_tasks(&mut pending);
    }

    fn retain_tasks(&self, tasks: &mut Vec<OwnedTask>) {
        if tasks.is_empty() {
            return;
        }
        self.lingering().append(tasks);
    }

    fn lingering(&self) -> std::sync::MutexGuard<'_, Vec<OwnedTask>> {
        self.lingering_tasks
            .lock()
            .unwrap_or_else(|err| err.into_inner())
    }

    fn notify_status(&self, status: &str) {
        {
            let mut last = self
                .last_notified_status
                .lock()
                .unwrap_or_else(|err| err.into_inner());
            if last.as_deref() == Some(status) {
                return;
            }
            *last = Some(status.to_string());
        }
        if let Some(cb) = &self.cfg.on_status {
            if catch_unwind(AssertUnwindSafe(|| cb(status))).is_err() {
                log::error!(
                    "tunnel status callback panicked for status {status}; continuing runtime"
                );
            }
        }
    }
}

async fn start_h2_connection<T>(
    io: T,
    deadline: Instant,
    timings: RuntimeTimings,
    stopped: Arc<AtomicBool>,
    force_down: Arc<Notify>,
    superseded: Arc<AtomicBool>,
) -> Result<OpenConnection>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (send, connection) = with_phase_timeout(deadline, "h2", async {
        h2::client::Builder::new()
            .enable_push(false)
            .handshake(io)
            .await
            .map_err(|e| transient(format!("h2 handshake: {e}")))
    })
    .await?;
    let mut connection = connection;
    let send = with_phase_timeout(deadline, "h2", async {
        tokio::select! {
            ready = send.ready() => ready
                .map_err(|e| transient(format!("h2 connection readiness: {e}"))),
            result = &mut connection => match result {
                Ok(()) => Err(transient("h2 connection closed before readiness")),
                Err(err) => Err(transient(format!("h2 connection before readiness: {err}"))),
            },
        }
    })
    .await?;

    let (closed_tx, closed_rx) = oneshot::channel();
    let ping_pong = connection.ping_pong();
    let driver = tokio::spawn(async move {
        if let Err(err) = connection.await {
            if is_superseded_goaway(&err) {
                superseded.store(true, Ordering::SeqCst);
            }
        }
        let _ = closed_tx.send(());
    });
    let ping = ping_pong.map(|mut ping_pong| {
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(timings.ping_interval).await;
                if stopped.load(Ordering::SeqCst) {
                    return;
                }
                if !matches!(
                    tokio::time::timeout(timings.ping_ack, ping_pong.ping(h2::Ping::opaque()))
                        .await,
                    Ok(Ok(_))
                ) {
                    force_down.notify_one();
                    return;
                }
            }
        })
    });
    Ok(OpenConnection {
        send,
        closed: closed_rx,
        tasks: ConnectionTasks {
            driver: Some(driver),
            ping,
        },
    })
}

async fn shutdown_owned_tasks(tasks: &mut Vec<OwnedTask>, timeout: Duration) {
    for task in tasks.iter() {
        task.handle.abort();
    }
    let completed = tokio::time::timeout(timeout, async {
        while tasks.iter().any(|task| !task.handle.is_finished()) {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .is_ok();

    let mut remaining = Vec::new();
    for mut task in tasks.drain(..) {
        if task.handle.is_finished() {
            let _ = (&mut task.handle).await;
        } else {
            remaining.push(task);
        }
    }
    if !completed {
        for task in &remaining {
            log::warn!("tunnel {} task did not stop during teardown", task.name);
        }
    }
    *tasks = remaining;
}

async fn with_phase_timeout<T, F>(deadline: Instant, phase: &'static str, future: F) -> Result<T>
where
    F: Future<Output = Result<T>>,
{
    tokio::time::timeout_at(deadline, future)
        .await
        .map_err(|_| transient(format!("tunnel connect timeout during {phase}")))?
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

/// Tag for a takeover: another client connected to this tunnel. The
/// supervisor stops (does not reconnect) on this, like the auth failure.
fn superseded_error(msg: impl Into<String>) -> InkboxError {
    InkboxError::Tunnel(format!("tunnel-superseded: {}", msg.into()))
}

fn is_superseded_error(err: &InkboxError) -> bool {
    err.is_tunnel_superseded()
}

fn timeout_phase(err: &InkboxError) -> Option<&str> {
    let InkboxError::Tunnel(message) = err else {
        return None;
    };
    message.strip_prefix("tunnel connect timeout during ")
}

/// True iff a connection-driver `h2::Error` carries the dedicated superseded
/// GOAWAY code. Rust reads only the code (no debug bytes), so this is the
/// reliable takeover channel on the connection itself.
fn is_superseded_goaway(err: &h2::Error) -> bool {
    err.reason() == Some(h2::Reason::from(SUPERSEDED_GOAWAY_ERROR_CODE))
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
#[path = "runtime_tests.rs"]
mod tests;
