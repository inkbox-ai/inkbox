use std::collections::VecDeque;
use std::future::pending;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant as StdInstant};

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
    tasks: StdMutex<Vec<JoinHandle<()>>>,
}

impl PeerSignals {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            forward_to_client: AtomicBool::new(true),
            hello_seen: Notify::new(),
            intakes: AtomicUsize::new(0),
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
    let runtime = Arc::new(TunnelRuntime::new(cfg()));
    runtime.aclose().await;
    assert!(runtime.serve_forever().await.is_ok());
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
    let started = StdInstant::now();
    runtime.aclose().await;
    assert!(tokio::time::timeout(Duration::from_millis(100), serving)
        .await
        .unwrap()
        .unwrap()
        .is_ok());
    assert!(started.elapsed() < Duration::from_millis(100));
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

    let started = StdInstant::now();
    runtime.aclose().await;
    assert!(tokio::time::timeout(Duration::from_millis(100), serving)
        .await
        .unwrap()
        .unwrap()
        .is_ok());
    assert!(started.elapsed() < Duration::from_millis(100));
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
    let started = StdInstant::now();
    runtime.aclose().await;
    assert!(tokio::time::timeout(Duration::from_millis(100), serving)
        .await
        .unwrap()
        .unwrap()
        .is_ok());
    assert!(started.elapsed() < Duration::from_millis(100));
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

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn intake_runs_while_connected_callback_is_blocked() {
    let signals = PeerSignals::new();
    let script =
        ScriptedConnector::new([ConnectAction::Peer(HelloMode::Complete, signals.clone())]);
    let recorder = StatusRecorder::new();
    let callback_finished = Arc::new(AtomicBool::new(false));
    let mut runtime = build_runtime(&script, &recorder, fast_timings());
    let callback_recorder = recorder.clone();
    let callback_finished_inner = callback_finished.clone();
    runtime.cfg.on_status = Some(Box::new(move |status| {
        callback_recorder.push(status);
        if status == "connected" {
            std::thread::sleep(Duration::from_millis(200));
            callback_finished_inner.store(true, Ordering::SeqCst);
        }
    }));
    let runtime = Arc::new(runtime);
    let serving = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.serve_forever().await }
    });

    recorder.wait_count("connected", 1).await;
    tokio::time::timeout(Duration::from_millis(100), async {
        while signals.intakes.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("intake did not start while callback was blocked");
    assert!(!callback_finished.load(Ordering::SeqCst));

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
    let started = StdInstant::now();
    runtime.aclose().await;
    assert!(tokio::time::timeout(Duration::from_millis(150), serving)
        .await
        .unwrap()
        .unwrap()
        .is_ok());
    assert!(started.elapsed() < Duration::from_millis(150));
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
    let started = StdInstant::now();
    recorder.wait_count("reconnecting", 1).await;
    assert!(started.elapsed() < Duration::from_millis(100));
    assert_eq!(
        recorder
            .snapshot()
            .iter()
            .filter(|status| status.as_str() == "reconnecting")
            .count(),
        1
    );

    runtime.aclose().await;
    tokio::time::timeout(Duration::from_millis(500), serving)
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
    timings.ping_ack = Duration::from_millis(30);
    let runtime = Arc::new(build_runtime(&script, &recorder, timings));
    let serving = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.serve_forever().await }
    });

    recorder.wait_count("connected", 1).await;
    first.stop_forwarding();
    let started = StdInstant::now();
    recorder.wait_count("reconnecting", 1).await;
    assert!(started.elapsed() < Duration::from_millis(320));
    recorder.wait_count("connected", 2).await;

    runtime.aclose().await;
    serving.await.unwrap().unwrap();
    assert_eq!(
        recorder.snapshot(),
        [
            "connecting",
            "connected",
            "reconnecting",
            "connected",
            "closed",
        ]
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
