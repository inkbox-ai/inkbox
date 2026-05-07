"""
inkbox/tunnels/client/_h2_transcode.py

Server-side HTTP/2 fed by TLS plaintext. Each h2 stream becomes a
``DispatchRequest`` handed to a ``Dispatch`` impl; the dispatcher's
streamed response is encoded back into HEADERS+DATA+END_STREAM frames.

Implements the Plaintext adapter contract used by the runtime in
passthrough mode after the TLS terminator.

WebSocket-over-h2 (RFC 8441 Extended CONNECT) is supported when the
dispatcher exposes ``dispatch_websocket``: the transcoder builds a
byte-channel sink whose inbound DATA frames feed a frame decoder
(unmasked per RFC 8441 §5.1) and whose outbound bytes ride h2 DATA
frames. Dispatchers without that method respond ``:status 501``.
"""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from typing import AsyncIterator, Awaitable, Callable

import h2.config
import h2.connection
import h2.errors
import h2.events
import h2.exceptions
import h2.settings

from inkbox.tunnels.client._dispatch import (
    Dispatch,
    DispatchRequest,
    DispatchResponseHead,
)
from inkbox.tunnels.client._envelope import HOP_BY_HOP_RESPONSE
from inkbox.tunnels.client._ws_passthrough import (
    ByteChannelWebSocketSink,
)


logger = logging.getLogger("inkbox.tunnels")


# Re-export under the legacy private name so callers in this module
# stay unchanged. Source of truth lives in ``_envelope``.
_RESPONSE_HOP_BY_HOP = HOP_BY_HOP_RESPONSE


class _H2StreamCtx:
    """Per-stream state tracked by the transcoder."""

    def __init__(self, stream_id: int) -> None:
        self.stream_id = stream_id
        self.body_queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self.inbound_count = 0
        self.dispatcher_task: asyncio.Task[None] | None = None
        self.head_sent = False
        self.body_ended = False
        self.cancelled = False
        # WS-over-h2 — when the stream is an Extended CONNECT, the
        # parser routes inbound DATA bytes into ``ws_sink`` instead of
        # ``body_queue`` so the WS dispatcher can consume frames.
        self.ws_sink: ByteChannelWebSocketSink | None = None


class _OutboundQueue:
    def __init__(self) -> None:
        self._chunks: deque[bytes | None] = deque()
        self._wakeup = asyncio.Event()

    def push(self, chunk: bytes | None) -> None:
        self._chunks.append(chunk)
        self._wakeup.set()

    async def drain(self) -> bytes | None:
        while not self._chunks:
            self._wakeup.clear()
            await self._wakeup.wait()
        return self._chunks.popleft()


