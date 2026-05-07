"""
inkbox/tunnels/client/_h1_server.py

In-process HTTP/1.1 server-side parser. Drives a sans-IO h11 connection
to turn plaintext bytes from the third party into ``DispatchRequest``
objects, hands them to a ``Dispatch`` impl, and serializes responses
back to plaintext bytes.

Implements the ``Plaintext`` adapter contract used by the runtime in
passthrough mode after the TLS terminator. Body caps, hop-by-hop header
stripping, and path validation all run inside this layer (or inside the
dispatcher) so h1 inbound has the same guarantees as h2.
"""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from typing import Awaitable, Callable

import h11

from inkbox.tunnels.client._dispatch import (
    Dispatch,
    DispatchRequest,
    DispatchResponseHead,
)
from inkbox.tunnels.client._envelope import HOP_BY_HOP_RESPONSE
from inkbox.tunnels.client._ws_passthrough import (
    ByteChannelWebSocketSink,
    compute_ws_accept,
)


logger = logging.getLogger("inkbox.tunnels")


# Re-exported under the legacy private name so the rest of this module
# keeps working unchanged. Source of truth lives in ``_envelope`` —
# duplicating it here is what let earlier copies drift to "trailers"
# (token, not header) instead of "trailer".
_HOP_BY_HOP_RESPONSE = HOP_BY_HOP_RESPONSE


class _OutboundQueue:
    """Queue of plaintext bytes waiting to be encrypted and sent."""

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
        chunk = self._chunks.popleft()
        return chunk


