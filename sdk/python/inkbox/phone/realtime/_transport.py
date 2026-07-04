"""
inkbox/phone/realtime/_transport.py

Minimal async WebSocket client for the realtime control channel. Drives an
asyncio TLS stream and frames messages with the shared RFC 6455 codec
(``inkbox.tunnels.client._wsframe``). Text-only application messages; ping
frames are answered with pong; close/fragmentation are handled inline.
"""

from __future__ import annotations

import asyncio
import base64
import os
import ssl
from collections import deque
from typing import Any
from urllib.parse import urlparse

import certifi

from inkbox.tunnels.client._wsframe import (
    WS_OPCODE_BINARY,
    WS_OPCODE_CLOSE,
    WS_OPCODE_PING,
    WS_OPCODE_PONG,
    WS_OPCODE_TEXT,
    decode_ws_frames,
    encode_ws_frame,
)

_HANDSHAKE_LIMIT = 64 * 1024


class RealtimeConnectError(Exception):
    """The control-channel WebSocket upgrade failed.

    ``close_code`` carries the WS close code when the server rejects the
    upgrade with one (e.g. ``4401`` for an unauthenticated connection).
    """

    def __init__(self, message: str, *, status: int | None = None,
                 close_code: int | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.close_code = close_code


class WsTransport:
    """Async client WebSocket over an asyncio (optionally TLS) stream."""

    def __init__(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        self._reader = reader
        self._writer = writer
        self._buf = bytearray()
        self._frames: deque[tuple[int, bytes, bool]] = deque()
        self._fragments = bytearray()
        self._frag_opcode = 0
        self._closed = False

    @classmethod
    async def connect(
        cls,
        url: str,
        *,
        headers: dict[str, str],
        timeout: float,
    ) -> WsTransport:
        """Open ``url`` (ws:// or wss://) and complete the client handshake."""
        parsed = urlparse(url)
        secure = parsed.scheme == "wss"
        host = parsed.hostname or ""
        port = parsed.port or (443 if secure else 80)
        ssl_ctx: ssl.SSLContext | None = None
        if secure:
            ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(
                host, port, ssl=ssl_ctx,
                server_hostname=host if secure else None,
            ),
            timeout=timeout,
        )
        self = cls(reader, writer)
        try:
            await asyncio.wait_for(self._handshake(parsed, host, headers), timeout)
        except Exception:
            await self.close()
            raise
        return self

    async def _handshake(self, parsed: Any, host: str, headers: dict[str, str]) -> None:
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"
        lines = [
            f"GET {path} HTTP/1.1",
            f"Host: {host}",
            "Upgrade: websocket",
            "Connection: Upgrade",
            f"Sec-WebSocket-Key: {key}",
            "Sec-WebSocket-Version: 13",
        ]
        for name, value in headers.items():
            lines.append(f"{name}: {value}")
        request = ("\r\n".join(lines) + "\r\n\r\n").encode("ascii")
        self._writer.write(request)
        await self._writer.drain()

        raw = await self._reader.readuntil(b"\r\n\r\n")
        if len(raw) > _HANDSHAKE_LIMIT:
            raise RealtimeConnectError("handshake response too large")
        status_line = raw.split(b"\r\n", 1)[0].decode("latin-1", "replace")
        parts = status_line.split(" ", 2)
        status = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
        if status != 101:
            raise RealtimeConnectError(
                f"control channel upgrade rejected: {status_line.strip()}",
                status=status,
            )

    async def send_text(self, text: str) -> None:
        if self._closed:
            raise RealtimeConnectError("control channel is closed")
        self._writer.write(encode_ws_frame(WS_OPCODE_TEXT, text.encode("utf-8"), mask=True))
        await self._writer.drain()

    async def recv(self) -> str | None:
        """Return the next text message, or ``None`` once the peer closes."""
        while True:
            if self._frames:
                opcode, payload, fin = self._frames.popleft()
                message = self._consume_frame(opcode, payload, fin)
                if message is _PONG:
                    await self._send_pong(payload)
                    continue
                if message is _CLOSED:
                    return None
                if message is not None:
                    return message
                continue
            if self._closed:
                return None
            chunk = await self._reader.read(65536)
            if not chunk:
                self._closed = True
                return None
            self._buf.extend(chunk)
            self._frames.extend(decode_ws_frames(self._buf))

    def _consume_frame(self, opcode: int, payload: bytes, fin: bool) -> Any:
        if opcode == WS_OPCODE_CLOSE:
            self._closed = True
            return _CLOSED
        if opcode == WS_OPCODE_PING:
            return _PONG
        if opcode == WS_OPCODE_PONG:
            return None
        if opcode in (WS_OPCODE_TEXT, WS_OPCODE_BINARY):
            if fin and not self._fragments:
                return payload.decode("utf-8", "replace") if opcode == WS_OPCODE_TEXT else None
            self._frag_opcode = self._frag_opcode or opcode
            self._fragments.extend(payload)
            if not fin:
                return None
            data = bytes(self._fragments)
            is_text = self._frag_opcode == WS_OPCODE_TEXT
            self._fragments = bytearray()
            self._frag_opcode = 0
            return data.decode("utf-8", "replace") if is_text else None
        # Continuation frame (opcode 0x0) carries fragment bytes.
        self._fragments.extend(payload)
        if not fin:
            return None
        data = bytes(self._fragments)
        is_text = self._frag_opcode == WS_OPCODE_TEXT
        self._fragments = bytearray()
        self._frag_opcode = 0
        return data.decode("utf-8", "replace") if is_text else None

    async def _send_pong(self, payload: bytes) -> None:
        if self._closed:
            return
        self._writer.write(encode_ws_frame(WS_OPCODE_PONG, payload, mask=True))
        await self._writer.drain()

    async def close(self) -> None:
        if self._closed:
            self._safe_close_writer()
            return
        self._closed = True
        try:
            self._writer.write(encode_ws_frame(WS_OPCODE_CLOSE, b"", mask=True))
            await self._writer.drain()
        except Exception:
            pass
        self._safe_close_writer()

    def _safe_close_writer(self) -> None:
        try:
            self._writer.close()
        except Exception:
            pass


_PONG = object()
_CLOSED = object()
