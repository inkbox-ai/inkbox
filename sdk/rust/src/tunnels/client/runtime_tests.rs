use std::collections::VecDeque;
use std::future::pending;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::*;
use crate::tunnels::client::{LocalTunnelStatus, TunnelStatusHandle};

struct TestLogger {
    messages: StdMutex<Vec<String>>,
}

impl log::Log for TestLogger {
    fn enabled(&self, _metadata: &log::Metadata<'_>) -> bool {
        true
    }

    fn log(&self, record: &log::Record<'_>) {
        self.messages
            .lock()
            .unwrap()
            .push(record.args().to_string());
    }

    fn flush(&self) {}
}

static TEST_LOGGER: TestLogger = TestLogger {
    messages: StdMutex::new(Vec::new()),
};

fn cfg() -> TunnelRuntimeConfig {
    TunnelRuntimeConfig {
        tunnel_id: "11111111-1111-1111-1111-111111111111".into(),
        api_key: "test-key".into(),
        zone: "example.com".into(),
        public_host: "agent.example.com".into(),
        pool_size: Some(1),
        forward_to: ForwardTo::Url("http://localhost:8080".into()),
        tls_material: None,
        max_inbound_body_bytes: DEFAULT_INBOUND_BODY_BYTES,
        max_outbound_body_bytes: DEFAULT_OUTBOUND_BODY_BYTES,
        on_status: None,
        forward_to_verify_tls: true,
        forward_to_ca_bundle: None,
    }
}

fn fast_timings() -> RuntimeTimings {
    RuntimeTimings {
        connect: Duration::from_millis(80),
        hello: Duration::from_millis(80),
        teardown: Duration::from_millis(50),
        ping_interval: Duration::from_millis(20),
        ping_ack: Duration::from_millis(20),
        initial_backoff: Duration::from_millis(100),
        backoff_cap: 0.8,
        backoff_jitter: 0.0,
    }
}

#[derive(Clone, Copy)]
enum HelloMode {
    Complete,
    StallBody,
    Auth,
    Superseded,
}

struct PeerSignals {
    forward_to_client: AtomicBool,
    hello_seen: Notify,
    intakes: AtomicUsize,
    responses: AtomicUsize,
    tasks: StdMutex<Vec<JoinHandle<()>>>,
}

impl PeerSignals {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            forward_to_client: AtomicBool::new(true),
            hello_seen: Notify::new(),
            intakes: AtomicUsize::new(0),
            responses: AtomicUsize::new(0),
            tasks: StdMutex::new(Vec::new()),
        })
    }

    fn stop_forwarding(&self) {
        self.forward_to_client.store(false, Ordering::SeqCst);
    }

    fn abort_tasks(&self) {
        for task in self.tasks.lock().unwrap().drain(..) {
            task.abort();
        }
    }
}

enum ConnectAction {
    Fail,
    Hang,
    H2Hang(Arc<Notify>),
    Peer(HelloMode, Arc<PeerSignals>),
    PeerSlowTeardown(Arc<PeerSignals>),
}

#[derive(Clone)]
struct ScriptedConnector {
    actions: Arc<StdMutex<VecDeque<ConnectAction>>>,
    attempts: Arc<AtomicUsize>,
}

impl ScriptedConnector {
    fn new(actions: impl IntoIterator<Item = ConnectAction>) -> Self {
        Self {
            actions: Arc::new(StdMutex::new(actions.into_iter().collect())),
            attempts: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn hook(&self) -> TestConnector {
        let script = self.clone();
        Arc::new(move |deadline, timings, stopped, force_down, superseded| {
            let action = script.actions.lock().unwrap().pop_front();
            script.attempts.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move {
                match action.unwrap_or(ConnectAction::Hang) {
                    ConnectAction::Fail => Err(transient("scripted connect failure")),
                    ConnectAction::Hang => pending().await,
                    ConnectAction::H2Hang(entered) => {
                        let (client, server_guard) = tokio::io::duplex(1);
                        entered.notify_one();
                        let result = start_h2_connection(
                            client, deadline, timings, stopped, force_down, superseded,
                        )
                        .await;
                        drop(server_guard);
                        result
                    }
                    ConnectAction::Peer(mode, signals) => {
                        open_loopback_peer(
                            deadline, timings, stopped, force_down, superseded, mode, signals,
                        )
                        .await
                    }
                    ConnectAction::PeerSlowTeardown(signals) => {
                        let force_after_hello = force_down.clone();
                        let mut open = open_loopback_peer(
                            deadline,
                            timings,
                            stopped,
                            force_down,
                            superseded,
                            HelloMode::Complete,
                            signals,
                        )
                        .await?;
                        let (started_tx, started_rx) = std::sync::mpsc::channel();
                        let blocking_ping = tokio::task::spawn_blocking(move || {
                            started_tx.send(()).unwrap();
                            std::thread::sleep(Duration::from_millis(250));
                        });
                        started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
                        if let Some(ping) = open.tasks.ping.replace(blocking_ping) {
                            ping.abort();
                        }
                        tokio::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(10)).await;
                            force_after_hello.notify_one();
                        });
                        Ok(open)
                    }
                }
            })
        })
    }
}