class H2TranscoderPlaintext:
    """h2 server fed by TLS plaintext; routes streams to a Dispatch impl.

    One instance per third-party TLS session.
    """

    def __init__(
        self,
        *,
        dispatch: Dispatch,
        max_inbound_body_bytes: int,
    ) -> None:
        config = h2.config.H2Configuration(
            client_side=False, header_encoding="utf-8",
        )
        self._conn = h2.connection.H2Connection(config=config)
        self._conn.initiate_connection()
        # The initial preface SETTINGS reflects defaults
        # (server-side ENABLE_PUSH=0 already, MAX_CONCURRENT_STREAMS
        # bounded by hyper-h2's 100). We send a follow-up SETTINGS
        # frame to advertise ENABLE_CONNECT_PROTOCOL=1 (RFC 8441), and
        # to make ENABLE_PUSH=0 / MAX_CONCURRENT_STREAMS=100 explicit
        # on the wire even when they happen to equal the defaults.
        self._conn.update_settings({
            h2.settings.SettingCodes.ENABLE_PUSH: 0,
            h2.settings.SettingCodes.MAX_CONCURRENT_STREAMS: 100,
            h2.settings.SettingCodes.ENABLE_CONNECT_PROTOCOL: 1,
        })

        self._dispatch = dispatch
        self._max_inbound = max_inbound_body_bytes
        self._outbound = _OutboundQueue()
        self._streams: dict[int, _H2StreamCtx] = {}
        self._send_lock = asyncio.Lock()
        self._closed = False
        # Push the initial server preface bytes.
        self._flush_outbound()

    # --- Plaintext adapter contract -------------------------------------

    async def feed(self, plaintext: bytes) -> None:
        if self._closed:
            return
        try:
            events = self._conn.receive_data(plaintext)
        except h2.exceptions.ProtocolError:
            logger.exception("h2 protocol error from third party")
            self._closed = True
            self._outbound.push(None)
            return
        for event in events:
            await self._handle_event(event)
        self._flush_outbound()

    async def pump_outbound(
        self, send: Callable[[bytes], Awaitable[None]],
    ) -> None:
        while True:
            chunk = await self._outbound.drain()
            if chunk is None:
                return
            try:
                await send(chunk)
            except Exception:
                logger.exception("h2 outbound send failed")
                return

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        # GOAWAY then drain.
        try:
            self._conn.close_connection(
                error_code=h2.errors.ErrorCodes.NO_ERROR,
            )
            self._flush_outbound()
        except h2.exceptions.ProtocolError:
            pass
        for ctx in list(self._streams.values()):
            ctx.body_queue.put_nowait(None)
            if ctx.dispatcher_task is not None and not ctx.dispatcher_task.done():
                ctx.dispatcher_task.cancel()
        self._outbound.push(None)

    # --- internal -------------------------------------------------------

    def _flush_outbound(self) -> None:
        data = self._conn.data_to_send()
        if data:
            self._outbound.push(data)

    async def _handle_event(self, event: h2.events.Event) -> None:
        if isinstance(event, h2.events.RequestReceived):
            await self._on_request(event)
        elif isinstance(event, h2.events.DataReceived):
            await self._on_data(event)
        elif isinstance(event, h2.events.StreamEnded):
            await self._on_stream_ended(event)
        elif isinstance(event, h2.events.StreamReset):
            await self._on_stream_reset(event)
        elif isinstance(event, h2.events.WindowUpdated):
            pass  # h2 lib accounts internally
        elif isinstance(event, h2.events.ConnectionTerminated):
            self._closed = True
            self._outbound.push(None)

    async def _on_request(self, event: h2.events.RequestReceived) -> None:
        sid = event.stream_id
        if sid is None:
            return
        ctx = _H2StreamCtx(stream_id=sid)
        self._streams[sid] = ctx

        method = ":method"
        path = ":path"
        scheme = ":scheme"
        protocol = ":protocol"
        method_v = ""
        path_v = "/"
        is_websocket = False
        ws_subprotocol: str | None = None
        out_headers: list[tuple[str, str]] = []
        for k, v in (event.headers or []):
            kl = k if isinstance(k, str) else k.decode("utf-8", errors="replace")
            vs = v if isinstance(v, str) else v.decode("utf-8", errors="replace")
            kl = kl.lower()
            if kl == method:
                method_v = vs
            elif kl == path:
                path_v = vs
            elif kl == scheme:
                pass
            elif kl == protocol:
                if vs.lower() == "websocket":
                    is_websocket = True
            elif kl == "sec-websocket-protocol":
                ws_subprotocol = vs
            out_headers.append((kl, vs))

        # WebSocket-over-h2 — if the dispatcher exposes
        # ``dispatch_websocket`` AND we're an Extended CONNECT, build a
        # byte-channel WS sink whose inbound bytes come from this
        # stream's DATA frames (unmasked per RFC 8441 §5.1) and whose
        # outbound bytes are emitted as DATA frames.
        if is_websocket:
            if hasattr(self._dispatch, "dispatch_websocket"):
                await self._dispatch_websocket_h2(
                    ctx, method_v, path_v, out_headers, ws_subprotocol,
                )
                return
            await self._send_error_response(
                ctx, status=501, reason="websocket-over-h2-not-implemented",
            )
            return

        async def body_iter() -> AsyncIterator[bytes]:
            while True:
                item = await ctx.body_queue.get()
                if item is None:
                    return
                yield item

        request = DispatchRequest(
            method=method_v,
            path=path_v,
            headers=out_headers,
            body=body_iter(),
            forwarded_for_ip=None,  # supplied by caller if known
            sni_host=None,
            is_websocket=False,
            ws_subprotocol=ws_subprotocol,
            transport="h2",
        )
        sink = _H2ResponseSink(self, ctx)

        async def _drive() -> None:
            try:
                await self._dispatch.dispatch(request, sink)
            except Exception:
                logger.exception("h2 dispatch raised")
                if not sink.head_sent:
                    try:
                        await sink.send_head(
                            DispatchResponseHead(
                                status=502,
                                headers=[("content-type", "text/plain")],
                            ),
                        )
                        await sink.send_body(b"upstream error")
                    except Exception:
                        pass
            try:
                await sink.end_body()
            except Exception:
                pass

        ctx.dispatcher_task = asyncio.get_event_loop().create_task(_drive())

    async def _on_data(self, event: h2.events.DataReceived) -> None:
        sid = event.stream_id
        ctx = self._streams.get(sid)
        if ctx is None or ctx.cancelled:
            return
        chunk = event.data or b""
        # WS-over-h2 — inbound bytes belong to the WS frame stream.
        if ctx.ws_sink is not None:
            if chunk:
                ctx.ws_sink.feed_inbound(bytes(chunk))
            try:
                self._conn.acknowledge_received_data(
                    event.flow_controlled_length, sid,
                )
            except h2.exceptions.StreamClosedError:
                pass
            self._flush_outbound()
            return
        ctx.inbound_count += len(chunk)
        if ctx.inbound_count > self._max_inbound:
            ctx.cancelled = True
            ctx.body_queue.put_nowait(None)
            try:
                self._conn.reset_stream(
                    sid, error_code=h2.errors.ErrorCodes.REFUSED_STREAM,
                )
            except h2.exceptions.StreamClosedError:
                pass
            self._flush_outbound()
            logger.warning(
                "inkbox-reason=request-too-large transport=h2 stream_id=%d cap=%d",
                sid, self._max_inbound,
            )
            return
        if chunk:
            ctx.body_queue.put_nowait(bytes(chunk))
        # Acknowledge the bytes back into the connection-level window so
        # peers don't stall.
        try:
            self._conn.acknowledge_received_data(
                event.flow_controlled_length, sid,
            )
        except h2.exceptions.StreamClosedError:
            pass
        self._flush_outbound()

    async def _on_stream_ended(self, event: h2.events.StreamEnded) -> None:
        ctx = self._streams.get(event.stream_id)
        if ctx is None:
            return
        if ctx.ws_sink is not None:
            ctx.ws_sink.signal_inbound_eof()
            return
        ctx.body_queue.put_nowait(None)

    async def _on_stream_reset(self, event: h2.events.StreamReset) -> None:
        ctx = self._streams.get(event.stream_id)
        if ctx is None:
            return
        ctx.cancelled = True
        if ctx.ws_sink is not None:
            ctx.ws_sink.signal_inbound_eof()
        ctx.body_queue.put_nowait(None)
        if ctx.dispatcher_task is not None:
            ctx.dispatcher_task.cancel()

    async def _dispatch_websocket_h2(
        self,
        ctx: _H2StreamCtx,
        method: str,
        path: str,
        headers: list[tuple[str, str]],
        ws_subprotocol: str | None,
    ) -> None:
        # ``send_plaintext`` writes raw frame bytes back as h2 DATA on
        # this stream. The transcoder's send-lock is held inside.
        async def send_plaintext(data: bytes) -> None:
            if not data:
                return
            offset = 0
            while offset < len(data):
                async with self._send_lock:
                    try:
                        window = self._conn.local_flow_control_window(
                            ctx.stream_id,
                        )
                    except h2.exceptions.StreamClosedError:
                        ctx.cancelled = True
                        return
                    max_frame = self._conn.max_outbound_frame_size
                    send_size = min(window, max_frame, len(data) - offset)
                    if send_size > 0:
                        try:
                            self._conn.send_data(
                                ctx.stream_id,
                                data[offset:offset + send_size],
                            )
                            self._flush_outbound()
                            offset += send_size
                        except h2.exceptions.StreamClosedError:
                            ctx.cancelled = True
                            return
                if send_size <= 0:
                    await asyncio.sleep(0.005)

        # `accept` builder emits the :status 200 HEADERS frame (RFC 8441
        # §4 — the h2 response to a successful Extended CONNECT is 2xx).
        # `reject` builder emits a :status 4xx with END_STREAM.
        accept_invoked = {"value": False}

        def build_accept(
            subprotocol: str | None,
            extra_headers: list[tuple[str, str]] | None,
        ) -> bytes:
            # We can't easily pre-build the bytes for the h2 HEADERS
            # frame without going through hyper-h2; run the call inline.
            accept_invoked["value"] = True
            out_headers: list[tuple[str, str]] = [(":status", "200")]
            if subprotocol:
                out_headers.append(("sec-websocket-protocol", subprotocol))
            # Application-defined response headers — set-cookie, custom
            # X-* flags, etc. The dispatch caller is expected to have
            # already filtered hop-by-hop / handshake-control headers.
            if extra_headers:
                for hk, hv in extra_headers:
                    out_headers.append((hk.lower(), hv))
            try:
                self._conn.send_headers(ctx.stream_id, out_headers)
                self._flush_outbound()
            except h2.exceptions.StreamClosedError:
                ctx.cancelled = True
            # No bytes for ``send_plaintext`` to write — the HEADERS
            # frame is already in the outbound queue. Return empty so
            # the sink's accept doesn't double-write.
            return b""

        def build_reject(status: int) -> bytes:
            try:
                self._conn.send_headers(
                    ctx.stream_id,
                    [
                        (":status", str(status)),
                        ("inkbox-reason", "websocket-rejected"),
                    ],
                    end_stream=True,
                )
                self._flush_outbound()
            except h2.exceptions.StreamClosedError:
                ctx.cancelled = True
            return b""

        async def on_close() -> None:
            if ctx.cancelled:
                return
            ctx.cancelled = True
            async with self._send_lock:
                try:
                    self._conn.end_stream(ctx.stream_id)
                    self._flush_outbound()
                except h2.exceptions.StreamClosedError:
                    pass

        ws_sink = ByteChannelWebSocketSink(
            send_plaintext=send_plaintext,
            accept_response_builder=build_accept,
            reject_response_builder=build_reject,
            on_close=on_close,
            require_client_mask=False,  # RFC 8441 §5.1 — h2 WS unmasked
        )
        ctx.ws_sink = ws_sink

        request = DispatchRequest(
            method=method,
            path=path,
            headers=headers,
            body=_empty_body_iter(),
            forwarded_for_ip=None,
            sni_host=None,
            is_websocket=True,
            ws_subprotocol=ws_subprotocol,
            transport="h2",
        )

        async def _drive() -> None:
            try:
                await self._dispatch.dispatch_websocket(  # type: ignore[attr-defined]
                    request, ws_sink,
                )
            except Exception:
                logger.exception("h2 ws dispatch raised")
                if not accept_invoked["value"]:
                    try:
                        await ws_sink.reject(status=500)
                    except Exception:
                        pass
            finally:
                try:
                    await ws_sink.aclose()
                except Exception:
                    pass

        ctx.dispatcher_task = asyncio.get_event_loop().create_task(_drive())

    async def _send_error_response(
        self, ctx: _H2StreamCtx, *, status: int, reason: str,
    ) -> None:
        async with self._send_lock:
            try:
                self._conn.send_headers(
                    ctx.stream_id,
                    [
                        (":status", str(status)),
                        ("content-type", "text/plain"),
                        ("inkbox-reason", reason),
                    ],
                    end_stream=True,
                )
                self._flush_outbound()
            except h2.exceptions.StreamClosedError:
                pass


