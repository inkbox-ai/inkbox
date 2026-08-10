from __future__ import annotations

import asyncio
import logging
import signal
import time
from datetime import datetime, timezone
from typing import Callable
from unittest.mock import MagicMock
from uuid import uuid4

import h2.events
import pytest

from inkbox.tunnels.client._bootstrap import TunnelBundle
from inkbox.tunnels.client._listener import TunnelListener
from inkbox.tunnels.client._runtime import (
    _DISPATCH_GENERATION,
    StatusCallback,
    TunnelRuntime,
    TunnelRuntimeStatus,
    _ConnectTimeoutError,
    _Connection,
    _HelloTimeoutError,
    _StreamEvent,
    _TunnelAuthError,
)
from inkbox.tunnels.types import TLSMode, Tunnel, TunnelStatus


def _runtime(**kwargs: object) -> TunnelRuntime:
    options: dict[str, object] = {
        "tunnel_id": uuid4(),
        "api_key": "ApiKey_test",
        "zone": "tunnel.example",
        "public_host": "agent.tunnel.example",
        "pool_size": 1,
        "forward_to": "http://127.0.0.1:1",
        "tls_terminator": None,
    }
    options.update(kwargs)
    return TunnelRuntime(**options)  # type: ignore[arg-type]


class ScriptedReader:
    def __init__(self, *results: bytes | BaseException) -> None:
        self._results = list(results)
        self._blocked = asyncio.Event()

    async def read(self, _size: int = -1) -> bytes:
        if not self._results:
            await self._blocked.wait()
            return b""
        result = self._results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result


class AbortableWriter:
    def __init__(self, on_abort=None, *, hang_close: bool = False) -> None:
        self.writes: list[bytes] = []
        self.close_calls = 0
        self.abort_calls = 0
        self._on_abort = on_abort
        self._hang_close = hang_close
        self.transport = self

    def write(self, data: bytes) -> None:
        self.writes.append(data)

    async def drain(self) -> None:
        return None

    def close(self) -> None:
        self.close_calls += 1

    async def wait_closed(self) -> None:
        if self._hang_close:
            await asyncio.Event().wait()

    def abort(self) -> None:
        self.abort_calls += 1
        if self._on_abort is not None:
            self._on_abort()

    def get_extra_info(self, _name: str):
        return None


class MinimalH2:
    max_outbound_frame_size = 16384
    outbound_flow_control_window = 65535

    def __init__(self, *, stream_window: int = 65535) -> None:
        self.stream_window = stream_window
        self.pings: list[bytes] = []
        self.sent_headers: list[int] = []
        self._next_stream = 1

    def data_to_send(self) -> bytes:
        return b""

    def receive_data(self, _chunk: bytes) -> list[object]:
        return []

    def get_next_available_stream_id(self) -> int:
        stream_id = self._next_stream
        self._next_stream += 2
        return stream_id

    def send_headers(self, stream_id: int, _headers, *, end_stream: bool) -> None:
        self.sent_headers.append(stream_id)

    def local_flow_control_window(self, _stream_id: int) -> int:
        return self.stream_window

    def send_data(self, _stream_id: int, _data: bytes, *, end_stream: bool) -> None:
        return None

    def ping(self, payload: bytes) -> None:
        self.pings.append(payload)


def _connection(conn_id: int = 1) -> _Connection:
    conn = _Connection(conn_id)
    conn.h2 = MinimalH2()  # type: ignore[assignment]
    conn.reader = ScriptedReader()
    conn.writer = AbortableWriter()  # type: ignore[assignment]
    return conn


@pytest.mark.asyncio
async def test_force_reconnect_aborts_after_publishing_closed() -> None:
    runtime = _runtime()
    conn = _connection()
    observed: list[bool] = []
    writer = AbortableWriter(lambda: observed.append(conn.closed.is_set()))
    conn.writer = writer  # type: ignore[assignment]

    runtime._force_reconnect_conn(conn)
    runtime._force_reconnect_conn(conn)

    assert observed == [True]
    assert writer.abort_calls == 1
    assert conn.closed.is_set()


def test_force_reconnect_falls_back_to_writer_close() -> None:
    runtime = _runtime()
    conn = _connection()
    writer = MagicMock(spec=["close"])
    conn.writer = writer

    runtime._force_reconnect_conn(conn)

    writer.close.assert_called_once_with()


