"""WS upgrade response headers — application-defined headers on the
upstream's 101 must flow back to the third party.

Pre-fix shape stripped everything except ``sec-websocket-protocol`` from
the upstream 101, which silently broke any application that uses the
upgrade response as a header surface (e.g. ``X-Use-Inkbox-*`` opt-out
flags, ``Set-Cookie`` for session establishment).

These tests pin the contract:
1. ``open_ws_upstream`` returns the full lowercase header list.
2. ``_dispatch_ws_upgrade_to_url`` forwards them, filtering only
   hop-by-hop + ws-handshake-control + h2 pseudo-headers.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib

import pytest

from inkbox.tunnels.client._envelope import Envelope
from inkbox.tunnels.client._runtime import TunnelRuntime
from inkbox.tunnels.client._ws_upstream import open_ws_upstream


WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def _accept_for(key: str) -> str:
    return base64.b64encode(
        hashlib.sha1((key + WS_GUID).encode("ascii")).digest(),
    ).decode("ascii")


async def _start_app_header_upstream(
    port_holder: list[int], extra_headers: list[tuple[str, str]],
) -> asyncio.AbstractServer:
    """Real upstream that completes the WS upgrade with the listed
    extra headers on the 101."""

    async def handle(reader, writer):
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
        accept = _accept_for(ws_key)
        lines = [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            f"Sec-WebSocket-Accept: {accept}",
            *(f"{k}: {v}" for k, v in extra_headers),
        ]
        writer.write(("\r\n".join(lines) + "\r\n\r\n").encode("ascii"))
        await writer.drain()
        try:
            await reader.read()
        finally:
            writer.close()

    server = await asyncio.start_server(handle, host="127.0.0.1", port=0)
    port_holder.append(server.sockets[0].getsockname()[1])
    return server


@pytest.mark.asyncio
async def test_open_ws_upstream_captures_all_response_headers():
    port_holder: list[int] = []
    extra = [
        ("Sec-WebSocket-Protocol", "chat"),
        ("X-Custom", "value-1"),
        ("X-Use-Inkbox-Text-To-Speech", "false"),
        ("X-Use-Inkbox-Speech-To-Text", "false"),
        ("Set-Cookie", "session=abc; Path=/"),
    ]
    server = await _start_app_header_upstream(port_holder, extra)
    serve = asyncio.create_task(server.serve_forever())
    try:
        port = port_holder[0]
        up = await open_ws_upstream(
            forward_to=f"http://127.0.0.1:{port}",
            request_path="/ws",
            request_headers=[],
            ws_subprotocol="chat",
            forwarded_for_ip=None,
            public_host="agent.test",
        )
        try:
            # Headers list must include every header the upstream sent
            # except those filtered at parse time. Names must be
            # lowercase. Hop-by-hop (Upgrade, Connection) and the
            # already-validated handshake-control headers are
            # acceptable to either include or exclude here — they get
            # filtered at forward time. We assert that the
            # application-defined headers ARE present.
            names = [k for (k, _) in up.headers]
            assert ("x-custom", "value-1") in up.headers
            assert ("x-use-inkbox-text-to-speech", "false") in up.headers
            assert ("x-use-inkbox-speech-to-text", "false") in up.headers
            assert ("set-cookie", "session=abc; Path=/") in up.headers
            # All names lowercased.
            for k in names:
                assert k == k.lower(), f"non-lowercase header name: {k!r}"
        finally:
            up.writer.close()
            await up.writer.wait_closed()
    finally:
        serve.cancel()
        try:
            await serve
        except (asyncio.CancelledError, Exception):
            pass
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_passthrough_dispatch_websocket_forwards_app_headers():
    """Passthrough path (`UpstreamUrlDispatch.dispatch_websocket`) must
    forward upstream 101 response headers via ws.accept(headers=...).
    The edge fix covered _dispatch_ws_upgrade_to_url; this is the
    parallel passthrough call site."""
    from inkbox.tunnels.client._dispatch import (
        DispatchRequest,
        UpstreamUrlDispatch,
    )

    port_holder: list[int] = []
    extra = [
        ("Sec-WebSocket-Protocol", "chat"),
        ("X-Custom", "value-1"),
        ("X-Use-Inkbox-Text-To-Speech", "false"),
        ("X-Use-Inkbox-Speech-To-Text", "false"),
        ("Set-Cookie", "session=abc; Path=/"),
        # These should be stripped by the SDK's filter.
        ("Connection", "Upgrade"),
        ("Upgrade", "websocket"),
    ]
    server = await _start_app_header_upstream(port_holder, extra)
    serve = asyncio.create_task(server.serve_forever())
    try:
        port = port_holder[0]

        # Fake WebSocketSink that captures the accept() args.
        captured_accept: dict = {}

        class _FakeSink:
            async def accept(self, *, subprotocol=None, headers=None):
                captured_accept["subprotocol"] = subprotocol
                captured_accept["headers"] = (
                    list(headers) if headers is not None else None
                )

            async def reject(self, *, status: int = 400):
                captured_accept["rejected"] = status

            async def send_frame(self, *a, **kw):
                pass

            async def recv_frame(self):
                # Returning None ends the bridge loop after accept.
                return None

            async def aclose(self):
                pass

        dispatch = UpstreamUrlDispatch(
            forward_to=f"http://127.0.0.1:{port}",
            public_host="agent.test",
            max_outbound_body_bytes=1_000_000,
            max_inbound_body_bytes=1_000_000,
        )
        try:
            async def _empty_body():
                if False:
                    yield b""

            request = DispatchRequest(
                method="GET",
                path="/ws",
                headers=[("sec-websocket-protocol", "chat")],
                body=_empty_body(),
                forwarded_for_ip=None,
                sni_host=None,
                ws_subprotocol="chat",
                is_websocket=True,
            )
            await dispatch.dispatch_websocket(request, _FakeSink())
        finally:
            await dispatch.aclose()

        assert "rejected" not in captured_accept, (
            f"upstream upgrade rejected: {captured_accept!r}"
        )
        assert captured_accept.get("subprotocol") == "chat"
        forwarded = captured_accept.get("headers") or []
        names_to_values = {k.lower(): v for (k, v) in forwarded}
        names = {k.lower() for (k, _) in forwarded}

        # Application-defined headers must be present.
        assert names_to_values.get("x-custom") == "value-1"
        assert names_to_values.get("x-use-inkbox-text-to-speech") == "false"
        assert names_to_values.get("x-use-inkbox-speech-to-text") == "false"
        assert names_to_values.get("set-cookie") == "session=abc; Path=/"

        # Hop-by-hop / handshake-control / pseudo MUST NOT be forwarded.
        assert "connection" not in names
        assert "upgrade" not in names
        assert "sec-websocket-accept" not in names
        assert "sec-websocket-extensions" not in names
        assert "sec-websocket-key" not in names
        assert "sec-websocket-version" not in names
        # sec-websocket-protocol rides the subprotocol field, not the
        # headers list — the filter must not double-emit it.
        assert "sec-websocket-protocol" not in names
        for k in names:
            assert not k.startswith(":"), f"pseudo-header leaked: {k!r}"
    finally:
        serve.cancel()
        try:
            await serve
        except (asyncio.CancelledError, Exception):
            pass
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_dispatch_ws_upgrade_to_url_forwards_app_headers():
    """End-to-end: from envelope intake through to the
    ``/_system/response/{request_id}`` post — the response headers
    list must contain the upstream's app-defined headers and must
    NOT contain hop-by-hop or ws-handshake-control headers."""
    from uuid import uuid4

    port_holder: list[int] = []
    extra = [
        ("Sec-WebSocket-Protocol", "chat"),
        ("X-Custom", "value-1"),
        ("X-Use-Inkbox-Text-To-Speech", "false"),
        ("X-Use-Inkbox-Speech-To-Text", "false"),
        ("Set-Cookie", "session=abc; Path=/"),
    ]
    server = await _start_app_header_upstream(port_holder, extra)
    serve = asyncio.create_task(server.serve_forever())
    try:
        port = port_holder[0]

        runtime = TunnelRuntime(
            tunnel_id=uuid4(),
            secret="sec",
            zone="inkboxwire.example",
            public_host="my-agent.inkboxwire.example",
            pool_size=1,
            forward_to=f"http://127.0.0.1:{port}",
            tls_terminator=None,
        )
        runtime._response_deadline_seconds = 5.0

        # Capture the post made by _post_response on the 200 upgrade
        # reply. Stub h2 + open_stream + the bridge wait so we don't
        # need a real h2 server — what we care about is the headers
        # list passed to _post_response.
        captured: list[tuple[int, list[tuple[str, str]]]] = []

        async def _capture_post_response(
            request_id, *, status, headers, body, end_stream=True,
        ):
            captured.append((status, list(headers)))

        runtime._post_response = _capture_post_response  # type: ignore[assignment]

        # _dispatch_ws_upgrade_to_url: opens upstream, posts 200,
        # opens bridge stream, waits for status. We let it open the
        # real upstream (we have one running). We stub _h2 +
        # _open_stream_locked so the bridge open + wait don't blow
        # up — we never reach a real bridge in this test.
        class _FakeH2:
            def reset_stream(self, *a, **kw): pass
            def send_data(self, *a, **kw): pass

        async def _fake_flush(): return None
        runtime._h2 = _FakeH2()  # type: ignore[assignment]
        runtime._flush = _fake_flush  # type: ignore[assignment]
        runtime._open_stream_locked = lambda h, end_stream: 99  # type: ignore[assignment]
        runtime._streams[99] = asyncio.Queue()
        # Make the bridge wait fail fast — we only care about the
        # _post_response call that happened BEFORE the wait.
        runtime._response_deadline_seconds = 0.05

        envelope = Envelope(
            request_id="req-headers-1",
            method="GET",
            path="/ws",
            route_kind="ws-upgrade",
            ws_id="ws-headers-1",
            forwarded_headers=[
                ("sec-websocket-protocol", "chat"),
            ],
            body=b"",
            body_uri=None,
            forwarded_for_ip=None,
            tcp_id=None,
            sni_host=None,
            extra_meta={},
        )

        await runtime._dispatch_ws_upgrade_to_url(envelope)

        # First captured post is the 200 upgrade reply.
        assert captured, "no _post_response call recorded"
        assert captured[0][0] == 200
        headers = captured[0][1]
        names_to_values = {k.lower(): v for (k, v) in headers}
        names = {k.lower() for (k, _) in headers}

        # Must include the application-defined headers.
        assert ("sec-websocket-protocol", "chat") in [
            (k.lower(), v) for (k, v) in headers
        ]
        assert names_to_values.get("x-custom") == "value-1"
        assert names_to_values.get("x-use-inkbox-text-to-speech") == "false"
        assert names_to_values.get("x-use-inkbox-speech-to-text") == "false"
        assert names_to_values.get("set-cookie") == "session=abc; Path=/"

        # Must NOT include hop-by-hop / handshake-control / pseudo.
        assert "connection" not in names
        assert "upgrade" not in names
        assert "sec-websocket-accept" not in names
        assert "sec-websocket-extensions" not in names
        assert "sec-websocket-key" not in names
        assert "sec-websocket-version" not in names
        for k in names:
            assert not k.startswith(":"), f"pseudo-header leaked: {k!r}"
    finally:
        serve.cancel()
        try:
            await serve
        except (asyncio.CancelledError, Exception):
            pass
        server.close()
        await server.wait_closed()