// The loopback fixture uses in-memory duplex streams instead of certificate
// files. It still drives the real h2 handshake, connection driver, HELLO,
// intake, and PING paths while keeping test-only trust material out of crates.
async fn open_loopback_peer(
    deadline: Instant,
    timings: RuntimeTimings,
    stopped: Arc<AtomicBool>,
    force_down: Arc<Notify>,
    superseded: Arc<AtomicBool>,
    hello_mode: HelloMode,
    signals: Arc<PeerSignals>,
) -> Result<OpenConnection> {
    let (client_io, client_proxy) = tokio::io::duplex(64 * 1024);
    let (server_proxy, server_io) = tokio::io::duplex(64 * 1024);
    let (mut from_client, mut to_client) = tokio::io::split(client_proxy);
    let (mut from_server, mut to_server) = tokio::io::split(server_proxy);

    let client_to_server = tokio::spawn(async move {
        let _ = tokio::io::copy(&mut from_client, &mut to_server).await;
    });

    let signals_for_proxy = signals.clone();
    let server_to_client = tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            let Ok(read) = from_server.read(&mut buf).await else {
                return;
            };
            if read == 0 {
                return;
            }
            if signals_for_proxy.forward_to_client.load(Ordering::SeqCst)
                && to_client.write_all(&buf[..read]).await.is_err()
            {
                return;
            }
        }
    });

    let signals_for_server = signals.clone();
    let server = tokio::spawn(async move {
        let mut connection = h2::server::handshake(server_io).await.unwrap();
        let mut pending_responses = Vec::new();
        let mut pending_bodies = Vec::new();
        while let Some(result) = connection.accept().await {
            let (request, mut respond) = result.unwrap();
            match request.uri().path() {
                PATH_HELLO => {
                    signals_for_server.hello_seen.notify_one();
                    let (status, body) = match hello_mode {
                        HelloMode::Complete | HelloMode::StallBody => (
                            200,
                            br#"{"owner_token":"owner","default_pool_size":1}"#.as_slice(),
                        ),
                        HelloMode::Auth => (401, b"{}".as_slice()),
                        HelloMode::Superseded => {
                            (409, br#"{"reason":"hello-superseded"}"#.as_slice())
                        }
                    };
                    let response = http::Response::builder().status(status).body(()).unwrap();
                    let mut body_stream = respond.send_response(response, false).unwrap();
                    if matches!(hello_mode, HelloMode::StallBody) {
                        pending_bodies.push(body_stream);
                    } else {
                        body_stream
                            .send_data(Bytes::copy_from_slice(body), true)
                            .unwrap();
                    }
                }
                PATH_INTAKE => {
                    signals_for_server.intakes.fetch_add(1, Ordering::SeqCst);
                    pending_responses.push(respond);
                }
                _ => {
                    signals_for_server.responses.fetch_add(1, Ordering::SeqCst);
                    let response = http::Response::builder().status(200).body(()).unwrap();
                    respond.send_response(response, true).unwrap();
                }
            }
        }
        drop((pending_responses, pending_bodies));
    });

    signals
        .tasks
        .lock()
        .unwrap()
        .extend([client_to_server, server_to_client, server]);

    start_h2_connection(
        client_io, deadline, timings, stopped, force_down, superseded,
    )
    .await
}

#[derive(Clone)]
struct StatusRecorder {
    seen: Arc<StdMutex<Vec<String>>>,
    changed: watch::Sender<usize>,
}