@pytest.mark.asyncio
async def test_read_eof_is_durable_for_late_waiter() -> None:
    runtime = _runtime()
    conn = _connection()
    conn.reader = ScriptedReader(b"")

    await runtime._read_loop(conn)
    conn.streams[1] = asyncio.Queue()

    status, body = await asyncio.wait_for(
        runtime._await_response(1, conn), timeout=0.1,
    )
    assert (status, body) == (0, b"")


@pytest.mark.asyncio
async def test_queued_response_wins_over_connection_close() -> None:
    runtime = _runtime()
    conn = _connection()
    queue: asyncio.Queue[_StreamEvent] = asyncio.Queue()
    conn.streams[1] = queue
    queue.put_nowait(_StreamEvent("headers", headers=[(":status", "204")]))
    queue.put_nowait(_StreamEvent("end"))
    runtime._publish_connection_closed(conn)

    assert await runtime._await_response(1, conn) == (204, b"")


@pytest.mark.asyncio
async def test_closed_connection_releases_flow_control_waiter() -> None:
    runtime = _runtime()
    conn = _connection()
    conn.h2 = MinimalH2(stream_window=0)  # type: ignore[assignment]
    send = asyncio.create_task(runtime._send_data(1, b"x", end_stream=True, conn=conn))
    await asyncio.sleep(0)

    runtime._publish_connection_closed(conn)

    with pytest.raises(ConnectionError):
        await asyncio.wait_for(send, timeout=0.1)


@pytest.mark.asyncio
async def test_cold_and_planned_bridge_close_codes() -> None:
    runtime = _runtime()

    cold = _connection(1)
    cold.bridge_stream_ids.add(3)
    cold.streams[3] = asyncio.Queue()
    runtime._publish_connection_closed(cold)
    cold_event = await runtime._next_stream_event(cold, 3, cold.streams[3])

    planned = _connection(2)
    planned.bridge_stream_ids.add(5)
    planned.streams[5] = asyncio.Queue()
    planned.streams[5].put_nowait(_StreamEvent("reset", reset_code=4500))
    runtime._publish_connection_closed(planned, bridge_close_code=4500)
    planned_event = await runtime._next_stream_event(planned, 5, planned.streams[5])

    assert cold_event.reset_code == 1011
    assert planned_event.reset_code == 4500


@pytest.mark.asyncio
async def test_cold_callable_bridge_returns_1011() -> None:
    runtime = _runtime()
    conn = _connection()
    stream_id = 3
    conn.bridge_stream_ids.add(stream_id)
    conn.streams[stream_id] = asyncio.Queue()

    class Session:
        async def outbound(self):
            if False:
                yield None

        async def deliver(self, _message) -> None:
            return None

        def signal_outbound_eof(self) -> None:
            return None

    runtime._publish_connection_closed(conn)

    close_code = await asyncio.wait_for(
        runtime._pump_ws(stream_id, Session(), conn),  # type: ignore[arg-type]
        timeout=0.1,
    )

    assert close_code == 1011


@pytest.mark.asyncio
async def test_hello_timeout_removes_stream_and_aborts(monkeypatch) -> None:
    import inkbox.tunnels.client._runtime as runtime_module

    runtime = _runtime()
    conn = _connection()
    runtime._active = conn
    candidates: list[_Connection] = []

    async def open_connection(candidate: _Connection) -> None:
        candidates.append(candidate)
        candidate.h2 = conn.h2
        candidate.reader = conn.reader
        candidate.writer = conn.writer

    monkeypatch.setattr(runtime, "_open_connection", open_connection)
    monkeypatch.setattr(runtime_module, "HELLO_TIMEOUT_SEC", 0.02)

    with pytest.raises(_HelloTimeoutError):
        await asyncio.wait_for(runtime._run_once(), timeout=0.2)

    assert conn.writer.abort_calls == 1  # type: ignore[union-attr]
    assert candidates[0].streams == {}
    assert candidates[0].closed.is_set()
    assert runtime._active is None


@pytest.mark.asyncio
async def test_connect_timeout_is_bounded_and_cleans_active(monkeypatch) -> None:
    import inkbox.tunnels.client._runtime as runtime_module

    runtime = _runtime()

    async def stalled_open(_candidate: _Connection) -> None:
        await asyncio.Event().wait()

    monkeypatch.setattr(runtime, "_open_connection", stalled_open)
    monkeypatch.setattr(runtime_module, "CONNECT_TIMEOUT_SEC", 0.02)

    with pytest.raises(_ConnectTimeoutError):
        await asyncio.wait_for(runtime._run_once(), timeout=0.1)

    assert runtime._active is None


