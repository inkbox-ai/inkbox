"""WebSocket over h1 + callable (ASGI websocket-scope) tests.

Drives an ASGI websocket app through ``InProcH1ParserPlaintext`` +
``CallableDispatch`` end-to-end at the parser layer: feed an upgrade
request as plaintext bytes, capture outbound bytes, drive WS frames
through the parser, and assert the handler sees the right ASGI events.
"""

from __future__ import annotations

import asyncio
import base64
import os
from typing import Any

import pytest

from inkbox.tunnels.client._dispatch import CallableDispatch
from inkbox.tunnels.client._h1_server import InProcH1ParserPlaintext
from inkbox.tunnels.client._ws_passthrough import (
    compute_ws_accept,
)
from inkbox.tunnels.client._wsframe import (
    WS_OPCODE_BINARY,
    WS_OPCODE_CLOSE,
    WS_OPCODE_TEXT,
    encode_ws_frame,
)


def _build_upgrade_request(path: str = "/ws") -> tuple[bytes, str, str]:
    key_raw = os.urandom(16)
    key = base64.b64encode(key_raw).decode("ascii")
    accept = compute_ws_accept(key)
    request = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: agent.test\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n"
        f"\r\n"
    ).encode("ascii")
    return request, key, accept


async def _drain_outbound(parser: InProcH1ParserPlaintext) -> bytes:
    """Pull all currently-pending outbound chunks without blocking."""
    out = bytearray()
    pump_done = asyncio.Event()

    async def send(chunk: bytes) -> None:
        out.extend(chunk)

    async def pumper() -> None:
        try:
            await parser.pump_outbound(send)
        finally:
            pump_done.set()

    task = asyncio.create_task(pumper())
    # Yield enough times to let pump_outbound consume current chunks.
    for _ in range(5):
        await asyncio.sleep(0)
    await parser.aclose()
    try:
        await asyncio.wait_for(task, timeout=2.0)
    except asyncio.TimeoutError:
        task.cancel()
    return bytes(out)


@pytest.mark.asyncio
async def test_ws_over_h1_callable_basic_round_trip():
    seen: list[dict[str, Any]] = []

    async def app(scope, receive, send):
        assert scope["type"] == "websocket"
        assert scope["path"] == "/ws"
        evt = await receive()
        assert evt["type"] == "websocket.connect"
        await send({"type": "websocket.accept"})
        evt = await receive()
        seen.append(evt)
        await send({"type": "websocket.send", "text": "hello-back"})
        evt = await receive()
        seen.append(evt)

    dispatch = CallableDispatch(
        app=app, public_host="agent.test", max_outbound_body_bytes=1_000_000,
    )
    parser = InProcH1ParserPlaintext(
        dispatch=dispatch,
        max_inbound_body_bytes=1_000_000,
        forwarded_for_ip=None,
        sni_host=None,
        public_host="agent.test",
    )

    out_buf = bytearray()
    pump_done = asyncio.Event()

    async def send(chunk: bytes) -> None:
        out_buf.extend(chunk)

    async def pumper() -> None:
        try:
            await parser.pump_outbound(send)
        finally:
            pump_done.set()

    pump_task = asyncio.create_task(pumper())

    upgrade_req, _, accept = _build_upgrade_request()
    await parser.feed(upgrade_req)

    # Wait for the 101 response to land.
    for _ in range(50):
        if b"101 Switching Protocols" in bytes(out_buf):
            break
        await asyncio.sleep(0.01)
    assert b"101 Switching Protocols" in bytes(out_buf)
    assert (b"Sec-WebSocket-Accept: " + accept.encode("ascii")) in bytes(out_buf)

    # Strip the 101 head (everything before \r\n\r\n + the marker).
    head_end = bytes(out_buf).find(b"\r\n\r\n") + 4
    out_buf[:head_end] = b""

    # Send a masked client TEXT frame "ping-from-client".
    payload = b"ping-from-client"
    client_frame = encode_ws_frame(WS_OPCODE_TEXT, payload, mask=True)
    await parser.feed(client_frame)

    # Wait for server reply frame.
    for _ in range(50):
        # Server frames are unmasked, so decode manually below by
        # checking the buffer's first two bytes.
        if len(out_buf) >= 2:
            b0 = out_buf[0]
            b1 = out_buf[1]
            if (b1 & 0x7F) > 0 and len(out_buf) >= 2 + (b1 & 0x7F):
                break
        await asyncio.sleep(0.01)
    assert len(out_buf) >= 2
    b0 = out_buf[0]
    b1 = out_buf[1]
    assert (b0 & 0x0F) == WS_OPCODE_TEXT
    assert (b1 & 0x80) == 0  # server frames must NOT be masked
    plen = b1 & 0x7F
    assert plen < 126
    body = bytes(out_buf[2:2 + plen])
    assert body == b"hello-back"

    # Send a CLOSE frame from client to terminate.
    close_payload = (1000).to_bytes(2, "big") + b"bye"
    close_frame = encode_ws_frame(WS_OPCODE_CLOSE, close_payload, mask=True)
    await parser.feed(close_frame)

    # Let app see disconnect and finish.
    for _ in range(50):
        if any(e["type"] == "websocket.disconnect" for e in seen):
            break
        await asyncio.sleep(0.01)

    await parser.aclose()
    try:
        await asyncio.wait_for(pump_task, timeout=2.0)
    except asyncio.TimeoutError:
        pump_task.cancel()

    assert any(e["type"] == "websocket.disconnect" for e in seen)
    assert any(
        e["type"] == "websocket.receive" and e.get("text") == "ping-from-client"
        for e in seen
    )


