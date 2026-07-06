"""
Tests for the terminal "another client took over this tunnel" (superseded)
path: the SDK must stop and not reconnect, and must NOT mistake its own
make-before-break reconnect for an external takeover.
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import h2.events
import pytest

from inkbox.tunnels.client._runtime import (
    HELLO_REASON_SUPERSEDED,
    SUPERSEDED_GOAWAY_ERROR_CODE,
    TunnelRuntime,
    _Connection,
    _hello_reason,
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
    assert conn.superseded is True


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
    await runtime._handle_event(
        _goaway(SUPERSEDED_GOAWAY_ERROR_CODE, b'{"reason":"superseded"}'), conn,
    )
    assert runtime._superseded is False


@pytest.mark.asyncio
async def test_superseded_goaway_ignored_when_not_active():
    runtime = _make_runtime()
    _active_conn(runtime)
    other = _Connection(2)  # not the active connection
    await runtime._handle_event(
        _goaway(SUPERSEDED_GOAWAY_ERROR_CODE, b'{"reason":"superseded"}'), other,
    )
    assert runtime._superseded is False


@pytest.mark.asyncio
async def test_superseded_goaway_ignored_during_handoff():
    runtime = _make_runtime()
    conn = _active_conn(runtime)
    runtime._handoff_in_flight = True
    await runtime._handle_event(
        _goaway(SUPERSEDED_GOAWAY_ERROR_CODE, b'{"reason":"superseded"}'), conn,
    )
    assert runtime._superseded is False


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
    assert _hello_reason(b'{"reason":"hello-superseded"}') == HELLO_REASON_SUPERSEDED
    assert _hello_reason(b"") is None
    assert _hello_reason(b"not json") is None


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

    with pytest.raises(_TunnelSupersededError):
        await runtime.serve_forever()
    # terminal status surfaced (not "reconnecting"/"closed"), no retry loop
    assert "superseded" in statuses
    assert "reconnecting" not in statuses


def test_guard_helper_matrix():
    runtime = _make_runtime()
    conn = _active_conn(runtime)
    assert runtime._superseded_is_terminal(conn) is True
    conn.draining = True
    assert runtime._superseded_is_terminal(conn) is False
    conn.draining = False
    runtime._handoff_in_flight = True
    assert runtime._superseded_is_terminal(conn) is False
