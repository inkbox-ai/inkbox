"""Tests for ``TunnelRuntime`` + ``TunnelListener`` behavior.

Three layers of coverage:

1. Listener-level behavior — wait() exception propagation, the
   sync/async exclusion rule.
2. Dispatch-level behavior — body cap enforcement, deadline plumbing
   (including materialize+dispatch in one budget, and the WS-accept
   deadline), exercised by calling the dispatch path with stubbed
   transports.
3. Wire-format codec — WS binary base64 round-trip vs. the server-side
   bridge contract.
"""

from __future__ import annotations

import asyncio
import base64
import json
import threading
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from inkbox.tunnels.client._asgi import (
    AsgiResponseTooLarge,
    invoke_asgi_http,
)
from inkbox.tunnels.client._bootstrap import TunnelBundle
from inkbox.tunnels.client._envelope import Envelope
from inkbox.tunnels.client._listener import TunnelListener
from inkbox.tunnels.client._runtime import TunnelRuntime, _TunnelAuthError
from inkbox.tunnels.client._ws import WSASGISession
from inkbox.tunnels.client._wsframe import encode_ws_envelope
from inkbox.tunnels.types import TLSMode, Tunnel, TunnelStatus


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_bundle() -> TunnelBundle:
    return TunnelBundle(
        tunnel=Tunnel(
            id=UUID("11111111-1111-1111-1111-111111111111"),
            organization_id="org",
            tunnel_name="my-agent",
            description=None,
            tls_mode=TLSMode.EDGE,
            cert_pem=None,
            cert_fingerprint_sha256=None,
            cert_expires_at=None,
            status=TunnelStatus.ACTIVE,
            last_connected_at=None,
            last_connected_ip_addr=None,
            restore_deadline_at=None,
            currently_connected=False,
            public_host="my-agent.inkboxwire.example",
            zone="inkboxwire.example",
            metadata={},
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        ),
        secret="sec",
        public_host="my-agent.inkboxwire.example",
        zone="inkboxwire.example",
        tls_terminator=None,
    )


def _make_runtime(**kwargs) -> TunnelRuntime:
    base = dict(
        tunnel_id=uuid4(),
        secret="sec",
        zone="inkboxwire.example",
        public_host="my-agent.inkboxwire.example",
        pool_size=1,
        forward_to="http://127.0.0.1:1",
        tls_terminator=None,
    )
    base.update(kwargs)
    return TunnelRuntime(**base)


def _make_envelope(body: bytes = b"") -> Envelope:
    return Envelope(
        request_id="req-1",
        method="POST",
        path="/webhook",
        route_kind="webhook",
        ws_id=None,
        forwarded_headers=[],
        body=body,
        body_uri=None,
        forwarded_for_ip="1.2.3.4",
        tcp_id=None,
        sni_host=None,
        extra_meta={},
    )


# ---------------------------------------------------------------------------
# Listener wait() exception propagation
# ---------------------------------------------------------------------------


def _prep_listener_for_wait(listener: TunnelListener) -> None:
    """Bypass real thread/runtime startup so wait() just consumes state."""
    # Setting _thread short-circuits _start_thread_if_needed.
    listener._thread = threading.Thread(target=lambda: None, daemon=True)


def test_listener_wait_reraises_captured_runtime_error():
    """wait() must surface fatal runtime exceptions instead of returning silently."""
    bundle = _make_bundle()
    runtime = _make_runtime()
    listener = TunnelListener(bundle=bundle, runtime=runtime)
    _prep_listener_for_wait(listener)

    # Simulate what _runner does on a fatal failure: capture and signal.
    listener._runtime_error = _TunnelAuthError(
        "/_system/hello returned 401; connect secret is invalid",
    )
    listener._stopped.set()

    with pytest.raises(_TunnelAuthError, match="401"):
        listener.wait()


def test_listener_wait_clean_shutdown_returns_without_error():
    """A clean shutdown (no captured error) returns normally."""
    bundle = _make_bundle()
    runtime = _make_runtime()
    listener = TunnelListener(bundle=bundle, runtime=runtime)
    _prep_listener_for_wait(listener)
    listener._stopped.set()
    listener.wait()


def test_listener_runtime_error_only_raised_once():
    """Two wait() calls; only the first raises (state is consumed)."""
    bundle = _make_bundle()
    runtime = _make_runtime()
    listener = TunnelListener(bundle=bundle, runtime=runtime)
    _prep_listener_for_wait(listener)
    listener._runtime_error = _TunnelAuthError("boom")
    listener._stopped.set()

    with pytest.raises(_TunnelAuthError):
        listener.wait()
    listener.wait()


def test_listener_serve_forever_and_wait_are_mutually_exclusive():
    """async serve_forever() + sync wait() can't both drive the same listener."""
    bundle = _make_bundle()
    runtime = _make_runtime()
    listener = TunnelListener(bundle=bundle, runtime=runtime)
    # Mark as if a sync thread is already running.
    listener._thread = threading.Thread(target=lambda: None)

    async def _go():
        with pytest.raises(RuntimeError, match="mutually exclusive"):
            await listener.serve_forever()

    asyncio.run(_go())