@pytest.mark.asyncio
async def test_handoff_stalled_dial_respects_total_budget(monkeypatch) -> None:
    import inkbox.tunnels.client._runtime as runtime_module

    runtime = _runtime()

    async def stalled_open(_conn: _Connection) -> None:
        await asyncio.Event().wait()

    monkeypatch.setattr(runtime, "_open_connection", stalled_open)
    monkeypatch.setattr(runtime_module, "HANDOFF_REDIAL_BUDGET_SEC", 0.03)
    started = time.monotonic()

    with pytest.raises(RuntimeError, match="budget exhausted"):
        await asyncio.wait_for(runtime._make_replacement_connection(), timeout=0.2)

    assert time.monotonic() - started < 0.15


@pytest.mark.asyncio
async def test_auth_failure_during_handoff_is_terminal(monkeypatch) -> None:
    runtime = _runtime()
    initial_attempts = 0

    async def open_connection(_conn: _Connection) -> None:
        nonlocal initial_attempts
        initial_attempts += 1
        return None

    async def read_loop(conn: _Connection) -> None:
        await conn.closed.wait()

    async def hello(_conn: _Connection) -> None:
        return None

    async def replacement() -> _Connection:
        raise _TunnelAuthError("replacement API key rejected")

    async def wait_for_handoff(conn: _Connection) -> None:
        runtime._begin_handoff(conn, reason="drain")
        task = runtime._handoff_task
        assert task is not None
        await task

    monkeypatch.setattr(runtime, "_open_connection", open_connection)
    monkeypatch.setattr(runtime, "_read_loop", read_loop)
    monkeypatch.setattr(runtime, "_send_hello", hello)
    monkeypatch.setattr(runtime, "_start_serving", lambda _conn: None)
    monkeypatch.setattr(runtime, "_make_replacement_connection", replacement)
    monkeypatch.setattr(runtime, "_wait_close_or_handoff", wait_for_handoff)

    with pytest.raises(_TunnelAuthError, match="replacement API key rejected"):
        await asyncio.wait_for(runtime.serve_forever(), timeout=0.2)

    assert initial_attempts == 1
    assert runtime._handoff_terminal_error is not None
    assert runtime.status == "closed"


@pytest.mark.asyncio
async def test_ping_timeout_is_independent_of_next_interval(monkeypatch) -> None:
    import inkbox.tunnels.client._runtime as runtime_module

    runtime = _runtime()
    conn = _connection()
    runtime._active = conn
    monkeypatch.setattr(runtime_module, "PING_INTERVAL", 0.01)
    monkeypatch.setattr(runtime_module, "PING_ACK_TIMEOUT", 0.03)
    started = time.monotonic()

    await asyncio.wait_for(runtime._ping_loop(conn), timeout=0.1)

    assert conn.aborted
    assert 0.025 <= time.monotonic() - started < 0.09


@pytest.mark.asyncio
async def test_only_matching_ping_ack_releases_wait(monkeypatch) -> None:
    import inkbox.tunnels.client._runtime as runtime_module

    runtime = _runtime()
    conn = _connection()
    runtime._active = conn
    monkeypatch.setattr(runtime_module, "PING_INTERVAL", 0.01)
    monkeypatch.setattr(runtime_module, "PING_ACK_TIMEOUT", 0.08)
    task = asyncio.create_task(runtime._ping_loop(conn))
    while conn.outstanding_ping_payload is None:
        await asyncio.sleep(0)
    payload = conn.outstanding_ping_payload

    await runtime._handle_event(h2.events.PingAckReceived(ping_data=b"stale!!!"), conn)
    assert not conn.ping_acknowledged.is_set()
    await runtime._handle_event(h2.events.PingAckReceived(ping_data=payload), conn)
    assert conn.ping_acknowledged.is_set()

    runtime._stop.set()
    await asyncio.wait_for(task, timeout=0.1)
    assert not conn.aborted


