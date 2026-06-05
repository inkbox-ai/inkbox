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
import base64
import json
import logging
import random
import socket
import ssl
import struct
import time
from contextlib import suppress
from typing import Any, Callable
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
# Hard ceiling on how long the runtime will sit on a connection that
# has not acked a PING. Mirrors the TS runtime's PING_ACK_TIMEOUT_MS.
# A silently-dead TCP (kernel sees no FIN; reads block, writes buffer)
# is the failure mode this guards against — without it, ``_read_loop``
# can park forever on a half-broken socket.
PING_ACK_TIMEOUT = 10.0
# OS TCP keepalive cadence applied to the underlying socket. Kicks in
# below the application-level PING ack timeout when the OS supports it
# (Linux/macOS); on platforms without per-socket keepalive knobs we
# silently degrade to PING ack tracking only.
TCP_KEEPALIVE_IDLE_SECONDS = 30
TCP_KEEPALIVE_INTERVAL_SECONDS = 10
TCP_KEEPALIVE_PROBE_COUNT = 3
BACKOFF_CAP = 30.0
BACKOFF_JITTER = 0.25  # +- 25%

# Budget for re-dialing the replacement connection during a handoff. The
# server may bounce the first hello while it drains (the NLB can land us
# back on the draining task), so retry with jittered backoff up to here.
HANDOFF_REDIAL_BUDGET_SEC = 30.0
# Minimum spacing between handoffs so a stray/rapid GOAWAY can't chain
# handoffs in a tight loop.
HANDOFF_SETTLE_SEC = 2.0
# How long an HTTP reply waits for an in-flight handoff to publish the
# new active connection before giving up (the server response deadline +
# the third-party retry recover a dropped reply).
POST_ACTIVE_WAIT_SEC = 5.0

# WS/passthrough close code surfaced to live bridges when the server
# drains (NO_ERROR GOAWAY). In the 4500 application range; must not
# collide with AGENT_TIMEOUT (4504).
WS_CLOSE_SERVER_DRAINING = 4500
WS_CLOSE_AGENT_TIMEOUT = 4504

DEFAULT_INBOUND_BODY_BYTES = 32 * 1024 * 1024
DEFAULT_OUTBOUND_BODY_BYTES = 32 * 1024 * 1024


class _TunnelAuthError(RuntimeError):
    """Permanent auth failure from /_system/hello; do not retry."""


class _OwnerTokenInvalidError(RuntimeError):
    """Tunnel server rejected our owner_token (HTTP 401 on intake)."""


# Inbound stream events surfaced by the read loop.
class _StreamEvent:
    __slots__ = (
        "kind", "headers", "data", "flow_controlled_length", "reset_code",
    )

    def __init__(
        self,
        kind: str,
        *,
        headers: list[tuple[str, str]] | None = None,
        data: bytes = b"",
        flow_controlled_length: int = 0,
        reset_code: int | None = None,
    ) -> None:
        self.kind = kind
        self.headers = headers or []
        self.data = data
        self.flow_controlled_length = flow_controlled_length
        # For "reset" events, an optional application close code that the
        # WS/TCP bridge surfaces to the customer's handler (e.g. the
        # server_draining code on a drain).
        self.reset_code = reset_code


# Type for status callbacks.
StatusCallback = Callable[[str], None]


class _Connection:
    """One persistent h2 connection's state.

    The runtime holds a single ``active`` connection (the pool that parks
    new intakes) plus zero-or-more ``draining`` ones during a
    make-before-break handoff. State is per-connection because two live
    h2 sessions each allocate stream ids 1,3,5… — a shared streams map
    would collide across them.
    """

    __slots__ = (
        "conn_id",
        "reader",
        "writer",
        "h2",
        "send_lock",
        "owner_token",
        "server_pool_size",
        "intake_idle_seconds",
        "response_deadline_seconds",
        "streams",
        "bridge_stream_ids",
        "window_events",
        "conn_window_event",
        "draining",
        "ping_task",
        "read_task",
        "outstanding_ping_payload",
        "outstanding_ping_sent_at",
        "goaway_received",
    )

    def __init__(self, conn_id: int) -> None:
        self.conn_id = conn_id
        self.reader: asyncio.StreamReader | None = None
        self.writer: asyncio.StreamWriter | None = None
        self.h2: h2.connection.H2Connection | None = None
        self.send_lock = asyncio.Lock()
        self.owner_token: str | None = None
        self.server_pool_size: int | None = None
        self.intake_idle_seconds: float | None = None
        self.response_deadline_seconds: float | None = None
        self.streams: dict[int, asyncio.Queue[_StreamEvent]] = {}
        self.bridge_stream_ids: set[int] = set()
        self.window_events: dict[int, asyncio.Event] = {}
        self.conn_window_event = asyncio.Event()
        self.conn_window_event.set()
        # Stop parking new intakes once this conn has received GOAWAY.
        self.draining = False
        self.ping_task: asyncio.Task[None] | None = None
        self.read_task: asyncio.Task[None] | None = None
        self.outstanding_ping_payload: bytes | None = None
        self.outstanding_ping_sent_at: float | None = None
        # Set once a GOAWAY (ConnectionTerminated) lands; the read loop
        # winds down because hyper-h2 is now CLOSED.
        self.goaway_received = False

    @property
    def live_bridges(self) -> int:
        return len(self.bridge_stream_ids)


