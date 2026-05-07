"""Unit tests for the in-process h1 parser plaintext adapter."""

from __future__ import annotations

import asyncio


from inkbox.tunnels.client._dispatch import (
    DispatchRequest,
    DispatchResponseHead,
)
from inkbox.tunnels.client._h1_server import InProcH1ParserPlaintext


class _StubDispatch:
    """Capture the request, then emit a fixed response."""

    def __init__(
        self,
        *,
        status: int = 200,
        body: bytes = b"hello",
        headers: list[tuple[str, str]] | None = None,
    ) -> None:
        self.status = status
        self.body = body
        self.headers = headers or [
            ("content-type", "text/plain"),
            ("content-length", str(len(body))),
        ]
        self.captured: DispatchRequest | None = None
        self.captured_body = bytearray()

    async def dispatch(self, request, response):
        self.captured = request
        async for chunk in request.body:
            self.captured_body.extend(chunk)
        await response.send_head(
            DispatchResponseHead(status=self.status, headers=self.headers),
        )
        if self.body:
            await response.send_body(self.body)
        await response.end_body()

    async def aclose(self):
        pass


async def _drive_parser(
    parser: InProcH1ParserPlaintext, request_bytes: bytes,
    *, timeout: float = 1.0,
) -> bytes:
    """Feed request_bytes; collect outbound bytes until the parser closes."""
    received = bytearray()

    async def _send(chunk: bytes) -> None:
        received.extend(chunk)

    pump = asyncio.create_task(parser.pump_outbound(_send))
    await parser.feed(request_bytes)
    # Wait for the pump to drain (pump returns when sentinel is pushed).
    try:
        await asyncio.wait_for(pump, timeout=timeout)
    except asyncio.TimeoutError:
        pump.cancel()
    return bytes(received)


async def test_h1_parser_basic_get():
    dispatch = _StubDispatch(status=200, body=b"hello-world")
    parser = InProcH1ParserPlaintext(
        dispatch=dispatch,
        max_inbound_body_bytes=1_000_000,
        forwarded_for_ip="1.2.3.4",
        sni_host="my-agent.example",
    )
    req = (
        b"GET /webhook?x=1 HTTP/1.1\r\n"
        b"Host: my-agent.example\r\n"
        b"Connection: close\r\n"
        b"\r\n"
    )
    out = await _drive_parser(parser, req)
    assert b"HTTP/1.1 200" in out
    assert b"hello-world" in out
    assert dispatch.captured is not None
    assert dispatch.captured.method == "GET"
    assert dispatch.captured.path == "/webhook?x=1"
    assert dispatch.captured.forwarded_for_ip == "1.2.3.4"
    assert dispatch.captured.sni_host == "my-agent.example"
    # Headers normalized to lower-case.
    keys = {k for k, _ in dispatch.captured.headers}
    assert "host" in keys
    assert "connection" in keys


async def test_h1_parser_post_with_body():
    dispatch = _StubDispatch(body=b"echoed")
    parser = InProcH1ParserPlaintext(
        dispatch=dispatch,
        max_inbound_body_bytes=1_000_000,
        forwarded_for_ip=None,
        sni_host=None,
    )
    req = (
        b"POST /e HTTP/1.1\r\n"
        b"Host: localhost\r\n"
        b"Content-Length: 11\r\n"
        b"Connection: close\r\n"
        b"\r\n"
        b"hello-world"
    )
    out = await _drive_parser(parser, req)
    assert b"HTTP/1.1 200" in out
    assert dispatch.captured_body == b"hello-world"


async def test_h1_parser_413_on_inbound_body_cap():
    dispatch = _StubDispatch(body=b"unused")
    parser = InProcH1ParserPlaintext(
        dispatch=dispatch,
        max_inbound_body_bytes=8,  # tiny cap
        forwarded_for_ip=None,
        sni_host=None,
    )
    req = (
        b"POST /e HTTP/1.1\r\n"
        b"Host: localhost\r\n"
        b"Content-Length: 100\r\n"
        b"Connection: close\r\n"
        b"\r\n"
        + (b"X" * 100)
    )
    out = await _drive_parser(parser, req)
    assert b"HTTP/1.1 413" in out
    assert b"payload too large" in out


