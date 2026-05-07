"""Edge-mode URL WS bridging — focused tests for the upstream WS hop.

The full bridge-stream pump (`_pump_ws_url_bridge`) is exercised
indirectly via the URL-WS passthrough tests since they share the same
`open_ws_upstream` helper. These tests pin the helper's contract:
successful 101 + accept verification, structured error on upstream
unreachable, structured error on bad accept.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib

import pytest

from inkbox.tunnels.client._ws_upstream import (
    WsUpstreamError,
    open_ws_upstream,
)


WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def _accept_for(key: str) -> str:
    return base64.b64encode(
        hashlib.sha1((key + WS_GUID).encode("ascii")).digest(),
    ).decode("ascii")


async def _good_upstream(
    port_holder: list[int], subprotocol: str | None = None,
) -> asyncio.AbstractServer:
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
        ]
        if subprotocol:
            lines.append(f"Sec-WebSocket-Protocol: {subprotocol}")
        writer.write(("\r\n".join(lines) + "\r\n\r\n").encode("ascii"))
        await writer.drain()
        try:
            await reader.read()
        finally:
            writer.close()

    server = await asyncio.start_server(handle, host="127.0.0.1", port=0)
    port_holder.append(server.sockets[0].getsockname()[1])
    return server


async def _bad_accept_upstream(
    port_holder: list[int],
) -> asyncio.AbstractServer:
    async def handle(reader, writer):
        head = bytearray()
        while b"\r\n\r\n" not in bytes(head):
            chunk = await reader.read(4096)
            if not chunk:
                writer.close()
                return
            head.extend(chunk)
        writer.write(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                "Sec-WebSocket-Accept: AAAAAAAAAAAAAAAAAAAAAAAAAAA=\r\n\r\n"
            ).encode("ascii"),
        )
        await writer.drain()
        try:
            await reader.read()
        finally:
            writer.close()

    server = await asyncio.start_server(handle, host="127.0.0.1", port=0)
    port_holder.append(server.sockets[0].getsockname()[1])
    return server


@pytest.mark.asyncio
async def test_open_ws_upstream_succeeds_and_returns_subprotocol():
    port_holder: list[int] = []
    server = await _good_upstream(port_holder, subprotocol="v2.proto")
    serve = asyncio.create_task(server.serve_forever())
    try:
        port = port_holder[0]
        up = await open_ws_upstream(
            forward_to=f"http://127.0.0.1:{port}",
            request_path="/ws",
            request_headers=[("sec-websocket-protocol", "v1.proto, v2.proto")],
            ws_subprotocol="v1.proto, v2.proto",
            forwarded_for_ip="1.2.3.4",
            public_host="agent.test",
        )
        try:
            assert up.subprotocol == "v2.proto"
            assert up.reader is not None
            assert up.writer is not None
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
async def test_open_ws_upstream_502_when_upstream_unreachable():
    # Bind a port then release it — `connect` will refuse.
    sock = await asyncio.start_server(lambda r, w: None, "127.0.0.1", 0)
    port = sock.sockets[0].getsockname()[1]
    sock.close()
    await sock.wait_closed()

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


@pytest.mark.asyncio
async def test_open_ws_upstream_502_when_accept_mismatches():
    port_holder: list[int] = []
    server = await _bad_accept_upstream(port_holder)
    serve = asyncio.create_task(server.serve_forever())
    try:
        port = port_holder[0]
        with pytest.raises(WsUpstreamError) as ei:
            await open_ws_upstream(
                forward_to=f"http://127.0.0.1:{port}",
                request_path="/ws",
                request_headers=[],
                ws_subprotocol=None,
                forwarded_for_ip=None,
                public_host="agent.test",
            )
        # Bad accept surfaces as a generic 502 — same as other
        # protocol-correctness failures on the upstream hop.
        assert ei.value.status == 502
        assert "accept" in ei.value.reason.lower()
    finally:
        serve.cancel()
        try:
            await serve
        except (asyncio.CancelledError, Exception):
            pass
        server.close()
        await server.wait_closed()
