from __future__ import annotations

import asyncio
import json

import h2.config
import h2.connection
import h2.events
import pytest

from inkbox.tunnels.client._runtime import SUPERSEDED_GOAWAY_ERROR_CODE
from inkbox.tunnels.exceptions import TunnelSupersededError
from test_tunnels_reconnect import AbortableWriter, _runtime
from test_tunnels_retry_after import _clock


class _Peer:
    """An in-memory HTTP/2 peer delivering HELLO and GOAWAY in one read."""

    def __init__(self, status, retry_after, end_after_hello):
        self.status = status
        self.retry_after = retry_after
        self.end_after_hello = end_after_hello
        self.ended = False
        self.inbound = asyncio.Queue()
        self.h2 = h2.connection.H2Connection(config=h2.config.H2Configuration(
            client_side=False, header_encoding="utf-8",
        ))
        self.h2.initiate_connection()

    async def read(self, _size):
        return await self.inbound.get()

    def write(self, data):
        if self.ended:
            return
        for event in self.h2.receive_data(data):
            if not isinstance(event, h2.events.RequestReceived):
                continue
            if dict(event.headers).get(":path") != "/_system/hello":
                continue
            headers = [(":status", str(self.status))]
            if self.retry_after is not None:
                headers.append(("retry-after", self.retry_after))
            self.h2.send_headers(event.stream_id, headers)
            self.h2.send_data(
                event.stream_id, json.dumps({"owner_token": "owner"}).encode(),
                end_stream=True,
            )
            if self.end_after_hello is not None:
                self.end(self.end_after_hello)
        pending = self.h2.data_to_send()
        if pending:
            self.inbound.put_nowait(pending)

    def end(self, how="goaway"):
        self.ended = True
        if how != "eof":
            self.h2.close_connection(
                error_code=SUPERSEDED_GOAWAY_ERROR_CODE if how == "superseded" else 0,
            )
        pending = self.h2.data_to_send()
        if pending:
            self.inbound.put_nowait(pending)
        if how == "eof":
            self.inbound.put_nowait(b"")


def _wire_transport(monkeypatch, runtime, responses):
    attempts = []
    peers = []

    async def open_connection(conn):
        peer = _Peer(*responses[len(attempts)])
        attempts.append(conn)
        peers.append(peer)
        conn.reader = peer
        conn.writer = AbortableWriter(lambda: peer.inbound.put_nowait(b""))
        conn.writer.write = peer.write
        conn.h2 = h2.connection.H2Connection(config=h2.config.H2Configuration(
            client_side=True, header_encoding="utf-8",
        ))
        conn.h2.initiate_connection()
        await runtime._flush_conn(conn)

    monkeypatch.setattr(runtime, "_open_connection", open_connection)
    return attempts, peers


@pytest.mark.asyncio
@pytest.mark.parametrize("cold", [True, False])
@pytest.mark.parametrize("end_after_hello", ["goaway", "eof"])
async def test_hello_then_disconnect_does_not_publish_ready(
    monkeypatch, cold, end_after_hello,
):
    statuses = []
    runtime = _runtime(on_status=statuses.append)
    responses = [(200, None, end_after_hello), (503, "60", None), (200, None, None)]
    if not cold:
        responses.insert(0, (200, None, None))
    attempts, peers = _wire_transport(monkeypatch, runtime, responses)
    _clock_state, _delays = _clock(monkeypatch, runtime)
    original_start = runtime._start_serving
    original_sleep = runtime._sleep_before_retry
    started = []
    retry_waiting = asyncio.Event()
    release_retry = asyncio.Event()
    recovered = asyncio.Event()

    def start(conn):
        started.append(conn.conn_id)
        original_start(conn)
        if len(attempts) == len(responses):
            recovered.set()
        elif not cold and len(attempts) == 1:
            asyncio.get_running_loop().call_soon(peers[0].end)

    async def sleep(delay):
        if delay > 20 and not retry_waiting.is_set():
            retry_waiting.set()
            await release_retry.wait()
        await original_sleep(delay)

    monkeypatch.setattr(runtime, "_start_serving", start)
    monkeypatch.setattr(runtime, "_sleep_before_retry", sleep)
    task = asyncio.create_task(runtime.serve_forever())
    try:
        await asyncio.wait_for(retry_waiting.wait(), timeout=1)
        assert runtime.status == "reconnecting"
        assert not runtime.is_connected
        assert statuses.count("connected") == (0 if cold else 1)
        assert started == ([] if cold else [1])
        release_retry.set()
        await asyncio.wait_for(recovered.wait(), timeout=1)
        assert runtime.status == "connected"
        assert started == ([3] if cold else [1, 4])
    finally:
        release_retry.set()
        await runtime.aclose()
        await asyncio.wait_for(task, timeout=1)
    assert statuses[-1] == "closed"


@pytest.mark.asyncio
@pytest.mark.parametrize("cold", [True, False])
async def test_hello_then_takeover_never_serves_or_reclaims(monkeypatch, cold):
    statuses = []
    runtime = _runtime(on_status=statuses.append)
    responses = [(200, None, "superseded")]
    if not cold:
        responses.insert(0, (200, None, None))
    attempts, peers = _wire_transport(monkeypatch, runtime, responses)
    original_start = runtime._start_serving
    started = []

    def start(conn):
        started.append(conn.conn_id)
        original_start(conn)
        if not cold and len(attempts) == 1:
            asyncio.get_running_loop().call_soon(peers[0].end)

    monkeypatch.setattr(runtime, "_start_serving", start)
    try:
        with pytest.raises(TunnelSupersededError):
            await asyncio.wait_for(runtime.serve_forever(), timeout=1)
    finally:
        await runtime.aclose()
    assert len(attempts) == len(responses)
    assert started == ([] if cold else [1])
    assert statuses.count("connected") == (0 if cold else 1)
    assert runtime.status == "superseded"