impl StatusRecorder {
    fn new() -> Self {
        Self {
            seen: Arc::new(StdMutex::new(Vec::new())),
            changed: watch::channel(0).0,
        }
    }

    fn callback(&self) -> StatusCallback {
        let recorder = self.clone();
        Box::new(move |status| recorder.push(status))
    }

    fn push(&self, status: &str) {
        let count = {
            let mut seen = self.seen.lock().unwrap();
            seen.push(status.to_string());
            seen.len()
        };
        let _ = self.changed.send(count);
    }

    async fn wait_count(&self, status: &str, count: usize) {
        let mut changed = self.changed.subscribe();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if self
                    .seen
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|value| value.as_str() == status)
                    .count()
                    >= count
                {
                    return;
                }
                changed.changed().await.unwrap();
            }
        })
        .await
        .expect("status transition timed out");
    }

    fn snapshot(&self) -> Vec<String> {
        self.seen.lock().unwrap().clone()
    }
}

fn assert_ordered_subsequence(actual: &[String], expected: &[&str]) {
    let mut next = 0;
    for status in actual {
        if next < expected.len() && status == expected[next] {
            next += 1;
        }
    }
    assert_eq!(
        next,
        expected.len(),
        "missing ordered subsequence {expected:?} in {actual:?}"
    );
}

fn build_runtime(
    script: &ScriptedConnector,
    recorder: &StatusRecorder,
    timings: RuntimeTimings,
) -> TunnelRuntime {
    let mut config = cfg();
    config.on_status = Some(recorder.callback());
    let mut runtime = TunnelRuntime::new(config);
    runtime.timings = timings;
    runtime.test_hooks.connector = Some(script.hook());
    runtime.test_hooks.random = Some(Arc::new(|| 0.5));
    runtime
}

#[test]
fn public_url_shape() {
    let runtime = TunnelRuntime::new(cfg());
    assert_eq!(runtime.public_url(), "https://agent.example.com");
    assert_eq!(runtime.url(PATH_HELLO), "https://example.com/_system/hello");
}

#[test]
fn error_and_takeover_classification() {
    assert!(is_auth_error(&tunnel_auth_error("nope")));
    assert!(is_owner_token_invalid(&owner_token_invalid("x")));
    assert!(is_superseded_error(&superseded_error("x")));
    assert!(superseded_error("x").is_tunnel_superseded());
    assert!(!is_superseded_error(&transient("x")));
    let takeover = h2::Error::from(h2::Reason::from(SUPERSEDED_GOAWAY_ERROR_CODE));
    assert!(is_superseded_goaway(&takeover));
    assert!(!is_superseded_goaway(&h2::Error::from(
        h2::Reason::NO_ERROR
    )));
}

#[tokio::test]
async fn immediate_stop_is_persistent() {
    let recorder = StatusRecorder::new();
    let mut config = cfg();
    config.on_status = Some(recorder.callback());
    let runtime = Arc::new(TunnelRuntime::new(config));
    runtime.aclose().await;
    assert!(runtime.serve_forever().await.is_ok());
    assert_eq!(recorder.snapshot(), ["closed"]);
}

#[tokio::test]
async fn aclose_without_serve_publishes_closed() {
    let handle = TunnelStatusHandle::new();
    let mut config = cfg();
    config.on_status = Some(handle.callback());
    let runtime = TunnelRuntime::new(config);

    runtime.aclose().await;

    assert_eq!(handle.status(), LocalTunnelStatus::Closed);
}

#[tokio::test]
async fn aclose_does_not_overwrite_superseded() {
    let recorder = StatusRecorder::new();
    let mut config = cfg();
    config.on_status = Some(recorder.callback());
    let runtime = TunnelRuntime::new(config);
    runtime.notify_status("superseded");

    runtime.aclose().await;

    assert_eq!(recorder.snapshot(), ["superseded"]);
}

#[tokio::test]
async fn connect_timeout_retries_and_shutdown_interrupts_backoff() {
    let script = ScriptedConnector::new([
        ConnectAction::H2Hang(Arc::new(Notify::new())),
        ConnectAction::Hang,
    ]);
    let recorder = StatusRecorder::new();
    let runtime = Arc::new(build_runtime(&script, &recorder, fast_timings()));
    let serving = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.serve_forever().await }
    });

    recorder.wait_count("reconnecting", 1).await;
    runtime.aclose().await;
    assert!(tokio::time::timeout(Duration::from_secs(1), serving)
        .await
        .unwrap()
        .unwrap()
        .is_ok());
    assert_eq!(recorder.snapshot().last().unwrap(), "closed");
}

