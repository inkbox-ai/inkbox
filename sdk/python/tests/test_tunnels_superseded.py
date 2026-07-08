"""
Tests for the terminal "another client took over this tunnel" (superseded)
path: the SDK must stop and not reconnect, and must NOT mistake its own
make-before-break reconnect for an external takeover.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock
from uuid import uuid4

import h2.events
import pytest

from inkbox.tunnels.client._runtime import (
    HELLO_REASON_SUPERSEDED,
    INTAKE_REASON_SUPERSEDED,
    SUPERSEDED_GOAWAY_ERROR_CODE,
    TunnelRuntime,
    _Connection,
    _parse_reason_json,
    _StreamEvent,
    _TunnelSupersededError,
)


def _make_runtime(**kwargs) -> TunnelRuntime:
    base = dict(
        tunnel_id=uuid4(),
        api_key="ApiKey_test",
        zone="inkboxwire.example",
        public_host="my-agent.inkboxwire.example",
        pool_size=1,
        forward_to="http://127.0.0.1:1",
        tls_terminator=None,
    )
    base.update(kwargs)
    return TunnelRuntime(**base)


def _goaway(error_code: int, debug: bytes | None) -> h2.events.ConnectionTerminated:
    ev = h2.events.ConnectionTerminated()
    ev.error_code = error_code
    ev.last_stream_id = 0
    ev.additional_data = debug
    return ev


def _active_conn(runtime: TunnelRuntime) -> _Connection:
    conn = _Connection(1)
    runtime._active = conn
    return conn


# ── GOAWAY classification ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_superseded_goaway_on_active_marks_terminal():
    runtime = _make_runtime()
    conn = _active_conn(runtime)
    await runtime._handle_event(
        _goaway(SUPERSEDED_GOAWAY_ERROR_CODE, b'{"reason":"superseded"}'), conn,
    )
    assert runtime._superseded is True


@pytest.mark.asyncio
async def test_superseded_code_is_authoritative_without_reason():
    """The dedicated code alone is terminal even if the debug blob is lost."""
    runtime = _make_runtime()
    conn = _active_conn(runtime)
    await runtime._handle_event(_goaway(SUPERSEDED_GOAWAY_ERROR_CODE, None), conn)
    assert runtime._superseded is True


@pytest.mark.asyncio
async def test_superseded_reason_is_a_belt_for_other_nonzero_code():
    runtime = _make_runtime()
    conn = _active_conn(runtime)
    await runtime._handle_event(_goaway(9, b'{"reason":"superseded"}'), conn)
    assert runtime._superseded is True


@pytest.mark.asyncio
async def test_superseded_goaway_ignored_when_draining():
    """A takeover signal on our own draining predecessor is not terminal."""
    runtime = _make_runtime()
    conn = _active_conn(runtime)
    conn.draining = True
    runtime._draining.add(conn)  # a real make-before-break predecessor
    await runtime._handle_event(
        _goaway(SUPERSEDED_GOAWAY_ERROR_CODE, b'{"reason":"superseded"}'), conn,
    )
    assert runtime._superseded is False


@pytest.mark.asyncio
async def test_superseded_goaway_on_nonactive_replacement_is_terminal():
    """Regression: a takeover on a non-active replacement (NOT a drain
    predecessor) is terminal. Previously mis-suppressed by the non-active
    guard, which let the runtime cold-reconnect and re-steal the tunnel."""
    runtime = _make_runtime()
    _active_conn(runtime)
    replacement = _Connection(2)  # not active, NOT in _draining
    await runtime._handle_event(
        _goaway(SUPERSEDED_GOAWAY_ERROR_CODE, b'{"reason":"superseded"}'),
        replacement,
    )
    assert runtime._superseded is True


@pytest.mark.asyncio
async def test_superseded_goaway_on_replacement_during_handoff_is_terminal():
    """Regression (the real race): mid-handoff, old A is the draining
    predecessor and B is the in-flight replacement. A superseded GOAWAY on B
    (an external takeover) must be terminal, not swallowed as a self-handoff."""
    runtime = _make_runtime()
    old_a = _active_conn(runtime)
    old_a.draining = True
    runtime._draining.add(old_a)
    runtime._handoff_in_flight = True
    replacement = _Connection(2)  # B: not active, NOT in _draining
    await runtime._handle_event(
        _goaway(SUPERSEDED_GOAWAY_ERROR_CODE, b'{"reason":"superseded"}'),
        replacement,
    )
    assert runtime._superseded is True


@pytest.mark.asyncio
async def test_drain_goaway_hands_off_not_superseded(monkeypatch):
    runtime = _make_runtime()
    conn = _active_conn(runtime)
    calls: list[str] = []
    monkeypatch.setattr(
        runtime, "_begin_handoff", lambda c, *, reason: calls.append(reason),
    )
    await runtime._handle_event(_goaway(0, b'{"reason":"drain"}'), conn)
    assert runtime._superseded is False
    assert calls == ["drain"]


@pytest.mark.asyncio
async def test_infra_goaway_different_reason_reconnects_not_terminal():
    runtime = _make_runtime()
    conn = _active_conn(runtime)
    await runtime._handle_event(_goaway(2, b'{"reason":"internal"}'), conn)
    assert runtime._superseded is False


# ── intake channel ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_intake_superseded_terminal_on_nonactive_replacement(monkeypatch):
    """Regression: intake-superseded on a non-draining replacement conn (not
    active, mid-handoff) is terminal. _park_one_intake must raise, not re-park.

    An intake-superseded can't actually land while B's hello is in flight
    (intakes only start after _start_serving), so this drives the intake
    predicate directly rather than framing it as hello-in-flight.
    """
    runtime = _make_runtime()
    _active_conn(runtime)  # a DIFFERENT active conn (old A)
    runtime._handoff_in_flight = True
    conn = _Connection(2)  # replacement B: not active, NOT in _draining
    conn.owner_token = "owner_test"
    conn.h2 = MagicMock()
    conn.writer = MagicMock()
    monkeypatch.setattr(runtime, "_open_stream_locked", lambda *a, **k: 7)

    async def _flush(c):
        return None

    monkeypatch.setattr(runtime, "_flush_conn", _flush)

    queue: asyncio.Queue = asyncio.Queue()
    conn.streams[7] = queue
    await queue.put(_StreamEvent(
        "headers",
        headers=[(":status", "409"), ("inkbox-reason", INTAKE_REASON_SUPERSEDED)],
    ))
    await queue.put(_StreamEvent("end"))

    with pytest.raises(_TunnelSupersededError):
        await runtime._park_one_intake(conn, slot=0)


@pytest.mark.asyncio
async def test_intake_loop_terminal_on_superseded(monkeypatch):
    """intake-superseded -> mark terminal + force the conn down (no reconnect)."""
    runtime = _make_runtime()
    runtime._h2 = MagicMock()  # truthy so the loop guard passes

    async def _fake_park(conn=None, slot=0):
        raise _TunnelSupersededError("slot=0: taken over")

    monkeypatch.setattr(runtime, "_park_one_intake", _fake_park)
    forced: list[int] = []
    monkeypatch.setattr(
        runtime, "_force_reconnect_conn", lambda conn: forced.append(1),
    )
    await runtime._intake_loop(0)
    assert runtime._superseded is True
    assert forced == [1]


# ── hello channel ────────────────────────────────────────────────────────


def test_hello_reason_parses_body():
    assert _parse_reason_json(b'{"reason":"hello-superseded"}') == HELLO_REASON_SUPERSEDED
    assert _parse_reason_json(b"") is None
    assert _parse_reason_json(b"not json") is None


@pytest.mark.asyncio
async def test_hello_superseded_is_terminal(monkeypatch):
    runtime = _make_runtime()
    conn = _active_conn(runtime)
    conn.h2 = MagicMock()
    conn.writer = MagicMock()
    monkeypatch.setattr(runtime, "_open_stream_locked", lambda *a, **k: 1)

    async def _flush(c):
        return None

    async def _await(sid, conn=None):
        return 409, b'{"reason":"hello-superseded"}'

    monkeypatch.setattr(runtime, "_flush_conn", _flush)
    monkeypatch.setattr(runtime, "_await_response", _await)

    with pytest.raises(_TunnelSupersededError):
        await runtime._send_hello(conn)
    assert runtime._superseded is True


@pytest.mark.asyncio
async def test_hello_generic_409_is_transient(monkeypatch):
    runtime = _make_runtime()
    conn = _active_conn(runtime)
    conn.h2 = MagicMock()
    conn.writer = MagicMock()
    monkeypatch.setattr(runtime, "_open_stream_locked", lambda *a, **k: 1)

    async def _flush(c):
        return None

    async def _await(sid, conn=None):
        return 409, b'{"reason":"something-else"}'

    monkeypatch.setattr(runtime, "_flush_conn", _flush)
    monkeypatch.setattr(runtime, "_await_response", _await)

    with pytest.raises(RuntimeError) as exc:
        await runtime._send_hello(conn)
    assert not isinstance(exc.value, _TunnelSupersededError)
    assert runtime._superseded is False


# ── serve_forever surfacing ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_serve_forever_stops_and_surfaces_on_superseded(monkeypatch):
    runtime = _make_runtime()
    statuses: list[str] = []
    monkeypatch.setattr(runtime, "_notify_status", lambda s: statuses.append(s))

    async def _boom():
        raise _TunnelSupersededError("taken over")

    monkeypatch.setattr(runtime, "_run_once", _boom)

    with pytest.raises(_TunnelSupersededError) as exc_info:
        await runtime.serve_forever()
    # the original error (with its channel/slot detail) is re-raised verbatim
    assert "taken over" in str(exc_info.value)
    # terminal status surfaced (not "reconnecting"/"closed"), no retry loop
    assert "superseded" in statuses
    assert "reconnecting" not in statuses


@pytest.mark.asyncio
async def test_serve_forever_terminal_when_flag_set_on_plain_error(monkeypatch):
    """A takeover GOAWAY that lands mid-hello sets _superseded but the hello
    fails with a PLAIN error; serve_forever must stop, not reconnect."""
    runtime = _make_runtime()
    statuses: list[str] = []
    monkeypatch.setattr(runtime, "_notify_status", lambda s: statuses.append(s))

    async def _run_once_plain_error():
        runtime._superseded = True  # set by the read loop mid-hello
        raise RuntimeError("connection closed during hello")

    monkeypatch.setattr(runtime, "_run_once", _run_once_plain_error)

    with pytest.raises(_TunnelSupersededError):
        await runtime.serve_forever()
    assert "superseded" in statuses
    assert "reconnecting" not in statuses


@pytest.mark.asyncio
async def test_hello_superseded_terminal_even_during_handoff(monkeypatch):
    """hello-superseded is terminal even on a non-active/handoff connection, so
    a handoff retry can't re-hello and boot the client that replaced us."""
    runtime = _make_runtime()
    _active_conn(runtime)  # a DIFFERENT active conn
    runtime._handoff_in_flight = True
    conn = _Connection(2)  # the replacement being helloed (not active)
    conn.h2 = MagicMock()
    conn.writer = MagicMock()
    monkeypatch.setattr(runtime, "_open_stream_locked", lambda *a, **k: 1)

    async def _flush(c):
        return None

    async def _await(sid, conn=None):
        return 409, b'{"reason":"hello-superseded"}'

    monkeypatch.setattr(runtime, "_flush_conn", _flush)
    monkeypatch.setattr(runtime, "_await_response", _await)

    with pytest.raises(_TunnelSupersededError):
        await runtime._send_hello(conn)
    assert runtime._superseded is True