@pytest.mark.asyncio
async def test_hanging_writer_close_is_bounded_and_aborted(monkeypatch) -> None:
    import inkbox.tunnels.client._runtime as runtime_module

    runtime = _runtime()
    conn = _connection()
    writer = AbortableWriter(hang_close=True)
    conn.writer = writer  # type: ignore[assignment]
    monkeypatch.setattr(runtime_module, "WRITER_CLOSE_TIMEOUT_SEC", 0.02)

    await asyncio.wait_for(runtime._close_connection_writer(conn), timeout=0.1)

    assert writer.close_calls == 1
    assert writer.abort_calls == 1


@pytest.mark.asyncio
async def test_cancellation_resistant_task_cannot_block_reconnect(monkeypatch) -> None:
    import inkbox.tunnels.client._runtime as runtime_module

    runtime = _runtime()
    conn = _connection()
    runtime._active = conn
    started = asyncio.Event()
    second_cancel = asyncio.Event()
    release = asyncio.Event()

    async def resistant_dispatch() -> None:
        cancellations = 0
        started.set()
        while not release.is_set():
            try:
                await release.wait()
            except asyncio.CancelledError:
                cancellations += 1
                if cancellations == 2:
                    second_cancel.set()

    task = runtime._spawn(resistant_dispatch())
    await started.wait()
    monkeypatch.setattr(runtime_module, "TASK_TEARDOWN_TIMEOUT_SEC", 0.01)

    await asyncio.wait_for(runtime._teardown_cold(conn), timeout=0.1)

    assert task in runtime._tasks
    assert not task.done()
    close_task = asyncio.create_task(runtime.aclose())
    await asyncio.wait_for(second_cancel.wait(), timeout=0.1)
    release.set()
    await asyncio.wait_for(close_task, timeout=0.1)
    assert task.done()


@pytest.mark.asyncio
async def test_stale_generation_cannot_post_to_replacement() -> None:
    runtime = _runtime()
    runtime._generation = 2
    opened: list[int] = []
    runtime._open_stream_locked = lambda *args, **kwargs: opened.append(1) or 1  # type: ignore[method-assign]
    token = _DISPATCH_GENERATION.set(1)
    try:
        await runtime._post_response("old", status=200, headers=[], body=b"")
    finally:
        _DISPATCH_GENERATION.reset(token)

    assert opened == []


@pytest.mark.asyncio
async def test_running_post_is_blocked_after_cold_teardown() -> None:
    runtime = _runtime()
    old = _connection(1)
    replacement = _connection(2)
    runtime._active = old
    runtime._handoff_in_flight = True
    release_handoff = asyncio.Event()

    async def handoff_wait() -> None:
        await release_handoff.wait()

    handoff_task = asyncio.create_task(handoff_wait())
    runtime._handoff_task = handoff_task
    opened: list[int] = []

    def open_stream(_headers, *, end_stream, conn=None):
        opened.append(conn.conn_id)
        conn.streams[1] = asyncio.Queue()
        conn.streams[1].put_nowait(_StreamEvent("end"))
        return 1

    runtime._open_stream_locked = open_stream  # type: ignore[method-assign]
    token = _DISPATCH_GENERATION.set(runtime._generation)
    try:
        post_task = asyncio.create_task(
            runtime._post_response("stale", status=200, headers=[], body=b""),
        )
    finally:
        _DISPATCH_GENERATION.reset(token)
    await asyncio.sleep(0)

    await runtime._teardown_cold(old)
    runtime._active = replacement
    release_handoff.set()
    await asyncio.wait_for(post_task, timeout=0.1)
    await handoff_task

    assert opened == []


@pytest.mark.asyncio
async def test_post_rechecks_generation_after_waiting_for_send_lock() -> None:
    runtime = _runtime()
    conn = _connection()
    runtime._active = conn
    opened: list[int] = []
    selected = asyncio.Event()
    original_pick = runtime._pick_reply_connection

    def pick(origin):
        result = original_pick(origin)
        selected.set()
        return result

    runtime._pick_reply_connection = pick  # type: ignore[method-assign]
    runtime._open_stream_locked = lambda *args, **kwargs: opened.append(1) or 1  # type: ignore[method-assign]
    await conn.send_lock.acquire()
    token = _DISPATCH_GENERATION.set(runtime._generation)
    try:
        post_task = asyncio.create_task(
            runtime._post_response("stale-lock", status=200, headers=[], body=b""),
        )
    finally:
        _DISPATCH_GENERATION.reset(token)
    await asyncio.wait_for(selected.wait(), timeout=0.1)

    runtime._generation += 1
    conn.send_lock.release()
    await asyncio.wait_for(post_task, timeout=0.1)

    assert opened == []