async fn assert_shutdown_interrupts_connect(action: ConnectAction) {
    let script = ScriptedConnector::new([action]);
    let recorder = StatusRecorder::new();
    let mut timings = fast_timings();
    timings.connect = Duration::from_secs(5);
    let runtime = Arc::new(build_runtime(&script, &recorder, timings));
    let serving = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.serve_forever().await }
    });
    tokio::time::timeout(Duration::from_secs(1), async {
        while script.attempts.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();

    runtime.aclose().await;
    assert!(tokio::time::timeout(Duration::from_secs(1), serving)
        .await
        .unwrap()
        .unwrap()
        .is_ok());
    let statuses = recorder.snapshot();
    assert!(
        !statuses.contains(&"reconnecting".to_string()),
        "unexpected statuses: {statuses:?}"
    );
}

#[tokio::test]
async fn shutdown_interrupts_stalled_connect_boundary() {
    assert_shutdown_interrupts_connect(ConnectAction::Hang).await;
}

#[tokio::test]
async fn shutdown_interrupts_h2_handshake() {
    let entered = Arc::new(Notify::new());
    let script = ScriptedConnector::new([ConnectAction::H2Hang(entered.clone())]);
    let recorder = StatusRecorder::new();
    let mut timings = fast_timings();
    timings.connect = Duration::from_secs(5);
    let runtime = Arc::new(build_runtime(&script, &recorder, timings));
    let serving = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.serve_forever().await }
    });

    entered.notified().await;
    runtime.aclose().await;
    assert!(tokio::time::timeout(Duration::from_secs(1), serving)
        .await
        .unwrap()
        .unwrap()
        .is_ok());
    assert!(!recorder.snapshot().contains(&"reconnecting".to_string()));
}

#[tokio::test]
async fn stop_before_backoff_registration_is_not_lost() {
    let script = ScriptedConnector::new([ConnectAction::Fail, ConnectAction::Hang]);
    let recorder = StatusRecorder::new();
    let mut runtime = build_runtime(&script, &recorder, fast_timings());
    let stop = runtime.stop.clone();
    let stopped = runtime.stopped.clone();
    let callback_recorder = recorder.clone();
    runtime.cfg.on_status = Some(Box::new(move |status| {
        callback_recorder.push(status);
        if status == "reconnecting" {
            stopped.store(true, Ordering::SeqCst);
            stop.send_replace(true);
        }
    }));

    Arc::new(runtime).serve_forever().await.unwrap();

    assert_eq!(script.attempts.load(Ordering::SeqCst), 1);
    assert_eq!(recorder.snapshot().last().unwrap(), "closed");
}

#[tokio::test]
async fn connected_follows_intake_worker_start() {
    let signals = PeerSignals::new();
    let script =
        ScriptedConnector::new([ConnectAction::Peer(HelloMode::Complete, signals.clone())]);
    let recorder = StatusRecorder::new();
    let intake_started = Arc::new(AtomicU64::new(0));
    let started_when_connected = Arc::new(AtomicU64::new(0));
    let mut runtime = build_runtime(&script, &recorder, fast_timings());
    runtime.test_hooks.intake_started = Some(intake_started.clone());
    let callback_recorder = recorder.clone();
    let started_for_callback = intake_started.clone();
    let observed = started_when_connected.clone();
    runtime.cfg.on_status = Some(Box::new(move |status| {
        callback_recorder.push(status);
        if status == "connected" {
            observed.store(
                started_for_callback.load(Ordering::SeqCst),
                Ordering::SeqCst,
            );
        }
    }));
    let runtime = Arc::new(runtime);
    let serving = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.serve_forever().await }
    });

    recorder.wait_count("connected", 1).await;
    assert_eq!(started_when_connected.load(Ordering::SeqCst), 1);

    runtime.aclose().await;
    serving.await.unwrap().unwrap();
    signals.abort_tasks();
}