class InProcH1ParserPlaintext:
    """h11-driven server-side parser exposed as a ``Plaintext`` adapter.

    One instance per third-party TLS session. Requests are dispatched
    serially (no pipelining); h11 enforces this naturally.
    """

    def __init__(
        self,
        *,
        dispatch: Dispatch,
        max_inbound_body_bytes: int,
        forwarded_for_ip: str | None,
        sni_host: str | None,
        public_host: str = "",
    ) -> None:
        self._conn = h11.Connection(our_role=h11.SERVER)
        self._dispatch = dispatch
        self._max_inbound = max_inbound_body_bytes
        self._forwarded_for_ip = forwarded_for_ip
        self._sni_host = sni_host
        self._public_host = public_host
        self._outbound = _OutboundQueue()
        self._serve_task: asyncio.Task[None] | None = None
        self._body_queue: asyncio.Queue[bytes | None] | None = None
        self._inbound_consumed = 0
        self._closed = False
        # WebSocket bridge — set when a WS upgrade routes the parser
        # into raw-bytes mode. h11 stops being driven from this point.
        self._ws_sink: ByteChannelWebSocketSink | None = None

    async def feed(self, plaintext: bytes) -> None:
        if self._closed:
            return
        if self._ws_sink is not None:
            self._ws_sink.feed_inbound(plaintext)
            return
        self._conn.receive_data(plaintext)
        await self._step()

    async def pump_outbound(
        self, send: Callable[[bytes], Awaitable[None]],
    ) -> None:
        """Forward outbound plaintext chunks to ``send`` until close."""
        while True:
            chunk = await self._outbound.drain()
            if chunk is None:
                return
            try:
                await send(chunk)
            except Exception:
                logger.exception("h1 outbound send failed")
                return

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        # Close any in-flight body iterator and stop pump.
        if self._body_queue is not None:
            self._body_queue.put_nowait(None)
        if self._ws_sink is not None:
            self._ws_sink.signal_inbound_eof()
        self._outbound.push(None)
        if self._serve_task is not None and not self._serve_task.done():
            self._serve_task.cancel()
            try:
                await self._serve_task
            except (asyncio.CancelledError, Exception):
                pass

    # --- internal -------------------------------------------------------

    async def _step(self) -> None:
        """Pull events from h11; act on them."""
        while True:
            try:
                event = self._conn.next_event()
            except h11.RemoteProtocolError:
                # Bad request; emit 400 and close.
                self._send_simple_response(400, b"bad request")
                self._closed = True
                self._outbound.push(None)
                return
            if event is h11.NEED_DATA:
                return
            if isinstance(event, h11.Request):
                await self._handle_request(event)
                # Keep iterating in case more events are buffered (Data,
                # EndOfMessage may already be parseable).
                continue
            if isinstance(event, h11.Data):
                if self._body_queue is not None:
                    self._inbound_consumed += len(event.data)
                    if self._inbound_consumed > self._max_inbound:
                        self._send_413_and_close()
                        return
                    self._body_queue.put_nowait(bytes(event.data))
                continue
            if isinstance(event, h11.EndOfMessage):
                if self._body_queue is not None:
                    self._body_queue.put_nowait(None)
                continue
            if isinstance(event, h11.ConnectionClosed):
                self._closed = True
                self._outbound.push(None)
                return
            if event is h11.PAUSED:
                # Server is waiting for response to be sent before
                # accepting next request — fine, we'll resume after.
                return

    async def _handle_request(self, req: h11.Request) -> None:
        method = req.method.decode("ascii", errors="replace")
        target = req.target.decode("latin-1", errors="replace")
        headers: list[tuple[str, str]] = []
        is_websocket = False
        ws_subprotocol: str | None = None
        ws_key: str | None = None
        for k, v in req.headers:
            kl = k.decode("latin-1").lower()
            vs = v.decode("latin-1")
            headers.append((kl, vs))
            if kl == "upgrade" and vs.lower() == "websocket":
                is_websocket = True
            elif kl == "sec-websocket-protocol":
                ws_subprotocol = vs
            elif kl == "sec-websocket-key":
                ws_key = vs

        # WebSocket-upgrade branch — if the dispatcher supports WS,
        # build a byte-channel sink, hand it over, and put the parser
        # into raw-bytes mode so subsequent feed() bytes go straight
        # to the frame decoder.
        if (
            is_websocket
            and ws_key is not None
            and hasattr(self._dispatch, "dispatch_websocket")
        ):
            await self._dispatch_websocket(
                method, target, headers, ws_subprotocol, ws_key,
            )
            return

        body_queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._body_queue = body_queue
        self._inbound_consumed = 0

        async def body_iter():
            while True:
                item = await body_queue.get()
                if item is None:
                    return
                yield item

        request = DispatchRequest(
            method=method,
            path=target,
            headers=headers,
            body=body_iter(),
            forwarded_for_ip=self._forwarded_for_ip,
            sni_host=self._sni_host,
            is_websocket=is_websocket,
            ws_subprotocol=ws_subprotocol,
            transport="h1",
        )
        sink = _H1ResponseSink(self._conn, self._outbound)
        # Run dispatcher in a task so we can keep accepting body data
        # in the meantime.
        async def _drive() -> None:
            try:
                await self._dispatch.dispatch(request, sink)
            except Exception:
                logger.exception("h1 dispatch raised")
                if not sink.head_sent:
                    try:
                        await sink.send_head(
                            DispatchResponseHead(
                                status=502,
                                headers=[("content-type", "text/plain"),
                                         ("content-length", "13")],
                            ),
                        )
                        await sink.send_body(b"upstream error")
                    except Exception:
                        pass
            try:
                await sink.end_body()
            except Exception:
                pass
            # Drain body queue if dispatcher didn't consume it.
            if not body_queue.empty() or self._body_queue is body_queue:
                # Flag end-of-body so any pending iter consumers complete.
                pass
            # h11 may want us to reuse the connection for the next
            # request; tell it the response is done.
            try:
                if self._conn.our_state is h11.DONE:
                    self._conn.start_next_cycle()
            except h11.LocalProtocolError:
                # Cycle restart not possible; close.
                self._closed = True
                self._outbound.push(None)

        self._serve_task = asyncio.get_event_loop().create_task(_drive())

    async def _dispatch_websocket(
        self,
        method: str,
        target: str,
        headers: list[tuple[str, str]],
        ws_subprotocol: str | None,
        ws_key: str,
    ) -> None:
        # Build a byte-channel sink whose ``accept`` writes the 101
        # response into the outbound queue, and whose subsequent frame
        # I/O rides over plaintext bytes from ``feed`` (which switches
        # to raw mode the moment we install the sink).
        accept_value = compute_ws_accept(ws_key)
        outbound = self._outbound

        async def send_plaintext(data: bytes) -> None:
            outbound.push(data)

        def build_accept(
            subprotocol: str | None,
            extra_headers: list[tuple[str, str]] | None,
        ) -> bytes:
            head_lines = [
                b"HTTP/1.1 101 Switching Protocols",
                b"Upgrade: websocket",
                b"Connection: Upgrade",
                b"Sec-WebSocket-Accept: " + accept_value.encode("ascii"),
            ]
            if subprotocol:
                head_lines.append(
                    b"Sec-WebSocket-Protocol: " + subprotocol.encode("ascii"),
                )
            # Application-defined response headers — set-cookie, custom
            # X-* flags, etc. The dispatch caller is expected to have
            # already filtered hop-by-hop / handshake-control headers.
            if extra_headers:
                for hk, hv in extra_headers:
                    head_lines.append(
                        f"{hk}: {hv}".encode("latin-1"),
                    )
            return b"\r\n".join(head_lines) + b"\r\n\r\n"

        def build_reject(status: int) -> bytes:
            body = b"upgrade refused"
            return (
                f"HTTP/1.1 {status} {_status_phrase(status)}\r\n"
                f"Content-Type: text/plain\r\n"
                f"Content-Length: {len(body)}\r\n"
                f"Connection: close\r\n\r\n"
            ).encode("ascii") + body

        async def on_close() -> None:
            self._closed = True
            outbound.push(None)

        ws_sink = ByteChannelWebSocketSink(
            send_plaintext=send_plaintext,
            accept_response_builder=build_accept,
            reject_response_builder=build_reject,
            on_close=on_close,
        )
        # Capture any bytes h11 has already buffered past the request
        # boundary — they belong to the WS frame stream now.
        trailing = self._conn.trailing_data
        if trailing and trailing[0]:
            ws_sink.feed_inbound(trailing[0])
        self._ws_sink = ws_sink

        request = DispatchRequest(
            method=method,
            path=target,
            headers=headers,
            body=_empty_body_iter(),
            forwarded_for_ip=self._forwarded_for_ip,
            sni_host=self._sni_host,
            is_websocket=True,
            ws_subprotocol=ws_subprotocol,
            transport="h1",
        )

        async def _drive() -> None:
            try:
                await self._dispatch.dispatch_websocket(request, ws_sink)
            except Exception:
                logger.exception("h1 ws dispatch raised")
            finally:
                try:
                    await ws_sink.aclose()
                except Exception:
                    pass

        self._serve_task = asyncio.get_event_loop().create_task(_drive())

    def _send_simple_response(self, status: int, body: bytes) -> None:
        head = h11.Response(
            status_code=status,
            headers=[
                (b"content-type", b"text/plain"),
                (b"content-length", str(len(body)).encode("ascii")),
                (b"connection", b"close"),
            ],
        )
        for ev in (head, h11.Data(data=body), h11.EndOfMessage()):
            data = self._conn.send(ev)
            if data:
                self._outbound.push(data)

    def _send_413_and_close(self) -> None:
        self._send_simple_response(413, b"payload too large")
        logger.warning(
            "inkbox-reason=request-too-large transport=h1 cap=%d",
            self._max_inbound,
        )
        # Unblock any dispatcher iterating ``request.body``; without
        # this, an in-flight dispatcher awaiting the next chunk hangs
        # forever — the connection close that ends the upstream side
        # never reaches the body-iter consumer.
        if self._body_queue is not None:
            self._body_queue.put_nowait(None)
        self._closed = True
        self._outbound.push(None)


