"""
inkbox/tunnels/client/_ws.py

In-process WebSocket session. Drives a user's WS handler against an
envelope. Uses scope parity with the HTTP path — third-party IP, public
host, explicit Host header — so URL generation in the user's app
matches the URL-forward path.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from typing import Any

from inkbox.tunnels.client._envelope import HOP_BY_HOP_REQUEST


logger = logging.getLogger("inkbox.tunnels")


class WSASGISession:
    """Drives a websocket app callable around our envelope-based bridge.

    Lifecycle:

    1. ``run_until_accept()`` — start the route, block until the app
       sends ``websocket.accept`` (or ``websocket.close``); return the
       message it sent.
    2. ``deliver(envelope_msg)`` — push an inbound wire envelope as
       ``websocket.receive`` (or ``websocket.disconnect``).
    3. ``outbound()`` — async-iterate every ``websocket.send`` /
       ``websocket.close`` the app produces.
    4. ``close(code)`` — terminate the handler.
    """

    def __init__(
        self,
        *,
        app: Any,
        path: str,
        headers: list[tuple[str, str]],
        public_host: str,
        forwarded_for_ip: str | None,
    ) -> None:
        self._app = app
        raw_path, _, query_string = path.partition("?")

        asgi_headers: list[tuple[bytes, bytes]] = []
        asgi_headers.append((b"host", public_host.encode("latin-1")))
        asgi_headers.append((b"x-forwarded-host", public_host.encode("latin-1")))
        asgi_headers.append((b"x-forwarded-proto", b"https"))
        if forwarded_for_ip:
            asgi_headers.append(
                (b"x-forwarded-for", forwarded_for_ip.encode("latin-1")),
            )
            asgi_headers.append(
                (b"forwarded", f"for={forwarded_for_ip}".encode("latin-1")),
            )
        offered_subprotocols: list[str] = []
        seen = {b"host", b"x-forwarded-host", b"x-forwarded-proto",
                b"x-forwarded-for", b"forwarded"}
        for k, v in headers:
            kl = k.lower()
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

        client_host = forwarded_for_ip or "unknown"
        self._scope = {
            "type": "websocket",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "scheme": "wss",
            "path": raw_path,
            "raw_path": raw_path.encode("utf-8"),
            "query_string": query_string.encode("utf-8"),
            "root_path": "",
            "headers": asgi_headers,
            "client": (client_host, 0),
            "server": (public_host, 443),
            "subprotocols": offered_subprotocols,
        }
        self._inbound: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._outbound: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self._accepted = asyncio.Event()
        self._accept_msg: dict[str, Any] | None = None
        self._closed = False
        self._task: asyncio.Task[None] | None = None

    async def run_until_accept(self) -> dict[str, Any]:
        await self._inbound.put({"type": "websocket.connect"})
        self._task = asyncio.create_task(self._run_app())
        await self._accepted.wait()
        assert self._accept_msg is not None
        return self._accept_msg

    async def _run_app(self) -> None:
        try:
            await self._app(self._scope, self._inbound.get, self._send)
        except Exception:
            logger.exception("WS app callable raised")
            if not self._accepted.is_set():
                self._accept_msg = {"type": "websocket.close", "code": 1011}
                self._accepted.set()
        finally:
            await self._outbound.put(None)

    async def _send(self, msg: dict[str, Any]) -> None:
        if (
            msg["type"] in ("websocket.accept", "websocket.close")
            and not self._accepted.is_set()
        ):
            self._accept_msg = msg
            self._accepted.set()
            if msg["type"] == "websocket.close":
                return
            return
        if msg["type"] in ("websocket.send", "websocket.close"):
            await self._outbound.put(msg)

    async def outbound(self):
        while True:
            msg = await self._outbound.get()
            if msg is None:
                return
            yield msg
            if msg["type"] == "websocket.close":
                return

    def signal_outbound_eof(self) -> None:
        try:
            self._outbound.put_nowait(None)
        except asyncio.QueueFull:
            pass

    async def deliver(self, wire: dict[str, Any]) -> None:
        kind = wire.get("type")
        if kind == "text":
            await self._inbound.put(
                {"type": "websocket.receive", "text": wire.get("data", "")},
            )
        elif kind == "binary":
            data = wire.get("data", "")
            # The server base64-encodes binary payloads on the wire;
            # decode back to the original bytes before handing to the
            # app callable.
            # ``validate=True`` makes b64decode reject non-base64
            # characters instead of silently stripping them — without
            # it, "@@@@" decodes to b"" and we'd deliver an empty
            # frame the app would mistake for a real message.
            if isinstance(data, str):
                try:
                    payload = base64.b64decode(data, validate=True)
                except (ValueError, base64.binascii.Error):  # type: ignore[attr-defined]
                    logger.warning(
                        "ws inbound: malformed base64 binary payload; "
                        "dropping frame",
                    )
                    return
            else:
                payload = bytes(data)
            await self._inbound.put(
                {"type": "websocket.receive", "bytes": payload},
            )
        elif kind == "close":
            await self._inbound.put(
                {
                    "type": "websocket.disconnect",
                    "code": int(wire.get("code", 1000)),
                },
            )

    async def close(self, *, code: int) -> None:
        if self._closed:
            return
        self._closed = True
        await self._inbound.put({"type": "websocket.disconnect", "code": code})
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=5.0)
            except asyncio.TimeoutError:
                self._task.cancel()
                try:
                    await self._task
                except (asyncio.CancelledError, Exception):
                    pass
            except (asyncio.CancelledError, Exception):
                pass