#[tokio::test]
async fn shutdown_interrupts_stalled_hello() {
    let signals = PeerSignals::new();
    let script =
        ScriptedConnector::new([ConnectAction::Peer(HelloMode::StallBody, signals.clone())]);
    let recorder = StatusRecorder::new();
    let mut timings = fast_timings();
    timings.hello = Duration::from_secs(5);
    let runtime = Arc::new(build_runtime(&script, &recorder, timings));
    let serving = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.serve_forever().await }
    });

    signals.hello_seen.notified().await;
    runtime.aclose().await;
    assert!(tokio::time::timeout(Duration::from_secs(1), serving)
        .await
        .unwrap()
        .unwrap()
        .is_ok());
    assert!(!recorder.snapshot().contains(&"reconnecting".to_string()));
    signals.abort_tasks();
}

#[tokio::test]
async fn hello_body_timeout_enters_reconnecting() {
    let signals = PeerSignals::new();
    let script = ScriptedConnector::new([
        ConnectAction::Peer(HelloMode::StallBody, signals.clone()),
        ConnectAction::Hang,
    ]);
    let recorder = StatusRecorder::new();
    let runtime = Arc::new(build_runtime(&script, &recorder, fast_timings()));
    let serving = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.serve_forever().await }
    });

    recorder.wait_count("reconnecting", 1).await;
    runtime.aclose().await;
    serving.await.unwrap().unwrap();
    assert!(!recorder.snapshot().contains(&"connected".to_string()));
    signals.abort_tasks();
}

#[tokio::test]
async fn reconnecting_precedes_bounded_teardown_and_is_not_duplicated() {
    let signals = PeerSignals::new();
    let script = ScriptedConnector::new([
        ConnectAction::PeerSlowTeardown(signals.clone()),
        ConnectAction::Hang,
    ]);
    let recorder = StatusRecorder::new();
    let mut timings = fast_timings();
    timings.teardown = Duration::from_millis(200);
    let runtime = Arc::new(build_runtime(&script, &recorder, timings));
    let serving = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.serve_forever().await }
    });

    recorder.wait_count("connected", 1).await;
    recorder.wait_count("reconnecting", 1).await;
    assert_eq!(
        recorder
            .snapshot()
            .iter()
            .filter(|status| status.as_str() == "reconnecting")
            .count(),
        1
    );

    runtime.aclose().await;
    tokio::time::timeout(Duration::from_secs(1), serving)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    signals.abort_tasks();
}

#[tokio::test]
async fn ping_timeout_forces_reconnect_before_another_interval() {
    let first = PeerSignals::new();
    let second = PeerSignals::new();
    let script = ScriptedConnector::new([
        ConnectAction::Peer(HelloMode::Complete, first.clone()),
        ConnectAction::Peer(HelloMode::Complete, second.clone()),
    ]);
    let recorder = StatusRecorder::new();
    let mut timings = fast_timings();
    timings.ping_interval = Duration::from_millis(200);
    timings.ping_ack = Duration::from_millis(100);
    let runtime = Arc::new(build_runtime(&script, &recorder, timings));
    let serving = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.serve_forever().await }
    });

    recorder.wait_count("connected", 1).await;
    first.stop_forwarding();
    recorder.wait_count("reconnecting", 1).await;
    recorder.wait_count("connected", 2).await;

    runtime.aclose().await;
    serving.await.unwrap().unwrap();
    assert_ordered_subsequence(
        &recorder.snapshot(),
        &[
            "connecting",
            "connected",
            "reconnecting",
            "connected",
            "closed",
        ],
    );
    first.abort_tasks();
    second.abort_tasks();
}

#[tokio::test]
async fn three_failures_recover_and_success_resets_backoff() {
    let first = PeerSignals::new();
    let second = PeerSignals::new();
    let script = ScriptedConnector::new([
        ConnectAction::Fail,
        ConnectAction::Fail,
        ConnectAction::Fail,
        ConnectAction::Peer(HelloMode::Complete, first.clone()),
        ConnectAction::Fail,
        ConnectAction::Peer(HelloMode::Complete, second.clone()),
    ]);
    let recorder = StatusRecorder::new();
    let sleeps = Arc::new(StdMutex::new(Vec::new()));
    let mut runtime = build_runtime(&script, &recorder, fast_timings());
    let sleeps_for_hook = sleeps.clone();
    runtime.test_hooks.sleeper = Some(Arc::new(move |duration| {
        sleeps_for_hook.lock().unwrap().push(duration);
        Box::pin(async { tokio::task::yield_now().await })
    }));
    let runtime = Arc::new(runtime);
    let serving = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.serve_forever().await }
    });

    recorder.wait_count("connected", 1).await;
    first.stop_forwarding();
    recorder.wait_count("connected", 2).await;
    runtime.aclose().await;
    serving.await.unwrap().unwrap();

    let requested = sleeps.lock().unwrap().clone();
    assert_eq!(
        requested[0..3],
        [
            Duration::from_millis(100),
            Duration::from_millis(200),
            Duration::from_millis(400),
        ]
    );
    assert_eq!(requested[3], Duration::from_millis(100));
    assert_eq!(requested[4], Duration::from_millis(200));
    assert_eq!(
        recorder
            .snapshot()
            .iter()
            .filter(|s| *s == "connected")
            .count(),
        2
    );
    first.abort_tasks();
    second.abort_tasks();
}