class _H2ResponseSink:
    """``DispatchResponseSink`` impl that emits h2 frames."""

    def __init__(self, transcoder: H2TranscoderPlaintext, ctx: _H2StreamCtx) -> None:
        self._t = transcoder
        self._ctx = ctx
        self.head_sent = False
        self.body_ended = False

    async def send_head(self, head: DispatchResponseHead) -> None:
        if self.head_sent or self._ctx.cancelled:
            return
        self.head_sent = True
        out: list[tuple[str, str]] = [(":status", str(head.status))]
        for k, v in head.headers:
            kl = k.lower()
            if kl in _RESPONSE_HOP_BY_HOP:
                continue
            if kl.startswith(":"):
                continue
            out.append((kl, v))
        async with self._t._send_lock:
            try:
                self._t._conn.send_headers(self._ctx.stream_id, out)
                self._t._flush_outbound()
            except h2.exceptions.StreamClosedError:
                self._ctx.cancelled = True

    async def send_body(self, chunk: bytes) -> None:
        if self.body_ended or self._ctx.cancelled or not chunk:
            return
        # Respect h2 flow control by chunking on the per-stream window.
        offset = 0
        while offset < len(chunk):
            async with self._t._send_lock:
                try:
                    window = self._t._conn.local_flow_control_window(
                        self._ctx.stream_id,
                    )
                except h2.exceptions.StreamClosedError:
                    self._ctx.cancelled = True
                    return
                max_frame = self._t._conn.max_outbound_frame_size
                send_size = min(window, max_frame, len(chunk) - offset)
                if send_size <= 0:
                    # Window closed; await an outbound flush and retry.
                    pass
                else:
                    try:
                        self._t._conn.send_data(
                            self._ctx.stream_id,
                            chunk[offset:offset + send_size],
                        )
                        self._t._flush_outbound()
                        offset += send_size
                    except h2.exceptions.StreamClosedError:
                        self._ctx.cancelled = True
                        return
            if send_size <= 0:
                # Yield so peer WINDOW_UPDATE can land.
                await asyncio.sleep(0.01)

    async def end_body(self) -> None:
        if self.body_ended:
            return
        self.body_ended = True
        if self._ctx.cancelled:
            return
        async with self._t._send_lock:
            try:
                self._t._conn.end_stream(self._ctx.stream_id)
                self._t._flush_outbound()
            except h2.exceptions.StreamClosedError:
                pass

    async def reset(self, reason: str) -> None:
        if self._ctx.cancelled:
            return
        self._ctx.cancelled = True
        self.body_ended = True
        async with self._t._send_lock:
            try:
                self._t._conn.reset_stream(
                    self._ctx.stream_id,
                    error_code=h2.errors.ErrorCodes.INTERNAL_ERROR,
                )
                self._t._flush_outbound()
            except h2.exceptions.StreamClosedError:
                pass
        logger.warning(
            "inkbox-reason=%s transport=h2 stream_id=%d",
            reason, self._ctx.stream_id,
        )


async def _empty_body_iter() -> AsyncIterator[bytes]:
    if False:  # pragma: no cover
        yield b""
