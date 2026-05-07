"""WS-over-h2 → URL upstream bridging.

Spins up a tiny raw-socket WS upstream that echoes TEXT frames, then
drives an Extended CONNECT request through the h2 transcoder + an
``UpstreamUrlDispatch`` pointed at that upstream. Verifies the
transcoder bridges frames in both directions verbatim.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib

import h2.config
import h2.connection
import h2.events
import pytest

from inkbox.tunnels.client._dispatch import UpstreamUrlDispatch
from inkbox.tunnels.client._h2_transcode import H2TranscoderPlaintext
from inkbox.tunnels.client._ws_passthrough import (
    decode_client_frame,
    encode_server_frame,
)
from inkbox.tunnels.client._wsframe import (
    WS_OPCODE_CLOSE,
    WS_OPCODE_TEXT,
)


WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def _accept_for(key: str) -> str:
    return base64.b64encode(
        hashlib.sha1((key + WS_GUID).encode("ascii")).digest(),
    ).decode("ascii")


async def _run_echo_upstream(host: str, port_holder: list[int]) -> asyncio.AbstractServer:
    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        # Read upgrade request.
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
        upgrade_resp = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
        ).encode("ascii")
        writer.write(upgrade_resp)
        await writer.drain()

        # Echo frames.
        buf = bytearray()
        # Drain any leftover bytes from the upgrade read.
        rest = bytes(head).split(b"\r\n\r\n", 1)[1] if b"\r\n\r\n" in bytes(head) else b""
        if rest:
            buf.extend(rest)
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
                # Echo back as server frame (unmasked).
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
    port = server.sockets[0].getsockname()[1]
    port_holder.append(port)
    return server


@pytest.mark.asyncio
async def test_ws_over_h2_to_url_upstream_text_echo():
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
            transcoder = H2TranscoderPlaintext(
                dispatch=dispatch, max_inbound_body_bytes=1_000_000,
            )
            out = bytearray()

            async def s(d):
                out.extend(d)

            pump = asyncio.create_task(transcoder.pump_outbound(s))
            await asyncio.sleep(0)

            client = h2.connection.H2Connection(
                config=h2.config.H2Configuration(
                    client_side=True, header_encoding="utf-8",
                ),
            )
            client.initiate_connection()
            await transcoder.feed(client.data_to_send())
            await asyncio.sleep(0.05)
            client.receive_data(bytes(out))
            out.clear()
            await transcoder.feed(client.data_to_send())
            await asyncio.sleep(0.05)
            if out:
                client.receive_data(bytes(out))
                out.clear()

            headers = [
                (":method", "CONNECT"),
                (":scheme", "https"),
                (":authority", "agent.test"),
                (":path", "/ws"),
                (":protocol", "websocket"),
                ("sec-websocket-version", "13"),
            ]
            stream_id = client.get_next_available_stream_id()
            client.send_headers(stream_id, headers, end_stream=False)
            await transcoder.feed(client.data_to_send())

            response_status: str | None = None
            for _ in range(200):
                if out:
                    data = bytes(out)
                    out.clear()
                    for ev in client.receive_data(data):
                        if isinstance(ev, h2.events.ResponseReceived):
                            for k, v in ev.headers:
                                if k == ":status":
                                    response_status = v
                    if response_status is not None:
                        break
                await asyncio.sleep(0.02)
            assert response_status == "200"

            # Send a TEXT frame from the third party (h2: unmasked).
            text_frame = encode_server_frame(WS_OPCODE_TEXT, b"hello-bridge")
            client.send_data(stream_id, text_frame)
            await transcoder.feed(client.data_to_send())

            # Wait for the echo back as DATA on the stream.
            payload = bytearray()
            decoded = None
            for _ in range(400):
                if out:
                    data = bytes(out)
                    out.clear()
                    for ev in client.receive_data(data):
                        if isinstance(ev, h2.events.DataReceived):
                            payload.extend(ev.data)
                            client.acknowledge_received_data(
                                ev.flow_controlled_length, stream_id,
                            )
                    await transcoder.feed(client.data_to_send())
                decoded = decode_client_frame(payload, require_mask=False)
                if decoded is not None and decoded[0] == WS_OPCODE_TEXT:
                    break
                await asyncio.sleep(0.02)
            assert decoded is not None
            assert decoded[0] == WS_OPCODE_TEXT
            assert decoded[1] == b"hello-bridge"

            # Send CLOSE.
            close_frame = encode_server_frame(
                WS_OPCODE_CLOSE, (1000).to_bytes(2, "big"),
            )
            client.send_data(stream_id, close_frame)
            await transcoder.feed(client.data_to_send())

            await asyncio.sleep(0.1)
            await transcoder.aclose()
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


@pytest.mark.asyncio
async def test_ws_over_h2_to_url_upstream_rejects_502_when_upstream_unreachable():
    # Pick a definitely-closed port — bind and immediately release.
    sock = await asyncio.start_server(lambda r, w: None, "127.0.0.1", 0)
    port = sock.sockets[0].getsockname()[1]
    sock.close()
    await sock.wait_closed()

    forward_to = f"http://127.0.0.1:{port}"
    dispatch = UpstreamUrlDispatch(
        forward_to=forward_to,
        public_host="agent.test",
        max_outbound_body_bytes=1_000_000,
        max_inbound_body_bytes=1_000_000,
    )
    try:
        transcoder = H2TranscoderPlaintext(
            dispatch=dispatch, max_inbound_body_bytes=1_000_000,
        )
        out = bytearray()

        async def s(d):
            out.extend(d)

        pump = asyncio.create_task(transcoder.pump_outbound(s))
        await asyncio.sleep(0)

        client = h2.connection.H2Connection(
            config=h2.config.H2Configuration(
                client_side=True, header_encoding="utf-8",
            ),
        )
        client.initiate_connection()
        await transcoder.feed(client.data_to_send())
        await asyncio.sleep(0.05)
        client.receive_data(bytes(out))
        out.clear()
        await transcoder.feed(client.data_to_send())
        await asyncio.sleep(0.05)
        if out:
            client.receive_data(bytes(out))
            out.clear()

        headers = [
            (":method", "CONNECT"),
            (":scheme", "https"),
            (":authority", "agent.test"),
            (":path", "/ws"),
            (":protocol", "websocket"),
            ("sec-websocket-version", "13"),
        ]
        stream_id = client.get_next_available_stream_id()
        client.send_headers(stream_id, headers, end_stream=False)
        await transcoder.feed(client.data_to_send())

        response_status: str | None = None
        for _ in range(200):
            if out:
                data = bytes(out)
                out.clear()
                for ev in client.receive_data(data):
                    if isinstance(ev, h2.events.ResponseReceived):
                        for k, v in ev.headers:
                            if k == ":status":
                                response_status = v
                if response_status is not None:
                    break
            await asyncio.sleep(0.02)
        assert response_status == "502"

        await transcoder.aclose()
        try:
            await asyncio.wait_for(pump, timeout=2.0)
        except asyncio.TimeoutError:
            pump.cancel()
    finally:
        await dispatch.aclose()