#[tokio::test]
async fn callback_panic_does_not_prevent_recovery() {
    let signals = PeerSignals::new();
    let script = ScriptedConnector::new([
        ConnectAction::Fail,
        ConnectAction::Peer(HelloMode::Complete, signals.clone()),
    ]);
    let recorder = StatusRecorder::new();
    let mut runtime = build_runtime(&script, &recorder, fast_timings());
    let callback_recorder = recorder.clone();
    runtime.cfg.on_status = Some(Box::new(move |status| {
        callback_recorder.push(status);
        if status == "reconnecting" {
            panic!("monitor failed for reconnecting");
        }
    }));
    runtime.test_hooks.sleeper = Some(Arc::new(|_| Box::pin(async {})));
    let runtime = Arc::new(runtime);
    let serving = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.serve_forever().await }
    });

    recorder.wait_count("connected", 1).await;
    runtime.aclose().await;
    serving.await.unwrap().unwrap();
    signals.abort_tasks();
}

#[test]
fn callback_panic_log_names_the_status() {
    let _ = log::set_logger(&TEST_LOGGER);
    log::set_max_level(log::LevelFilter::Trace);
    TEST_LOGGER.messages.lock().unwrap().clear();
    let mut config = cfg();
    config.on_status = Some(Box::new(|_| panic!("monitor failed")));
    let runtime = TunnelRuntime::new(config);

    runtime.notify_status("reconnecting");

    assert!(TEST_LOGGER
        .messages
        .lock()
        .unwrap()
        .iter()
        .any(|message| message.contains("status reconnecting")));
}

#[test]
fn status_callbacks_are_edge_triggered() {
    let recorder = StatusRecorder::new();
    let mut config = cfg();
    let callback_recorder = recorder.clone();
    config.on_status = Some(Box::new(move |status| callback_recorder.push(status)));
    let runtime = TunnelRuntime::new(config);

    runtime.notify_status("connecting");
    runtime.notify_status("connecting");
    runtime.notify_status("reconnecting");
    runtime.notify_status("reconnecting");
    runtime.notify_status("connected");

    assert_eq!(
        recorder.snapshot(),
        vec!["connecting", "reconnecting", "connected"]
    );
}

#[tokio::test]
async fn terminal_status_matches_status_handle() {
    for (mode, expected) in [
        (HelloMode::Auth, LocalTunnelStatus::Closed),
        (HelloMode::Superseded, LocalTunnelStatus::Superseded),
    ] {
        let signals = PeerSignals::new();
        let script = ScriptedConnector::new([ConnectAction::Peer(mode, signals.clone())]);
        let handle = TunnelStatusHandle::new();
        let mut runtime = TunnelRuntime::new(cfg());
        runtime.timings = fast_timings();
        runtime.test_hooks.connector = Some(script.hook());
        runtime.cfg.on_status = Some(handle.callback());
        let result = Arc::new(runtime).serve_forever().await;

        assert!(result.is_err());
        assert_eq!(handle.status(), expected);
        assert!(!handle.is_connected());
        signals.abort_tasks();
    }
}

