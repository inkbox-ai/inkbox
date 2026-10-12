from __future__ import annotations

import asyncio
import json
from functools import partial
from types import SimpleNamespace

import pytest

import inkbox.tunnels.client._runtime as runtime_module
from inkbox.tunnels.client._runtime import (
    MAX_RETRY_AFTER_SEC,
    _Connection,
    _StreamEvent,
    _TunnelAuthError,
    _parse_retry_after,
)
from inkbox.tunnels.exceptions import TunnelSupersededError
from test_tunnels_reconnect import AbortableWriter, MinimalH2, _runtime


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None), ("", None), ("not a date", None), ("-1", None),
        ("1.5", None), ("nan", None), ("inf", None), ("５", None),
        ("Wed, 21 Oct 2015 07:28:05", None),
        ("0", 0.0), (" 5 ", 5.0), ("0005", 5.0),
        ("9" * 400, MAX_RETRY_AFTER_SEC),
        ("Wed, 21 Oct 2015 07:28:05 GMT", 5.0),
        ("Wednesday, 21-Oct-15 07:28:05 GMT", 5.0),
        ("Wed Oct 21 07:28:05 2015", 5.0),
        ("Wed, 21 Oct 2015 07:27:00 GMT", 0.0),
        ("Wed, 21 Oct 2099 07:28:00 GMT", MAX_RETRY_AFTER_SEC),
    ],
)
def test_retry_after_formats_and_bounds(monkeypatch, value, expected):
    monkeypatch.setattr(runtime_module.time, "time", lambda: 1445412480.0)
    assert _parse_retry_after(value) == expected


def _transport(monkeypatch, runtime, responses):
    """Feed real hello parsing with stream events, without opening a socket."""
    attempts = []

    async def open_connection(conn):
        conn.h2 = MinimalH2()
        conn.writer = AbortableWriter()
        attempts.append(conn)

    async def read_loop(conn):
        await conn.closed.wait()

    async def flush(conn):
        status, retry_after = responses[len(attempts) - 1]
        headers = [(":status", str(status))]
        if retry_after is not None:
            headers.append(("retry-after", retry_after))
        body = {"reason": "hello-superseded"} if status == 409 else {"owner_token": "owner"}
        queue = conn.streams[max(conn.streams)]
        queue.put_nowait(_StreamEvent("headers", headers=headers))
        queue.put_nowait(_StreamEvent("data", data=json.dumps(body).encode()))
        queue.put_nowait(_StreamEvent("end"))

    monkeypatch.setattr(runtime, "_open_connection", open_connection)
    monkeypatch.setattr(runtime, "_read_loop", read_loop)
    monkeypatch.setattr(runtime, "_flush_conn", flush)
    monkeypatch.setattr(runtime, "_start_serving", lambda conn: None)
    return attempts


def _clock(monkeypatch, runtime):
    clock = SimpleNamespace(now=100.0)
    # Replace only the runtime's module reference, not asyncio's clock.
    monkeypatch.setattr(runtime_module, "time", SimpleNamespace(
        monotonic=lambda: clock.now, time=lambda: 1445412480.0,
    ))
    monkeypatch.setattr(runtime_module.random, "random", lambda: 0.5)
    delays = []

    async def sleep(delay):
        delays.append(delay)
        clock.now += delay
        await asyncio.sleep(0)

    monkeypatch.setattr(runtime, "_sleep_before_retry", sleep)
    return clock, delays


@pytest.mark.asyncio
@pytest.mark.parametrize("hint", ["5", "Wed, 21 Oct 2015 07:28:05 GMT"])
async def test_real_hello_503_handoff_honors_retry_after(monkeypatch, hint):
    runtime = _runtime()
    attempts = _transport(monkeypatch, runtime, [(503, hint), (200, None)])
    _clock_state, delays = _clock(monkeypatch, runtime)

    conn = await runtime._make_replacement_connection()
    assert len(attempts) == 2
    assert delays == [5.625]
    assert conn.owner_token == "owner"
    assert runtime._retry_not_before == 0.0
    runtime._active = conn
    await runtime.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("hint", [None, "invalid", "-1", "0"])
async def test_missing_or_invalid_hint_keeps_exponential_backoff(monkeypatch, hint):
    runtime = _runtime()
    _transport(monkeypatch, runtime, [(503, hint), (503, hint), (200, None)])
    _clock_state, delays = _clock(monkeypatch, runtime)
    runtime._active = await runtime._make_replacement_connection()
    assert delays == [0.1, 0.2]
    await runtime.aclose()


def _serve_then_drain(monkeypatch, runtime, attempts):
    def stop(conn):
        runtime._stop.set()
        runtime._publish_connection_closed(conn)

    def start(conn):
        loop = asyncio.get_running_loop()
        if len(attempts) == 1:
            loop.call_soon(partial(runtime._begin_handoff, conn, reason="drain"))
        else:
            loop.call_soon(stop, conn)

    monkeypatch.setattr(runtime, "_start_serving", start)


