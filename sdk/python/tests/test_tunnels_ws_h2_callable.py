"""WebSocket over h2 (RFC 8441) + callable tests.

Drives an ASGI websocket app through ``H2TranscoderPlaintext`` +
``CallableDispatch`` end-to-end. Constructs an h2 client connection,
opens an Extended CONNECT stream (`:method=CONNECT`, `:protocol=websocket`),
exchanges DATA frames carrying RFC 6455 frames (unmasked per RFC 8441),
and asserts the handler sees the right ASGI websocket events.
"""

from __future__ import annotations

import asyncio
from typing import Any

import h2.config
import h2.connection
import h2.events
import h2.errors
import h2.settings
import pytest

from inkbox.tunnels.client._dispatch import CallableDispatch
from inkbox.tunnels.client._h2_transcode import H2TranscoderPlaintext
from inkbox.tunnels.client._ws_passthrough import (
    decode_client_frame,
    encode_server_frame,
)
from inkbox.tunnels.client._wsframe import (
    WS_OPCODE_BINARY,
    WS_OPCODE_CLOSE,
    WS_OPCODE_TEXT,
)


async def _drain_pump(transcoder: H2TranscoderPlaintext):
    out = bytearray()

    async def send(data: bytes) -> None:
        out.extend(data)

    pump = asyncio.create_task(transcoder.pump_outbound(send))
    # Yield once so the pump task starts running before the caller
    # returns — otherwise its initial drain() may not be primed.
    await asyncio.sleep(0)
    return out, pump


@pytest.mark.asyncio
async def test_ws_over_h2_callable_round_trip():
    seen: list[dict[str, Any]] = []

    async def app(scope, receive, send):
        assert scope["type"] == "websocket"
        evt = await receive()
        assert evt["type"] == "websocket.connect"
        await send({"type": "websocket.accept"})
        msg = await receive()
        seen.append(msg)
        await send({"type": "websocket.send", "text": "hello-back"})
        msg = await receive()
        seen.append(msg)

    dispatch = CallableDispatch(
        app=app, public_host="agent.test", max_outbound_body_bytes=1_000_000,
    )
    transcoder = H2TranscoderPlaintext(
        dispatch=dispatch, max_inbound_body_bytes=1_000_000,
    )
    out, pump = await _drain_pump(transcoder)

    # h2 client side.
    client = h2.connection.H2Connection(
        config=h2.config.H2Configuration(
            client_side=True, header_encoding="utf-8",
        ),
    )
    client.initiate_connection()
    # Tell the server about the client's ENABLE_CONNECT_PROTOCOL preference
    # by acknowledging the server's settings — hyper-h2 client side does
    # this on receive_data automatically.
    await transcoder.feed(client.data_to_send())

    # Wait for the server's preface to land in `out` so that we can ack
    # it and learn ENABLE_CONNECT_PROTOCOL=1. Then the client can send
    # an Extended CONNECT.
    for _ in range(50):
        if out:
            break
        await asyncio.sleep(0.01)
    server_data = bytes(out)
    out.clear()
    client.receive_data(server_data)
    # Process events to ack settings.
    await transcoder.feed(client.data_to_send())

    # Drain any pending settings-ack bytes before sending CONNECT.
    await asyncio.sleep(0.05)
    if out:
        client.receive_data(bytes(out))
        out.clear()

    # Open Extended CONNECT stream.
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

    # Wait for the :status 200 response from the transcoder.
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

    # Drive a TEXT WS frame as DATA on the stream (unmasked per RFC 8441).
    text_frame = encode_server_frame(WS_OPCODE_TEXT, b"ping-from-client")
    client.send_data(stream_id, text_frame)
    await transcoder.feed(client.data_to_send())

    # Pull DATA frames from the server containing the WS reply.
    server_payload = bytearray()
    for _ in range(100):
        if out:
            data = bytes(out)
            out.clear()
            for ev in client.receive_data(data):
                if isinstance(ev, h2.events.DataReceived):
                    server_payload.extend(ev.data)
                    client.acknowledge_received_data(
                        ev.flow_controlled_length, stream_id,
                    )
            await transcoder.feed(client.data_to_send())
        decoded = decode_client_frame(
            server_payload, require_mask=False,
        )
        if decoded is not None and decoded[0] == WS_OPCODE_TEXT:
            assert decoded[1] == b"hello-back"
            break
        await asyncio.sleep(0.01)
    else:
        pytest.fail("never received WS reply over h2")

    # Send a CLOSE frame from client.
    close_frame = encode_server_frame(
        WS_OPCODE_CLOSE, (1000).to_bytes(2, "big") + b"bye",
    )
    client.send_data(stream_id, close_frame)
    await transcoder.feed(client.data_to_send())

    # Let app see the disconnect and finish.
    for _ in range(50):
        if any(e["type"] == "websocket.disconnect" for e in seen):
            break
        await asyncio.sleep(0.01)
    assert any(e["type"] == "websocket.disconnect" for e in seen)
    assert any(
        e["type"] == "websocket.receive" and e.get("text") == "ping-from-client"
        for e in seen
    )

    await transcoder.aclose()
    try:
        await asyncio.wait_for(pump, timeout=2.0)
    except asyncio.TimeoutError:
        pump.cancel()