@pytest.mark.asyncio
async def test_make_replacement_reraises_superseded_no_retry(monkeypatch):
    """A takeover during the handoff hello propagates terminally instead of
    being retried within the redial budget."""
    runtime = _make_runtime()
    attempts = {"n": 0}

    async def _open(conn):
        return None

    async def _read_loop(conn):
        await asyncio.sleep(3600)

    async def _hello(conn):
        attempts["n"] += 1
        raise _TunnelSupersededError("taken over during handoff")

    async def _close(conn):
        return None

    monkeypatch.setattr(runtime, "_open_connection", _open)
    monkeypatch.setattr(runtime, "_read_loop", _read_loop)
    monkeypatch.setattr(runtime, "_send_hello", _hello)
    monkeypatch.setattr(runtime, "_force_reconnect_conn", lambda c: None)
    monkeypatch.setattr(runtime, "_close_connection_writer", _close)

    with pytest.raises(_TunnelSupersededError):
        await runtime._make_replacement_connection()
    assert attempts["n"] == 1  # did NOT retry the doomed hello


def test_superseded_error_is_public_and_typed():
    """The terminal error is the public TunnelSupersededError (a TunnelError),
    reachable from inkbox and inkbox.tunnels, not a bare RuntimeError."""
    import inkbox
    from inkbox.tunnels import TunnelSupersededError
    from inkbox.tunnels.exceptions import TunnelError

    assert _TunnelSupersededError is TunnelSupersededError
    assert inkbox.TunnelSupersededError is TunnelSupersededError
    assert issubclass(TunnelSupersededError, TunnelError)


def test_guard_helper_matrix():
    """Terminal for any conn except one we put into make-before-break drain."""
    runtime = _make_runtime()
    conn = _active_conn(runtime)
    # active conn, not a drain predecessor -> terminal
    assert runtime._superseded_is_terminal(conn) is True
    # a not-yet-active replacement (not in _draining) is also terminal, even
    # while a handoff is in flight
    replacement = _Connection(2)
    runtime._handoff_in_flight = True
    assert runtime._superseded_is_terminal(replacement) is True
    # only our own draining predecessor is ignored
    runtime._draining.add(conn)
    assert runtime._superseded_is_terminal(conn) is False