# ---------------------------------------------------------------------------
# ASGI response cap enforcement (per-chunk)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_asgi_response_cap_raises_mid_stream():
    """The cap fires on the chunk that pushes us past the limit, not after."""

    async def app(scope, receive, send):
        await receive()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        # First chunk fits; second exceeds the cap and must abort.
        await send({"type": "http.response.body", "body": b"x" * 8, "more_body": True})
        await send({"type": "http.response.body", "body": b"y" * 8})

    env = _make_envelope(body=b"")
    with pytest.raises(AsgiResponseTooLarge):
        await invoke_asgi_http(
            app=app,
            envelope=env,
            public_host="my-agent.inkboxwire.example",
            max_response_bytes=10,  # first 8 fit; second 8 trips the cap
        )


@pytest.mark.asyncio
async def test_asgi_response_within_cap_succeeds():
    async def app(scope, receive, send):
        await receive()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"hello"})

    env = _make_envelope(body=b"")
    status, _, body = await invoke_asgi_http(
        app=app,
        envelope=env,
        public_host="my-agent.inkboxwire.example",
        max_response_bytes=1024,
    )
    assert status == 200
    assert body == b"hello"


# ---------------------------------------------------------------------------
# Deadline plumbing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_with_deadline_passes_through_when_unset():
    runtime = _make_runtime()
    runtime._response_deadline_seconds = None

    async def quick():
        return "ok"

    assert await runtime._with_deadline(quick()) == "ok"


@pytest.mark.asyncio
async def test_with_deadline_times_out_on_slow_dispatch():
    runtime = _make_runtime()
    runtime._response_deadline_seconds = 0.1

    async def slow():
        await asyncio.sleep(5)
        return "should not get here"

    with pytest.raises(asyncio.TimeoutError):
        await runtime._with_deadline(slow())


# ---------------------------------------------------------------------------
# URL forward streaming cap (mocked transport)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_url_forward_streaming_cap_bails_mid_stream():
    """Synthesize a streaming upstream response that exceeds the cap."""
    from inkbox.tunnels.client._url_forward import forward_envelope_to_url

    class _FakeStream:
        def __init__(self, chunks: list[bytes]) -> None:
            self._chunks = chunks
            self.status_code = 200
            self.headers = {"content-type": "application/octet-stream"}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def aiter_bytes(self):
            for c in self._chunks:
                yield c

    class _FakeClient:
        def __init__(self, chunks: list[bytes]) -> None:
            self._chunks = chunks

        def stream(self, **kwargs):
            return _FakeStream(self._chunks)

    env = _make_envelope(body=b"")
    # 10 chunks of 100 bytes each = 1000 bytes; cap at 200.
    client = _FakeClient([b"a" * 100 for _ in range(10)])
    result = await forward_envelope_to_url(
        envelope=env,
        forward_to="http://127.0.0.1:8080",
        public_host="my-agent.inkboxwire.example",
        http_client=client,  # type: ignore[arg-type]
        max_outbound_body_bytes=200,
    )
    assert result.status == 502
    assert result.inkbox_reason == "response-too-large"


# ---------------------------------------------------------------------------
# WS binary base64 round-trip vs. server contract
# ---------------------------------------------------------------------------


def test_encode_ws_envelope_binary_uses_base64():
    """Server expects base64 in ``data``; latin-1 used to corrupt non-ASCII."""
    payload = b"\x00\xff\x80hello"
    raw = encode_ws_envelope({"type": "websocket.send", "bytes": payload})
    # First 4 bytes are the length prefix; the rest is JSON.
    body = raw[4:]
    decoded = json.loads(body.decode("utf-8"))
    assert decoded["type"] == "binary"
    # The data field, base64-decoded, must reproduce the original bytes.
    assert base64.b64decode(decoded["data"]) == payload


def test_encode_ws_envelope_text_unchanged():
    """Text frames don't get base64'd."""
    raw = encode_ws_envelope({"type": "websocket.send", "text": "hi there"})
    decoded = json.loads(raw[4:].decode("utf-8"))
    assert decoded == {"type": "text", "data": "hi there"}


@pytest.mark.asyncio
async def test_ws_session_deliver_binary_base64_decodes():
    """Inbound binary envelope from the server must reach the app as raw bytes."""
    received: list[bytes] = []
    accepted = asyncio.Event()

    async def app(scope, receive, send):
        msg = await receive()
        assert msg["type"] == "websocket.connect"
        await send({"type": "websocket.accept"})
        accepted.set()
        while True:
            msg = await receive()
            if msg["type"] == "websocket.disconnect":
                return
            if msg["type"] == "websocket.receive":
                received.append(msg.get("bytes", b""))
                if len(received) >= 1:
                    return

    session = WSASGISession(
        app=app,
        path="/ws",
        headers=[],
        public_host="my-agent.inkboxwire.example",
        forwarded_for_ip="1.2.3.4",
    )
    accept_msg = await session.run_until_accept()
    assert accept_msg["type"] == "websocket.accept"

    payload = b"\x00\xff\x80\x01binary"
    await session.deliver({
        "type": "binary",
        "data": base64.b64encode(payload).decode("ascii"),
    })
    # Drive the app forward until it returns.
    await session.close(code=1000)
    assert received == [payload]


