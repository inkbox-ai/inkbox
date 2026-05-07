"""Unit tests for the in-process h2 transcoder plaintext adapter."""

from __future__ import annotations

import asyncio

import h2.config
import h2.connection
import h2.events
import h2.settings

from inkbox.tunnels.client._dispatch import (
    DispatchRequest,
    DispatchResponseHead,
)
from inkbox.tunnels.client._h2_transcode import H2TranscoderPlaintext


class _StubDispatch:
    def __init__(
        self,
        *,
        status: int = 200,
        body: bytes = b"hello",
    ) -> None:
        self.status = status
        self.body = body
        self.captured: DispatchRequest | None = None
        self.captured_body = bytearray()

    async def dispatch(self, request, response):
        self.captured = request
        async for chunk in request.body:
            self.captured_body.extend(chunk)
        await response.send_head(
            DispatchResponseHead(
                status=self.status,
                headers=[("content-type", "text/plain")],
            ),
        )
        if self.body:
            await response.send_body(self.body)
        await response.end_body()

    async def aclose(self):
        pass


def _client_conn() -> h2.connection.H2Connection:
    config = h2.config.H2Configuration(
        client_side=True, header_encoding="utf-8",
    )
    conn = h2.connection.H2Connection(config=config)
    conn.initiate_connection()
    return conn


async def _drive(
    transcoder: H2TranscoderPlaintext,
    client: h2.connection.H2Connection,
    *,
    timeout: float = 2.0,
) -> tuple[list[h2.events.Event], bytes]:
    """Pump bytes between the client and transcoder until the client side
    has received headers + END_STREAM, or timeout."""
    received_events: list[h2.events.Event] = []
    received_raw = bytearray()

    async def _server_send(chunk: bytes) -> None:
        received_raw.extend(chunk)
        events = client.receive_data(chunk)
        received_events.extend(events)

    pump_task = asyncio.create_task(transcoder.pump_outbound(_server_send))

    # First, push the client preface bytes into the transcoder.
    initial = client.data_to_send()
    if initial:
        await transcoder.feed(initial)

    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        # Send any client-side bytes to the transcoder.
        client_out = client.data_to_send()
        if client_out:
            await transcoder.feed(client_out)
        # Look for end-of-response indicator.
        if any(
            isinstance(ev, h2.events.StreamEnded)
            for ev in received_events
        ):
            break
        await asyncio.sleep(0.01)

    await transcoder.aclose()
    try:
        await asyncio.wait_for(pump_task, timeout=1.0)
    except asyncio.TimeoutError:
        pump_task.cancel()
    return received_events, bytes(received_raw)


async def test_h2_transcode_basic_get():
    dispatch = _StubDispatch(status=200, body=b"hello-h2")
    transcoder = H2TranscoderPlaintext(
        dispatch=dispatch, max_inbound_body_bytes=1_000_000,
    )
    client = _client_conn()
    sid = client.get_next_available_stream_id()
    client.send_headers(
        sid,
        [
            (":method", "GET"),
            (":authority", "example.test"),
            (":scheme", "https"),
            (":path", "/webhook"),
        ],
        end_stream=True,
    )
    events, _ = await _drive(transcoder, client)
    headers_evt = next(
        (ev for ev in events if isinstance(ev, h2.events.ResponseReceived)),
        None,
    )
    data_evt = next(
        (ev for ev in events if isinstance(ev, h2.events.DataReceived)),
        None,
    )
    assert headers_evt is not None
    assert dict(headers_evt.headers).get(":status") == "200"
    assert data_evt is not None
    assert data_evt.data == b"hello-h2"
    assert dispatch.captured is not None
    assert dispatch.captured.method == "GET"
    assert dispatch.captured.path == "/webhook"


async def test_h2_transcode_settings_advertise_correctly():
    """The transcoder's preface SETTINGS must carry the values we set."""
    dispatch = _StubDispatch()
    transcoder = H2TranscoderPlaintext(
        dispatch=dispatch, max_inbound_body_bytes=1_000_000,
    )
    client = _client_conn()
    received: list[h2.events.Event] = []

    async def _send(chunk: bytes) -> None:
        events = client.receive_data(chunk)
        received.extend(events)

    pump = asyncio.create_task(transcoder.pump_outbound(_send))
    # Push the client preface so the server side has something to react
    # to (and so the pump drains the server preface to us).
    await transcoder.feed(client.data_to_send())
    # Give the pump a tick.
    await asyncio.sleep(0.05)
    await transcoder.aclose()
    try:
        await asyncio.wait_for(pump, timeout=1.0)
    except asyncio.TimeoutError:
        pump.cancel()

    settings_changes = [
        ev for ev in received if isinstance(ev, h2.events.RemoteSettingsChanged)
    ]
    assert settings_changes, f"no RemoteSettingsChanged seen in {received!r}"
    # All advertised settings should appear at least once in the
    # changed_settings dict (there may be multiple SETTINGS frames).
    seen: dict[h2.settings.SettingCodes, int] = {}
    for ev in settings_changes:
        for code, change in ev.changed_settings.items():
            seen[code] = change.new_value
    assert seen.get(h2.settings.SettingCodes.ENABLE_PUSH) == 0
    assert seen.get(h2.settings.SettingCodes.MAX_CONCURRENT_STREAMS) == 100
    assert seen.get(h2.settings.SettingCodes.ENABLE_CONNECT_PROTOCOL) == 1


async def test_h2_transcode_websocket_returns_501_for_phase2():
    """Phase 2 doesn't bridge WS-over-h2 to URL upstreams; it returns 501."""
    dispatch = _StubDispatch()
    transcoder = H2TranscoderPlaintext(
        dispatch=dispatch, max_inbound_body_bytes=1_000_000,
    )
    client = _client_conn()
    sid = client.get_next_available_stream_id()
    client.send_headers(
        sid,
        [
            (":method", "CONNECT"),
            (":protocol", "websocket"),
            (":authority", "example.test"),
            (":scheme", "https"),
            (":path", "/ws"),
        ],
        end_stream=False,
    )
    events, _ = await _drive(transcoder, client)
    headers_evt = next(
        (ev for ev in events if isinstance(ev, h2.events.ResponseReceived)),
        None,
    )
    assert headers_evt is not None
    h = dict(headers_evt.headers)
    assert h.get(":status") == "501"
    assert h.get("inkbox-reason") == "websocket-over-h2-not-implemented"


async def test_h2_transcode_inbound_body_cap_resets_stream():
    dispatch = _StubDispatch()
    transcoder = H2TranscoderPlaintext(
        dispatch=dispatch, max_inbound_body_bytes=8,
    )
    client = _client_conn()
    sid = client.get_next_available_stream_id()
    client.send_headers(
        sid,
        [
            (":method", "POST"),
            (":authority", "example.test"),
            (":scheme", "https"),
            (":path", "/big"),
        ],
        end_stream=False,
    )
    client.send_data(sid, b"X" * 100, end_stream=True)
    events, _ = await _drive(transcoder, client, timeout=1.0)
    reset_evt = next(
        (ev for ev in events if isinstance(ev, h2.events.StreamReset)),
        None,
    )
    assert reset_evt is not None
