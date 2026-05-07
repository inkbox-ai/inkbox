"""
inkbox/tunnels/client/_ws_passthrough.py

WebSocket support for passthrough mode.

The h1 parser (``_h1_server.py``) and h2 transcoder (``_h2_transcode.py``)
hand a ``WebSocketSink`` to the dispatcher when the inbound is a WS
upgrade. The dispatcher completes the handshake via ``accept`` then
bridges frames via ``send_frame`` / ``recv_frame``.

The h1 path uses standard ``Upgrade: websocket`` (RFC 6455). The h2
path uses Extended CONNECT (RFC 8441) — pseudo-headers carry the same
information; both produce the same surface to the dispatcher.

The ASGI invoker in this module drives a websocket-scope app against
that sink so the handler is identical regardless of transport.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
from typing import Any, Awaitable, Callable, Protocol

from inkbox.tunnels.client._envelope import HOP_BY_HOP_REQUEST
from inkbox.tunnels.client._wsframe import (
    WS_OPCODE_BINARY,
    WS_OPCODE_CLOSE,
    WS_OPCODE_PING,
    WS_OPCODE_PONG,
    WS_OPCODE_TEXT,
)


logger = logging.getLogger("inkbox.tunnels")


WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def compute_ws_accept(key: str) -> str:
    """RFC 6455 §1.3 — compute ``Sec-WebSocket-Accept`` from the client's
    ``Sec-WebSocket-Key``."""
    digest = hashlib.sha1(
        (key + WS_GUID).encode("ascii"),
    ).digest()
    return base64.b64encode(digest).decode("ascii")


class WebSocketSink(Protocol):
    """Transport-side surface a dispatcher uses to drive a WS upgrade.

    Lifecycle:

    1. ``accept(subprotocol=...)`` — completes the handshake (h1 sends
       a 101 with ``Sec-WebSocket-Accept``; h2 sends ``:status 200``).
    2. Many ``send_frame`` / ``recv_frame`` cycles. Server-to-client
       frames are unmasked (RFC 6455 §5.1).
    3. ``aclose`` — drain remaining outbound bytes and tear down.
    """

    async def accept(
        self,
        *,
        subprotocol: str | None = None,
        headers: list[tuple[str, str]] | None = None,
    ) -> None: ...

    async def reject(self, *, status: int = 400) -> None: ...

    async def send_frame(
        self, opcode: int, payload: bytes, *, fin: bool = True,
    ) -> None: ...

    async def recv_frame(self) -> tuple[int, bytes, bool] | None: ...

    async def aclose(self) -> None: ...


async def invoke_asgi_websocket(
    app: Any,
    request: Any,  # DispatchRequest — typed loosely to avoid import cycle
    ws: WebSocketSink,
    *,
    public_host: str,
) -> None:
    """Drive an ASGI websocket-scope app against ``ws``.

    Translates RFC 6455 frame-level semantics into ASGI ``websocket.*``
    events and back. Fragmentation is reassembled before delivery; the
    handler always sees a complete message per ``websocket.receive``.
    Ping is replied automatically; pong is dropped.
    """
    raw_path, _, query = request.path.partition("?")

    asgi_headers: list[tuple[bytes, bytes]] = []
    asgi_headers.append((b"host", public_host.encode("latin-1")))
    asgi_headers.append((b"x-forwarded-host", public_host.encode("latin-1")))
    asgi_headers.append((b"x-forwarded-proto", b"https"))
    if request.forwarded_for_ip:
        asgi_headers.append(
            (b"x-forwarded-for", request.forwarded_for_ip.encode("latin-1")),
        )
        asgi_headers.append(
            (b"forwarded",
             f"for={request.forwarded_for_ip}".encode("latin-1")),
        )
    offered_subprotocols: list[str] = []
    seen = {b"host", b"x-forwarded-host", b"x-forwarded-proto",
            b"x-forwarded-for", b"forwarded"}
    for k, v in request.headers:
        kl = k.lower()
        if kl.startswith(":"):
            continue
        if kl in HOP_BY_HOP_REQUEST:
            continue
        if kl == "sec-websocket-protocol":
            offered_subprotocols.extend(
                p.strip() for p in v.split(",") if p.strip()
            )
            continue
        kb = kl.encode("latin-1")
        if kb in seen:
            continue
        asgi_headers.append((kb, v.encode("latin-1")))

    client_host = request.forwarded_for_ip or "unknown"
    scope = {
        "type": "websocket",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "scheme": "wss",
        "path": raw_path,
        "raw_path": raw_path.encode("utf-8"),
        "query_string": query.encode("utf-8"),
        "root_path": "",
        "headers": asgi_headers,
        "client": (client_host, 0),
        "server": (public_host, 443),
        "subprotocols": offered_subprotocols,
    }

    inbound: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    inbound.put_nowait({"type": "websocket.connect"})

    accepted = asyncio.Event()
    closed = asyncio.Event()

    async def receive() -> dict[str, Any]:
        return await inbound.get()

    async def send(msg: dict[str, Any]) -> None:
        kind = msg.get("type")
        if kind == "websocket.accept":
            # ASGI permits an optional ``headers`` field on
            # websocket.accept (Iterable[(bytes, bytes)]). Decode to
            # the SDK's str/str shape so the sink can serialize them
            # into the third-party-facing 101 alongside subprotocol.
            asgi_headers = msg.get("headers") or []
            decoded_headers: list[tuple[str, str]] = []
            for hk, hv in asgi_headers:
                try:
                    k = hk.decode("latin-1") if isinstance(hk, bytes) else hk
                    v = hv.decode("latin-1") if isinstance(hv, bytes) else hv
                except UnicodeDecodeError:
                    continue
                decoded_headers.append((k, v))
            await ws.accept(
                subprotocol=msg.get("subprotocol"),
                headers=decoded_headers if decoded_headers else None,
            )
            accepted.set()
        elif kind == "websocket.close":
            code = int(msg.get("code", 1000))
            reason = msg.get("reason", "") or ""
            if not accepted.is_set():
                # ASGI permits close-before-accept (handler refuses).
                await ws.reject(status=403)
                accepted.set()
                closed.set()
                return
            payload = code.to_bytes(2, "big") + reason.encode("utf-8")
            try:
                await ws.send_frame(WS_OPCODE_CLOSE, payload)
            except Exception:
                pass
            closed.set()
        elif kind == "websocket.send":
            if not accepted.is_set() or closed.is_set():
                return
            text = msg.get("text")
            data = msg.get("bytes")
            if text is not None:
                await ws.send_frame(
                    WS_OPCODE_TEXT, text.encode("utf-8"),
                )
            elif data is not None:
                payload = (
                    data if isinstance(data, bytes) else bytes(data)
                )
                await ws.send_frame(WS_OPCODE_BINARY, payload)

    async def reader() -> None:
        fragments: bytearray | None = None
        fragments_text = False
        try:
            while not closed.is_set():
                got = await ws.recv_frame()
                if got is None:
                    await inbound.put(
                        {"type": "websocket.disconnect", "code": 1006},
                    )
                    return
                opcode, payload, fin = got
                if opcode == WS_OPCODE_PING:
                    try:
                        await ws.send_frame(WS_OPCODE_PONG, payload)
                    except Exception:
                        return
                    continue
                if opcode == WS_OPCODE_PONG:
                    continue
                if opcode == WS_OPCODE_CLOSE:
                    code = (
                        int.from_bytes(payload[:2], "big")
                        if len(payload) >= 2 else 1000
                    )
                    await inbound.put(
                        {"type": "websocket.disconnect", "code": code},
                    )
                    return
                if opcode == 0x0:  # continuation
                    if fragments is None:
                        return
                    fragments.extend(payload)
                elif opcode == WS_OPCODE_TEXT:
                    if fragments is not None:
                        return
                    fragments = bytearray(payload)
                    fragments_text = True
                elif opcode == WS_OPCODE_BINARY:
                    if fragments is not None:
                        return
                    fragments = bytearray(payload)
                    fragments_text = False
                else:
                    return
                if not fin:
                    continue
                msg_bytes = bytes(fragments) if fragments else b""
                fragments = None
                if fragments_text:
                    try:
                        await inbound.put({
                            "type": "websocket.receive",
                            "text": msg_bytes.decode("utf-8"),
                        })
                    except UnicodeDecodeError:
                        await inbound.put({
                            "type": "websocket.disconnect", "code": 1003,
                        })
                        return
                else:
                    await inbound.put({
                        "type": "websocket.receive",
                        "bytes": msg_bytes,
                    })
        except Exception:
            logger.exception("ws reader failed")
            await inbound.put(
                {"type": "websocket.disconnect", "code": 1011},
            )

    reader_task = asyncio.create_task(reader())
    try:
        await app(scope, receive, send)
    except Exception:
        logger.exception("ws handler raised")
        if not accepted.is_set():
            try:
                await ws.reject(status=500)
            except Exception:
                pass
    finally:
        closed.set()
        if not reader_task.done():
            reader_task.cancel()
            try:
                await reader_task
            except (asyncio.CancelledError, Exception):
                pass
        try:
            await ws.aclose()
        except Exception:
            pass


# --- helpers shared by the h1 / h2 sink implementations -----------------------


class _ByteQueue:
    """Async byte queue used by sinks to surface inbound plaintext bytes
    to a frame decoder."""

    def __init__(self) -> None:
        self._buf = bytearray()
        self._closed = False
        self._wakeup = asyncio.Event()

    def push(self, data: bytes) -> None:
        if data:
            self._buf.extend(data)
            self._wakeup.set()

    def close(self) -> None:
        self._closed = True
        self._wakeup.set()

    async def read_some(self) -> bytes:
        while not self._buf and not self._closed:
            self._wakeup.clear()
            await self._wakeup.wait()
        out = bytes(self._buf)
        self._buf.clear()
        return out

    @property
    def closed(self) -> bool:
        return self._closed and not self._buf


def encode_server_frame(
    opcode: int, payload: bytes, *, fin: bool = True,
) -> bytes:
    """Encode an unmasked server-to-client frame.

    RFC 6455 §5.1 — frames sent from server to client MUST NOT be
    masked. The shared ``_wsframe.encode_ws_frame`` accepts a ``mask``
    flag; this helper enforces ``mask=False`` and an explicit ``fin``.
    """
    out = bytearray()
    out.append((0x80 if fin else 0x00) | (opcode & 0x0F))
    plen = len(payload)
    if plen < 126:
        out.append(plen)
    elif plen < 65536:
        out.append(126)
        out += plen.to_bytes(2, "big")
    else:
        out.append(127)
        out += plen.to_bytes(8, "big")
    out += payload
    return bytes(out)


def decode_client_frame(
    buf: bytearray, *, require_mask: bool = True,
) -> tuple[int, bytes, bool] | None:
    """Decode one complete client-to-server frame from ``buf``.

    Returns ``None`` if the buffer doesn't yet contain a full frame;
    mutates ``buf`` to drop consumed bytes when a frame is returned.

    For h1 WebSockets (RFC 6455 §5.1) client frames MUST be masked;
    pass ``require_mask=True`` (default) and the decoder rejects
    unmasked frames by clearing ``buf`` (caller treats that as a fatal
    protocol error).

    For h2 WebSockets (RFC 8441 §5.1) frames are NEVER masked — the
    transcoder passes ``require_mask=False`` so unmasked payloads are
    returned verbatim.
    """
    if len(buf) < 2:
        return None
    b0 = buf[0]
    b1 = buf[1]
    fin = bool(b0 & 0x80)
    opcode = b0 & 0x0F
    masked = bool(b1 & 0x80)
    plen = b1 & 0x7F
    offset = 2
    if plen == 126:
        if len(buf) < 4:
            return None
        plen = int.from_bytes(bytes(buf[2:4]), "big")
        offset = 4
    elif plen == 127:
        if len(buf) < 10:
            return None
        plen = int.from_bytes(bytes(buf[2:10]), "big")
        offset = 10
    if require_mask and not masked:
        # Treat unmasked client frame on h1 as a fatal protocol
        # violation; signal by clearing the buffer.
        del buf[:]
        return None
    if not require_mask and masked:
        # h2 WS MUST NOT mask — treat as fatal.
        del buf[:]
        return None
    if masked:
        if len(buf) < offset + 4:
            return None
        mask_key = bytes(buf[offset:offset + 4])
        offset += 4
        if len(buf) < offset + plen:
            return None
        raw = bytes(buf[offset:offset + plen])
        payload = bytes(p ^ mask_key[i % 4] for i, p in enumerate(raw))
    else:
        if len(buf) < offset + plen:
            return None
        payload = bytes(buf[offset:offset + plen])
    del buf[:offset + plen]
    return (opcode, payload, fin)


# --- generic byte-channel sink -----------------------------------------------


class ByteChannelWebSocketSink:
    """``WebSocketSink`` backed by an inbound byte queue + outbound send
    callable. The h1 parser builds one of these once it routes a WS
    upgrade; the h2 transcoder builds the same shape on top of an
    Extended-CONNECT stream's DATA frames.
    """

    def __init__(
        self,
        *,
        send_plaintext: Callable[[bytes], Awaitable[None]],
        accept_response_builder: Callable[
            [str | None, list[tuple[str, str]] | None], bytes,
        ],
        reject_response_builder: Callable[[int], bytes],
        on_close: Callable[[], Awaitable[None]] | None = None,
        require_client_mask: bool = True,
    ) -> None:
        self._send_plaintext = send_plaintext
        self._accept_builder = accept_response_builder
        self._reject_builder = reject_response_builder
        self._on_close = on_close
        self._require_mask = require_client_mask
        self._inbound = _ByteQueue()
        self._frame_buf = bytearray()
        self._accepted = False
        self._closed = False
        self._send_lock = asyncio.Lock()

    def feed_inbound(self, data: bytes) -> None:
        if self._closed:
            return
        self._inbound.push(data)

    def signal_inbound_eof(self) -> None:
        self._inbound.close()

    async def accept(
        self,
        *,
        subprotocol: str | None = None,
        headers: list[tuple[str, str]] | None = None,
    ) -> None:
        if self._accepted or self._closed:
            return
        self._accepted = True
        head = self._accept_builder(subprotocol, headers)
        async with self._send_lock:
            await self._send_plaintext(head)

    async def reject(self, *, status: int = 400) -> None:
        if self._accepted or self._closed:
            return
        self._closed = True
        head = self._reject_builder(status)
        async with self._send_lock:
            await self._send_plaintext(head)

    async def send_frame(
        self, opcode: int, payload: bytes, *, fin: bool = True,
    ) -> None:
        if not self._accepted or self._closed:
            return
        frame = encode_server_frame(opcode, payload, fin=fin)
        async with self._send_lock:
            await self._send_plaintext(frame)

    async def recv_frame(self) -> tuple[int, bytes, bool] | None:
        while True:
            decoded = decode_client_frame(
                self._frame_buf, require_mask=self._require_mask,
            )
            if decoded is not None:
                return decoded
            if self._inbound.closed:
                return None
            chunk = await self._inbound.read_some()
            if not chunk and self._inbound.closed:
                return None
            self._frame_buf.extend(chunk)

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._inbound.close()
        if self._on_close is not None:
            try:
                await self._on_close()
            except Exception:
                pass