class _H1ResponseSink:
    """``DispatchResponseSink`` impl that drives an h11 connection."""

    def __init__(
        self, conn: h11.Connection, outbound: _OutboundQueue,
    ) -> None:
        self._conn = conn
        self._outbound = outbound
        self.head_sent = False
        self.body_ended = False

    async def send_head(self, head: DispatchResponseHead) -> None:
        if self.head_sent:
            return
        self.head_sent = True
        # Strip hop-by-hop response headers; let h11 figure
        # transfer-encoding from the rest.
        out_headers: list[tuple[bytes, bytes]] = []
        seen_content_length = False
        for k, v in head.headers:
            kl = k.lower()
            if kl in _HOP_BY_HOP_RESPONSE:
                continue
            if kl == "content-length":
                seen_content_length = True
            out_headers.append((kl.encode("latin-1"), v.encode("latin-1")))
        # If no content-length, send Transfer-Encoding: chunked so we
        # can stream. h11 emits chunked framing for us.
        if not seen_content_length:
            out_headers.append((b"transfer-encoding", b"chunked"))
        out_headers.append((b"connection", b"close"))
        ev = h11.Response(status_code=head.status, headers=out_headers)
        data = self._conn.send(ev)
        if data:
            self._outbound.push(data)

    async def send_body(self, chunk: bytes) -> None:
        if not chunk:
            return
        data = self._conn.send(h11.Data(data=chunk))
        if data:
            self._outbound.push(data)

    async def end_body(self) -> None:
        if self.body_ended:
            return
        self.body_ended = True
        try:
            data = self._conn.send(h11.EndOfMessage())
        except h11.LocalProtocolError:
            return
        if data:
            self._outbound.push(data)

    async def reset(self, reason: str) -> None:
        # h1 has no graceful mid-response reset — close the underlying
        # socket. The runtime layer owns the socket close; we signal
        # by pushing the sentinel.
        logger.warning(
            "inkbox-reason=%s transport=h1 (closing connection mid-response)",
            reason,
        )
        self.body_ended = True
        self._outbound.push(None)


_STATUS_PHRASES: dict[int, str] = {
    400: "Bad Request",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error",
    501: "Not Implemented",
    502: "Bad Gateway",
    503: "Service Unavailable",
}


def _status_phrase(status: int) -> str:
    return _STATUS_PHRASES.get(status, "Error")


async def _empty_body_iter():
    if False:  # pragma: no cover
        yield b""
