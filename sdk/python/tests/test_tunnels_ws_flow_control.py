"""Edge WS bridge — h2 stream flow-control credit regression.

Both `_pump_ws_url_bridge` (URL forward) and `_pump_ws` (callable) consume
inbound h2 DATA on the bridge stream but the auto-ack in `_handle_event`
deliberately skips bridge streams (line ~564 of `_runtime.py`) so the
consumer can credit back as it drains. The TCP passthrough pump does
this; the WS pumps were missing it. Without crediting, the server's
per-stream send window depletes after ~65 KB and inbound stalls — which
is exactly what happens to phone-media / streaming-media WS workloads
after the first few frames.

These tests pin the contract:
1. URL-forward pump credits bytes back as envelopes are forwarded.
2. Callable pump credits bytes back as envelopes are delivered.
3. End-to-end forwarding works for >> 1 stream window's worth of data
   (the failing case before the fix).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import struct
from contextlib import suppress
from typing import Any

import pytest

from inkbox.tunnels.client._envelope import Envelope
from inkbox.tunnels.client._runtime import TunnelRuntime, _StreamEvent
from inkbox.tunnels.client._wsframe import (
    WS_OPCODE_BINARY,
    WS_OPCODE_TEXT,
    decode_ws_frames,
    encode_ws_envelope,
    encode_ws_frame,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def _make_runtime() -> TunnelRuntime:
    from uuid import uuid4
    return TunnelRuntime(
        tunnel_id=uuid4(),
        api_key="ApiKey_test",
        zone="inkboxwire.example",
        public_host="my-agent.inkboxwire.example",
        pool_size=1,
        forward_to="http://127.0.0.1:1",
        tls_terminator=None,
    )


class _FakeH2:
    """Minimal h2.connection.H2Connection stand-in for the bridge pumps.

    Records ``acknowledge_received_data`` calls; ``send_data`` and the
    flow-control surface are stubbed to "infinite outbound window" so
    the pump's outbound side (sender PONG / envelope writes) never
    blocks on credit.
    """

    def __init__(self) -> None:
        self.ack_calls: list[tuple[int, int]] = []
        self.sent_data: list[tuple[int, bytes, bool]] = []
        self.max_outbound_frame_size = 65536

    @property
    def outbound_flow_control_window(self) -> int:
        return 1 << 24

    def local_flow_control_window(self, stream_id: int) -> int:
        return 1 << 24

    def acknowledge_received_data(self, length: int, stream_id: int) -> None:
        self.ack_calls.append((stream_id, length))

    def send_data(self, stream_id: int, data: bytes, *, end_stream: bool = False) -> None:
        self.sent_data.append((stream_id, data, end_stream))

    def reset_stream(self, stream_id: int, error_code: Any) -> None:
        pass


async def _start_upstream_echo(
    port_holder: list[int],
    received: list[tuple[int, bytes]],
    accept_pings: bool = True,
) -> asyncio.AbstractServer:
    """Real WS upstream that completes the upgrade then logs every WS
    frame it receives. Used as the destination for `_pump_ws_url_bridge`
    (which writes RFC 6455 frames to a real socket)."""

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
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
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
        ).encode("ascii"))
        await writer.drain()

        # Drain frames; record (opcode, payload) for the test to inspect.
        rest = bytes(head).split(b"\r\n\r\n", 1)[1]
        buf = bytearray(rest)
        try:
            while True:
                frames = decode_ws_frames(buf)
                for opcode, payload, _fin in frames:
                    received.append((opcode, payload))
                more = await reader.read(4096)
                if not more:
                    return
                buf.extend(more)
        finally:
            with suppress(Exception):
                writer.close()
                await writer.wait_closed()

    server = await asyncio.start_server(handle, host="127.0.0.1", port=0)
    port_holder.append(server.sockets[0].getsockname()[1])
    return server


def _wrap_envelope_in_outer_binary(envelope_bytes: bytes) -> bytes:
    """The tunnel server side wraps each length-prefixed envelope in a
    WS BINARY frame (server → client direction is unmasked)."""
    return encode_ws_frame(WS_OPCODE_BINARY, envelope_bytes, mask=False)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pump_ws_url_bridge_credits_inbound_window(monkeypatch):
    """Push 300 small TEXT envelopes (>>65KB total wire bytes) into the
    bridge stream queue. Without per-envelope crediting, the pump
    consumes only the first ~64 KB before stalling. With crediting, the
    pump drains all 300 to the upstream WS server and `_h2.acknowledge_received_data`
    is called with cumulative bytes covering the whole stream."""
    received: list[tuple[int, bytes]] = []
    port_holder: list[int] = []
    upstream = await _start_upstream_echo(port_holder, received)
    serve_task = asyncio.create_task(upstream.serve_forever())

    try:
        port = port_holder[0]
        # Open the upstream WS connection ourselves so the pump receives
        # already-connected reader/writer (skips the open_ws_upstream
        # plumbing — we're testing the pump in isolation).
        ws_key = base64.b64encode(b"0" * 16).decode("ascii")
        request = (
            f"GET /ws HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{port}\r\n"
            "Connection: Upgrade\r\n"
            "Upgrade: websocket\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            f"Sec-WebSocket-Key: {ws_key}\r\n\r\n"
        ).encode("ascii")
        upstream_reader, upstream_writer = await asyncio.open_connection(
            "127.0.0.1", port,
        )
        upstream_writer.write(request)
        await upstream_writer.drain()
        head = bytearray()
        while b"\r\n\r\n" not in bytes(head):
            head.extend(await upstream_reader.read(4096))

        runtime = _make_runtime()
        fake_h2 = _FakeH2()
        runtime._h2 = fake_h2  # type: ignore[assignment]

        async def _fake_flush() -> None:
            return None

        runtime._flush = _fake_flush  # type: ignore[assignment]

        stream_id = 13
        runtime._streams[stream_id] = asyncio.Queue()
        runtime._bridge_stream_ids.add(stream_id)

        # Pre-fill the bridge stream queue with 300 TEXT envelopes.
        # Each envelope is JSON {"type":"text","data":"<text>"} —
        # length-prefixed and wrapped in a WS BINARY frame. Pad each
        # payload to ~250 bytes so the total comfortably exceeds the
        # default h2 stream window (65535) and the bug actually fires.
        n_envelopes = 300
        total_wire_bytes = 0
        pad = "x" * 220
        for i in range(n_envelopes):
            inner_text = f"frame-{i:04d}-{pad}"
            env = encode_ws_envelope({
                "type": "websocket.send", "text": inner_text,
            })
            wire = _wrap_envelope_in_outer_binary(env)
            ev = _StreamEvent(
                "data", data=wire, flow_controlled_length=len(wire),
            )
            runtime._streams[stream_id].put_nowait(ev)
            total_wire_bytes += len(wire)

        # Sanity: must exceed initial window so we'd notice the bug.
        assert total_wire_bytes > 65535, (
            f"test pre-condition: need >65KB, got {total_wire_bytes}"
        )

        # Run the pump as a task; it'll drain the queue, write to
        # upstream, and credit back. We bound it with a wall clock —
        # if the pump is broken (no credit) it would never exit on its
        # own, but the queue is finite here so it should drain fully
        # and then park on _await_event_or_close. We trigger exit by
        # sending an "end" event after a delay.
        pump_task = asyncio.create_task(
            runtime._pump_ws_url_bridge(
                stream_id, upstream_reader, upstream_writer, b"",
            ),
        )

        # Wait for upstream to receive all 300 frames, with a 5s budget.
        deadline = asyncio.get_running_loop().time() + 5.0
        while len(received) < n_envelopes:
            if asyncio.get_running_loop().time() > deadline:
                break
            await asyncio.sleep(0.02)

        # Now signal the pump to exit cleanly.
        runtime._streams[stream_id].put_nowait(_StreamEvent("end"))
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(pump_task, timeout=2.0)
        if not pump_task.done():
            pump_task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await pump_task

        # 1. Upstream received all 300 frames as TEXT.
        text_frames = [(op, p) for (op, p) in received if op == WS_OPCODE_TEXT]
        assert len(text_frames) == n_envelopes, (
            f"upstream got {len(text_frames)}/{n_envelopes} TEXT frames; "
            "without flow-control crediting the pump stalls after ~65KB"
        )

        # 2. Cumulative ack bytes cover the whole stream window's worth.
        total_acked = sum(length for _, length in fake_h2.ack_calls)
        assert total_acked >= 65535, (
            f"only acked {total_acked} bytes; expected at least 65535 "
            "(one initial window) so the server can keep sending"
        )
        # And every ack is for our stream id.
        for sid, _ in fake_h2.ack_calls:
            assert sid == stream_id

        # 3. Frame contents match what we sent in.
        for i, (_, payload) in enumerate(text_frames):
            assert payload.decode("utf-8") == f"frame-{i:04d}-{pad}"
    finally:
        with suppress(Exception):
            upstream_writer.close()
            await upstream_writer.wait_closed()
        serve_task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await serve_task
        upstream.close()
        await upstream.wait_closed()


@pytest.mark.asyncio
async def test_pump_ws_callable_credits_inbound_window():
    """Same shape as URL-forward, but for the callable WS pump
    (`_pump_ws`). 300 envelopes pushed at the bridge → all should be
    delivered to the WS session, and acknowledge_received_data must be
    called with cumulative bytes covering the stream."""
    runtime = _make_runtime()
    fake_h2 = _FakeH2()
    runtime._h2 = fake_h2  # type: ignore[assignment]

    async def _fake_flush() -> None:
        return None

    runtime._flush = _fake_flush  # type: ignore[assignment]

    stream_id = 21
    runtime._streams[stream_id] = asyncio.Queue()
    runtime._bridge_stream_ids.add(stream_id)

    delivered: list[dict[str, Any]] = []

    class _StubWsSession:
        async def deliver(self, msg: dict) -> None:
            delivered.append(msg)

        async def outbound(self):
            # No outbound traffic — yields nothing then ends so the
            # sender task exits quickly.
            if False:
                yield
            return

        def signal_outbound_eof(self) -> None:
            pass

        async def close(self, code: int = 1000) -> None:
            pass

    n_envelopes = 300
    total_wire_bytes = 0
    pad = "x" * 220
    for i in range(n_envelopes):
        env = encode_ws_envelope({
            "type": "websocket.send", "text": f"cb-{i:04d}-{pad}",
        })
        wire = _wrap_envelope_in_outer_binary(env)
        ev = _StreamEvent(
            "data", data=wire, flow_controlled_length=len(wire),
        )
        runtime._streams[stream_id].put_nowait(ev)
        total_wire_bytes += len(wire)
    assert total_wire_bytes > 65535

    pump_task = asyncio.create_task(
        runtime._pump_ws(stream_id, _StubWsSession()),  # type: ignore[arg-type]
    )

    deadline = asyncio.get_running_loop().time() + 5.0
    while len(delivered) < n_envelopes:
        if asyncio.get_running_loop().time() > deadline:
            break
        await asyncio.sleep(0.02)

    runtime._streams[stream_id].put_nowait(_StreamEvent("end"))
    with suppress(asyncio.TimeoutError):
        await asyncio.wait_for(pump_task, timeout=2.0)
    if not pump_task.done():
        pump_task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await pump_task

    assert len(delivered) == n_envelopes, (
        f"callable pump delivered {len(delivered)}/{n_envelopes}; "
        "without flow-control crediting the pump stalls after ~65KB"
    )
    total_acked = sum(length for _, length in fake_h2.ack_calls)
    assert total_acked >= 65535, (
        f"callable pump only acked {total_acked} bytes; expected at "
        "least 65535"
    )
    for i, msg in enumerate(delivered):
        assert msg["type"] == "text"
        assert msg["data"] == f"cb-{i:04d}-{pad}"


# Silence unused-import warnings (kept for potential extensions).
_ = (Envelope, json, struct)
