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
async def test_dispatch_tcp_stream_does_not_drop_callable_envelopes():
    """Regression: passthrough + callable must not be rejected at the
    runtime layer. Previously ``_dispatch_tcp_stream`` returned early
    when ``forward_to`` was not a URL, so callable envelopes were
    silently dropped despite the listener accepting the configuration.
    """
    async def app(scope, receive, send):
        return None  # never reached in this test

    runtime = _make_runtime(
        forward_to=app,  # callable, not URL
        tls_terminator=object(),  # truthy, makes us look like passthrough
    )
    # tcp_id None → second early-return; that path is intentional.
    env_no_tcp = Envelope(
        request_id="r", method="GET", path="/", route_kind="webhook",
        ws_id=None, forwarded_headers=[], body=b"", body_uri=None,
        forwarded_for_ip=None, tcp_id=None, sni_host=None, extra_meta={},
    )
    await runtime._dispatch_tcp_stream(env_no_tcp)

    # tcp_id present + callable forward_to: the function must proceed
    # past the early-return guards. We intercept the bridge-open call
    # so the test doesn't need a real h2 connection.
    env_with_tcp = Envelope(
        request_id="r", method="CONNECT", path="/_system/tcp/abc",
        route_kind="passthrough-tcp", ws_id=None, forwarded_headers=[],
        body=b"", body_uri=None, forwarded_for_ip=None, tcp_id="abc",
        sni_host="agent.test", extra_meta={},
    )
    reached_open = asyncio.Event()

    async def _patched_send_lock_acquire(*_a, **_k):
        # Signal that we got past the early-return guards into the
        # bridge-open code path, then bail out by raising — we don't
        # need to actually open a stream.
        reached_open.set()
        raise RuntimeError("test bail-out")

    runtime._send_lock = type(  # noqa: SLF001 — test reaches into internals
        "L", (), {"__aenter__": _patched_send_lock_acquire,
                  "__aexit__": lambda *a, **k: None}
    )()
    try:
        await runtime._dispatch_tcp_stream(env_with_tcp)
    except RuntimeError as e:
        assert "test bail-out" in str(e) or reached_open.is_set()
    assert reached_open.is_set()


@pytest.mark.asyncio
async def test_ws_upgrade_rejects_path_traversal():
    """Edge-mode WS upgrades must run validate_envelope_path. Without
    the guard, a ws-upgrade envelope with /../ would skip HTTP-path
    validation and reach the upstream raw."""
    runtime = _make_runtime()
    captured: list[tuple[str, int, list[tuple[str, str]], bytes]] = []

    async def _capture_post_response(
        request_id, *, status, headers, body, end_stream=True,
    ):
        captured.append((request_id, status, list(headers), body))

    runtime._post_response = _capture_post_response  # type: ignore[assignment]

    env = Envelope(
        request_id="req-bad-path",
        method="GET",
        path="/foo/../etc/passwd",
        route_kind="ws-upgrade",
        ws_id="ws-1",
        forwarded_headers=[],
        body=b"",
        body_uri=None,
        forwarded_for_ip=None,
        tcp_id=None,
        sni_host=None,
        extra_meta={},
    )
    await runtime._dispatch_ws_upgrade(env)

    assert len(captured) == 1
    request_id, status, headers, body = captured[0]
    assert request_id == "req-bad-path"
    assert status == 400
    reason_headers = [v for (k, v) in headers if k == "inkbox-reason"]
    assert reason_headers == ["invalid-path"]