#[tokio::test]
async fn completed_dispatch_tasks_are_pruned_without_losing_teardown_ownership() {
    let tasks = Arc::new(StdMutex::new(Vec::new()));
    let completed = Arc::new(AtomicUsize::new(0));

    for _ in 0..1_000 {
        let completed = completed.clone();
        let handle = tokio::spawn(async move {
            completed.fetch_add(1, Ordering::SeqCst);
        });
        while !handle.is_finished() {
            tokio::task::yield_now().await;
        }
        push_dispatch_task(tasks.as_ref(), OwnedTask::new("request dispatch", handle)).await;
        assert!(tasks.lock().unwrap().len() <= 1);
    }
    assert_eq!(completed.load(Ordering::SeqCst), 1_000);

    let pending_dropped = Arc::new(AtomicBool::new(false));
    let pending = pending_task(pending_dropped.clone());
    tokio::task::yield_now().await;
    push_dispatch_task(tasks.as_ref(), OwnedTask::new("request dispatch", pending)).await;
    assert_eq!(tasks.lock().unwrap().len(), 1);

    let mut remaining = std::mem::take(&mut *tasks.lock().unwrap());
    shutdown_owned_tasks(&mut remaining, Duration::from_secs(1)).await;
    assert!(remaining.is_empty());
    assert!(pending_dropped.load(Ordering::SeqCst));
}

#[tokio::test]
async fn stale_generation_response_is_rejected_before_send() {
    let signals = PeerSignals::new();
    let timings = fast_timings();
    let runtime = TunnelRuntime::new(cfg());
    let force_down = Arc::new(Notify::new());
    let superseded = Arc::new(AtomicBool::new(false));
    let OpenConnection {
        send,
        closed: _closed,
        mut tasks,
    } = open_loopback_peer(
        Instant::now() + Duration::from_secs(1),
        timings,
        runtime.stopped.clone(),
        force_down,
        superseded,
        HelloMode::Complete,
        signals.clone(),
    )
    .await
    .unwrap();
    let mut active = runtime.send_hello(send).await.unwrap();
    active.generation = 1;
    runtime.generation.store(2, Ordering::SeqCst);

    let err = runtime
        .post_response(&active, "request-1", 200, &[], None, Vec::new())
        .await
        .unwrap_err();

    assert!(
        matches!(err, InkboxError::Tunnel(message) if message.contains("closed tunnel connection"))
    );
    assert_eq!(signals.responses.load(Ordering::SeqCst), 0);
    let pending = tasks.shutdown(Duration::from_secs(1)).await;
    assert!(pending.is_empty());
    signals.abort_tasks();
}

struct DropSignal(Arc<AtomicBool>);

impl Drop for DropSignal {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

fn pending_task(dropped: Arc<AtomicBool>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let _signal = DropSignal(dropped);
        pending::<()>().await;
    })
}

#[tokio::test]
async fn connection_task_shutdown_aborts_and_joins_driver_and_ping() {
    let driver_dropped = Arc::new(AtomicBool::new(false));
    let ping_dropped = Arc::new(AtomicBool::new(false));
    let mut tasks = ConnectionTasks {
        driver: Some(pending_task(driver_dropped.clone())),
        ping: Some(pending_task(ping_dropped.clone())),
    };
    tokio::task::yield_now().await;

    let pending = tasks.shutdown(Duration::from_millis(50)).await;

    assert!(pending.is_empty());
    assert!(driver_dropped.load(Ordering::SeqCst));
    assert!(ping_dropped.load(Ordering::SeqCst));
    assert!(tasks.driver.is_none());
    assert!(tasks.ping.is_none());
}

#[tokio::test]
async fn unfinished_task_remains_owned_after_bounded_teardown() {
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let handle = tokio::task::spawn_blocking(move || {
        started_tx.send(()).unwrap();
        std::thread::sleep(Duration::from_millis(80));
    });
    started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
    let mut tasks = vec![OwnedTask::new("blocking test task", handle)];

    shutdown_owned_tasks(&mut tasks, Duration::from_millis(5)).await;

    assert_eq!(tasks.len(), 1);
    let runtime = TunnelRuntime::new(cfg());
    runtime.retain_tasks(&mut tasks);
    assert!(tasks.is_empty());
    assert_eq!(runtime.lingering().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn connection_phase_deadline_is_shared() {
    let started = Instant::now();
    let deadline = started + CONNECT_TIMEOUT;
    with_phase_timeout(deadline, "tcp", async {
        tokio::time::sleep(Duration::from_secs(7)).await;
        Ok(())
    })
    .await
    .unwrap();
    let err = with_phase_timeout(deadline, "tls", async {
        tokio::time::sleep(Duration::from_secs(4)).await;
        Ok(())
    })
    .await
    .unwrap_err();

    assert_eq!(Instant::now() - started, CONNECT_TIMEOUT);
    assert_eq!(timeout_phase(&err), Some("tls"));
}