async def test_h1_parser_413_unblocks_body_consumer():
    """Regression: 413 must signal end-of-body so a dispatcher iterating
    ``request.body`` doesn't hang waiting for a chunk that won't arrive.
    """
    body_consume_done = asyncio.Event()

    class _BodyConsumingDispatch:
        async def dispatch(self, request, response):
            # Drain the body iterator. Before the fix this hangs after
            # the 413 because the body queue never got its sentinel.
            async for _ in request.body:
                pass
            body_consume_done.set()

        async def aclose(self):
            pass

    parser = InProcH1ParserPlaintext(
        dispatch=_BodyConsumingDispatch(),
        max_inbound_body_bytes=8,
        forwarded_for_ip=None,
        sni_host=None,
    )
    req = (
        b"POST /e HTTP/1.1\r\n"
        b"Host: localhost\r\n"
        b"Content-Length: 100\r\n"
        b"\r\n"
        + (b"X" * 100)
    )

    out = bytearray()

    async def sink(c):
        out.extend(c)

    pump = asyncio.create_task(parser.pump_outbound(sink))
    await parser.feed(req)

    # Without the fix the body iterator never returns; bound the wait.
    try:
        await asyncio.wait_for(body_consume_done.wait(), timeout=1.0)
    finally:
        await parser.aclose()
        try:
            await asyncio.wait_for(pump, timeout=1.0)
        except asyncio.TimeoutError:
            pump.cancel()

    assert body_consume_done.is_set()
    assert b"HTTP/1.1 413" in bytes(out)


async def test_h1_parser_chunked_body():
    dispatch = _StubDispatch(body=b"ok")
    parser = InProcH1ParserPlaintext(
        dispatch=dispatch,
        max_inbound_body_bytes=1_000_000,
        forwarded_for_ip=None,
        sni_host=None,
    )
    req = (
        b"POST /e HTTP/1.1\r\n"
        b"Host: localhost\r\n"
        b"Transfer-Encoding: chunked\r\n"
        b"Connection: close\r\n"
        b"\r\n"
        b"5\r\nhello\r\n"
        b"5\r\nworld\r\n"
        b"0\r\n\r\n"
    )
    out = await _drive_parser(parser, req)
    assert b"HTTP/1.1 200" in out
    assert dispatch.captured_body == b"helloworld"


async def test_h1_parser_websocket_upgrade_detected():
    """The parser must surface Upgrade: websocket as is_websocket=True."""
    captured: DispatchRequest | None = None

    class _Capture(_StubDispatch):
        async def dispatch(self, request, response):
            nonlocal captured
            captured = request
            # Don't actually 101 in this unit test — just close.
            await response.send_head(
                DispatchResponseHead(
                    status=400,
                    headers=[("content-type", "text/plain"),
                             ("content-length", "0")],
                ),
            )
            await response.end_body()

    dispatch = _Capture()
    parser = InProcH1ParserPlaintext(
        dispatch=dispatch,
        max_inbound_body_bytes=1_000_000,
        forwarded_for_ip=None,
        sni_host=None,
    )
    req = (
        b"GET /ws HTTP/1.1\r\n"
        b"Host: localhost\r\n"
        b"Upgrade: websocket\r\n"
        b"Connection: Upgrade\r\n"
        b"Sec-WebSocket-Version: 13\r\n"
        b"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
        b"Sec-WebSocket-Protocol: chat\r\n"
        b"\r\n"
    )
    await _drive_parser(parser, req)
    assert captured is not None
    assert captured.is_websocket is True
    assert captured.ws_subprotocol == "chat"