@pytest.mark.asyncio
async def test_open_ws_upstream_rejects_negotiated_extensions():
    """If a misbehaving upstream confirms a Sec-WebSocket-Extensions we
    didn't offer (e.g. permessage-deflate), refuse — we don't have a
    codec wired and would otherwise forward compressed bytes raw."""
    import base64
    import hashlib

    from inkbox.tunnels.client._ws_upstream import (
        WsUpstreamError,
        open_ws_upstream,
    )

    WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    async def handler(reader, writer):
        head = bytearray()
        while b"\r\n\r\n" not in bytes(head):
            chunk = await reader.read(4096)
            if not chunk:
                writer.close()
                return
            head.extend(chunk)
        head_text = bytes(head).split(b"\r\n\r\n", 1)[0].decode("iso-8859-1")
        ws_key = ""
        for line in head_text.split("\r\n")[1:]:
            if ":" in line:
                k, _, v = line.partition(":")
                if k.strip().lower() == "sec-websocket-key":
                    ws_key = v.strip()
        accept = base64.b64encode(
            hashlib.sha1((ws_key + WS_GUID).encode("ascii")).digest(),
        ).decode("ascii")
        writer.write((
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n"
            "Sec-WebSocket-Extensions: permessage-deflate\r\n\r\n"
        ).encode("ascii"))
        await writer.drain()
        try:
            await reader.read()
        finally:
            writer.close()

    server = await asyncio.start_server(handler, host="127.0.0.1", port=0)
    serve = asyncio.create_task(server.serve_forever())
    try:
        port = server.sockets[0].getsockname()[1]
        with pytest.raises(WsUpstreamError) as ei:
            await open_ws_upstream(
                forward_to=f"http://127.0.0.1:{port}",
                request_path="/ws",
                request_headers=[],
                ws_subprotocol=None,
                forwarded_for_ip=None,
                public_host="agent.test",
            )
        assert ei.value.status == 502
        assert "extensions" in ei.value.reason.lower()
    finally:
        serve.cancel()
        try:
            await serve
        except (asyncio.CancelledError, Exception):
            pass
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_open_ws_upstream_rejects_unoffered_subprotocol():
    """RFC 6455 §4.1: server's selected subprotocol must be one the
    client offered. A misbehaving upstream that picks an un-offered
    token must be rejected — otherwise we'd advertise a protocol the
    third party never asked for."""
    import base64
    import hashlib

    from inkbox.tunnels.client._ws_upstream import (
        WsUpstreamError,
        open_ws_upstream,
    )

    WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    async def handler(reader, writer):
        head = bytearray()
        while b"\r\n\r\n" not in bytes(head):
            chunk = await reader.read(4096)
            if not chunk:
                writer.close()
                return
            head.extend(chunk)
        head_text = bytes(head).split(b"\r\n\r\n", 1)[0].decode("iso-8859-1")
        ws_key = ""
        for line in head_text.split("\r\n")[1:]:
            if ":" in line:
                k, _, v = line.partition(":")
                if k.strip().lower() == "sec-websocket-key":
                    ws_key = v.strip()
        accept = base64.b64encode(
            hashlib.sha1((ws_key + WS_GUID).encode("ascii")).digest(),
        ).decode("ascii")
        writer.write((
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n"
            "Sec-WebSocket-Protocol: admin\r\n\r\n"
        ).encode("ascii"))
        await writer.drain()
        try:
            await reader.read()
        finally:
            writer.close()

    server = await asyncio.start_server(handler, host="127.0.0.1", port=0)
    serve = asyncio.create_task(server.serve_forever())
    try:
        port = server.sockets[0].getsockname()[1]
        # Client offered nothing.
        with pytest.raises(WsUpstreamError) as ei:
            await open_ws_upstream(
                forward_to=f"http://127.0.0.1:{port}",
                request_path="/ws",
                request_headers=[],
                ws_subprotocol=None,
                forwarded_for_ip=None,
                public_host="agent.test",
            )
        assert ei.value.status == 502
        assert "subprotocol" in ei.value.reason.lower()

        # Client offered "chat" but upstream still picked "admin".
        with pytest.raises(WsUpstreamError) as ei2:
            await open_ws_upstream(
                forward_to=f"http://127.0.0.1:{port}",
                request_path="/ws",
                request_headers=[],
                ws_subprotocol="chat",
                forwarded_for_ip=None,
                public_host="agent.test",
            )
        assert ei2.value.status == 502
        assert "subprotocol" in ei2.value.reason.lower()
    finally:
        serve.cancel()
        try:
            await serve
        except (asyncio.CancelledError, Exception):
            pass
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_reset_bridge_stream_emits_rst_stream_cancel():
    """_reset_bridge_stream sends RST_STREAM(CANCEL) on the named
    stream — used on the bridge-open failure path so the h2 stream
    doesn't sit half-open server-side."""
    runtime = _make_runtime()
    calls: list[tuple[str, tuple, dict]] = []

    class _FakeH2:
        def reset_stream(self, stream_id, error_code):
            calls.append(("reset_stream", (stream_id, error_code), {}))

        def send_data(self, *args, **kwargs):
            calls.append(("send_data", args, kwargs))

    async def _fake_flush():
        return None

    runtime._h2 = _FakeH2()  # type: ignore[assignment]
    runtime._flush = _fake_flush  # type: ignore[assignment]

    await runtime._reset_bridge_stream(42)

    import h2.errors
    assert len(calls) == 1
    assert calls[0][0] == "reset_stream"
    assert calls[0][1] == (42, h2.errors.ErrorCodes.CANCEL)


