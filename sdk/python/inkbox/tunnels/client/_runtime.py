"""
inkbox/tunnels/client/_runtime.py

The h2 data-plane runtime. Maintains one persistent HTTP/2 connection to
``https://{zone}/_system/connect``, parks N intake streams, dispatches
envelopes (HTTP / WS upgrade / passthrough TCP-stream), and manages
flow control + reconnect.

Responsibilities:

- URL-forward HTTP dispatch (forward third-party traffic to a local URL).
- In-process callable dispatch when ``forward_to`` is a Python web app.
- Out-of-band request-body materialization for offloaded inbound bodies.
- Scope parity for in-process dispatch (third-party IP, public host,
  explicit ``Host`` header) so the user's app sees consistent forwarded
  headers regardless of how ``forward_to`` is shaped.
- Path-traversal validation before invoking ``forward_to``.
- Owns its own ``httpx.AsyncClient`` for URL-forward and body-fetch GETs.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import socket
import ssl
import struct
from contextlib import suppress
from typing import Any, Callable
from urllib.parse import urlsplit
from uuid import UUID

import h2.config
import h2.connection
import h2.errors
import h2.events
import h2.exceptions
import h2.settings
import httpx

from inkbox.tunnels.client._asgi import AsgiResponseTooLarge, invoke_asgi_http
from inkbox.tunnels.client._bridge import (
    BRIDGE_CLEANUP_SEND_TIMEOUT_SEC,
    BRIDGE_CLOSE_CODE,
    BRIDGE_HALF_CLOSE_GRACE_SEC,
    BRIDGE_STATUS_TIMEOUT_SEC,
    BridgeOpenFailed,
    BridgeProtocolError,
    BridgeStats,
    BridgeStreamReset,
)
from inkbox.tunnels.client._envelope import (
    HOP_BY_HOP_RESPONSE,
    Envelope,
    filter_response_headers,
    parse_envelope,
)
from inkbox.tunnels.client._tls import TLSTerminator
from inkbox.tunnels.client._url_forward import (
    ForwardResult,
    forward_envelope_to_url,
    validate_envelope_path,
)
from inkbox.tunnels.client._ws import WSASGISession
from inkbox.tunnels.client._wsframe import (
    WS_OPCODE_BINARY,
    WS_OPCODE_CLOSE,
    WS_OPCODE_PING,
    WS_OPCODE_PONG,
    WS_OPCODE_TEXT,
    decode_ws_frames,
    encode_ws_envelope,
    encode_ws_frame,
)


logger = logging.getLogger("inkbox.tunnels")


PING_INTERVAL = 20.0
BACKOFF_CAP = 30.0
BACKOFF_JITTER = 0.25  # +- 25%

DEFAULT_INBOUND_BODY_BYTES = 32 * 1024 * 1024
DEFAULT_OUTBOUND_BODY_BYTES = 32 * 1024 * 1024


class _TunnelAuthError(RuntimeError):
    """Permanent auth failure from /_system/hello; do not retry."""


class _OwnerTokenInvalidError(RuntimeError):
    """Tunnel server rejected our owner_token (HTTP 401 on intake)."""


# Inbound stream events surfaced by the read loop.
class _StreamEvent:
    __slots__ = ("kind", "headers", "data", "flow_controlled_length")

    def __init__(
        self,
        kind: str,
        *,
        headers: list[tuple[str, str]] | None = None,
        data: bytes = b"",
        flow_controlled_length: int = 0,
    ) -> None:
        self.kind = kind
        self.headers = headers or []
        self.data = data
        self.flow_controlled_length = flow_controlled_length


# Type for status callbacks.
StatusCallback = Callable[[str], None]


class TunnelRuntime:
    """The data-plane runtime.

    Args:
        tunnel_id: Tunnel's UUID (string-coerced for headers).
        secret: The connect secret (sent on hello + every CONNECT).
        zone: The data-plane h2 endpoint host (e.g. ``inkboxwire.com``).
        public_host: Tunnel's public host (e.g. ``my-agent.inkboxwire.com``).
        pool_size: Requested number of parked intake streams. ``None``
            means omit the header so the server picks the default.
        forward_to: Either a URL string (e.g. ``"http://localhost:8080"``)
            or a Python web-app callable matching
            ``async def app(scope, receive, send)``.
        tls_terminator: Optional :class:`TLSTerminator` for passthrough.
        max_inbound_body_bytes: Cap for materialized inbound bodies.
        max_outbound_body_bytes: Cap for materialized outbound bodies.
        on_status: Optional callback invoked on transport state changes.
    """

    def __init__(
        self,
        *,
        tunnel_id: UUID | str,
        secret: str,
        zone: str,
        public_host: str,
        pool_size: int | None,
        forward_to: str | Any,
        tls_terminator: TLSTerminator | None,
        max_inbound_body_bytes: int = DEFAULT_INBOUND_BODY_BYTES,
        max_outbound_body_bytes: int = DEFAULT_OUTBOUND_BODY_BYTES,
        on_status: StatusCallback | None = None,
    ) -> None:
        self._tunnel_id = str(tunnel_id)
        self._secret = secret
        self._zone = zone
        self._public_host = public_host
        self._pool_size = pool_size
        self._forward_to = forward_to
        self._terminator = tls_terminator
        self._max_inbound = max_inbound_body_bytes
        self._max_outbound = max_outbound_body_bytes
        self._on_status = on_status

        self._is_url_forward = isinstance(forward_to, str)

        # Per-connection state — reset on every reconnect.
        self._owner_token: str | None = None
        self._server_pool_size: int | None = None
        self._intake_idle_seconds: float | None = None
        self._response_deadline_seconds: float | None = None

        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._h2: h2.connection.H2Connection | None = None
        self._stop = asyncio.Event()
        self._send_lock = asyncio.Lock()
        self._streams: dict[int, asyncio.Queue[_StreamEvent]] = {}
        self._window_events: dict[int, asyncio.Event] = {}
        self._conn_window_event = asyncio.Event()
        self._conn_window_event.set()
        self._tasks: set[asyncio.Task[Any]] = set()
        self._bridge_stream_ids: set[int] = set()

        # httpx.AsyncClient for URL forwarding + body-uri GETs. Lazily
        # created on first dispatch, closed deterministically in aclose().
        self._http_client: httpx.AsyncClient | None = None

    # --- public lifecycle ----------------------------------------------------

    async def aclose(self) -> None:
        self._stop.set()
        if self._writer is not None:
            try:
                self._writer.close()
                await self._writer.wait_closed()
            except (OSError, ConnectionError):
                pass
        if self._http_client is not None:
            try:
                await self._http_client.aclose()
            except Exception:
                pass
            self._http_client = None

    def _force_reconnect(self) -> None:
        writer = self._writer
        if writer is None:
            return
        with suppress(Exception):
            writer.close()

    async def serve_forever(self) -> None:
        backoff = 1.0
        consecutive_failures = 0
        self._notify_status("connecting")
        while not self._stop.is_set():
            try:
                await self._run_once()
                backoff = 1.0
                consecutive_failures = 0
            except asyncio.CancelledError:
                raise
            except _TunnelAuthError:
                logger.error(
                    "/_system/hello rejected the connect secret — refusing "
                    "to retry. Rotate via inkbox.tunnels.rotate_secret(id), "
                    "update the state file, and reconnect.",
                )
                self._notify_status("closed")
                raise
            except Exception:
                consecutive_failures += 1
                logger.exception(
                    "tunnel runtime: connection error (#%d); reconnecting",
                    consecutive_failures,
                )
                self._notify_status("reconnecting")
            if self._stop.is_set():
                self._notify_status("closed")
                return
            jitter = backoff * BACKOFF_JITTER * (2 * random.random() - 1)
            sleep_for = max(0.1, backoff + jitter)
            try:
                await asyncio.sleep(sleep_for)
            except asyncio.CancelledError:
                self._notify_status("closed")
                raise
            backoff = min(backoff * 2, BACKOFF_CAP)

    # --- connection lifecycle -----------------------------------------------

    async def _run_once(self) -> None:
        await self._open_connection()
        read_task = asyncio.create_task(self._read_loop())
        ping_task: asyncio.Task[None] | None = None
        try:
            try:
                await self._send_hello()
            except Exception:
                read_task.cancel()
                raise
            self._notify_status("connected")
            effective_pool = self._server_pool_size or self._pool_size or 1
            for slot in range(effective_pool):
                self._spawn(self._intake_loop(slot))
            ping_task = asyncio.create_task(self._ping_loop())
            await read_task
        finally:
            if ping_task is not None:
                ping_task.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await ping_task
            if not read_task.done():
                read_task.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await read_task
            for task in list(self._tasks):
                task.cancel()
            for task in list(self._tasks):
                with suppress(asyncio.CancelledError, Exception):
                    await task
            self._tasks.clear()
            self._streams.clear()
            self._window_events.clear()
            if self._writer is not None:
                with suppress(OSError, ConnectionError):
                    self._writer.close()
                    await self._writer.wait_closed()
            self._writer = None
            self._reader = None
            self._h2 = None

    def _spawn(self, coro: Any) -> asyncio.Task[Any]:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    async def _open_connection(self) -> None:
        ctx = ssl.create_default_context()
        ctx.set_alpn_protocols(["h2"])
        logger.info("connecting to https://%s/_system/connect", self._zone)
        self._reader, self._writer = await asyncio.open_connection(
            host=self._zone, port=443, ssl=ctx, server_hostname=self._zone,
        )
        sock = self._writer.get_extra_info("socket")
        if sock is not None:
            try:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except OSError:
                pass
        config = h2.config.H2Configuration(
            client_side=True, header_encoding="utf-8",
        )
        self._h2 = h2.connection.H2Connection(config=config)
        self._h2.local_settings.update({
            h2.settings.SettingCodes.ENABLE_CONNECT_PROTOCOL: 1,
        })
        self._h2.initiate_connection()
        await self._flush()

    async def _flush(self) -> None:
        assert self._h2 is not None and self._writer is not None
        data = self._h2.data_to_send()
        if data:
            self._writer.write(data)
            await self._writer.drain()

    # --- handshake -----------------------------------------------------------

    async def _send_hello(self) -> None:
        self._owner_token = None
        self._server_pool_size = None
        self._intake_idle_seconds = None
        self._response_deadline_seconds = None

        hello_headers: list[tuple[str, str]] = [
            (":method", "POST"),
            (":scheme", "https"),
            (":authority", self._zone),
            (":path", "/_system/hello"),
            ("x-tunnel-id", self._tunnel_id),
            ("x-tunnel-secret", self._secret),
            ("content-length", "0"),
        ]
        if self._pool_size is not None:
            hello_headers.append(("x-pool-size", str(self._pool_size)))

        async with self._send_lock:
            stream_id = self._open_stream_locked(hello_headers, end_stream=True)
            await self._flush()

        status, body = await self._await_response(stream_id)
        self._streams.pop(stream_id, None)
        if status in (401, 403):
            raise _TunnelAuthError(
                f"/_system/hello returned {status}; connect secret is invalid",
            )
        if status != 200:
            raise RuntimeError(
                f"/_system/hello returned {status}; transient — will retry",
            )
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError(
                f"/_system/hello returned 200 but body was not JSON: {exc}",
            ) from exc
        owner_token = payload.get("owner_token")
        if not owner_token:
            raise RuntimeError(
                "/_system/hello response missing owner_token; cannot park "
                "intake streams without it",
            )
        self._owner_token = str(owner_token)
        if isinstance(payload.get("default_pool_size"), int):
            self._server_pool_size = int(payload["default_pool_size"])
        if (val := payload.get("intake_idle_seconds")) is not None:
            try:
                self._intake_idle_seconds = float(val)
            except (TypeError, ValueError):
                pass
        if (val := payload.get("response_deadline_seconds")) is not None:
            try:
                self._response_deadline_seconds = float(val)
            except (TypeError, ValueError):
                pass

    def _open_stream_locked(
        self, headers: list[tuple[str, str]], *, end_stream: bool,
    ) -> int:
        assert self._h2 is not None
        stream_id = self._h2.get_next_available_stream_id()
        self._h2.send_headers(stream_id, headers, end_stream=end_stream)
        self._streams[stream_id] = asyncio.Queue()
        return stream_id

    async def _await_response_status(self, stream_id: int) -> int:
        status, _ = await self._await_response(stream_id)
        return status

    async def _await_response(self, stream_id: int) -> tuple[int, bytes]:
        queue = self._streams[stream_id]
        status: int = 0
        body = bytearray()
        got_headers = False
        while True:
            event = await queue.get()
            if event.kind == "headers" and not got_headers:
                got_headers = True
                status_str = next(
                    (v for k, v in event.headers if k == ":status"), "0",
                )
                try:
                    status = int(status_str)
                except ValueError:
                    status = 0
            elif event.kind == "data":
                body.extend(event.data)
            elif event.kind in ("end", "reset"):
                return status, bytes(body)

    # --- intake pool --------------------------------------------------------

    async def _intake_loop(self, slot: int) -> None:
        while not self._stop.is_set() and self._h2 is not None:
            try:
                envelope = await self._park_one_intake(slot)
            except asyncio.CancelledError:
                raise
            except _OwnerTokenInvalidError:
                logger.warning(
                    "intake slot %d: owner_token rejected; reconnecting", slot,
                )
                self._force_reconnect()
                return
            except Exception:
                logger.exception(
                    "intake slot %d transient error; retrying", slot,
                )
                await asyncio.sleep(0.25)
                continue
            if envelope is None:
                continue
            self._spawn(self._dispatch(envelope))

    async def _park_one_intake(self, slot: int) -> Envelope | None:
        if not self._owner_token:
            raise RuntimeError(
                "intake parked before /_system/hello returned an owner_token",
            )
        async with self._send_lock:
            stream_id = self._open_stream_locked(
                [
                    (":method", "POST"),
                    (":scheme", "https"),
                    (":authority", self._zone),
                    (":path", "/_system/intake"),
                    ("x-tunnel-id", self._tunnel_id),
                    ("x-owner-token", self._owner_token),
                    ("x-pool-slot", str(slot)),
                    ("content-length", "0"),
                ],
                end_stream=True,
            )
            await self._flush()

        queue = self._streams[stream_id]
        headers: list[tuple[str, str]] | None = None
        body = bytearray()
        try:
            while True:
                event = await queue.get()
                if event.kind == "headers" and headers is None:
                    headers = event.headers
                elif event.kind == "data":
                    body.extend(event.data)
                elif event.kind == "end":
                    break
                elif event.kind == "reset":
                    return None
        finally:
            self._streams.pop(stream_id, None)

        if headers is None:
            return None
        status = next((v for k, v in headers if k == ":status"), "0")
        if status != "200":
            reason = next(
                (v for k, v in headers if k == "inkbox-reason"), "",
            )
            body_bytes = bytes(body)[:200]
            logger.warning(
                "/_system/intake slot=%d -> status=%s reason=%r body=%r",
                slot, status, reason, body_bytes,
            )
            if status == "401":
                raise _OwnerTokenInvalidError(
                    f"slot={slot} status=401 reason={reason!r}",
                )
            return None
        return parse_envelope(headers, bytes(body))

    # --- read pump ----------------------------------------------------------

    async def _ping_loop(self) -> None:
        while not self._stop.is_set():
            await asyncio.sleep(PING_INTERVAL)
            if self._h2 is None or self._writer is None:
                return
            try:
                async with self._send_lock:
                    self._h2.ping(b"keepaliv")
                    await self._flush()
            except Exception:
                return

    async def _read_loop(self) -> None:
        assert self._h2 is not None and self._reader is not None
        while not self._stop.is_set():
            chunk = await self._reader.read(65536)
            if not chunk:
                return
            try:
                events = self._h2.receive_data(chunk)
            except h2.exceptions.ProtocolError:
                logger.exception("h2 protocol error")
                return
            for event in events:
                await self._handle_event(event)
            async with self._send_lock:
                await self._flush()

    async def _handle_event(self, event: h2.events.Event) -> None:
        if isinstance(event, h2.events.ResponseReceived):
            queue = self._streams.get(event.stream_id)
            if queue is not None:
                await queue.put(_StreamEvent(
                    "headers", headers=list(event.headers),
                ))
        elif isinstance(event, h2.events.InformationalResponseReceived):
            pass
        elif isinstance(event, h2.events.DataReceived):
            queue = self._streams.get(event.stream_id)
            if queue is not None:
                await queue.put(_StreamEvent(
                    "data",
                    data=event.data,
                    flow_controlled_length=event.flow_controlled_length,
                ))
            if (
                self._h2 is not None
                and event.stream_id not in self._bridge_stream_ids
            ):
                self._h2.acknowledge_received_data(
                    event.flow_controlled_length, event.stream_id,
                )
        elif isinstance(event, h2.events.StreamEnded):
            queue = self._streams.get(event.stream_id)
            if queue is not None:
                await queue.put(_StreamEvent("end"))
        elif isinstance(event, h2.events.StreamReset):
            queue = self._streams.get(event.stream_id)
            if queue is not None:
                await queue.put(_StreamEvent("reset"))
            ev = self._window_events.pop(event.stream_id, None)
            if ev is not None:
                ev.set()
        elif isinstance(event, h2.events.WindowUpdated):
            if event.stream_id == 0:
                self._conn_window_event.set()
            else:
                ev = self._window_events.get(event.stream_id)
                if ev is not None:
                    ev.set()
        elif isinstance(event, h2.events.ConnectionTerminated):
            debug = ""
            try:
                if event.additional_data:
                    debug = event.additional_data.decode("utf-8", errors="replace")
            except AttributeError:
                pass
            logger.info(
                "GOAWAY error_code=%s last_stream_id=%s debug=%r",
                event.error_code, event.last_stream_id, debug,
            )
            raise ConnectionError("tunnel server sent GOAWAY")

    # --- envelope dispatch --------------------------------------------------

    async def _dispatch(self, envelope: Envelope) -> None:
        if envelope.route_kind == "ws-upgrade":
            try:
                await self._dispatch_ws_upgrade(envelope)
            except Exception:
                logger.exception(
                    "ws dispatch failed request_id=%s", envelope.request_id,
                )
            return
        if envelope.route_kind == "tcp-stream":
            try:
                await self._dispatch_tcp_stream(envelope)
            except Exception:
                logger.exception(
                    "tcp-stream dispatch failed tcp_id=%s", envelope.tcp_id,
                )
            return
        try:
            await self._dispatch_http(envelope)
        except Exception:
            logger.exception(
                "dispatch failed request_id=%s", envelope.request_id,
            )
            with suppress(Exception):
                await self._post_response(
                    envelope.request_id,
                    status=500,
                    headers=[("content-type", "text/plain")],
                    body=b"internal error",
                )

    # --- HTTP envelope dispatch ---------------------------------------------

    async def _dispatch_http(self, envelope: Envelope) -> None:
        # Path-traversal guard. Runs BEFORE materializing body or
        # dispatching to forward_to.
        path_reject_reason = validate_envelope_path(envelope.path)
        if path_reject_reason is not None:
            await self._post_response(
                envelope.request_id,
                status=400,
                headers=[
                    ("content-type", "text/plain"),
                    ("inkbox-reason", path_reject_reason),
                ],
                body=b"invalid path",
            )
            return

        # The server's reply-wait clock starts the moment we hand off
        # the envelope, so the budget needs to cover materialization +
        # dispatch as one unit. Wrap both in a single _with_deadline.
        client = self._ensure_http_client() if self._is_url_forward else None
        disconnect_event = asyncio.Event()
        if self._stop.is_set():
            disconnect_event.set()

        async def _materialize_and_dispatch() -> tuple[
            str, int, list[tuple[str, str]], bytes,
        ]:
            """Materialize body (if offloaded) then dispatch.

            Returns ``(kind, status, headers, body)`` where ``kind`` is
            one of ``"forward"``, ``"asgi"``, or one of the reason
            strings the runtime maps to a fixed response (``too-large``,
            ``fetch-failed``).
            """
            nonlocal envelope
            try:
                envelope = await self._materialize_body(envelope)
            except _BodyTooLarge:
                return ("too-large", 413, [], b"")
            except Exception:
                logger.exception(
                    "body materialization failed request_id=%s",
                    envelope.request_id,
                )
                return ("fetch-failed", 502, [], b"")
            if self._is_url_forward:
                assert client is not None
                result = await forward_envelope_to_url(
                    envelope=envelope,
                    forward_to=self._forward_to,
                    public_host=self._public_host,
                    http_client=client,
                    max_outbound_body_bytes=self._max_outbound,
                )
                extras: list[tuple[str, str]] = []
                if result.inkbox_reason:
                    extras.append(("inkbox-reason", result.inkbox_reason))
                return (
                    "forward",
                    result.status,
                    filter_response_headers(result.headers) + extras,
                    result.body,
                )
            status, resp_headers, resp_body = await invoke_asgi_http(
                app=self._forward_to,
                envelope=envelope,
                public_host=self._public_host,
                max_response_bytes=self._max_outbound,
                disconnect_event=disconnect_event,
            )
            return (
                "asgi",
                status,
                filter_response_headers(resp_headers),
                resp_body,
            )

        try:
            try:
                kind, status, resp_headers, resp_body = await self._with_deadline(
                    _materialize_and_dispatch(),
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "asgi dispatch exceeded server response deadline "
                    "(%.1fs); request_id=%s",
                    self._response_deadline_seconds or 0.0,
                    envelope.request_id,
                )
                disconnect_event.set()
                await self._post_response(
                    envelope.request_id,
                    status=504,
                    headers=[
                        ("content-type", "text/plain"),
                        ("inkbox-reason", "response-deadline-exceeded"),
                    ],
                    body=b"local handler too slow",
                )
                return
            except AsgiResponseTooLarge:
                logger.warning(
                    "asgi response too large; cap=%d", self._max_outbound,
                )
                await self._post_response(
                    envelope.request_id,
                    status=502,
                    headers=[
                        ("content-type", "text/plain"),
                        ("inkbox-reason", "response-too-large"),
                    ],
                    body=b"response too large",
                )
                return
            if kind == "too-large":
                await self._post_response(
                    envelope.request_id,
                    status=413,
                    headers=[
                        ("content-type", "text/plain"),
                        ("inkbox-reason", "request-body-too-large"),
                    ],
                    body=b"request body too large",
                )
                return
            if kind == "fetch-failed":
                await self._post_response(
                    envelope.request_id,
                    status=502,
                    headers=[
                        ("content-type", "text/plain"),
                        ("inkbox-reason", "body-fetch-failed"),
                    ],
                    body=b"failed to fetch request body",
                )
                return
            await self._post_response(
                envelope.request_id,
                status=status,
                headers=resp_headers,
                body=resp_body,
            )
        finally:
            disconnect_event.set()

    async def _materialize_body(self, envelope: Envelope) -> Envelope:
        """Resolve any ``inkbox-body-uri`` GET into the envelope's body.

        Inline bodies are passed through unchanged. If the inline body
        already exceeds ``max_inbound_body_bytes``, raises
        :class:`_BodyTooLarge`.
        """
        if len(envelope.body) > self._max_inbound:
            raise _BodyTooLarge()
        if envelope.body_uri is None:
            return envelope
        client = self._ensure_http_client()
        async with client.stream("GET", envelope.body_uri) as resp:
            if resp.status_code >= 400:
                raise RuntimeError(
                    f"inkbox-body-uri GET returned {resp.status_code}",
                )
            buf = bytearray()
            async for chunk in resp.aiter_bytes():
                buf.extend(chunk)
                if len(buf) > self._max_inbound:
                    raise _BodyTooLarge()
            envelope.body = bytes(buf)
        return envelope

    async def _with_deadline(self, awaitable: Any) -> Any:
        """Wrap a dispatch coroutine in the server-advertised deadline.

        ``response_deadline_seconds`` is set by ``/_system/hello`` and
        bounds how long the public side will hold a request before
        releasing it back to the third party. Honoring it here prevents
        the SDK from posting a stale response after the server has
        already given up. Falls through (no timeout) if the server
        didn't advertise a deadline.
        """
        deadline = self._response_deadline_seconds
        if deadline is None or deadline <= 0:
            return await awaitable
        return await asyncio.wait_for(awaitable, timeout=deadline)

    def _ensure_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=30.0)
        return self._http_client

    # --- WebSocket bridge ---------------------------------------------------

    async def _dispatch_ws_upgrade(self, envelope: Envelope) -> None:
        """Bridge a third-party WS upgrade end-to-end (in-process app only in v1)."""
        if self._is_url_forward:
            # WS bridging requires an in-process app callable today.
            # Reject gracefully so a third-party WS upgrade doesn't hang.
            await self._reject_ws(
                envelope.request_id,
                status=501,
                reason="WS upgrade requires forward_to=app callable",
            )
            return
        if envelope.ws_id is None:
            await self._reject_ws(envelope.request_id, status=400, reason="missing ws_id")
            return

        ws_session = WSASGISession(
            app=self._forward_to,
            path=envelope.path,
            headers=envelope.forwarded_headers,
            public_host=self._public_host,
            forwarded_for_ip=envelope.forwarded_for_ip,
        )
        # The server's reply-wait clock is bounded by
        # response_deadline_seconds; if the app stalls before calling
        # accept() the third party will already have 504'd. Bound the
        # wait here so we don't leak a session task for a request
        # nobody is listening to anymore.
        try:
            accept_msg = await self._with_deadline(ws_session.run_until_accept())
        except asyncio.TimeoutError:
            logger.warning(
                "ws-upgrade: app did not call accept within deadline (%.1fs); "
                "request_id=%s",
                self._response_deadline_seconds or 0.0, envelope.request_id,
            )
            await ws_session.close(code=1011)
            await self._reject_ws(
                envelope.request_id,
                status=504,
                reason="ws upgrade timed out",
            )
            return
        if accept_msg["type"] == "websocket.close":
            code = accept_msg.get("code", 1006)
            await self._reject_ws(
                envelope.request_id,
                status=403,
                reason=f"app rejected WS (close code={code})",
            )
            return

        subprotocol = accept_msg.get("subprotocol")
        accept_headers: list[tuple[str, str]] = []
        for raw_k, raw_v in accept_msg.get("headers", []):
            try:
                k = raw_k.decode("latin-1") if isinstance(raw_k, bytes) else raw_k
                v = raw_v.decode("latin-1") if isinstance(raw_v, bytes) else raw_v
            except UnicodeDecodeError:
                continue
            if k.lower() in HOP_BY_HOP_RESPONSE:
                continue
            accept_headers.append((k, v))

        upgrade_reply_headers: list[tuple[str, str]] = []
        if subprotocol:
            upgrade_reply_headers.append(("sec-websocket-protocol", subprotocol))
        upgrade_reply_headers.extend(accept_headers)
        await self._post_response(
            envelope.request_id,
            status=200,
            headers=upgrade_reply_headers,
            body=b"",
        )

        connect_headers: list[tuple[str, str]] = [
            (":method", "CONNECT"),
            (":scheme", "https"),
            (":authority", self._zone),
            (":path", f"/_system/ws/{envelope.ws_id}"),
            (":protocol", "inkbox-tunnel-ws"),
            ("sec-websocket-version", "13"),
            ("x-tunnel-id", self._tunnel_id),
            ("x-tunnel-secret", self._secret),
            ("inkbox-ws-id", envelope.ws_id),
        ]

        async with self._send_lock:
            stream_id = self._open_stream_locked(connect_headers, end_stream=False)
            await self._flush()

        queue = self._streams[stream_id]

        async def _await_connect_200() -> bool:
            while True:
                event = await queue.get()
                if event.kind == "headers":
                    status_str = next(
                        (v for k, v in event.headers if k == ":status"), "0",
                    )
                    if status_str != "200":
                        logger.info(
                            "CONNECT /_system/ws/%s -> %s; aborting bridge",
                            envelope.ws_id, status_str,
                        )
                        return False
                    return True
                if event.kind in ("end", "reset"):
                    return False

        try:
            ok = await self._with_deadline(_await_connect_200())
        except asyncio.TimeoutError:
            logger.warning(
                "ws-upgrade CONNECT stream did not reach 200 within deadline; "
                "ws_id=%s", envelope.ws_id,
            )
            await ws_session.close(code=1011)
            self._streams.pop(stream_id, None)
            return
        if not ok:
            await ws_session.close(code=1011)
            self._streams.pop(stream_id, None)
            return

        try:
            await self._pump_ws(stream_id, ws_session)
        finally:
            await ws_session.close(code=1000)
            self._streams.pop(stream_id, None)

    async def _pump_ws(self, stream_id: int, ws_session: WSASGISession) -> None:
        wire_buf = bytearray()
        env_buf = bytearray()
        recv_done = False

        async def _send_ws_binary(payload: bytes, *, end_stream: bool = False) -> None:
            await self._send_data(
                stream_id,
                encode_ws_frame(WS_OPCODE_BINARY, payload, mask=True),
                end_stream=end_stream,
            )

        async def app_to_wire() -> None:
            try:
                async for msg in ws_session.outbound():
                    payload = encode_ws_envelope(msg)
                    await _send_ws_binary(payload, end_stream=False)
                close_env = encode_ws_envelope(
                    {"type": "websocket.close", "code": 1000, "reason": ""},
                )
                await _send_ws_binary(close_env, end_stream=False)
                close_frame_payload = (1000).to_bytes(2, "big")
                await self._send_data(
                    stream_id,
                    encode_ws_frame(WS_OPCODE_CLOSE, close_frame_payload, mask=True),
                    end_stream=True,
                )
            except (ConnectionError, h2.exceptions.ProtocolError):
                pass

        sender = self._spawn(app_to_wire())
        try:
            while not recv_done:
                event = await self._streams[stream_id].get()
                if event.kind == "data":
                    wire_buf.extend(event.data)
                    for opcode, payload, _fin in decode_ws_frames(wire_buf):
                        if opcode == WS_OPCODE_PING:
                            await self._send_data(
                                stream_id,
                                encode_ws_frame(WS_OPCODE_PONG, payload, mask=True),
                                end_stream=False,
                            )
                            continue
                        if opcode == WS_OPCODE_PONG:
                            continue
                        if opcode == WS_OPCODE_CLOSE:
                            with suppress(ConnectionError, h2.exceptions.ProtocolError):
                                await self._send_data(
                                    stream_id,
                                    encode_ws_frame(WS_OPCODE_CLOSE, payload, mask=True),
                                    end_stream=True,
                                )
                            recv_done = True
                            break
                        if opcode in (WS_OPCODE_BINARY, WS_OPCODE_TEXT):
                            env_buf.extend(payload)
                    while not recv_done:
                        if len(env_buf) < 4:
                            break
                        (length,) = struct.unpack(">I", bytes(env_buf[:4]))
                        if len(env_buf) < 4 + length:
                            break
                        env_bytes = bytes(env_buf[4:4 + length])
                        del env_buf[:4 + length]
                        try:
                            envelope_msg = json.loads(env_bytes.decode("utf-8"))
                        except (UnicodeDecodeError, json.JSONDecodeError):
                            continue
                        await ws_session.deliver(envelope_msg)
                        if envelope_msg.get("type") == "close":
                            recv_done = True
                            break
                elif event.kind in ("end", "reset"):
                    recv_done = True
        finally:
            ws_session.signal_outbound_eof()
            try:
                await asyncio.wait_for(sender, timeout=2.0)
            except asyncio.TimeoutError:
                sender.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await sender
            except (asyncio.CancelledError, Exception):
                pass

    # --- TCP-stream bridge (passthrough) ------------------------------------

    async def _dispatch_tcp_stream(self, envelope: Envelope) -> None:
        """Bridge a passthrough TCP stream end-to-end."""
        if self._terminator is None:
            logger.warning(
                "tcp-stream envelope received but tunnel is edge mode; "
                "dropping (server should not have routed this here)",
            )
            return
        if not self._is_url_forward:
            logger.warning(
                "tcp-stream envelope received but forward_to is not a URL; "
                "passthrough requires forward_to=URL in v1",
            )
            return
        if envelope.tcp_id is None:
            return

        parsed = urlsplit(self._forward_to)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or (443 if parsed.scheme == "https" else 80)

        tcp_id = envelope.tcp_id
        sni_host = envelope.sni_host or ""

        connect_headers: list[tuple[str, str]] = [
            (":method", "CONNECT"),
            (":scheme", "https"),
            (":authority", self._zone),
            (":path", f"/_system/tcp/{tcp_id}"),
            (":protocol", "inkbox-tunnel-tcp"),
            ("sec-websocket-version", "13"),
            ("sec-websocket-protocol", "inkbox-tunnel-tcp"),
            ("x-tunnel-id", self._tunnel_id),
            ("x-tunnel-secret", self._secret),
            ("inkbox-tcp-id", tcp_id),
        ]

        async with self._send_lock:
            stream_id = self._open_stream_locked(
                connect_headers, end_stream=False,
            )
            self._bridge_stream_ids.add(stream_id)
            try:
                await self._flush()
            except Exception:
                self._bridge_stream_ids.discard(stream_id)
                self._streams.pop(stream_id, None)
                raise

        async def _await_bridge_status_200() -> None:
            queue = self._streams[stream_id]
            while True:
                event = await queue.get()
                if event.kind == "headers":
                    status_str = next(
                        (v for k, v in event.headers if k == ":status"), "0",
                    )
                    if status_str != "200":
                        raise BridgeOpenFailed(f"status={status_str}")
                    return
                if event.kind in ("end", "reset"):
                    raise BridgeOpenFailed(f"stream {event.kind} before 200")
                raise BridgeProtocolError(
                    f"unexpected pre-headers event kind={event.kind}",
                )

        try:
            await asyncio.wait_for(
                _await_bridge_status_200(),
                timeout=BRIDGE_STATUS_TIMEOUT_SEC,
            )
        except (asyncio.TimeoutError, BridgeOpenFailed, BridgeProtocolError):
            logger.exception("bridge open failed tcp_id=%s", tcp_id)
            await self._drain_and_ack_pending(stream_id)
            async with self._send_lock:
                if self._h2 is not None:
                    with suppress(
                        h2.exceptions.StreamClosedError,
                        h2.exceptions.NoSuchStreamError,
                        h2.exceptions.ProtocolError,
                    ):
                        self._h2.reset_stream(
                            stream_id,
                            error_code=h2.errors.ErrorCodes.CANCEL,
                        )
                        await self._flush()
            self._bridge_stream_ids.discard(stream_id)
            self._streams.pop(stream_id, None)
            return

        try:
            lb_reader, lb_writer = await asyncio.open_connection(host, port)
        except OSError:
            logger.exception("loopback dial failed tcp_id=%s", tcp_id)
            close_payload = (1011).to_bytes(2, "big") + b"loopback-dial-failed"
            with suppress(Exception, asyncio.TimeoutError):
                await asyncio.wait_for(
                    self._send_data(
                        stream_id,
                        encode_ws_frame(WS_OPCODE_CLOSE, close_payload, mask=True),
                        end_stream=True,
                    ),
                    timeout=BRIDGE_CLEANUP_SEND_TIMEOUT_SEC,
                )
            await self._drain_and_ack_pending(stream_id)
            self._bridge_stream_ids.discard(stream_id)
            self._streams.pop(stream_id, None)
            return

        stats = BridgeStats(tcp_id=tcp_id, stream_id=stream_id, sni_host=sni_host)
        tls_session = self._terminator.session()
        tls_lock = asyncio.Lock()
        tls_closed = False
        close_reason = "clean-eof"

        async def maybe_close_tls() -> bytes:
            nonlocal tls_closed
            async with tls_lock:
                if tls_closed:
                    return b""
                tls_closed = True
                return tls_session.close()

        def _half_close_loopback() -> None:
            with suppress(OSError, ConnectionError):
                lb_writer.write_eof()

        async def _send_ws_frame(
            opcode: int, payload: bytes, *, end_stream: bool = False,
        ) -> None:
            await self._send_data(
                stream_id,
                encode_ws_frame(opcode, payload, mask=True),
                end_stream=end_stream,
            )

        async def inbound() -> None:
            wire_buf = bytearray()
            pending_frags: bytearray | None = None
            unacked_wire_bytes = 0
            try:
                while True:
                    event = await self._streams[stream_id].get()
                    if event.kind == "end":
                        _half_close_loopback()
                        return
                    if event.kind == "reset":
                        raise BridgeStreamReset("inbound stream reset")
                    if event.kind != "data":
                        continue
                    unacked_wire_bytes += event.flow_controlled_length
                    wire_buf.extend(event.data)
                    for opcode, payload, fin in decode_ws_frames(wire_buf):
                        if opcode == WS_OPCODE_PING:
                            await _send_ws_frame(WS_OPCODE_PONG, payload)
                            continue
                        if opcode == WS_OPCODE_CLOSE:
                            _half_close_loopback()
                            return
                        if opcode == WS_OPCODE_PONG:
                            continue
                        if opcode == WS_OPCODE_TEXT:
                            raise BridgeProtocolError("unexpected TEXT frame")
                        if opcode == 0x0:
                            if pending_frags is None:
                                raise BridgeProtocolError(
                                    "continuation without start frame",
                                )
                            pending_frags.extend(payload)
                            stats.continuation_frames += 1
                        elif opcode == WS_OPCODE_BINARY:
                            if pending_frags is not None:
                                raise BridgeProtocolError(
                                    "new BINARY frame while fragmented msg open",
                                )
                            pending_frags = bytearray(payload)
                        else:
                            raise BridgeProtocolError(
                                f"unexpected opcode {opcode:#x}",
                            )
                        if not fin:
                            continue
                        chunk = bytes(pending_frags)
                        pending_frags = None
                        async with tls_lock:
                            plaintext_chunks, handshake_out = tls_session.feed(chunk)
                        if handshake_out:
                            await _send_ws_frame(WS_OPCODE_BINARY, handshake_out)
                            stats.outbound_frames += 1
                            stats.encrypted_bytes += len(handshake_out)
                        for pt in plaintext_chunks:
                            lb_writer.write(pt)
                        if plaintext_chunks:
                            await lb_writer.drain()
                        stats.inbound_frames += 1
                        stats.decrypted_bytes += sum(
                            len(pt) for pt in plaintext_chunks
                        )
                        if (
                            not stats.tls_handshake_done
                            and tls_session.handshake_done
                        ):
                            stats.tls_handshake_done = True

                    pending_payload = (
                        len(pending_frags) if pending_frags else 0
                    )
                    consumed = (
                        unacked_wire_bytes
                        - len(wire_buf)
                        - pending_payload
                    )
                    if consumed > 0:
                        unacked_wire_bytes -= consumed
                        async with self._send_lock:
                            if self._h2 is not None:
                                with suppress(
                                    h2.exceptions.StreamClosedError,
                                    h2.exceptions.NoSuchStreamError,
                                    h2.exceptions.ProtocolError,
                                ):
                                    self._h2.acknowledge_received_data(
                                        consumed, stream_id,
                                    )
                                    await self._flush()
            finally:
                if unacked_wire_bytes:
                    async with self._send_lock:
                        if self._h2 is not None:
                            with suppress(
                                h2.exceptions.StreamClosedError,
                                h2.exceptions.NoSuchStreamError,
                                h2.exceptions.ProtocolError,
                            ):
                                self._h2.acknowledge_received_data(
                                    unacked_wire_bytes, stream_id,
                                )
                                await self._flush()

        async def outbound() -> None:
            while True:
                try:
                    plaintext = await lb_reader.read(16 * 1024)
                except (ConnectionError, asyncio.IncompleteReadError):
                    break
                if not plaintext:
                    break
                async with tls_lock:
                    encrypted = tls_session.send(plaintext)
                if encrypted:
                    await _send_ws_frame(WS_OPCODE_BINARY, encrypted)
                    stats.outbound_frames += 1
                    stats.encrypted_bytes += len(encrypted)
            tail = await maybe_close_tls()
            if tail:
                await _send_ws_frame(WS_OPCODE_BINARY, tail)

        in_task = asyncio.create_task(inbound())
        out_task = asyncio.create_task(outbound())
        try:
            done, pending = await asyncio.wait(
                {in_task, out_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            pending_list = list(pending)
            try:
                for t in done:
                    t.result()
            except BridgeProtocolError:
                close_reason = "protocol-error"
                raise
            except BridgeStreamReset:
                close_reason = "inbound-error"
                raise
            except ssl.SSLError:
                close_reason = "tls-error"
                raise
            except Exception:
                close_reason = (
                    "inbound-error" if in_task in done else "outbound-error"
                )
                raise
            if out_task in done and out_task.exception() is None:
                in_task.cancel()
                with suppress(asyncio.CancelledError):
                    await in_task
            else:
                try:
                    results = await asyncio.wait_for(
                        asyncio.gather(*pending_list, return_exceptions=True),
                        timeout=BRIDGE_HALF_CLOSE_GRACE_SEC,
                    )
                    for t, r in zip(pending_list, results):
                        if isinstance(r, BridgeProtocolError):
                            close_reason = "protocol-error"
                        elif isinstance(r, BridgeStreamReset):
                            close_reason = "inbound-error"
                        elif isinstance(r, ssl.SSLError):
                            close_reason = "tls-error"
                        elif isinstance(r, Exception):
                            close_reason = (
                                "inbound-error" if t is in_task
                                else "outbound-error"
                            )
                except asyncio.TimeoutError:
                    close_reason = "cancelled"
                    for t in pending_list:
                        t.cancel()
                    with suppress(asyncio.CancelledError):
                        await asyncio.gather(*pending_list, return_exceptions=True)
        except asyncio.CancelledError:
            close_reason = "cancelled"
            raise
        finally:
            for t in (in_task, out_task):
                if not t.done():
                    t.cancel()
            with suppress(asyncio.CancelledError):
                await asyncio.gather(in_task, out_task, return_exceptions=True)
            ws_close_code = BRIDGE_CLOSE_CODE.get(close_reason, 1011)
            stats.close_reason = close_reason
            tail = await maybe_close_tls()
            if tail:
                with suppress(Exception, asyncio.TimeoutError):
                    await asyncio.wait_for(
                        _send_ws_frame(WS_OPCODE_BINARY, tail),
                        timeout=BRIDGE_CLEANUP_SEND_TIMEOUT_SEC,
                    )
            reason_bytes = close_reason.encode("utf-8")[:123]
            close_payload = ws_close_code.to_bytes(2, "big") + reason_bytes
            with suppress(
                h2.exceptions.StreamClosedError, Exception, asyncio.TimeoutError,
            ):
                await asyncio.wait_for(
                    _send_ws_frame(
                        WS_OPCODE_CLOSE, close_payload, end_stream=True,
                    ),
                    timeout=BRIDGE_CLEANUP_SEND_TIMEOUT_SEC,
                )
            with suppress(Exception):
                await self._drain_and_ack_pending(stream_id)
            with suppress(Exception):
                lb_writer.close()
                await lb_writer.wait_closed()
            self._bridge_stream_ids.discard(stream_id)
            self._streams.pop(stream_id, None)

    async def _reject_ws(
        self, request_id: str, *, status: int, reason: str,
    ) -> None:
        await self._post_response(
            request_id,
            status=status,
            headers=[("content-type", "text/plain")],
            body=reason.encode("utf-8"),
        )

    # --- response posting ---------------------------------------------------

    async def _post_response(
        self,
        request_id: str,
        *,
        status: int,
        headers: list[tuple[str, str]],
        body: bytes,
    ) -> None:
        req_headers: list[tuple[str, str]] = [
            (":method", "POST"),
            (":scheme", "https"),
            (":authority", self._zone),
            (":path", f"/_system/response/{request_id}"),
            ("x-tunnel-id", self._tunnel_id),
            ("x-tunnel-secret", self._secret),
            ("inkbox-status", str(status)),
            ("inkbox-request-id", request_id),
            ("content-length", str(len(body))),
        ]
        for k, v in headers:
            kl = k.lower()
            if kl in ("content-length", "transfer-encoding"):
                continue
            req_headers.append((f"inkbox-h-{kl}", v))

        async with self._send_lock:
            stream_id = self._open_stream_locked(
                req_headers, end_stream=(len(body) == 0),
            )
            await self._flush()
        if body:
            await self._send_data(stream_id, body, end_stream=True)
        try:
            status_code = await asyncio.wait_for(
                self._await_response_status(stream_id), timeout=30.0,
            )
            if status_code >= 400:
                logger.warning(
                    "/_system/response/%s -> %d", request_id, status_code,
                )
        except asyncio.TimeoutError:
            logger.warning("/_system/response/%s timed out", request_id)
        finally:
            self._streams.pop(stream_id, None)

    async def _send_data(
        self, stream_id: int, data: bytes, *, end_stream: bool,
    ) -> None:
        assert self._h2 is not None
        offset = 0
        total = len(data)
        while offset < total:
            await self._await_window(stream_id)
            async with self._send_lock:
                if self._h2 is None:
                    raise ConnectionError("h2 connection torn down")
                window = min(
                    self._h2.local_flow_control_window(stream_id),
                    self._h2.max_outbound_frame_size,
                )
                if window <= 0:
                    self._mark_window_blocked(stream_id)
                    continue
                chunk = data[offset:offset + window]
                end = end_stream and (offset + len(chunk) >= total)
                self._h2.send_data(stream_id, chunk, end_stream=end)
                offset += len(chunk)
                await self._flush()
        if end_stream and offset == 0:
            async with self._send_lock:
                if self._h2 is not None:
                    self._h2.send_data(stream_id, b"", end_stream=True)
                    await self._flush()

    def _mark_window_blocked(self, stream_id: int) -> None:
        ev = self._window_events.setdefault(stream_id, asyncio.Event())
        if (
            self._h2 is not None
            and self._h2.local_flow_control_window(stream_id) <= 0
        ):
            ev.clear()
        if (
            self._h2 is not None
            and self._h2.outbound_flow_control_window <= 0
        ):
            self._conn_window_event.clear()

    async def _drain_and_ack_pending(self, stream_id: int) -> None:
        queue = self._streams.get(stream_id)
        if queue is None or self._h2 is None:
            return
        total = 0
        while not queue.empty():
            event = queue.get_nowait()
            if event.kind == "data":
                total += event.flow_controlled_length
        if not total:
            return
        async with self._send_lock:
            if self._h2 is None:
                return
            with suppress(
                h2.exceptions.StreamClosedError,
                h2.exceptions.NoSuchStreamError,
                h2.exceptions.ProtocolError,
            ):
                self._h2.acknowledge_received_data(total, stream_id)
                await self._flush()

    async def _await_window(self, stream_id: int) -> None:
        async with self._send_lock:
            if self._h2 is None:
                raise ConnectionError("h2 connection torn down")
            stream_window = self._h2.local_flow_control_window(stream_id)
            conn_window = self._h2.outbound_flow_control_window
            if stream_window > 0 and conn_window > 0:
                return
        wait_tasks: list[asyncio.Task[Any]] = []
        if stream_window <= 0:
            ev = self._window_events.setdefault(stream_id, asyncio.Event())
            wait_tasks.append(asyncio.create_task(ev.wait()))
        if conn_window <= 0:
            wait_tasks.append(asyncio.create_task(self._conn_window_event.wait()))
        if not wait_tasks:
            return
        try:
            done, pending = await asyncio.wait(
                wait_tasks, return_when=asyncio.FIRST_COMPLETED,
            )
        finally:
            for t in wait_tasks:
                if not t.done():
                    t.cancel()
            for t in wait_tasks:
                if not t.done():
                    with suppress(asyncio.CancelledError, Exception):
                        await t

    # --- utilities ----------------------------------------------------------

    def _notify_status(self, status: str) -> None:
        if self._on_status is not None:
            try:
                self._on_status(status)
            except Exception:
                logger.exception("on_status callback raised")


class _BodyTooLarge(Exception):
    pass