class TunnelRuntime:
    """The data-plane runtime.

    Args:
        tunnel_id: Tunnel's UUID (string-coerced for headers).
        api_key: The data-plane API key (sent as `x-api-key` on hello +
            every CONNECT). Must be admin-scoped in the tunnel's org, or
            identity-scoped to match the tunnel's identity.
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
        api_key: str,
        zone: str,
        public_host: str,
        pool_size: int | None,
        forward_to: str | Any,
        tls_terminator: TLSTerminator | None,
        max_inbound_body_bytes: int = DEFAULT_INBOUND_BODY_BYTES,
        max_outbound_body_bytes: int = DEFAULT_OUTBOUND_BODY_BYTES,
        on_status: StatusCallback | None = None,
        forward_to_verify_tls: bool = True,
        forward_to_ca_bundle: bytes | str | None = None,
    ) -> None:
        self._tunnel_id = str(tunnel_id)
        self._api_key = api_key
        self._zone = zone
        self._public_host = public_host
        self._pool_size = pool_size
        self._forward_to = forward_to
        self._terminator = tls_terminator
        self._max_inbound = max_inbound_body_bytes
        self._max_outbound = max_outbound_body_bytes
        self._on_status = on_status
        self._forward_to_verify_tls = forward_to_verify_tls
        self._forward_to_ca_bundle = forward_to_ca_bundle

        self._is_url_forward = isinstance(forward_to, str)

        self._stop = asyncio.Event()
        # The connection that parks new intakes. Swapped atomically on a
        # make-before-break handoff. ``_draining`` holds post-GOAWAY
        # connections finishing in-flight work before they close.
        self._active: _Connection | None = None
        self._draining: set[_Connection] = set()
        self._next_conn_id = 1
        # True while a make-before-break handoff is dialing the
        # replacement; the supervisor + HTTP-reply gate key off it.
        self._handoff_in_flight = False
        self._handoff_task: asyncio.Task[None] | None = None
        self._last_handoff_at = 0.0
        # Wakes the supervisor when active is swapped mid-handoff.
        self._supervisor_wake: asyncio.Event = asyncio.Event()
        # Dispatch tasks are runtime-scoped (not per-connection): a
        # handoff must let an in-flight handler finish and post its reply
        # on the NEW conn. Only a cold reconnect cancels them.
        self._tasks: set[asyncio.Task[Any]] = set()

        # httpx.AsyncClient for URL forwarding + body-uri GETs. Lazily
        # created on first dispatch, closed deterministically in aclose().
        self._http_client: httpx.AsyncClient | None = None

        # Passthrough dispatcher (UpstreamUrlDispatch). Lazy: only
        # constructed when the first passthrough TCP stream needs it.
        self._passthrough_dispatch: object | None = None

    # --- active-connection delegation ---------------------------------------
    # The dispatch/pump code reads these per-connection fields off the
    # runtime; they resolve to the active connection. In steady state
    # (no drain) active is the only connection, so this preserves the
    # original single-connection behavior. Handoff-aware paths pass an
    # explicit connection instead of going through these.

    def _ensure_active(self) -> _Connection:
        if self._active is None:
            self._active = _Connection(self._next_conn_id)
            self._next_conn_id += 1
        return self._active

    @property
    def _h2(self) -> h2.connection.H2Connection | None:
        return self._active.h2 if self._active is not None else None

    @_h2.setter
    def _h2(self, value: h2.connection.H2Connection | None) -> None:
        self._ensure_active().h2 = value

    @property
    def _writer(self) -> asyncio.StreamWriter | None:
        return self._active.writer if self._active is not None else None

    @_writer.setter
    def _writer(self, value: asyncio.StreamWriter | None) -> None:
        self._ensure_active().writer = value

    @property
    def _reader(self) -> asyncio.StreamReader | None:
        return self._active.reader if self._active is not None else None

    @_reader.setter
    def _reader(self, value: asyncio.StreamReader | None) -> None:
        self._ensure_active().reader = value

    @property
    def _send_lock(self) -> asyncio.Lock:
        return self._ensure_active().send_lock

    @_send_lock.setter
    def _send_lock(self, value: asyncio.Lock) -> None:
        self._ensure_active().send_lock = value

    @property
    def _streams(self) -> dict[int, "asyncio.Queue[_StreamEvent]"]:
        return self._ensure_active().streams

    @property
    def _bridge_stream_ids(self) -> set[int]:
        return self._ensure_active().bridge_stream_ids

    @property
    def _window_events(self) -> dict[int, asyncio.Event]:
        return self._ensure_active().window_events

    @property
    def _conn_window_event(self) -> asyncio.Event:
        return self._ensure_active().conn_window_event

    @property
    def _owner_token(self) -> str | None:
        return self._active.owner_token if self._active is not None else None

    @_owner_token.setter
    def _owner_token(self, value: str | None) -> None:
        self._ensure_active().owner_token = value

    @property
    def _server_pool_size(self) -> int | None:
        return (
            self._active.server_pool_size if self._active is not None else None
        )

    @_server_pool_size.setter
    def _server_pool_size(self, value: int | None) -> None:
        self._ensure_active().server_pool_size = value

    @property
    def _intake_idle_seconds(self) -> float | None:
        return (
            self._active.intake_idle_seconds
            if self._active is not None else None
        )

    @_intake_idle_seconds.setter
    def _intake_idle_seconds(self, value: float | None) -> None:
        self._ensure_active().intake_idle_seconds = value

    @property
    def _response_deadline_seconds(self) -> float | None:
        return (
            self._active.response_deadline_seconds
            if self._active is not None else None
        )

    @_response_deadline_seconds.setter
    def _response_deadline_seconds(self, value: float | None) -> None:
        self._ensure_active().response_deadline_seconds = value

    @property
    def _outstanding_ping_payload(self) -> bytes | None:
        return (
            self._active.outstanding_ping_payload
            if self._active is not None else None
        )

    @_outstanding_ping_payload.setter
    def _outstanding_ping_payload(self, value: bytes | None) -> None:
        self._ensure_active().outstanding_ping_payload = value

    @property
    def _outstanding_ping_sent_at(self) -> float | None:
        return (
            self._active.outstanding_ping_sent_at
            if self._active is not None else None
        )

    @_outstanding_ping_sent_at.setter
    def _outstanding_ping_sent_at(self, value: float | None) -> None:
        self._ensure_active().outstanding_ping_sent_at = value

    # --- public lifecycle ----------------------------------------------------

    async def aclose(self) -> None:
        self._stop.set()
        # Cancel the ping loop on every connection (active + draining) so
        # no ping loop leaks across a handoff set, and close each writer.
        conns = [c for c in [self._active, *self._draining] if c is not None]
        for conn in conns:
            self._stop_ping_loop(conn)
            if conn.writer is not None:
                try:
                    conn.writer.close()
                    await conn.writer.wait_closed()
                except (OSError, ConnectionError):
                    pass
        if self._passthrough_dispatch is not None:
            try:
                await self._passthrough_dispatch.aclose()  # type: ignore[union-attr]
            except Exception:
                pass
            self._passthrough_dispatch = None
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
                    "/_system/hello rejected the API key — refusing to retry. "
                    "Check that the key matches the tunnel's identity scope "
                    "(or use an admin-scoped key in the tunnel's org).",
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
        conn = _Connection(self._next_conn_id)
        self._next_conn_id += 1
        self._active = conn
        await self._open_connection(conn)
        conn.read_task = asyncio.create_task(self._read_loop(conn))
        try:
            try:
                await self._send_hello(conn)
            except Exception:
                conn.read_task.cancel()
                raise
            self._notify_status("connected")
            self._start_serving(conn)
            # Supervise the active connection. A NO_ERROR GOAWAY swaps in
            # a fresh active out-of-band (make-before-break); follow it
            # without going through the backoff loop. Only a cold death
            # (active closed with no successor) returns so serve_forever
            # reconnects with backoff.
            while not self._stop.is_set():
                await self._wait_close_or_handoff(conn)
                if self._stop.is_set():
                    break
                if self._handoff_in_flight and self._handoff_task is not None:
                    with suppress(asyncio.CancelledError, Exception):
                        await self._handoff_task
                nxt = self._active
                if nxt is not None and nxt is not conn and not nxt.draining:
                    conn = nxt
                    continue
                if conn.read_task is None or conn.read_task.done():
                    break
        finally:
            await self._teardown_cold(conn)

    def _start_serving(self, conn: _Connection) -> None:
        """Spawn a connection's intake pool + ping loop."""
        effective_pool = conn.server_pool_size or self._pool_size or 1
        for slot in range(effective_pool):
            self._spawn(self._intake_loop(conn, slot))
        conn.ping_task = asyncio.create_task(self._ping_loop(conn))

    async def _wait_close_or_handoff(self, conn: _Connection) -> None:
        """Resolve once the supervised conn's read loop ends OR a handoff
        swaps the active connection."""
        self._supervisor_wake.clear()
        read_task = conn.read_task
        wake_task = asyncio.create_task(self._supervisor_wake.wait())
        waits: set[asyncio.Task[Any]] = {wake_task}
        if read_task is not None:
            waits.add(read_task)
        try:
            await asyncio.wait(waits, return_when=asyncio.FIRST_COMPLETED)
        finally:
            if not wake_task.done():
                wake_task.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await wake_task

    async def _teardown_cold(self, conn: _Connection) -> None:
        """Cold teardown of the supervised conn + any draining conns +
        all runtime dispatch tasks. The cold path (no live successor) is
        the only one that cancels in-flight dispatch tasks."""
        for c in [conn, *list(self._draining)]:
            self._stop_ping_loop(c)
            rt = c.read_task
            if rt is not None and not rt.done():
                rt.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await rt
        for task in list(self._tasks):
            task.cancel()
        for task in list(self._tasks):
            with suppress(asyncio.CancelledError, Exception):
                await task
        self._tasks.clear()
        for c in [conn, *list(self._draining)]:
            await self._close_connection_writer(c)
        self._draining.clear()
        if self._active is conn:
            self._active = None

    async def _close_connection_writer(self, conn: _Connection) -> None:
        conn.streams.clear()
        conn.window_events.clear()
        if conn.writer is not None:
            with suppress(OSError, ConnectionError):
                conn.writer.close()
                await conn.writer.wait_closed()
        conn.writer = None
        conn.reader = None
        conn.h2 = None

    def _spawn(self, coro: Any) -> asyncio.Task[Any]:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    # --- make-before-break handoff ------------------------------------------

    def _begin_handoff(self, old_conn: _Connection, *, reason: str) -> None:
        """On a NO_ERROR GOAWAY, stand up a fresh connection before the
        old one is torn down. In-band: never trips the backoff loop."""
        if (
            self._stop.is_set()
            or old_conn.draining
            or self._active is not old_conn
            or self._handoff_in_flight
            or (time.monotonic() - self._last_handoff_at) < HANDOFF_SETTLE_SEC
        ):
            return
        logger.info("tunnel runtime: starting handoff (reason=%r)", reason)
        self._handoff_in_flight = True
        self._last_handoff_at = time.monotonic()
        old_conn.draining = True
        self._draining.add(old_conn)
        # The old h2 is CLOSED at GOAWAY; pinging it is meaningless.
        self._stop_ping_loop(old_conn)
        self._handoff_task = asyncio.create_task(self._run_handoff(old_conn))

    async def _run_handoff(self, old_conn: _Connection) -> None:
        try:
            new_conn = await self._make_replacement_connection()
            self._active = new_conn
            # Supervisor was watching old_conn; wake it to follow new.
            self._supervisor_wake.set()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning(
                "tunnel runtime: handoff failed; reconnecting cold",
                exc_info=True,
            )
            # Force the old conn's read loop to end so the supervisor
            # returns to the cold backoff path.
            self._force_reconnect_conn(old_conn)
            self._supervisor_wake.set()
        finally:
            self._handoff_in_flight = False
            self._handoff_task = None
            await self._drain_old_connection(old_conn)

    async def _make_replacement_connection(self) -> _Connection:
        """Dial + hello + park a replacement, retrying transient hello
        failures (a drain 503 back on the still-draining task) within a
        bounded jittered budget."""
        backoff = 0.1
        start = time.monotonic()
        while not self._stop.is_set():
            conn = _Connection(self._next_conn_id)
            self._next_conn_id += 1
            try:
                await self._open_connection(conn)
                conn.read_task = asyncio.create_task(self._read_loop(conn))
                await self._send_hello(conn)
                self._start_serving(conn)
                return conn
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._force_reconnect_conn(conn)
                rt = conn.read_task
                if rt is not None and not rt.done():
                    rt.cancel()
                    with suppress(asyncio.CancelledError, Exception):
                        await rt
                await self._close_connection_writer(conn)
                if isinstance(exc, _TunnelAuthError):
                    raise
                if (time.monotonic() - start) > HANDOFF_REDIAL_BUDGET_SEC:
                    raise RuntimeError("handoff redial budget exhausted")
                jitter = backoff * BACKOFF_JITTER * (2 * random.random() - 1)
                await asyncio.sleep(max(0.05, backoff + jitter))
                backoff = min(backoff * 2, 5.0)
        raise RuntimeError("runtime stopped during handoff")

    async def _drain_old_connection(self, old_conn: _Connection) -> None:
        """Python's old h2 is CLOSED at GOAWAY, so its bridges can't keep
        running. Surface the typed server_draining close to each live
        bridge, then close the old writer. No bridge-drain window to wait
        on (unlike Node)."""
        self._surface_draining_to_bridges(old_conn)
        self._stop_ping_loop(old_conn)
        rt = old_conn.read_task
        if rt is not None and not rt.done():
            rt.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await rt
        await self._close_connection_writer(old_conn)
        self._draining.discard(old_conn)

    def _surface_draining_to_bridges(self, conn: _Connection) -> None:
        """Push a typed server_draining disconnect to every live bridge
        on the draining conn so the customer's handler/ASGI app sees a
        clean close instead of a hang. No send_* on the old (CLOSED) h2."""
        for stream_id in list(conn.bridge_stream_ids):
            queue = conn.streams.get(stream_id)
            if queue is not None:
                with suppress(asyncio.QueueFull):
                    queue.put_nowait(_StreamEvent(
                        "reset", reset_code=WS_CLOSE_SERVER_DRAINING,
                    ))

    def _wake_streams_on_close(self, conn: _Connection) -> None:
        """Wake non-bridge stream awaiters on a closed conn with a plain
        reset so in-flight intake/response waits don't hang. Bridges get
        the typed server_draining close via _surface_draining_to_bridges."""
        for stream_id, queue in list(conn.streams.items()):
            if stream_id in conn.bridge_stream_ids:
                continue
            with suppress(asyncio.QueueFull):
                queue.put_nowait(_StreamEvent("reset"))

    def _force_reconnect_conn(self, conn: _Connection) -> None:
        writer = conn.writer
        if writer is None:
            return
        with suppress(Exception):
            writer.close()

    async def _open_connection(self, conn: _Connection) -> None:
        ctx = ssl.create_default_context()
        ctx.set_alpn_protocols(["h2"])
        logger.info("connecting to https://%s/_system/connect", self._zone)
        conn.reader, conn.writer = await asyncio.open_connection(
            host=self._zone, port=443, ssl=ctx, server_hostname=self._zone,
        )
        sock = conn.writer.get_extra_info("socket")
        if sock is not None:
            try:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except OSError:
                pass
            # OS-level TCP keepalive — kicks in below the
            # application-level PING ack timeout when the OS supports
            # it. We set SO_KEEPALIVE unconditionally; the per-socket
            # idle/interval/count knobs are platform-specific so each
            # one is best-effort.
            try:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
            except OSError:
                pass
            for opt_name, value in (
                ("TCP_KEEPIDLE", TCP_KEEPALIVE_IDLE_SECONDS),
                ("TCP_KEEPINTVL", TCP_KEEPALIVE_INTERVAL_SECONDS),
                ("TCP_KEEPCNT", TCP_KEEPALIVE_PROBE_COUNT),
            ):
                opt = getattr(socket, opt_name, None)
                if opt is None:
                    continue
                try:
                    sock.setsockopt(socket.IPPROTO_TCP, opt, value)
                except OSError:
                    pass

        # Reset PING ack tracking for the fresh connection so a stale
        # outstanding-ping marker from a prior session can't trip the
        # watchdog the moment the new ping_loop starts.
        conn.outstanding_ping_payload = None
        conn.outstanding_ping_sent_at = None
        config = h2.config.H2Configuration(
            client_side=True, header_encoding="utf-8",
        )
        conn.h2 = h2.connection.H2Connection(config=config)
        conn.h2.local_settings.update({
            h2.settings.SettingCodes.ENABLE_CONNECT_PROTOCOL: 1,
        })
        conn.h2.initiate_connection()
        await self._flush_conn(conn)

    async def _flush(self) -> None:
        await self._flush_conn(self._active)

    async def _flush_conn(self, conn: _Connection | None) -> None:
        if conn is None or conn.h2 is None or conn.writer is None:
            return
        data = conn.h2.data_to_send()
        if data:
            conn.writer.write(data)
            await conn.writer.drain()

    # --- handshake -----------------------------------------------------------

    async def _send_hello(self, conn: _Connection | None = None) -> None:
        conn = conn if conn is not None else self._active
        assert conn is not None
        conn.owner_token = None
        conn.server_pool_size = None
        conn.intake_idle_seconds = None
        conn.response_deadline_seconds = None

        hello_headers: list[tuple[str, str]] = [
            (":method", "POST"),
            (":scheme", "https"),
            (":authority", self._zone),
            (":path", "/_system/hello"),
            ("x-tunnel-id", self._tunnel_id),
            ("x-api-key", self._api_key),
            ("content-length", "0"),
        ]
        if self._pool_size is not None:
            hello_headers.append(("x-pool-size", str(self._pool_size)))

        async with conn.send_lock:
            stream_id = self._open_stream_locked(hello_headers, end_stream=True, conn=conn)
            await self._flush_conn(conn)

        status, body = await self._await_response(stream_id, conn=conn)
        conn.streams.pop(stream_id, None)
        if status in (401, 403):
            raise _TunnelAuthError(
                f"/_system/hello returned {status}; the API key was rejected "
                "(check the key matches the tunnel's identity scope, or use "
                "an admin-scoped key in the tunnel's org)",
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
        conn.owner_token = str(owner_token)
        if isinstance(payload.get("default_pool_size"), int):
            conn.server_pool_size = int(payload["default_pool_size"])
        if (val := payload.get("intake_idle_seconds")) is not None:
            try:
                conn.intake_idle_seconds = float(val)
            except (TypeError, ValueError):
                pass
        if (val := payload.get("response_deadline_seconds")) is not None:
            try:
                conn.response_deadline_seconds = float(val)
            except (TypeError, ValueError):
                pass

    def _open_stream_locked(
        self,
        headers: list[tuple[str, str]],
        *,
        end_stream: bool,
        conn: _Connection | None = None,
    ) -> int:
        conn = conn if conn is not None else self._active
        assert conn is not None and conn.h2 is not None
        stream_id = conn.h2.get_next_available_stream_id()
        conn.h2.send_headers(stream_id, headers, end_stream=end_stream)
        conn.streams[stream_id] = asyncio.Queue()
        return stream_id

    async def _await_response_status(
        self, stream_id: int, conn: _Connection | None = None,
    ) -> int:
        status, _ = await self._await_response(stream_id, conn=conn)
        return status

    async def _await_response(
        self, stream_id: int, conn: _Connection | None = None,
    ) -> tuple[int, bytes]:
        conn = conn if conn is not None else self._active
        assert conn is not None
        queue = conn.streams[stream_id]
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

    async def _intake_loop(
        self, conn: _Connection | None = None, slot: int = 0,
    ) -> None:
        # Back-compat: a positional ``slot`` (no conn) targets active.
        if isinstance(conn, int):
            slot = conn
            conn = None
        conn = conn if conn is not None else self._active
        assert conn is not None
        while (
            not self._stop.is_set()
            and not conn.draining
            and conn.h2 is not None
        ):
            try:
                envelope = await self._park_one_intake(conn, slot)
            except asyncio.CancelledError:
                raise
            except _OwnerTokenInvalidError:
                logger.warning(
                    "intake slot %d: owner_token rejected; reconnecting", slot,
                )
                self._force_reconnect_conn(conn)
                return
            except Exception:
                logger.exception(
                    "intake slot %d transient error; retrying", slot,
                )
                await asyncio.sleep(0.25)
                continue
            if envelope is None:
                continue
            # Dispatch tasks are runtime-scoped and survive a handoff.
            # ``conn`` is the origin connection for bridge binds; HTTP
            # replies migrate to the active conn (see _post_response).
            self._spawn(self._dispatch(envelope, conn))

    async def _park_one_intake(
        self, conn: _Connection | None = None, slot: int = 0,
    ) -> Envelope | None:
        if isinstance(conn, int):
            slot = conn
            conn = None
        conn = conn if conn is not None else self._active
        assert conn is not None
        if not conn.owner_token:
            raise RuntimeError(
                "intake parked before /_system/hello returned an owner_token",
            )
        async with conn.send_lock:
            stream_id = self._open_stream_locked(
                [
                    (":method", "POST"),
                    (":scheme", "https"),
                    (":authority", self._zone),
                    (":path", "/_system/intake"),
                    ("x-tunnel-id", self._tunnel_id),
                    ("x-owner-token", conn.owner_token),
                    ("x-pool-slot", str(slot)),
                    ("content-length", "0"),
                ],
                end_stream=True,
                conn=conn,
            )
            await self._flush_conn(conn)

        queue = conn.streams[stream_id]
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
            conn.streams.pop(stream_id, None)

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

    def _stop_ping_loop(self, conn: _Connection) -> None:
        task = conn.ping_task
        conn.ping_task = None
        if task is not None and not task.done():
            task.cancel()

    async def _ping_loop(self, conn: _Connection | None = None) -> None:
        """Send a PING every ``PING_INTERVAL`` and force-reconnect if a
        prior PING has not been acked within ``PING_ACK_TIMEOUT``.

        Detects silently-dead TCP that the OS hasn't reported yet
        (carrier loss, firewall idle reap, NAT rebind, etc.). The TS
        runtime has the same shape; this brings Python to parity.
        """
        conn = conn if conn is not None else self._active
        assert conn is not None

        def _force() -> None:
            # Back-compat: when pinging the active conn, route through
            # _force_reconnect (the existing watchdog test patches it).
            if conn is self._active:
                self._force_reconnect()
            else:
                self._force_reconnect_conn(conn)

        while not self._stop.is_set():
            await asyncio.sleep(PING_INTERVAL)
            if conn.h2 is None or conn.writer is None:
                return
            # Before sending the next PING, fail fast if the previous
            # one is still unacked past the deadline.
            if (
                conn.outstanding_ping_payload is not None
                and conn.outstanding_ping_sent_at is not None
                and (time.monotonic() - conn.outstanding_ping_sent_at)
                > PING_ACK_TIMEOUT
            ):
                logger.warning(
                    "tunnel runtime: PING ack not received within %.1fs; "
                    "forcing reconnect",
                    PING_ACK_TIMEOUT,
                )
                _force()
                return
            payload = struct.pack("!Q", int(time.monotonic_ns()) & ((1 << 64) - 1))
            try:
                async with conn.send_lock:
                    conn.h2.ping(payload)
                    await self._flush_conn(conn)
            except Exception:
                logger.warning(
                    "tunnel runtime: PING send failed; forcing reconnect",
                    exc_info=True,
                )
                _force()
                return
            conn.outstanding_ping_payload = payload
            conn.outstanding_ping_sent_at = time.monotonic()

    async def _read_loop(self, conn: _Connection | None = None) -> None:
        conn = conn if conn is not None else self._active
        assert conn is not None and conn.h2 is not None and conn.reader is not None
        while not self._stop.is_set():
            chunk = await conn.reader.read(65536)
            if not chunk:
                return
            try:
                events = conn.h2.receive_data(chunk)
            except h2.exceptions.ProtocolError:
                logger.exception("h2 protocol error")
                return
            for event in events:
                await self._handle_event(event, conn)
            if conn.goaway_received:
                # hyper-h2 is CLOSED; nothing more will arrive on this
                # conn. Surface a synthetic reset to any pending stream
                # awaiters so they wake instead of hanging.
                self._wake_streams_on_close(conn)
                return
            async with conn.send_lock:
                await self._flush_conn(conn)

    async def _handle_event(
        self, event: h2.events.Event, conn: _Connection | None = None,
    ) -> None:
        conn = conn if conn is not None else self._active
        assert conn is not None
        if isinstance(event, h2.events.ResponseReceived):
            queue = conn.streams.get(event.stream_id)
            if queue is not None:
                await queue.put(_StreamEvent(
                    "headers", headers=list(event.headers),
                ))
        elif isinstance(event, h2.events.InformationalResponseReceived):
            pass
        elif isinstance(event, h2.events.DataReceived):
            queue = conn.streams.get(event.stream_id)
            if queue is not None:
                await queue.put(_StreamEvent(
                    "data",
                    data=event.data,
                    flow_controlled_length=event.flow_controlled_length,
                ))
            if (
                conn.h2 is not None
                and event.stream_id not in conn.bridge_stream_ids
            ):
                conn.h2.acknowledge_received_data(
                    event.flow_controlled_length, event.stream_id,
                )
        elif isinstance(event, h2.events.StreamEnded):
            queue = conn.streams.get(event.stream_id)
            if queue is not None:
                await queue.put(_StreamEvent("end"))
        elif isinstance(event, h2.events.StreamReset):
            queue = conn.streams.get(event.stream_id)
            if queue is not None:
                await queue.put(_StreamEvent("reset"))
            ev = conn.window_events.pop(event.stream_id, None)
            if ev is not None:
                ev.set()
        elif isinstance(event, h2.events.WindowUpdated):
            if event.stream_id == 0:
                conn.conn_window_event.set()
            else:
                ev = conn.window_events.get(event.stream_id)
                if ev is not None:
                    ev.set()
        elif isinstance(event, h2.events.PingAckReceived):
            # Clear the outstanding-ping marker so ``_ping_loop``'s next
            # tick doesn't trip the watchdog. ``ping_data`` round-trips
            # the bytes we sent; we don't strictly require equality
            # (a single outstanding ping at a time means the only
            # legitimate ack is for that ping) but we still validate
            # for sanity.
            ack_data = getattr(event, "ping_data", None)
            if (
                conn.outstanding_ping_payload is not None
                and (ack_data is None or ack_data == conn.outstanding_ping_payload)
            ):
                conn.outstanding_ping_payload = None
                conn.outstanding_ping_sent_at = None
        elif isinstance(event, h2.events.ConnectionTerminated):
            debug = ""
            try:
                if event.additional_data:
                    debug = event.additional_data.decode("utf-8", errors="replace")
            except AttributeError:
                pass
            reason = _parse_goaway_reason(debug)
            # Log the parsed reason + length only; the raw debug field is
            # peer-controlled, so don't echo it verbatim at info level.
            logger.info(
                "GOAWAY error_code=%s last_stream_id=%s reason=%r debug_len=%d",
                event.error_code, event.last_stream_id, reason, len(debug),
            )
            # hyper-h2 flips the whole connection to CLOSED on GOAWAY
            # regardless of error code, so we cannot keep live bridges
            # running on this conn (unlike Node). A NO_ERROR (0) GOAWAY
            # is the server's drain signal: hand off make-before-break
            # instead of raising. A non-zero code is a real fault — let
            # the read loop end and reconnect cold.
            conn.goaway_received = True
            if event.error_code == 0 and conn is self._active:
                self._begin_handoff(conn, reason=reason or "drain")

    # --- envelope dispatch --------------------------------------------------

    async def _dispatch(
        self, envelope: Envelope, origin: _Connection | None = None,
    ) -> None:
        origin = origin if origin is not None else self._active
        if envelope.route_kind == "ws-upgrade":
            try:
                await self._dispatch_ws_upgrade(envelope, origin)
            except Exception:
                logger.exception(
                    "ws dispatch failed request_id=%s", envelope.request_id,
                )
            return
        if envelope.route_kind == "tcp-stream":
            try:
                await self._dispatch_tcp_stream(envelope, origin)
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
            # Honor the forward_to_verify_tls / forward_to_ca_bundle
            # opts so edge https:// URL forwarding respects the same
            # knobs as the passthrough path. They're no-ops for http://
            # upstreams (httpx skips TLS entirely there).
            from inkbox.tunnels.client._upstream_tls import (
                build_upstream_tls_context,
            )
            verify_arg: bool | str | object = build_upstream_tls_context(
                verify=self._forward_to_verify_tls,
                ca_bundle=self._forward_to_ca_bundle,
            )
            self._http_client = httpx.AsyncClient(
                timeout=30.0, verify=verify_arg,
            )
        return self._http_client

    # --- WebSocket bridge ---------------------------------------------------

    async def _dispatch_ws_upgrade(
        self, envelope: Envelope, origin: _Connection | None = None,
    ) -> None:
        """Bridge a third-party WS upgrade end-to-end.

        URL forward_to: open an h1 ``Upgrade: websocket`` to the upstream
        and bridge frames between the bridge stream and the upstream
        socket. Callable forward_to: drive the user's ASGI websocket app
        directly (existing path).

        ``origin`` is the connection the upgrade arrived on; the bridge
        bind + pump ride it (they do NOT migrate on a handoff). The
        upgrade reply also rides origin — a WS upgrade caught mid-drain
        cannot complete via make-before-break (the bind is task-local).
        """
        origin = origin if origin is not None else self._active
        if envelope.ws_id is None:
            await self._reject_ws(envelope.request_id, status=400, reason="missing ws_id")
            return
        # Path-traversal guard. Edge WS upgrades skip _dispatch_http's
        # validate_envelope_path check, so apply it here too.
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
        if self._is_url_forward:
            await self._dispatch_ws_upgrade_to_url(envelope, origin)
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
        # WS-upgrade reply rides the origin conn only (never migrates).
        await self._post_response(
            envelope.request_id,
            status=200,
            headers=upgrade_reply_headers,
            body=b"",
            target=origin,
        )

        connect_headers: list[tuple[str, str]] = [
            (":method", "CONNECT"),
            (":scheme", "https"),
            (":authority", self._zone),
            (":path", f"/_system/ws/{envelope.ws_id}"),
            (":protocol", "inkbox-tunnel-ws"),
            ("sec-websocket-version", "13"),
            ("x-tunnel-id", self._tunnel_id),
            ("x-api-key", self._api_key),
            ("inkbox-ws-id", envelope.ws_id),
        ]

        async with origin.send_lock:
            stream_id = self._open_stream_locked(
                connect_headers, end_stream=False, conn=origin,
            )
            await self._flush_conn(origin)
        origin.bridge_stream_ids.add(stream_id)

        queue = origin.streams[stream_id]

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
            # RST the h2 CONNECT stream so it doesn't sit half-open
            # server-side; mirror the URL WSS bridge-open failure path.
            await self._reset_bridge_stream(stream_id, conn=origin)
            await ws_session.close(code=1011)
            origin.bridge_stream_ids.discard(stream_id)
            origin.streams.pop(stream_id, None)
            return
        if not ok:
            await self._reset_bridge_stream(stream_id, conn=origin)
            await ws_session.close(code=1011)
            origin.bridge_stream_ids.discard(stream_id)
            origin.streams.pop(stream_id, None)
            return

        close_code = 1000
        try:
            close_code = await self._pump_ws(stream_id, ws_session, origin)
        finally:
            await ws_session.close(code=close_code)
            # Graceful END_STREAM on the bridge so the server sees a
            # clean half-close. The pump may already have sent
            # END_STREAM (e.g. on app-side close); the helper
            # suppresses the resulting StreamClosedError.
            await self._end_bridge_stream(stream_id, conn=origin)
            origin.bridge_stream_ids.discard(stream_id)
            origin.streams.pop(stream_id, None)

    async def _dispatch_ws_upgrade_to_url(
        self, envelope: Envelope, origin: _Connection | None = None,
    ) -> None:
        """Bridge a third-party WS upgrade to a ``ws://`` / ``wss://``
        URL upstream.

        Opens an h1 ``Upgrade: websocket`` to the upstream URL, posts a
        ``:status 200`` upgrade reply on the bridge, then pumps frames
        in both directions: bridge → length-prefixed JSON envelopes
        carry text/binary/close from the third party, which we encode
        as RFC 6455 frames (masked, h1 client-side) and write to the
        upstream socket; upstream RFC 6455 frames are decoded (server,
        unmasked) and re-emitted as JSON envelopes back over the
        bridge.
        """
        from inkbox.tunnels.client._ws_upstream import (
            WsUpstreamError, open_ws_upstream,
        )

        origin = origin if origin is not None else self._active
        assert origin is not None

        # Bound the upstream handshake by the same clock the server
        # uses for the third-party reply. If response_deadline_seconds
        # is smaller than the helper default, posting a stale reject
        # after the server already 504'd would just be wasted work.
        handshake_timeout_s = (
            float(self._response_deadline_seconds)
            if self._response_deadline_seconds is not None
            else 30.0
        )
        try:
            up = await open_ws_upstream(
                forward_to=self._forward_to,
                request_path=envelope.path,
                request_headers=envelope.forwarded_headers,
                ws_subprotocol=_first_header(
                    envelope.forwarded_headers, "sec-websocket-protocol",
                ),
                forwarded_for_ip=envelope.forwarded_for_ip,
                public_host=self._public_host,
                verify=self._forward_to_verify_tls,
                ca_bundle=self._forward_to_ca_bundle,
                handshake_timeout_s=handshake_timeout_s,
            )
        except WsUpstreamError as e:
            await self._reject_ws(
                envelope.request_id, status=e.status, reason=e.reason,
            )
            return

        # Tell the third party the upgrade succeeded. Forward the
        # upstream's 101 response headers — application-defined headers
        # like X-Use-Inkbox-* opt-out flags, Set-Cookie session
        # establishment, custom correlation IDs, etc. all live here
        # and customers expect them to round-trip. Filter out:
        #   * hop-by-hop (connection, upgrade, transfer-encoding, ...)
        #   * ws handshake-control headers — these are per-hop.
        #     sec-websocket-accept is recomputed by the tunnel server
        #     against the third party's key. sec-websocket-key/version
        #     are request-only. extensions is already gated above
        #     (we 502 if upstream confirms one).
        #   * h2 pseudo-headers (defensive).
        from inkbox.tunnels.client._envelope import HOP_BY_HOP_RESPONSE
        ws_handshake_strip = {
            "sec-websocket-accept",
            "sec-websocket-extensions",
            "sec-websocket-key",
            "sec-websocket-version",
        }
        upgrade_reply_headers: list[tuple[str, str]] = []
        for hk, hv in up.headers:
            if hk.startswith(":"):
                continue
            if hk in HOP_BY_HOP_RESPONSE:
                continue
            if hk in ws_handshake_strip:
                continue
            upgrade_reply_headers.append((hk, hv))
        # WS-upgrade reply rides the origin conn only (never migrates).
        await self._post_response(
            envelope.request_id, status=200,
            headers=upgrade_reply_headers, body=b"",
            target=origin,
        )

        # Open the bridge stream.
        connect_headers: list[tuple[str, str]] = [
            (":method", "CONNECT"),
            (":scheme", "https"),
            (":authority", self._zone),
            (":path", f"/_system/ws/{envelope.ws_id}"),
            (":protocol", "inkbox-tunnel-ws"),
            ("sec-websocket-version", "13"),
            ("x-tunnel-id", self._tunnel_id),
            ("x-api-key", self._api_key),
            ("inkbox-ws-id", envelope.ws_id),
        ]
        async with origin.send_lock:
            stream_id = self._open_stream_locked(
                connect_headers, end_stream=False, conn=origin,
            )
            await self._flush_conn(origin)
        origin.bridge_stream_ids.add(stream_id)
        queue = origin.streams[stream_id]

        async def _await_connect_200() -> bool:
            while True:
                event = await queue.get()
                if event.kind == "headers":
                    status_str = next(
                        (v for k, v in event.headers if k == ":status"), "0",
                    )
                    return status_str == "200"
                if event.kind in ("end", "reset"):
                    return False

        try:
            ok = await self._with_deadline(_await_connect_200())
        except asyncio.TimeoutError:
            ok = False
        if not ok:
            # Bridge open failed — RST the h2 CONNECT stream so it
            # doesn't sit half-open server-side. Without this the
            # stream stays alive until the session GOAWAYs.
            await self._reset_bridge_stream(stream_id, conn=origin)
            await _safe_close_stream_writer(up.writer)
            origin.bridge_stream_ids.discard(stream_id)
            origin.streams.pop(stream_id, None)
            return

        try:
            await self._pump_ws_url_bridge(
                stream_id, up.reader, up.writer, up.leftover, origin,
            )
        finally:
            await _safe_close_stream_writer(up.writer)
            # Best-effort graceful END_STREAM on the bridge so the
            # server sees a clean half-close. The pump may already
            # have sent END_STREAM (e.g. on upstream WS CLOSE) — the
            # h2 lib will raise StreamClosedError, which we suppress.
            await self._end_bridge_stream(stream_id, conn=origin)
            origin.bridge_stream_ids.discard(stream_id)
            origin.streams.pop(stream_id, None)

    async def _pump_ws_url_bridge(
        self,
        stream_id: int,
        upstream_reader: asyncio.StreamReader,
        upstream_writer: asyncio.StreamWriter,
        upstream_leftover: bytes,
        origin: _Connection | None = None,
    ) -> None:
        """Bridge frames between the bridge stream and an upstream WS
        socket. The bridge protocol carries length-prefixed JSON
        envelopes inside outer WS BINARY frames. Each direction:

        * Bridge → upstream: parse outer WS BINARY → inner JSON
          envelope (text/binary/close) → encode as RFC 6455 frame
          (masked, h1 client-side) → write to upstream socket.

        * Upstream → bridge: read RFC 6455 frames (server, unmasked) →
          encode as JSON envelope → wrap in outer WS BINARY (masked) →
          send on bridge stream.
        """
        from inkbox.tunnels.client._ws_passthrough import decode_client_frame
        origin = origin if origin is not None else self._active
        assert origin is not None
        wire_buf = bytearray()
        env_buf = bytearray()
        recv_done = False
        upstream_buf = bytearray(upstream_leftover)
        upstream_closed = asyncio.Event()
        # Inbound h2 stream-window flow control: ``_handle_event``
        # deliberately skips bridge streams in the auto-ack path so the
        # consumer can credit back as it actually drains. Without this,
        # the server's per-stream send window (default 65535) depletes
        # after a few hundred small frames and inbound stalls — see
        # passthrough TCP for the same pattern.
        unacked_wire_bytes = 0

        async def _send_outer_binary(payload: bytes, *, end_stream: bool = False) -> None:
            await self._send_data(
                stream_id,
                encode_ws_frame(WS_OPCODE_BINARY, payload, mask=True),
                end_stream=end_stream,
                conn=origin,
            )

        async def upstream_to_bridge() -> None:
            # The inkbox bridge envelope schema cannot represent
            # fragmentation. Reassemble RFC 6455 fragments client-side
            # so we emit one envelope per complete message.
            message_opcode: int | None = None
            message_chunks: list[bytes] = []
            try:
                while not upstream_closed.is_set():
                    decoded = decode_client_frame(
                        upstream_buf, require_mask=False,
                    )
                    if decoded is None:
                        chunk = await upstream_reader.read(4096)
                        if not chunk:
                            return
                        upstream_buf.extend(chunk)
                        continue
                    opcode, payload, fin = decoded
                    if opcode == WS_OPCODE_PING:
                        # Respond directly to upstream; don't propagate.
                        try:
                            upstream_writer.write(
                                encode_ws_frame(
                                    WS_OPCODE_PONG, payload, mask=True,
                                ),
                            )
                            await upstream_writer.drain()
                        except (OSError, ConnectionError):
                            return
                        continue
                    if opcode == WS_OPCODE_PONG:
                        continue
                    if opcode == WS_OPCODE_CLOSE:
                        code = (
                            int.from_bytes(payload[:2], "big")
                            if len(payload) >= 2 else 1000
                        )
                        env = encode_ws_envelope({
                            "type": "websocket.close", "code": code, "reason": "",
                        })
                        with suppress(Exception):
                            await _send_outer_binary(env, end_stream=True)
                        return
                    if opcode in (WS_OPCODE_TEXT, WS_OPCODE_BINARY):
                        if message_opcode is not None:
                            # RFC 6455 §5.4 violation — drop & close.
                            return
                        message_opcode = opcode
                        message_chunks = [payload]
                    elif opcode == 0x0:  # CONTINUATION
                        if message_opcode is None:
                            return
                        message_chunks.append(payload)
                    else:
                        # Unknown opcode — ignore safely.
                        continue
                    if fin and message_opcode is not None:
                        full = b"".join(message_chunks)
                        started_opcode = message_opcode
                        message_opcode = None
                        message_chunks = []
                        if started_opcode == WS_OPCODE_TEXT:
                            try:
                                text = full.decode("utf-8")
                            except UnicodeDecodeError:
                                return
                            env = encode_ws_envelope({
                                "type": "websocket.send", "text": text,
                            })
                            await _send_outer_binary(env)
                        else:  # BINARY
                            env = encode_ws_envelope({
                                "type": "websocket.send", "bytes": full,
                            })
                            await _send_outer_binary(env)
            except (ConnectionError, h2.exceptions.ProtocolError):
                pass
            finally:
                upstream_closed.set()

        sender = self._spawn(upstream_to_bridge())

        async def _await_event_or_close() -> _StreamEvent | None:
            """Wake on a queue event OR upstream_closed. Returns None
            when upstream closed (abrupt EOF/RST) so the loop can exit
            without waiting for a third-party frame that may never
            arrive."""
            get_task = asyncio.create_task(origin.streams[stream_id].get())
            close_task = asyncio.create_task(upstream_closed.wait())
            try:
                done, _pending = await asyncio.wait(
                    {get_task, close_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if get_task in done:
                    return get_task.result()
                return None
            finally:
                for t in (get_task, close_task):
                    if not t.done():
                        t.cancel()
                        with suppress(asyncio.CancelledError, Exception):
                            await t

        async def _credit_consumed() -> None:
            """Credit back bytes that have left both wire_buf and
            env_buf — i.e. WS frame headers we've decoded plus
            envelopes we've forwarded to upstream. Mirrors the TCP
            passthrough pump's `consumed = unacked - len(wire_buf) -
            pending` accounting so end-to-end backpressure (slow
            upstream → server stops sending) holds."""
            nonlocal unacked_wire_bytes
            consumed = unacked_wire_bytes - len(wire_buf) - len(env_buf)
            if consumed <= 0:
                return
            unacked_wire_bytes -= consumed
            async with origin.send_lock:
                if origin.h2 is None:
                    return
                with suppress(
                    h2.exceptions.StreamClosedError,
                    h2.exceptions.NoSuchStreamError,
                    h2.exceptions.ProtocolError,
                ):
                    origin.h2.acknowledge_received_data(consumed, stream_id)
                    await self._flush_conn(origin)

        try:
            while not recv_done and not upstream_closed.is_set():
                event = await _await_event_or_close()
                if event is None:
                    break
                if event.kind == "data":
                    unacked_wire_bytes += event.flow_controlled_length
                    wire_buf.extend(event.data)
                    for opcode, payload, _fin in decode_ws_frames(wire_buf):
                        if opcode == WS_OPCODE_PING:
                            await self._send_data(
                                stream_id,
                                encode_ws_frame(WS_OPCODE_PONG, payload, mask=True),
                                end_stream=False,
                                conn=origin,
                            )
                            continue
                        if opcode == WS_OPCODE_PONG:
                            continue
                        if opcode == WS_OPCODE_CLOSE:
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
                        try:
                            envelope_msg = json.loads(env_bytes.decode("utf-8"))
                        except (UnicodeDecodeError, json.JSONDecodeError):
                            del env_buf[:4 + length]
                            await _credit_consumed()
                            continue
                        kind = envelope_msg.get("type")
                        if kind == "text":
                            text = envelope_msg.get("data") or ""
                            try:
                                upstream_writer.write(
                                    encode_ws_frame(
                                        WS_OPCODE_TEXT,
                                        text.encode("utf-8"),
                                        mask=True,
                                    ),
                                )
                                await upstream_writer.drain()
                            except (OSError, ConnectionError):
                                recv_done = True
                                break
                        elif kind == "binary":
                            data_b64 = envelope_msg.get("data") or ""
                            try:
                                payload_bin = base64.b64decode(
                                    data_b64, validate=True,
                                )
                            except (ValueError, base64.binascii.Error):  # type: ignore[attr-defined]
                                del env_buf[:4 + length]
                                await _credit_consumed()
                                continue
                            try:
                                upstream_writer.write(
                                    encode_ws_frame(
                                        WS_OPCODE_BINARY, payload_bin, mask=True,
                                    ),
                                )
                                await upstream_writer.drain()
                            except (OSError, ConnectionError):
                                recv_done = True
                                break
                        elif kind == "close":
                            code = int(envelope_msg.get("code", 1000))
                            with suppress(OSError, ConnectionError):
                                upstream_writer.write(
                                    encode_ws_frame(
                                        WS_OPCODE_CLOSE,
                                        code.to_bytes(2, "big"),
                                        mask=True,
                                    ),
                                )
                                await upstream_writer.drain()
                            del env_buf[:4 + length]
                            await _credit_consumed()
                            recv_done = True
                            break
                        # Per-envelope-consumed credit: the envelope
                        # has been delivered to upstream's socket buffer
                        # AND drained, so slow upstreams naturally
                        # propagate backpressure to the server.
                        del env_buf[:4 + length]
                        await _credit_consumed()
                    # Frame-header bytes that left wire_buf during
                    # decode but didn't correspond to forwarded
                    # envelopes (e.g. PING/PONG/partial frames) still
                    # need crediting so a chatty PING storm doesn't
                    # eat the window.
                    await _credit_consumed()
                elif event.kind in ("end", "reset"):
                    # On a server-drain reset, give the SDK-owned upstream
                    # leg a clean typed WS CLOSE instead of an abrupt RST.
                    if event.kind == "reset" and event.reset_code is not None:
                        with suppress(OSError, ConnectionError):
                            upstream_writer.write(
                                encode_ws_frame(
                                    WS_OPCODE_CLOSE,
                                    event.reset_code.to_bytes(2, "big"),
                                    mask=True,
                                ),
                            )
                            await upstream_writer.drain()
                    recv_done = True
        finally:
            upstream_closed.set()
            try:
                await asyncio.wait_for(sender, timeout=2.0)
            except asyncio.TimeoutError:
                sender.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await sender

    async def _pump_ws(
        self,
        stream_id: int,
        ws_session: WSASGISession,
        origin: _Connection | None = None,
    ) -> int:
        origin = origin if origin is not None else self._active
        assert origin is not None
        wire_buf = bytearray()
        env_buf = bytearray()
        recv_done = False
        # Close code surfaced to the app on bridge teardown; a drain
        # reset carries WS_CLOSE_SERVER_DRAINING.
        close_code = 1000
        # See _pump_ws_url_bridge for the full rationale; same bug
        # was present here. Bridge streams are excluded from
        # _handle_event's auto-ack so the consumer must credit back
        # as it drains, otherwise the server's per-stream window
        # depletes and inbound stalls.
        unacked_wire_bytes = 0

        async def _credit_consumed() -> None:
            nonlocal unacked_wire_bytes
            consumed = unacked_wire_bytes - len(wire_buf) - len(env_buf)
            if consumed <= 0:
                return
            unacked_wire_bytes -= consumed
            async with origin.send_lock:
                if origin.h2 is None:
                    return
                with suppress(
                    h2.exceptions.StreamClosedError,
                    h2.exceptions.NoSuchStreamError,
                    h2.exceptions.ProtocolError,
                ):
                    origin.h2.acknowledge_received_data(consumed, stream_id)
                    await self._flush_conn(origin)

        async def _send_ws_binary(payload: bytes, *, end_stream: bool = False) -> None:
            await self._send_data(
                stream_id,
                encode_ws_frame(WS_OPCODE_BINARY, payload, mask=True),
                end_stream=end_stream,
                conn=origin,
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
                    conn=origin,
                )
            except (ConnectionError, h2.exceptions.ProtocolError):
                pass

        sender = self._spawn(app_to_wire())
        try:
            while not recv_done:
                event = await origin.streams[stream_id].get()
                if event.kind == "data":
                    unacked_wire_bytes += event.flow_controlled_length
                    wire_buf.extend(event.data)
                    for opcode, payload, _fin in decode_ws_frames(wire_buf):
                        if opcode == WS_OPCODE_PING:
                            await self._send_data(
                                stream_id,
                                encode_ws_frame(WS_OPCODE_PONG, payload, mask=True),
                                end_stream=False,
                                conn=origin,
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
                                    conn=origin,
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
                        try:
                            envelope_msg = json.loads(env_bytes.decode("utf-8"))
                        except (UnicodeDecodeError, json.JSONDecodeError):
                            del env_buf[:4 + length]
                            await _credit_consumed()
                            continue
                        await ws_session.deliver(envelope_msg)
                        del env_buf[:4 + length]
                        await _credit_consumed()
                        if envelope_msg.get("type") == "close":
                            recv_done = True
                            break
                    # Frame-header bytes that left wire_buf still
                    # need crediting (e.g. PING storms).
                    await _credit_consumed()
                elif event.kind in ("end", "reset"):
                    if event.kind == "reset" and event.reset_code is not None:
                        # A server-drain reset carries the typed close
                        # code; surface it to the app instead of 1000.
                        close_code = event.reset_code
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
        return close_code

    # --- TCP-stream bridge (passthrough) ------------------------------------

    async def _dispatch_tcp_stream(
        self, envelope: Envelope, origin: _Connection | None = None,
    ) -> None:
        """Bridge a passthrough TCP stream end-to-end."""
        if self._terminator is None:
            logger.warning(
                "tcp-stream envelope received but tunnel is edge mode; "
                "dropping (server should not have routed this here)",
            )
            return
        if envelope.tcp_id is None:
            return

        origin = origin if origin is not None else self._active
        assert origin is not None

        # forward_to is parsed by UpstreamUrlDispatch; no per-bridge URL
        # parse here after the parser-based refactor.

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
            ("x-api-key", self._api_key),
            ("inkbox-tcp-id", tcp_id),
        ]

        async with origin.send_lock:
            stream_id = self._open_stream_locked(
                connect_headers, end_stream=False, conn=origin,
            )
            origin.bridge_stream_ids.add(stream_id)
            try:
                await self._flush_conn(origin)
            except Exception:
                origin.bridge_stream_ids.discard(stream_id)
                origin.streams.pop(stream_id, None)
                raise

        async def _await_bridge_status_200() -> None:
            queue = origin.streams[stream_id]
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
            await self._drain_and_ack_pending(stream_id, conn=origin)
            async with origin.send_lock:
                if origin.h2 is not None:
                    with suppress(
                        h2.exceptions.StreamClosedError,
                        h2.exceptions.NoSuchStreamError,
                        h2.exceptions.ProtocolError,
                    ):
                        origin.h2.reset_stream(
                            stream_id,
                            error_code=h2.errors.ErrorCodes.CANCEL,
                        )
                        await self._flush_conn(origin)
            origin.bridge_stream_ids.discard(stream_id)
            origin.streams.pop(stream_id, None)
            return

        # Build (or reuse) the passthrough dispatcher for this runtime.
        # UpstreamUrlDispatch owns its own httpx.AsyncClient pool; we
        # construct it once and share it across bridge streams. The
        # dispatcher is closed in TunnelRuntime.aclose().
        from inkbox.tunnels.client._dispatch import (
            CallableDispatch,
            UpstreamUrlDispatch,
        )
        if self._passthrough_dispatch is None:
            if self._is_url_forward:
                self._passthrough_dispatch = UpstreamUrlDispatch(
                    forward_to=self._forward_to,
                    public_host=self._public_host,
                    max_outbound_body_bytes=self._max_outbound,
                    max_inbound_body_bytes=self._max_inbound,
                    verify=self._forward_to_verify_tls,
                    ca_bundle=self._forward_to_ca_bundle,
                )
            else:
                self._passthrough_dispatch = CallableDispatch(
                    app=self._forward_to,
                    public_host=self._public_host,
                    max_outbound_body_bytes=self._max_outbound,
                )
        dispatch = self._passthrough_dispatch

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

        async def _send_ws_frame(
            opcode: int, payload: bytes, *, end_stream: bool = False,
        ) -> None:
            await self._send_data(
                stream_id,
                encode_ws_frame(opcode, payload, mask=True),
                end_stream=end_stream,
                conn=origin,
            )

        # Plaintext adapter — picked once after the TLS handshake reports
        # an ALPN protocol. Until then plaintext is buffered (typically
        # nothing arrives until handshake completes).
        plaintext_adapter: object | None = None
        adapter_ready = asyncio.Event()

        def _build_adapter() -> object:
            from inkbox.tunnels.client._h1_server import (
                InProcH1ParserPlaintext,
            )
            from inkbox.tunnels.client._h2_transcode import (
                H2TranscoderPlaintext,
            )
            alpn = tls_session._sslobj.selected_alpn_protocol()
            if alpn == "h2":
                return H2TranscoderPlaintext(
                    dispatch=dispatch,
                    max_inbound_body_bytes=self._max_inbound,
                )
            # Default to h1 parser for "http/1.1", None, or anything
            # else (defensive — unknown ALPN gets the parser path).
            return InProcH1ParserPlaintext(
                dispatch=dispatch,
                max_inbound_body_bytes=self._max_inbound,
                forwarded_for_ip=None,
                sni_host=sni_host or None,
            )

        # Outbound queue: TLS-wrapped plaintext bytes from the adapter,
        # sent back to the third party as WS BINARY frames.
        async def _outbound_send(plaintext: bytes) -> None:
            if not plaintext:
                return
            async with tls_lock:
                encrypted = tls_session.send(plaintext)
            if encrypted:
                await _send_ws_frame(WS_OPCODE_BINARY, encrypted)
                stats.outbound_frames += 1
                stats.encrypted_bytes += len(encrypted)

        async def inbound() -> None:
            nonlocal plaintext_adapter
            wire_buf = bytearray()
            pending_frags: bytearray | None = None
            unacked_wire_bytes = 0
            try:
                while True:
                    event = await origin.streams[stream_id].get()
                    if event.kind == "end":
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
                        # Build the plaintext adapter on first
                        # handshake-complete OR first plaintext byte.
                        # ssl.MemoryBIO flips ``handshake_done``
                        # synchronously inside ``feed()`` so this
                        # second condition is normally redundant for
                        # Python — symmetric with the TS fix that
                        # works around Node's async ``secureConnect``
                        # event ordering. Plaintext can only flow
                        # after the handshake is materially done, so
                        # using its presence as a trigger is safe.
                        if plaintext_adapter is None and (
                            tls_session.handshake_done
                            or plaintext_chunks
                        ):
                            plaintext_adapter = _build_adapter()
                            adapter_ready.set()
                        for pt in plaintext_chunks:
                            if plaintext_adapter is not None:
                                await plaintext_adapter.feed(pt)  # type: ignore[union-attr]
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
                        async with origin.send_lock:
                            if origin.h2 is not None:
                                with suppress(
                                    h2.exceptions.StreamClosedError,
                                    h2.exceptions.NoSuchStreamError,
                                    h2.exceptions.ProtocolError,
                                ):
                                    origin.h2.acknowledge_received_data(
                                        consumed, stream_id,
                                    )
                                    await self._flush_conn(origin)
            finally:
                if unacked_wire_bytes:
                    async with origin.send_lock:
                        if origin.h2 is not None:
                            with suppress(
                                h2.exceptions.StreamClosedError,
                                h2.exceptions.NoSuchStreamError,
                                h2.exceptions.ProtocolError,
                            ):
                                origin.h2.acknowledge_received_data(
                                    unacked_wire_bytes, stream_id,
                                )
                                await self._flush_conn(origin)

        async def outbound() -> None:
            # Wait for the Plaintext adapter to be picked (ALPN known
            # post-handshake), then run its outbound pump until the
            # adapter closes. The pump returns when the adapter pushes
            # its sentinel; we exit cleanly so the bridge wait
            # completes alongside inbound().
            await adapter_ready.wait()
            assert plaintext_adapter is not None
            await plaintext_adapter.pump_outbound(_outbound_send)  # type: ignore[union-attr]

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
                await self._drain_and_ack_pending(stream_id, conn=origin)
            # Close the per-bridge plaintext adapter (h1 parser or h2
            # transcoder). The shared UpstreamUrlDispatch lives on the
            # runtime and is closed in TunnelRuntime.aclose().
            if plaintext_adapter is not None:
                with suppress(Exception):
                    await plaintext_adapter.aclose()  # type: ignore[union-attr]
            origin.bridge_stream_ids.discard(stream_id)
            origin.streams.pop(stream_id, None)

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

    def _pick_reply_connection(
        self, origin: _Connection | None,
    ) -> _Connection | None:
        """The active conn if it can take new streams, else origin if it
        can. After a GOAWAY the origin refuses new streams, so an HTTP
        webhook reply migrates to the new active conn."""
        def usable(c: _Connection | None) -> bool:
            return (
                c is not None
                and not c.draining
                and c.h2 is not None
                and not c.goaway_received
            )
        if usable(self._active):
            return self._active
        if usable(origin):
            return origin
        return None

    async def _post_response(
        self,
        request_id: str,
        *,
        status: int,
        headers: list[tuple[str, str]],
        body: bytes,
        target: _Connection | None = None,
    ) -> None:
        # HTTP webhook replies migrate to the current active conn; pass
        # an explicit ``target`` (the origin) for replies that must NOT
        # migrate (WS-upgrade reply). A webhook can finish in the window
        # after the old conn is marked draining but before the new active
        # has parked — wait (bounded) for the handoff to publish it.
        if target is None:
            if self._handoff_in_flight and self._handoff_task is not None:
                with suppress(asyncio.CancelledError, Exception):
                    await asyncio.wait_for(
                        asyncio.shield(self._handoff_task),
                        timeout=POST_ACTIVE_WAIT_SEC,
                    )
            conn = self._pick_reply_connection(self._active)
            if conn is None:
                logger.warning(
                    "no live connection to post reply request_id=%s; dropping",
                    request_id,
                )
                return
        else:
            conn = target

        req_headers: list[tuple[str, str]] = [
            (":method", "POST"),
            (":scheme", "https"),
            (":authority", self._zone),
            (":path", f"/_system/response/{request_id}"),
            ("x-tunnel-id", self._tunnel_id),
            ("x-api-key", self._api_key),
            ("inkbox-status", str(status)),
            ("inkbox-request-id", request_id),
            ("content-length", str(len(body))),
        ]
        for k, v in headers:
            kl = k.lower()
            if kl in ("content-length", "transfer-encoding"):
                continue
            req_headers.append((f"inkbox-h-{kl}", v))

        async with conn.send_lock:
            stream_id = self._open_stream_locked(
                req_headers, end_stream=(len(body) == 0), conn=conn,
            )
            await self._flush_conn(conn)
        if body:
            await self._send_data(stream_id, body, end_stream=True, conn=conn)
        try:
            status_code = await asyncio.wait_for(
                self._await_response_status(stream_id, conn=conn), timeout=30.0,
            )
            if status_code >= 400:
                logger.warning(
                    "/_system/response/%s -> %d", request_id, status_code,
                )
        except asyncio.TimeoutError:
            logger.warning("/_system/response/%s timed out", request_id)
        finally:
            conn.streams.pop(stream_id, None)

    async def _reset_bridge_stream(
        self, stream_id: int, conn: _Connection | None = None,
    ) -> None:
        """RST_STREAM(CANCEL) the named stream. No-op if h2 is gone or
        the stream is already closed. Used on bridge-open failure
        paths so the h2 stream doesn't sit half-open server-side."""
        conn = conn if conn is not None else self._active
        if conn is None:
            return
        async with conn.send_lock:
            if conn.h2 is None:
                return
            with suppress(
                h2.exceptions.StreamClosedError,
                h2.exceptions.NoSuchStreamError,
                h2.exceptions.ProtocolError,
            ):
                conn.h2.reset_stream(
                    stream_id, error_code=h2.errors.ErrorCodes.CANCEL,
                )
                await self._flush_conn(conn)

    async def _end_bridge_stream(
        self, stream_id: int, conn: _Connection | None = None,
    ) -> None:
        """Send an empty DATA with END_STREAM on the named stream so
        the server sees a clean half-close. No-op if the stream has
        already been ended (the pump may have set END_STREAM on the
        upstream-WS-CLOSE path)."""
        conn = conn if conn is not None else self._active
        if conn is None:
            return
        async with conn.send_lock:
            if conn.h2 is None:
                return
            with suppress(
                h2.exceptions.StreamClosedError,
                h2.exceptions.NoSuchStreamError,
                h2.exceptions.ProtocolError,
            ):
                conn.h2.send_data(stream_id, b"", end_stream=True)
                await self._flush_conn(conn)

    async def _send_data(
        self,
        stream_id: int,
        data: bytes,
        *,
        end_stream: bool,
        conn: _Connection | None = None,
    ) -> None:
        conn = conn if conn is not None else self._active
        assert conn is not None and conn.h2 is not None
        offset = 0
        total = len(data)
        while offset < total:
            await self._await_window(stream_id, conn=conn)
            async with conn.send_lock:
                if conn.h2 is None:
                    raise ConnectionError("h2 connection torn down")
                window = min(
                    conn.h2.local_flow_control_window(stream_id),
                    conn.h2.max_outbound_frame_size,
                )
                if window <= 0:
                    self._mark_window_blocked(stream_id, conn=conn)
                    continue
                chunk = data[offset:offset + window]
                end = end_stream and (offset + len(chunk) >= total)
                conn.h2.send_data(stream_id, chunk, end_stream=end)
                offset += len(chunk)
                await self._flush_conn(conn)
        if end_stream and offset == 0:
            async with conn.send_lock:
                if conn.h2 is not None:
                    conn.h2.send_data(stream_id, b"", end_stream=True)
                    await self._flush_conn(conn)

    def _mark_window_blocked(
        self, stream_id: int, conn: _Connection | None = None,
    ) -> None:
        conn = conn if conn is not None else self._active
        if conn is None:
            return
        ev = conn.window_events.setdefault(stream_id, asyncio.Event())
        if (
            conn.h2 is not None
            and conn.h2.local_flow_control_window(stream_id) <= 0
        ):
            ev.clear()
        if (
            conn.h2 is not None
            and conn.h2.outbound_flow_control_window <= 0
        ):
            conn.conn_window_event.clear()

    async def _drain_and_ack_pending(
        self, stream_id: int, conn: _Connection | None = None,
    ) -> None:
        conn = conn if conn is not None else self._active
        if conn is None:
            return
        queue = conn.streams.get(stream_id)
        if queue is None or conn.h2 is None:
            return
        total = 0
        while not queue.empty():
            event = queue.get_nowait()
            if event.kind == "data":
                total += event.flow_controlled_length
        if not total:
            return
        async with conn.send_lock:
            if conn.h2 is None:
                return
            with suppress(
                h2.exceptions.StreamClosedError,
                h2.exceptions.NoSuchStreamError,
                h2.exceptions.ProtocolError,
            ):
                conn.h2.acknowledge_received_data(total, stream_id)
                await self._flush_conn(conn)

    async def _await_window(
        self, stream_id: int, conn: _Connection | None = None,
    ) -> None:
        conn = conn if conn is not None else self._active
        assert conn is not None
        async with conn.send_lock:
            if conn.h2 is None:
                raise ConnectionError("h2 connection torn down")
            stream_window = conn.h2.local_flow_control_window(stream_id)
            conn_window = conn.h2.outbound_flow_control_window
            if stream_window > 0 and conn_window > 0:
                return
        wait_tasks: list[asyncio.Task[Any]] = []
        if stream_window <= 0:
            ev = conn.window_events.setdefault(stream_id, asyncio.Event())
            wait_tasks.append(asyncio.create_task(ev.wait()))
        if conn_window <= 0:
            wait_tasks.append(asyncio.create_task(conn.conn_window_event.wait()))
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


def _parse_goaway_reason(debug: str) -> str | None:
    """Decode the GOAWAY debug data into a structured reason if present.

    The server may attach ``{"reason": "drain"}`` to a NO_ERROR GOAWAY.
    The handoff behaves the same either way today; this is the seam an
    app-level advance-notice would hang off of."""
    if not debug:
        return None
    try:
        parsed = json.loads(debug)
    except (json.JSONDecodeError, ValueError):
        return None
    if isinstance(parsed, dict):
        reason = parsed.get("reason")
        if isinstance(reason, str):
            return reason
    return None


def _first_header(
    headers: list[tuple[str, str]] | tuple[tuple[str, str], ...],
    name: str,
) -> str | None:
    name_l = name.lower()
    for k, v in headers:
        if k.lower() == name_l:
            return v
    return None


async def _safe_close_stream_writer(writer: asyncio.StreamWriter) -> None:
    with suppress(Exception):
        writer.close()
        await writer.wait_closed()