@pytest.mark.asyncio
async def test_end_bridge_stream_emits_empty_end_stream():
    """_end_bridge_stream sends an empty DATA with END_STREAM so the
    server sees a clean half-close — used on the WSS pump-exit path."""
    runtime = _make_runtime()
    calls: list[tuple[str, tuple, dict]] = []

    class _FakeH2:
        def send_data(self, stream_id, data, *, end_stream):
            calls.append(("send_data", (stream_id, data), {"end_stream": end_stream}))

    async def _fake_flush():
        return None

    runtime._h2 = _FakeH2()  # type: ignore[assignment]
    runtime._flush = _fake_flush  # type: ignore[assignment]

    await runtime._end_bridge_stream(99)

    assert calls == [("send_data", (99, b""), {"end_stream": True})]


@pytest.mark.asyncio
async def test_end_bridge_stream_swallows_already_closed():
    """If the pump already sent END_STREAM (e.g. on upstream WS CLOSE
    propagation), _end_bridge_stream must not raise."""
    import h2.exceptions

    runtime = _make_runtime()

    class _FakeH2:
        def send_data(self, *args, **kwargs):
            raise h2.exceptions.StreamClosedError(stream_id=99)

    async def _fake_flush():
        return None

    runtime._h2 = _FakeH2()  # type: ignore[assignment]
    runtime._flush = _fake_flush  # type: ignore[assignment]

    # Must NOT raise — the suppress() inside the helper catches it.
    await runtime._end_bridge_stream(99)


@pytest.mark.asyncio
async def test_dispatch_ws_upgrade_to_url_resets_bridge_on_open_failure():
    """When the bridge CONNECT stream fails to reach :status 200,
    _dispatch_ws_upgrade_to_url must RST the h2 stream (not just pop
    local state) so it doesn't leak server-side."""
    import asyncio

    runtime = _make_runtime(forward_to="http://127.0.0.1:1")
    runtime._response_deadline_seconds = 0.05

    # Stub open_ws_upstream so we don't need a real upstream.
    class _FakeWriter:
        def close(self):
            pass

        async def wait_closed(self):
            return None

    class _FakeUpstream:
        reader = None
        writer = _FakeWriter()
        subprotocol = None
        leftover = b""
        headers: list[tuple[str, str]] = []

    import inkbox.tunnels.client._ws_upstream as _wsu

    async def _fake_open_ws_upstream(**kwargs):
        return _FakeUpstream()

    monkey_orig = _wsu.open_ws_upstream
    _wsu.open_ws_upstream = _fake_open_ws_upstream  # type: ignore[assignment]

    try:
        # Track h2 calls.
        reset_calls: list[tuple[int, object]] = []

        class _FakeH2:
            def reset_stream(self, stream_id, error_code):
                reset_calls.append((stream_id, error_code))

            def send_data(self, *a, **kw):
                pass

        async def _fake_flush():
            return None

        async def _fake_open_stream_locked(headers, end_stream):
            return 7  # arbitrary stream_id

        async def _fake_post_response(request_id, *, status, headers, body, end_stream=True):
            return None

        # Pre-register the queue so _await_connect_200 can read.
        runtime._streams[7] = asyncio.Queue()
        runtime._h2 = _FakeH2()  # type: ignore[assignment]
        runtime._flush = _fake_flush  # type: ignore[assignment]
        runtime._open_stream_locked = lambda h, end_stream: 7  # type: ignore[assignment]
        runtime._post_response = _fake_post_response  # type: ignore[assignment]

        envelope = Envelope(
            request_id="req-1", method="GET", path="/ws",
            route_kind="ws-upgrade", ws_id="ws-1",
            forwarded_headers=[], body=b"", body_uri=None,
            forwarded_for_ip=None, tcp_id=None, sni_host=None,
            extra_meta={},
        )

        # The queue is empty so _await_connect_200 will time out (we
        # set deadline=0.05s above).
        await runtime._dispatch_ws_upgrade_to_url(envelope)

        import h2.errors
        assert reset_calls == [(7, h2.errors.ErrorCodes.CANCEL)], (
            f"expected reset on stream 7; got {reset_calls!r}"
        )
        assert 7 not in runtime._streams
        assert 7 not in runtime._bridge_stream_ids
    finally:
        _wsu.open_ws_upstream = monkey_orig  # type: ignore[assignment]


