"""WS-over-h1 → URL upstream bridging.

Drives an h1 ``Upgrade: websocket`` through ``InProcH1ParserPlaintext``
+ ``UpstreamUrlDispatch.dispatch_websocket`` against a tiny raw-socket
WS upstream that echoes frames.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import os

import pytest

from inkbox.tunnels.client._dispatch import UpstreamUrlDispatch
from inkbox.tunnels.client._h1_server import InProcH1ParserPlaintext
from inkbox.tunnels.client._ws_passthrough import (
    decode_client_frame,
    encode_server_frame,
)
from inkbox.tunnels.client._wsframe import (
    WS_OPCODE_CLOSE,
    WS_OPCODE_TEXT,
    encode_ws_frame,
)


WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def _accept_for(key: str) -> str:
    return base64.b64encode(
        hashlib.sha1((key + WS_GUID).encode("ascii")).digest(),
    ).decode("ascii")


async def _run_echo_upstream(
    host: str, port_holder: list[int],
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
        writer.write(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
            ).encode("ascii"),
        )
        await writer.drain()
        rest = bytes(head).split(b"\r\n\r\n", 1)[1]
        buf = bytearray(rest)
        try:
            while True:
                decoded = decode_client_frame(buf, require_mask=True)
                if decoded is None:
                    chunk = await reader.read(4096)
                    if not chunk:
                        return
                    buf.extend(chunk)
                    continue
                opcode, payload, fin = decoded
                if opcode == WS_OPCODE_CLOSE:
                    writer.write(encode_server_frame(WS_OPCODE_CLOSE, payload))
                    await writer.drain()
                    return
                writer.write(
                    encode_server_frame(
                        opcode if opcode != 0x0 else WS_OPCODE_TEXT,
                        payload,
                        fin=fin,
                    ),
                )
                await writer.drain()
        finally:
            writer.close()

    server = await asyncio.start_server(handle, host=host, port=0)
    port_holder.append(server.sockets[0].getsockname()[1])
    return server


@pytest.mark.asyncio
async def test_ws_over_h1_to_url_upstream_text_echo():
    port_holder: list[int] = []
    server = await _run_echo_upstream("127.0.0.1", port_holder)
    serve_task = asyncio.create_task(server.serve_forever())
    try:
        port = port_holder[0]
        forward_to = f"http://127.0.0.1:{port}"
        dispatch = UpstreamUrlDispatch(
            forward_to=forward_to,
            public_host="agent.test",
            max_outbound_body_bytes=1_000_000,
            max_inbound_body_bytes=1_000_000,
        )
        try:
            parser = InProcH1ParserPlaintext(
                dispatch=dispatch,
                max_inbound_body_bytes=1_000_000,
                forwarded_for_ip=None,
                sni_host=None,
            )
            out = bytearray()

            async def sink(c):
                out.extend(c)

            pump = asyncio.create_task(parser.pump_outbound(sink))

            key = base64.b64encode(os.urandom(16)).decode("ascii")
            upgrade = (
                f"GET /ws HTTP/1.1\r\n"
                f"Host: agent.test\r\n"
                f"Upgrade: websocket\r\n"
                f"Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\n"
                f"Sec-WebSocket-Version: 13\r\n\r\n"
            ).encode("ascii")
            await parser.feed(upgrade)

            for _ in range(200):
                if b"101 Switching Protocols" in bytes(out):
                    break
                await asyncio.sleep(0.02)
            assert b"101 Switching Protocols" in bytes(out)
            head_end = bytes(out).find(b"\r\n\r\n") + 4
            out[:head_end] = b""

            # Send TEXT frame (masked, h1 client).
            text = encode_ws_frame(
                WS_OPCODE_TEXT, b"hello-h1-bridge", mask=True,
            )
            await parser.feed(text)

            # Receive echo back as a server frame (unmasked).
            decoded = None
            for _ in range(400):
                decoded = decode_client_frame(out, require_mask=False)
                if decoded is not None and decoded[0] == WS_OPCODE_TEXT:
                    break
                await asyncio.sleep(0.02)
            assert decoded is not None
            assert decoded[1] == b"hello-h1-bridge"

            close = encode_ws_frame(
                WS_OPCODE_CLOSE, (1000).to_bytes(2, "big"), mask=True,
            )
            await parser.feed(close)
            await asyncio.sleep(0.1)
            await parser.aclose()
            try:
                await asyncio.wait_for(pump, timeout=2.0)
            except asyncio.TimeoutError:
                pump.cancel()
        finally:
            await dispatch.aclose()
    finally:
        serve_task.cancel()
        try:
            await serve_task
        except (asyncio.CancelledError, Exception):
            pass
        server.close()
        await server.wait_closed()


async def _run_bad_accept_upstream(
    host: str, port_holder: list[int],
) -> asyncio.AbstractServer:
    """Upstream that returns 101 with a *wrong* Sec-WebSocket-Accept."""
    async def handle(reader, writer):
        head = bytearray()
        while b"\r\n\r\n" not in bytes(head):
            chunk = await reader.read(4096)
            if not chunk:
                writer.close()
                return
            head.extend(chunk)
        # Always reply with the same wrong digest, regardless of the
        # client's key. RFC 6455 §1.3 says this MUST cause the client
        # to fail the connection.
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

    server = await asyncio.start_server(handle, host=host, port=0)
    port_holder.append(server.sockets[0].getsockname()[1])
    return server


@pytest.mark.asyncio
async def test_ws_over_h1_to_url_upstream_rejects_wrong_accept():
    """Upstream returns 101 with an incorrect Sec-WebSocket-Accept; the
    bridge must refuse and surface a non-101 to the third party."""
    port_holder: list[int] = []
    server = await _run_bad_accept_upstream("127.0.0.1", port_holder)
    serve_task = asyncio.create_task(server.serve_forever())
    try:
        port = port_holder[0]
        forward_to = f"http://127.0.0.1:{port}"
        dispatch = UpstreamUrlDispatch(
            forward_to=forward_to,
            public_host="agent.test",
            max_outbound_body_bytes=1_000_000,
            max_inbound_body_bytes=1_000_000,
        )
        try:
            parser = InProcH1ParserPlaintext(
                dispatch=dispatch,
                max_inbound_body_bytes=1_000_000,
                forwarded_for_ip=None,
                sni_host=None,
            )
            out = bytearray()

            async def sink(c):
                out.extend(c)

            pump = asyncio.create_task(parser.pump_outbound(sink))

            key = base64.b64encode(os.urandom(16)).decode("ascii")
            upgrade = (
                f"GET /ws HTTP/1.1\r\n"
                f"Host: agent.test\r\n"
                f"Upgrade: websocket\r\n"
                f"Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\n"
                f"Sec-WebSocket-Version: 13\r\n\r\n"
            ).encode("ascii")
            await parser.feed(upgrade)

            for _ in range(200):
                if b"HTTP/1.1 502" in bytes(out):
                    break
                await asyncio.sleep(0.02)
            assert b"HTTP/1.1 502" in bytes(out)
            assert b"101 Switching Protocols" not in bytes(out)

            await parser.aclose()
            try:
                await asyncio.wait_for(pump, timeout=2.0)
            except asyncio.TimeoutError:
                pump.cancel()
        finally:
            await dispatch.aclose()
    finally:
        serve_task.cancel()
        try:
            await serve_task
        except (asyncio.CancelledError, Exception):
            pass
        server.close()
        await server.wait_closed()