@pytest.mark.asyncio
async def test_ws_session_deliver_binary_malformed_is_dropped_not_delivered():
    """Malformed base64 must be dropped — not silently delivered as ``b""``.

    Reaches inside ``WSASGISession`` to inspect the inbound queue
    directly rather than driving an ASGI app, because the WS session's
    ``_run_app`` catches all exceptions to keep the bridge alive — that
    would mask a leaking empty frame from a less-direct assertion.
    """
    session = WSASGISession(
        app=lambda *_: None,  # never invoked here
        path="/ws",
        headers=[],
        public_host="my-agent.inkboxwire.example",
        forwarded_for_ip="1.2.3.4",
    )
    # Drain the websocket.connect that the session won't push since we
    # didn't call run_until_accept(); the inbound queue is empty.
    assert session._inbound.qsize() == 0

    await session.deliver({"type": "binary", "data": "@@@@"})
    # The frame must be dropped, not delivered as empty bytes.
    assert session._inbound.qsize() == 0


@pytest.mark.asyncio
async def test_ws_session_deliver_binary_unpadded_base64_is_rejected():
    """``validate=True`` also rejects unpadded / invalid-length base64."""
    session = WSASGISession(
        app=lambda *_: None, path="/ws", headers=[],
        public_host="my-agent.inkboxwire.example",
        forwarded_for_ip="1.2.3.4",
    )
    # 5 chars => not a multiple of 4 => rejected.
    await session.deliver({"type": "binary", "data": "abcde"})
    assert session._inbound.qsize() == 0


@pytest.mark.asyncio
async def test_ws_session_deliver_binary_valid_base64_is_delivered():
    """Sanity: a well-formed envelope still rounds-trips post-validate=True."""
    session = WSASGISession(
        app=lambda *_: None, path="/ws", headers=[],
        public_host="my-agent.inkboxwire.example",
        forwarded_for_ip="1.2.3.4",
    )
    payload = b"\x00\xff\x80hello"
    await session.deliver({
        "type": "binary",
        "data": base64.b64encode(payload).decode("ascii"),
    })
    msg = session._inbound.get_nowait()
    assert msg == {"type": "websocket.receive", "bytes": payload}


# ---------------------------------------------------------------------------
# Materialize-plus-dispatch deadline (single budget)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_materialize_plus_dispatch_share_one_deadline():
    """A slow body-uri fetch consumes the budget that local dispatch also lives in.

    Pins that the deadline wraps materialization + dispatch as one unit.
    A 5-second body fetch with a 0.1-second deadline must raise
    asyncio.TimeoutError out of ``_with_deadline(...)``.
    """
    runtime = _make_runtime()
    runtime._response_deadline_seconds = 0.1
    materialize_started = asyncio.Event()

    async def slow_materialize_and_dispatch():
        materialize_started.set()
        # Simulate a slow inkbox-body-uri GET that consumes the entire
        # deadline before dispatch even starts.
        await asyncio.sleep(5)
        return ("forward", 200, [], b"never-reached")

    with pytest.raises(asyncio.TimeoutError):
        await runtime._with_deadline(slow_materialize_and_dispatch())
    assert materialize_started.is_set()


# ---------------------------------------------------------------------------
# WS-accept deadline
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ws_accept_deadline_trips_when_app_stalls():
    """An ASGI WS handler that never calls accept must trip the deadline."""

    async def app(scope, receive, send):
        # Receive websocket.connect, then stall.
        await receive()
        await asyncio.sleep(60)

    session = WSASGISession(
        app=app,
        path="/ws",
        headers=[],
        public_host="my-agent.inkboxwire.example",
        forwarded_for_ip="1.2.3.4",
    )
    runtime = _make_runtime()
    runtime._response_deadline_seconds = 0.1

    with pytest.raises(asyncio.TimeoutError):
        await runtime._with_deadline(session.run_until_accept())

    # Cleanup — let the session task exit so we don't leak it.
    await session.close(code=1011)


@pytest.mark.asyncio
async def test_url_forward_streaming_under_cap_succeeds():
    from inkbox.tunnels.client._url_forward import forward_envelope_to_url

    class _FakeStream:
        def __init__(self) -> None:
            self.status_code = 201
            self.headers = {"content-type": "text/plain"}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def aiter_bytes(self):
            yield b"hello "
            yield b"world"

    class _FakeClient:
        def stream(self, **kwargs):
            return _FakeStream()

    env = _make_envelope(body=b"")
    result = await forward_envelope_to_url(
        envelope=env,
        forward_to="http://127.0.0.1:8080",
        public_host="my-agent.inkboxwire.example",
        http_client=_FakeClient(),  # type: ignore[arg-type]
        max_outbound_body_bytes=1024,
    )
    assert result.status == 201
    assert result.body == b"hello world"
    assert result.inkbox_reason is None