@pytest.mark.asyncio
async def test_ws_over_h1_callable_handler_rejects_before_accept():
    async def app(scope, receive, send):
        evt = await receive()
        assert evt["type"] == "websocket.connect"
        await send({"type": "websocket.close", "code": 1008})

    dispatch = CallableDispatch(
        app=app, public_host="agent.test", max_outbound_body_bytes=1_000_000,
    )
    parser = InProcH1ParserPlaintext(
        dispatch=dispatch,
        max_inbound_body_bytes=1_000_000,
        forwarded_for_ip=None,
        sni_host=None,
        public_host="agent.test",
    )

    out_buf = bytearray()
    pump_done = asyncio.Event()

    async def sink(chunk: bytes) -> None:
        out_buf.extend(chunk)

    async def pumper() -> None:
        try:
            await parser.pump_outbound(sink)
        finally:
            pump_done.set()

    pump_task = asyncio.create_task(pumper())

    upgrade_req, _, _ = _build_upgrade_request()
    await parser.feed(upgrade_req)

    # Wait for the rejection response.
    for _ in range(50):
        if b"403" in bytes(out_buf):
            break
        await asyncio.sleep(0.01)
    assert b"HTTP/1.1 403" in bytes(out_buf)

    await parser.aclose()
    try:
        await asyncio.wait_for(pump_task, timeout=2.0)
    except asyncio.TimeoutError:
        pump_task.cancel()


@pytest.mark.asyncio
async def test_ws_over_h1_callable_subprotocol_negotiated():
    async def app(scope, receive, send):
        await receive()
        offered = scope.get("subprotocols", [])
        assert "v2.proto" in offered
        await send(
            {"type": "websocket.accept", "subprotocol": "v2.proto"},
        )
        await receive()  # disconnect

    dispatch = CallableDispatch(
        app=app, public_host="agent.test", max_outbound_body_bytes=1_000_000,
    )
    parser = InProcH1ParserPlaintext(
        dispatch=dispatch,
        max_inbound_body_bytes=1_000_000,
        forwarded_for_ip=None,
        sni_host=None,
        public_host="agent.test",
    )

    out_buf = bytearray()

    async def sink(chunk: bytes) -> None:
        out_buf.extend(chunk)

    pump_task = asyncio.create_task(parser.pump_outbound(sink))

    key_raw = os.urandom(16)
    key = base64.b64encode(key_raw).decode("ascii")
    upgrade = (
        f"GET /ws HTTP/1.1\r\n"
        f"Host: agent.test\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n"
        f"Sec-WebSocket-Protocol: v1.proto, v2.proto\r\n"
        f"\r\n"
    ).encode("ascii")
    await parser.feed(upgrade)

    for _ in range(50):
        if b"101 Switching Protocols" in bytes(out_buf):
            break
        await asyncio.sleep(0.01)
    assert b"Sec-WebSocket-Protocol: v2.proto" in bytes(out_buf)

    # Tear down.
    close_frame = encode_ws_frame(
        WS_OPCODE_CLOSE, (1000).to_bytes(2, "big"), mask=True,
    )
    await parser.feed(close_frame)
    await parser.aclose()
    try:
        await asyncio.wait_for(pump_task, timeout=2.0)
    except asyncio.TimeoutError:
        pump_task.cancel()


@pytest.mark.asyncio
async def test_ws_over_h1_callable_binary_round_trip():
    async def app(scope, receive, send):
        await receive()
        await send({"type": "websocket.accept"})
        evt = await receive()
        assert evt["type"] == "websocket.receive"
        assert evt.get("bytes") == b"\x00\x01\x02hello"
        await send({"type": "websocket.send", "bytes": b"reply\xff"})
        await receive()

    dispatch = CallableDispatch(
        app=app, public_host="agent.test", max_outbound_body_bytes=1_000_000,
    )
    parser = InProcH1ParserPlaintext(
        dispatch=dispatch,
        max_inbound_body_bytes=1_000_000,
        forwarded_for_ip=None,
        sni_host=None,
        public_host="agent.test",
    )

    out_buf = bytearray()

    async def sink(chunk: bytes) -> None:
        out_buf.extend(chunk)

    pump_task = asyncio.create_task(parser.pump_outbound(sink))

    upgrade_req, _, _ = _build_upgrade_request("/binws")
    await parser.feed(upgrade_req)
    for _ in range(50):
        if b"101 Switching Protocols" in bytes(out_buf):
            break
        await asyncio.sleep(0.01)
    head_end = bytes(out_buf).find(b"\r\n\r\n") + 4
    out_buf[:head_end] = b""

    bin_frame = encode_ws_frame(
        WS_OPCODE_BINARY, b"\x00\x01\x02hello", mask=True,
    )
    await parser.feed(bin_frame)

    for _ in range(50):
        if len(out_buf) >= 2:
            b0 = out_buf[0]
            b1 = out_buf[1]
            plen = b1 & 0x7F
            if plen and len(out_buf) >= 2 + plen and (b0 & 0x0F) == WS_OPCODE_BINARY:
                break
        await asyncio.sleep(0.01)
    b0 = out_buf[0]
    b1 = out_buf[1]
    plen = b1 & 0x7F
    assert (b0 & 0x0F) == WS_OPCODE_BINARY
    assert bytes(out_buf[2:2 + plen]) == b"reply\xff"

    close_frame = encode_ws_frame(
        WS_OPCODE_CLOSE, (1000).to_bytes(2, "big"), mask=True,
    )
    await parser.feed(close_frame)
    await parser.aclose()
    try:
        await asyncio.wait_for(pump_task, timeout=2.0)
    except asyncio.TimeoutError:
        pump_task.cancel()