@pytest.mark.asyncio
async def test_reply_selection_rejects_closed_connections() -> None:
    runtime = _runtime()
    closed = _connection(1)
    fallback = _connection(2)
    runtime._active = closed
    runtime._publish_connection_closed(closed)

    assert runtime._pick_reply_connection(fallback) is fallback

    opened: list[int] = []
    runtime._open_stream_locked = lambda *args, **kwargs: opened.append(1) or 1  # type: ignore[method-assign]
    await runtime._post_response(
        "closed-target", status=200, headers=[], body=b"", target=closed,
    )
    assert opened == []


@pytest.mark.asyncio
async def test_child_tasks_inherit_cold_generation() -> None:
    runtime = _runtime()
    runtime._generation = 2

    async def sample_generation() -> int:
        return _DISPATCH_GENERATION.get()

    token = _DISPATCH_GENERATION.set(1)
    try:
        task = runtime._spawn(sample_generation())
        assert await task == 1
    finally:
        _DISPATCH_GENERATION.reset(token)


def _bundle() -> TunnelBundle:
    now = datetime.now(timezone.utc)
    return TunnelBundle(
        tunnel=Tunnel(
            id=uuid4(), organization_id="org", tunnel_name="agent",
            agent_identity_id=None, tls_mode=TLSMode.EDGE, cert_pem=None,
            cert_fingerprint_sha256=None, cert_expires_at=None,
            status=TunnelStatus.ACTIVE, last_connected_at=None,
            last_connected_ip_addr=None, last_disconnected_at=None,
            currently_connected=False, public_host="agent.tunnel.example",
            zone="tunnel.example", metadata={}, created_at=now, updated_at=now,
        ),
        public_host="agent.tunnel.example", zone="tunnel.example",
        tls_terminator=None,
    )


def test_listener_exposes_thread_safe_local_liveness() -> None:
    runtime = _runtime()
    listener = TunnelListener(bundle=_bundle(), runtime=runtime)

    assert listener.status == "idle"
    assert not listener.is_connected
    assert listener.last_connected_at is None

    runtime._record_connected(emit=True)
    first = listener.last_connected_at
    runtime._notify_status("reconnecting")

    assert first is not None and first.tzinfo == timezone.utc
    assert listener.status == "reconnecting"
    assert not listener.is_connected
    assert listener.last_connected_at == first

    runtime._record_connected(emit=False)
    assert listener.is_connected
    assert listener.last_connected_at is not None
    assert listener.last_connected_at >= first


def test_status_callback_uses_runtime_status_type() -> None:
    assert StatusCallback == Callable[[TunnelRuntimeStatus], None]


def test_sync_close_reports_runtime_thread_timeout() -> None:
    runtime = _runtime()
    listener = TunnelListener(bundle=_bundle(), runtime=runtime)
    thread = MagicMock()
    thread.is_alive.return_value = True
    listener._thread = thread

    with pytest.raises(TimeoutError, match="runtime thread"):
        listener.close()

    thread.join.assert_called_once_with(timeout=30.0)


def test_signal_handler_logs_thread_timeout_without_raising(caplog) -> None:
    runtime = _runtime()
    listener = TunnelListener(bundle=_bundle(), runtime=runtime)
    thread = MagicMock()
    thread.is_alive.return_value = True
    listener._thread = thread

    with caplog.at_level(logging.ERROR, logger="inkbox.tunnels"):
        listener._signal_handler(signal.SIGTERM, None)

    assert "runtime thread did not stop" in caplog.text
    assert listener.status == "idle"


def test_close_before_wait_stays_closed() -> None:
    runtime = _runtime()
    listener = TunnelListener(bundle=_bundle(), runtime=runtime)

    listener.close()

    assert listener.status == "closed"
    assert runtime._stop.is_set()


@pytest.mark.asyncio
async def test_superseded_status_survives_cleanup() -> None:
    runtime = _runtime()
    runtime._notify_status("superseded")

    await runtime.aclose()

    assert runtime.status == "superseded"


@pytest.mark.asyncio
async def test_explicit_aclose_is_idempotent() -> None:
    runtime = _runtime()
    conn = _connection()
    runtime._active = conn

    await runtime.aclose()
    await runtime.aclose()

    assert runtime.status == "closed"
    assert conn.closed.is_set()
