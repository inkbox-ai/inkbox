"""Cross-platform public listener smoke over real local TLS and HTTP/2 sockets."""
from __future__ import annotations

import asyncio
import json
import ssl
import threading
from contextlib import suppress
from pathlib import Path
from unittest.mock import MagicMock

import h2.config
import h2.connection
import h2.events
import pytest

from inkbox.tunnels.client import _runtime
from inkbox.tunnels.client._state import load_state
from inkbox.tunnels.resources.tunnels import TunnelsResource
from test_tunnels import _server_tunnel
from test_tunnels_tls_alpn import _self_signed_pair


@pytest.mark.parametrize("drive", ["async", "sync"])
@pytest.mark.parametrize("forward", ["callable", "url"])
async def test_public_listener_tls_roundtrip_reconnect_and_restart(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, drive: str, forward: str,
):
    cert, key = _self_signed_pair("tunnel.example")
    cert_path, key_path = tmp_path / "cert.pem", tmp_path / "key.pem"
    cert_path.write_bytes(cert)
    key_path.write_bytes(key)
    server_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_ctx.load_cert_chain(cert_path, key_path)
    server_ctx.set_alpn_protocols(["h2"])
    monkeypatch.setattr(_runtime, "create_default_verify_context",
                        lambda: ssl.create_default_context(cadata=cert.decode()))
    connections = 0
    replies: asyncio.Queue[tuple[dict[str, str], bytes]] = asyncio.Queue()
    peers: set[asyncio.StreamWriter] = set()
    handlers: set[asyncio.Task] = set()
    errors: list[BaseException] = []

    async def tunnel_server(reader, writer):
        nonlocal connections
        connections += 1
        request_id = f"request-{connections}"
        peers.add(writer)
        handlers.add(asyncio.current_task())
        conn = h2.connection.H2Connection(
            config=h2.config.H2Configuration(client_side=False, header_encoding="utf-8"),
        )
        headers_by_stream = {}
        bodies = {}
        sent = False
        try:
            assert writer.get_extra_info("ssl_object").selected_alpn_protocol() == "h2"
            conn.initiate_connection()
            writer.write(conn.data_to_send())
            await writer.drain()
            while data := await reader.read(65536):
                for event in conn.receive_data(data):
                    if isinstance(event, h2.events.RequestReceived):
                        headers_by_stream[event.stream_id] = dict(event.headers)
                        bodies[event.stream_id] = bytearray()
                    elif isinstance(event, h2.events.DataReceived):
                        bodies[event.stream_id].extend(event.data)
                        conn.acknowledge_received_data(event.flow_controlled_length, event.stream_id)
                    elif isinstance(event, h2.events.StreamEnded):
                        headers = headers_by_stream.pop(event.stream_id)
                        body = bytes(bodies.pop(event.stream_id))
                        path = headers[":path"]
                        if path == "/_system/hello":
                            assert headers["x-api-key"] == "ApiKey_test"
                            conn.send_headers(event.stream_id, [(":status", "200")])
                            conn.send_data(event.stream_id, json.dumps({
                                "owner_token": "test-owner", "default_pool_size": 1,
                                "response_deadline_seconds": 5,
                            }).encode(), end_stream=True)
                        elif path == "/_system/intake" and not sent:
                            assert headers["x-owner-token"] == "test-owner"
                            sent = True
                            conn.send_headers(event.stream_id, [
                                (":status", "200"), ("inkbox-request-id", request_id),
                                ("inkbox-method", "POST"), ("inkbox-path", "/webhook"),
                                ("inkbox-route-kind", "webhook"),
                                ("inkbox-h-content-type", "application/json"),
                            ])
                            conn.send_data(event.stream_id, b'{"text":"hello"}', end_stream=True)
                        elif path.startswith("/_system/response/"):
                            assert path == f"/_system/response/{request_id}"
                            replies.put_nowait((headers, body))
                            conn.send_headers(event.stream_id, [(":status", "204")], end_stream=True)
                writer.write(conn.data_to_send())
                await writer.drain()
        except (ConnectionError, asyncio.CancelledError):
            pass
        except BaseException as exc:
            errors.append(exc)
        finally:
            peers.discard(writer)
            writer.close()
            with suppress(ConnectionError):
                await writer.wait_closed()
            handlers.discard(asyncio.current_task())

    remote = await asyncio.start_server(tunnel_server, "127.0.0.1", 0, ssl=server_ctx)
    port = remote.sockets[0].getsockname()[1]
    original_open = asyncio.open_connection

    async def local_dial(*args, **kwargs):
        if kwargs.get("host") == "tunnel.example":
            assert kwargs["port"] == 443
            kwargs.update(host="127.0.0.1", port=port)
        return await original_open(*args, **kwargs)

    monkeypatch.setattr(asyncio, "open_connection", local_dial)

    async def app(scope, receive, send):
        assert scope["path"] == "/webhook"
        request = await receive()
        assert request["body"] == b'{"text":"hello"}'
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"reply\n"})

    async def upstream(reader, writer):
        try:
            head = await reader.readuntil(b"\r\n\r\n")
            assert head.startswith(b"POST /webhook HTTP/1.1")
            length = next(int(line.split(b":", 1)[1]) for line in head.split(b"\r\n")
                          if line.lower().startswith(b"content-length:"))
            assert await reader.readexactly(length) == b'{"text":"hello"}'
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nreply\n")
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    local = await asyncio.start_server(upstream, "127.0.0.1", 0)
    forward_to = app if forward == "callable" else f"http://127.0.0.1:{local.sockets[0].getsockname()[1]}"
    http = MagicMock()
    tunnel = _server_tunnel(zone="tunnel.example", public_host="agent.example")
    http.get.side_effect = lambda path: [tunnel] if path.endswith("/tunnels/") else tunnel
    client = MagicMock(_api_key="ApiKey_test")
    resource = TunnelsResource(http, inkbox=client)
    client.tunnels = resource
    state_dir = tmp_path / "state"
    try:
        for _ in range(2):
            statuses: list[str] = []
            listener = resource.connect(name="my-agent", forward_to=forward_to,
                                        state_dir=state_dir, on_status=statuses.append)
            task = None
            thread = None
            if drive == "async":
                task = asyncio.create_task(listener.serve_forever())
            else:
                def run():
                    try:
                        listener.wait()
                    except BaseException as exc:
                        errors.append(exc)
                thread = threading.Thread(target=run, daemon=True)
                thread.start()
            try:
                for attempt in range(2):
                    headers, body = await asyncio.wait_for(replies.get(), timeout=15)
                    assert headers["inkbox-status"] == "200"
                    assert body == b"reply\n"
                    assert listener.is_connected
                    assert listener.last_connected_at is not None
                    if attempt == 0:
                        for peer in tuple(peers):
                            peer.transport.abort()
                assert "reconnecting" in statuses
                assert not errors
            finally:
                if task is not None:
                    await listener.aclose()
                    with suppress(asyncio.CancelledError):
                        await task
                else:
                    await asyncio.to_thread(listener.close)
                    await asyncio.to_thread(thread.join, 5)
                    assert not thread.is_alive()
            assert listener.status == "closed"
            assert load_state(state_dir).tunnel_id == tunnel["id"]
        assert connections == 4
        assert not errors
        assert http.get.call_args_list[1].args[0].endswith(tunnel["id"])
    finally:
        remote.close()
        local.close()
        await remote.wait_closed()
        await local.wait_closed()
        for peer in tuple(peers):
            peer.transport.abort()
        if handlers:
            await asyncio.wait_for(asyncio.gather(*handlers), timeout=5)