@pytest.mark.asyncio
async def test_dispatch_ws_upgrade_callable_resets_bridge_on_open_failure():
    """Callable WSS path must RST the h2 CONNECT stream when the
    bridge fails to reach :status 200 — matches the URL WSS path so a
    misbehaving server doesn't leak half-open streams."""
    import asyncio

    async def app(scope, receive, send):
        # Accept the websocket scope so dispatch_ws_upgrade gets past
        # the run_until_accept gate. Then stall.
        await receive()
        await send({"type": "websocket.accept"})
        await asyncio.sleep(60)

    runtime = _make_runtime(forward_to=app)
    runtime._response_deadline_seconds = 0.05

    reset_calls: list[tuple[int, object]] = []

    class _FakeH2:
        def reset_stream(self, stream_id, error_code):
            reset_calls.append((stream_id, error_code))

        def send_data(self, *a, **kw):
            pass

    async def _fake_flush():
        return None

    async def _fake_post_response(request_id, *, status, headers, body, end_stream=True):
        return None

    runtime._h2 = _FakeH2()  # type: ignore[assignment]
    runtime._flush = _fake_flush  # type: ignore[assignment]
    runtime._open_stream_locked = lambda h, end_stream: 11  # type: ignore[assignment]
    runtime._post_response = _fake_post_response  # type: ignore[assignment]
    # Pre-register the bridge stream queue so _await_connect_200 can
    # park on it; it will time out at the 0.05s deadline.
    runtime._streams[11] = asyncio.Queue()

    envelope = Envelope(
        request_id="req-cb-1", method="GET", path="/ws",
        route_kind="ws-upgrade", ws_id="ws-cb-1",
        forwarded_headers=[], body=b"", body_uri=None,
        forwarded_for_ip=None, tcp_id=None, sni_host=None,
        extra_meta={},
    )

    await runtime._dispatch_ws_upgrade(envelope)

    import h2.errors
    assert reset_calls == [(11, h2.errors.ErrorCodes.CANCEL)], (
        f"expected reset on stream 11; got {reset_calls!r}"
    )
    assert 11 not in runtime._streams
    assert 11 not in runtime._bridge_stream_ids


@pytest.mark.asyncio
async def test_open_ws_upstream_handshake_timeout():
    """An upstream that completes TCP but stalls on the response head
    must trip the handshake timeout instead of wedging the dispatch."""
    from inkbox.tunnels.client._ws_upstream import (
        WsUpstreamError,
        open_ws_upstream,
    )

    async def stall(reader, writer):
        # Read the request, then never write anything.
        try:
            await reader.read(4096)
            await asyncio.sleep(60)
        finally:
            writer.close()

    server = await asyncio.start_server(stall, host="127.0.0.1", port=0)
    serve = asyncio.create_task(server.serve_forever())
    try:
        port = server.sockets[0].getsockname()[1]
        with pytest.raises(WsUpstreamError) as ei:
            await open_ws_upstream(
                forward_to=f"http://127.0.0.1:{port}",
                request_path="/ws",
                request_headers=[],
                ws_subprotocol=None,
                forwarded_for_ip=None,
                public_host="agent.test",
                handshake_timeout_s=0.3,
            )
        assert ei.value.status == 504
        assert "timeout" in ei.value.reason.lower()
    finally:
        serve.cancel()
        try:
            await serve
        except (asyncio.CancelledError, Exception):
            pass
        server.close()
        await server.wait_closed()


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