@pytest.mark.asyncio
async def test_ws_over_h2_callable_handler_rejects():
    async def app(scope, receive, send):
        await receive()
        await send({"type": "websocket.close", "code": 1008})

    dispatch = CallableDispatch(
        app=app, public_host="agent.test", max_outbound_body_bytes=1_000_000,
    )
    transcoder = H2TranscoderPlaintext(
        dispatch=dispatch, max_inbound_body_bytes=1_000_000,
    )
    out, pump = await _drain_pump(transcoder)

    client = h2.connection.H2Connection(
        config=h2.config.H2Configuration(
            client_side=True, header_encoding="utf-8",
        ),
    )
    client.initiate_connection()
    await transcoder.feed(client.data_to_send())

    for _ in range(50):
        if out:
            break
        await asyncio.sleep(0.01)
    data = bytes(out)
    out.clear()
    client.receive_data(data)
    await transcoder.feed(client.data_to_send())

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
    for _ in range(100):
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
        await asyncio.sleep(0.01)
    assert response_status == "403"

    await transcoder.aclose()
    try:
        await asyncio.wait_for(pump, timeout=2.0)
    except asyncio.TimeoutError:
        pump.cancel()


@pytest.mark.asyncio
async def test_ws_over_h2_binary_round_trip():
    async def app(scope, receive, send):
        await receive()
        await send({"type": "websocket.accept"})
        evt = await receive()
        assert evt.get("bytes") == b"\x00\x01\x02hello"
        await send({"type": "websocket.send", "bytes": b"reply\xff"})
        await receive()

    dispatch = CallableDispatch(
        app=app, public_host="agent.test", max_outbound_body_bytes=1_000_000,
    )
    transcoder = H2TranscoderPlaintext(
        dispatch=dispatch, max_inbound_body_bytes=1_000_000,
    )
    out, pump = await _drain_pump(transcoder)

    client = h2.connection.H2Connection(
        config=h2.config.H2Configuration(
            client_side=True, header_encoding="utf-8",
        ),
    )
    client.initiate_connection()
    await transcoder.feed(client.data_to_send())
    for _ in range(50):
        if out:
            break
        await asyncio.sleep(0.01)
    client.receive_data(bytes(out))
    out.clear()
    await transcoder.feed(client.data_to_send())

    headers = [
        (":method", "CONNECT"),
        (":scheme", "https"),
        (":authority", "agent.test"),
        (":path", "/binws"),
        (":protocol", "websocket"),
        ("sec-websocket-version", "13"),
    ]
    stream_id = client.get_next_available_stream_id()
    client.send_headers(stream_id, headers, end_stream=False)
    await transcoder.feed(client.data_to_send())

    # Wait for accept.
    for _ in range(100):
        if out:
            data = bytes(out)
            out.clear()
            for ev in client.receive_data(data):
                if isinstance(ev, h2.events.ResponseReceived):
                    pass
            break
        await asyncio.sleep(0.01)

    bin_frame = encode_server_frame(
        WS_OPCODE_BINARY, b"\x00\x01\x02hello",
    )
    client.send_data(stream_id, bin_frame)
    await transcoder.feed(client.data_to_send())

    server_payload = bytearray()
    found = False
    for _ in range(100):
        if out:
            data = bytes(out)
            out.clear()
            for ev in client.receive_data(data):
                if isinstance(ev, h2.events.DataReceived):
                    server_payload.extend(ev.data)
                    client.acknowledge_received_data(
                        ev.flow_controlled_length, stream_id,
                    )
            await transcoder.feed(client.data_to_send())
        decoded = decode_client_frame(
            server_payload, require_mask=False,
        )
        if decoded is not None and decoded[0] == WS_OPCODE_BINARY:
            assert decoded[1] == b"reply\xff"
            found = True
            break
        await asyncio.sleep(0.01)
    assert found

    close_frame = encode_server_frame(
        WS_OPCODE_CLOSE, (1000).to_bytes(2, "big"),
    )
    client.send_data(stream_id, close_frame)
    await transcoder.feed(client.data_to_send())

    await transcoder.aclose()
    try:
        await asyncio.wait_for(pump, timeout=2.0)
    except asyncio.TimeoutError:
        pump.cancel()