@pytest.mark.asyncio
async def test_hint_survives_handoff_budget_into_cold_retry(monkeypatch):
    statuses = []
    runtime = _runtime(on_status=statuses.append)
    attempts = _transport(monkeypatch, runtime, [(200, None), (503, "60"), (200, None)])
    _clock_state, delays = _clock(monkeypatch, runtime)
    _serve_then_drain(monkeypatch, runtime, attempts)

    await asyncio.wait_for(runtime.serve_forever(), timeout=0.5)
    assert len(attempts) == 3
    assert delays == [30.0, 30.0]
    assert statuses == ["connecting", "connected", "reconnecting", "connected", "closed"]


@pytest.mark.asyncio
async def test_planned_handoff_readiness_recovers_after_hello(monkeypatch):
    statuses = []
    runtime = _runtime(on_status=statuses.append)
    attempts = _transport(monkeypatch, runtime, [(200, None), (503, "5"), (200, None)])
    _clock_state, delays = _clock(monkeypatch, runtime)
    _serve_then_drain(monkeypatch, runtime, attempts)
    original_sleep = runtime._sleep_before_retry

    async def check_not_ready(delay):
        assert runtime.status == "reconnecting"
        assert not runtime.is_connected
        await original_sleep(delay)

    monkeypatch.setattr(runtime, "_sleep_before_retry", check_not_ready)
    await asyncio.wait_for(runtime.serve_forever(), timeout=0.5)
    assert delays == [5.625]
    assert statuses == ["connecting", "connected", "reconnecting", "connected", "closed"]


@pytest.mark.asyncio
@pytest.mark.parametrize("fraction", [0.0, 0.5, 0.999])
async def test_retry_after_jitter_never_shortens_server_floor(monkeypatch, fraction):
    runtime = _runtime()
    _transport(monkeypatch, runtime, [(503, "5"), (200, None)])
    _clock_state, delays = _clock(monkeypatch, runtime)
    monkeypatch.setattr(runtime_module.random, "random", lambda: fraction)
    runtime._active = await runtime._make_replacement_connection()
    assert delays[0] == pytest.approx(5 * (1 + 0.25 * fraction))
    assert 5 <= delays[0] <= 6.25
    await runtime.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 403, 409])
async def test_terminal_hello_during_handoff_never_uses_retry_after(monkeypatch, status):
    statuses = []
    runtime = _runtime(on_status=statuses.append)
    attempts = _transport(monkeypatch, runtime, [(200, None), (status, "60")])
    _clock_state, delays = _clock(monkeypatch, runtime)
    _serve_then_drain(monkeypatch, runtime, attempts)
    expected = TunnelSupersededError if status == 409 else _TunnelAuthError
    with pytest.raises(expected):
        await asyncio.wait_for(runtime.serve_forever(), timeout=0.5)
    assert len(attempts) == 2
    assert delays == []
    assert runtime._retry_not_before == 0.0
    assert statuses[-1] == ("superseded" if status == 409 else "closed")
    await runtime.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("handoff", [False, True])
async def test_shutdown_interrupts_retry_after_without_redial(monkeypatch, handoff):
    runtime = _runtime()
    responses = [(200, None), (503, "60")] if handoff else [(503, "60")]
    attempts = _transport(monkeypatch, runtime, responses)
    if handoff:
        _serve_then_drain(monkeypatch, runtime, attempts)
    sleeping = asyncio.Event()
    original_sleep = runtime._sleep_before_retry

    async def sleep(delay):
        assert delay > 20
        sleeping.set()
        await original_sleep(delay)

    monkeypatch.setattr(runtime, "_sleep_before_retry", sleep)
    task = asyncio.create_task(runtime.serve_forever())
    try:
        await asyncio.wait_for(sleeping.wait(), timeout=0.5)
        await asyncio.wait_for(runtime.aclose(), timeout=0.5)
        await asyncio.wait_for(task, timeout=0.5)
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    assert len(attempts) == len(responses)
    assert runtime.status == "closed"


@pytest.mark.asyncio
async def test_canceled_retry_wait_propagates(monkeypatch):
    runtime = _runtime()
    attempts = _transport(monkeypatch, runtime, [(503, "60")])
    sleeping = asyncio.Event()
    original_sleep = runtime._sleep_before_retry

    async def sleep(delay):
        sleeping.set()
        await original_sleep(delay)

    monkeypatch.setattr(runtime, "_sleep_before_retry", sleep)
    task = asyncio.create_task(runtime.serve_forever())
    await asyncio.wait_for(sleeping.wait(), timeout=0.5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await runtime.aclose()
    assert len(attempts) == 1


@pytest.mark.asyncio
async def test_response_headers_come_from_initial_headers_not_trailers():
    runtime = _runtime()
    conn = _Connection(1)
    queue = asyncio.Queue()
    conn.streams[1] = queue
    headers = [(":status", "503"), ("retry-after", "5")]
    queue.put_nowait(_StreamEvent("headers", headers=headers))
    queue.put_nowait(_StreamEvent("headers", headers=[("retry-after", "0")]))
    queue.put_nowait(_StreamEvent("end"))
    assert await runtime._await_response(1, conn) == (503, b"", headers)
