"""
inkbox/tunnels/client/_dispatch.py

The Dispatch interface — both the in-process h1 parser and the h2
transcoder hand parsed requests to a Dispatch impl. The interface is
transport-neutral; the same impl serves an h1 inbound and an h2 inbound.

UpstreamUrlDispatch forwards requests to a customer-supplied URL via
httpx (one connection pool per dispatcher). CallableDispatch invokes an
in-process ASGI callable; ``dispatch_websocket`` on either impl routes
WebSocket upgrades (h1 ``Upgrade: websocket`` or h2 Extended CONNECT)
without going through an HTTP response sink.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from contextlib import suppress
from dataclasses import dataclass
from typing import (
    AsyncIterable,
    AsyncIterator,
    Protocol,
)
from urllib.parse import urlsplit

import httpx

from inkbox.tunnels.client._envelope import HOP_BY_HOP_REQUEST
from inkbox.tunnels.client._upstream_tls import build_upstream_tls_context
from inkbox.tunnels.client._url_forward import (
    join_forward_path,
    validate_envelope_path,
)


logger = logging.getLogger("inkbox.tunnels")


@dataclass
class DispatchRequest:
    """Wire-shaped request handed to a Dispatch impl.

    Both transports (h1 parser, h2 transcoder) populate the same shape:
    method, path, headers, and an async-iterable body. The dispatcher
    consumes the body lazily and may abort it on cap or peer-reset.
    """

    method: str
    path: str
    # Headers as a list to preserve order and allow duplicates. Names
    # are lower-case, latin-1.
    headers: list[tuple[str, str]]
    # Streaming body. Yielding empty signals end-of-body.
    body: AsyncIterable[bytes]
    # Forwarded-for IP from the third-party connection, if known.
    forwarded_for_ip: str | None = None
    # SNI host as observed at the public ingress, if available.
    sni_host: str | None = None
    # Set when the inbound is a WebSocket upgrade (h1 Upgrade: websocket
    # or h2 Extended CONNECT). The dispatcher may surface a separate
    # WebSocket entry-point in that case.
    is_websocket: bool = False
    # WebSocket subprotocol (Sec-WebSocket-Protocol) if advertised.
    ws_subprotocol: str | None = None
    # Inbound transport: "h1" or "h2". Populated by the parser /
    # transcoder so dispatchers can emit structured telemetry with the
    # full ``dispatch=url-h1|url-h2|callable-h1|callable-h2`` field.
    transport: str = "h1"


@dataclass
class DispatchResponseHead:
    """Initial response surface — status + headers, no body yet."""

    status: int
    headers: list[tuple[str, str]]


class DispatchResponseSink(Protocol):
    """Streamed response sink the Dispatch impl writes to.

    The transport implements this so the dispatcher can call
    ``send_head`` followed by ``send_body`` chunks and ``end_body``.
    The transport translates these into wire frames (h1 chunked or
    Content-Length + body bytes; h2 HEADERS+DATA+END_STREAM).
    """

    async def send_head(self, head: DispatchResponseHead) -> None: ...
    async def send_body(self, chunk: bytes) -> None: ...
    async def end_body(self) -> None: ...
    async def reset(self, reason: str) -> None: ...


class Dispatch(Protocol):
    """Stateless-per-call dispatcher invoked by the parser/transcoder.

    Implementations are expected to be reentrant (h2 invokes them
    concurrently across streams).
    """

    async def dispatch(
        self, request: DispatchRequest, response: DispatchResponseSink,
    ) -> None: ...

    async def aclose(self) -> None:
        """Release any pooled resources (h1 client connection pool)."""
        ...


# --- UpstreamUrlDispatch -----------------------------------------------------


class UpstreamUrlDispatch:
    """Forward requests to a customer-supplied URL via httpx.

    One ``httpx.AsyncClient`` per dispatcher. Pool sizing matches what
    edge URL forwarding uses (sane defaults, configurable).
    """

    def __init__(
        self,
        *,
        forward_to: str,
        public_host: str,
        max_outbound_body_bytes: int,
        max_inbound_body_bytes: int,
        verify: bool | str | object = True,
        ca_bundle: bytes | str | None = None,
    ) -> None:
        self._forward_to = forward_to
        self._public_host = public_host
        self._max_outbound = max_outbound_body_bytes
        self._max_inbound = max_inbound_body_bytes
        self._verify = verify
        self._ca_bundle = ca_bundle
        if isinstance(verify, bool):
            verify_arg: bool | str | object = build_upstream_tls_context(
                verify=verify, ca_bundle=ca_bundle,
            )
        else:
            verify_arg = verify
        # Use HTTP/1.1 to upstream — we transcode anyway.
        self._client = httpx.AsyncClient(
            verify=verify_arg,
            http2=False,
            limits=httpx.Limits(
                max_connections=64, max_keepalive_connections=16,
            ),
            timeout=httpx.Timeout(60.0, connect=10.0),
        )

    async def aclose(self) -> None:
        with suppress(Exception):
            await self._client.aclose()

    async def dispatch(
        self, request: DispatchRequest, response: DispatchResponseSink,
    ) -> None:
        # Path validation — same rule as edge URL forwarding.
        reason = validate_envelope_path(request.path)
        if reason is not None:
            await _send_simple(response, 400, b"invalid path")
            return

        target_url = join_forward_path(self._forward_to, request.path)
        parsed = urlsplit(self._forward_to)
        target_host = parsed.netloc

        out_headers: list[tuple[str, str]] = []
        out_headers.append(("host", target_host))
        out_headers.append(("x-forwarded-host", self._public_host))
        out_headers.append(("x-forwarded-proto", "https"))
        if request.forwarded_for_ip:
            out_headers.append(("x-forwarded-for", request.forwarded_for_ip))
            out_headers.append(("forwarded", f"for={request.forwarded_for_ip}"))
        seen = {
            "host", "x-forwarded-host", "x-forwarded-proto",
            "x-forwarded-for", "forwarded",
        }
        for k, v in request.headers:
            kl = k.lower()
            # Drop pseudo-headers; drop hop-by-hop; drop forwarded-* (we
            # set them ourselves so the upstream sees a single
            # consistent forwarded-headers view).
            if kl.startswith(":"):
                continue
            if kl in HOP_BY_HOP_REQUEST:
                continue
            if kl in seen:
                continue
            out_headers.append((k, v))

        # Stream the request body into httpx. We don't materialize the
        # body — the parser/transcoder enforces its own inbound cap.
        bytes_out = 0
        status: int | None = None
        try:
            async with self._client.stream(
                method=request.method,
                url=target_url,
                headers=out_headers,
                content=_async_bytes_iter(request.body),
            ) as resp:
                status = resp.status_code
                await response.send_head(
                    DispatchResponseHead(
                        status=resp.status_code,
                        headers=list(resp.headers.items()),
                    ),
                )
                async for chunk in resp.aiter_bytes():
                    bytes_out += len(chunk)
                    if bytes_out > self._max_outbound:
                        # We've already committed status+headers; can't
                        # retroactively switch to 502. Reset the stream.
                        await response.reset("response-too-large")
                        logger.info(
                            "dispatch=url-%s status=%s method=%s path=%s "
                            "bytes_out=%d outcome=reset reason=response-too-large",
                            request.transport, status, request.method,
                            request.path, bytes_out,
                        )
                        return
                    await response.send_body(chunk)
                await response.end_body()
                logger.info(
                    "dispatch=url-%s status=%s method=%s path=%s "
                    "bytes_out=%d outcome=ok",
                    request.transport, status, request.method,
                    request.path, bytes_out,
                )
        except httpx.HTTPError:
            logger.warning(
                "dispatch=url-%s status=502 method=%s path=%s "
                "outcome=upstream-error",
                request.transport, request.method, request.path,
            )
            with suppress(Exception):
                await _send_simple(response, 502, b"upstream error")

    async def dispatch_websocket(
        self,
        request: DispatchRequest,
        ws: object,  # WebSocketSink
    ) -> None:
        """Bridge a WS upgrade through an h1 ``Upgrade: websocket`` to
        the upstream URL.

        Flow: open the upstream WS hop, accept on the inbound sink,
        then bridge frames. Inbound third-party frames are re-masked
        for the upstream (RFC 6455 §5.1 client-side); upstream server
        frames are decoded (unmasked) and forwarded back via the sink.
        """
        from inkbox.tunnels.client._ws_passthrough import (
            decode_client_frame,
        )
        from inkbox.tunnels.client._ws_upstream import (
            WsUpstreamError,
            open_ws_upstream,
        )
        from inkbox.tunnels.client._wsframe import (
            WS_OPCODE_CLOSE,
            encode_ws_frame,
        )

        reason = validate_envelope_path(request.path)
        if reason is not None:
            with suppress(Exception):
                await ws.reject(status=400)  # type: ignore[attr-defined]
            return

        try:
            up = await open_ws_upstream(
                forward_to=self._forward_to,
                request_path=request.path,
                request_headers=request.headers,
                ws_subprotocol=request.ws_subprotocol,
                forwarded_for_ip=request.forwarded_for_ip,
                public_host=self._public_host,
                verify=bool(self._verify),
                ca_bundle=self._ca_bundle,
            )
        except WsUpstreamError as e:
            with suppress(Exception):
                await ws.reject(status=e.status)  # type: ignore[attr-defined]
            return
        reader, writer = up.reader, up.writer
        leftover = up.leftover

        # Accept on the inbound sink so the third party gets its
        # protocol-appropriate handshake response. Forward the
        # upstream's application-defined 101 response headers
        # (Set-Cookie, X-Use-Inkbox-* opt-outs, custom correlation
        # IDs) so customers' WS upgrade response surface round-trips.
        # Strip:
        #   * hop-by-hop (HOP_BY_HOP_RESPONSE)
        #   * ws handshake-control headers — these are per-hop;
        #     sec-websocket-accept is computed by the inbound sink,
        #     sec-websocket-protocol rides the dedicated subprotocol
        #     arg (don't double-emit), key/version are request-only,
        #     extensions is already gated upstream.
        #   * h2 pseudo-headers (defensive).
        from inkbox.tunnels.client._envelope import HOP_BY_HOP_RESPONSE
        ws_handshake_strip = {
            "sec-websocket-accept",
            "sec-websocket-extensions",
            "sec-websocket-key",
            "sec-websocket-version",
            "sec-websocket-protocol",
        }
        forwarded_headers: list[tuple[str, str]] = []
        for hk, hv in up.headers:
            if hk.startswith(":"):
                continue
            if hk in HOP_BY_HOP_RESPONSE:
                continue
            if hk in ws_handshake_strip:
                continue
            forwarded_headers.append((hk, hv))
        try:
            await ws.accept(  # type: ignore[attr-defined]
                subprotocol=up.subprotocol,
                headers=forwarded_headers if forwarded_headers else None,
            )
        except Exception:
            await _safe_close_writer(writer)
            return

        # Bridge frames in both directions until either side closes.
        upstream_buf = bytearray(leftover)
        upstream_closed = asyncio.Event()
        third_party_closed = asyncio.Event()

        async def upstream_to_third_party() -> None:
            try:
                while not third_party_closed.is_set():
                    decoded = decode_client_frame(
                        upstream_buf, require_mask=False,
                    )
                    if decoded is None:
                        chunk = await reader.read(4096)
                        if not chunk:
                            return
                        upstream_buf.extend(chunk)
                        continue
                    opcode, payload, fin = decoded
                    try:
                        await ws.send_frame(  # type: ignore[attr-defined]
                            opcode, payload, fin=fin,
                        )
                    except Exception:
                        return
                    if opcode == WS_OPCODE_CLOSE:
                        return
            finally:
                upstream_closed.set()

        async def third_party_to_upstream() -> None:
            try:
                while not upstream_closed.is_set():
                    got = await ws.recv_frame()  # type: ignore[attr-defined]
                    if got is None:
                        return
                    opcode, payload, fin = got
                    # Re-encode for upstream (we are the client → must mask).
                    # Preserve fin so multi-frame messages stay fragmented
                    # and the upstream can stream them.
                    frame = encode_ws_frame(opcode, payload, mask=True, fin=fin)
                    try:
                        writer.write(frame)
                        await writer.drain()
                    except (OSError, ConnectionError):
                        return
                    if opcode == WS_OPCODE_CLOSE:
                        return
            finally:
                third_party_closed.set()

        u2t = asyncio.create_task(upstream_to_third_party())
        t2u = asyncio.create_task(third_party_to_upstream())
        try:
            await asyncio.wait(
                {u2t, t2u}, return_when=asyncio.FIRST_COMPLETED,
            )
        finally:
            for t in (u2t, t2u):
                if not t.done():
                    t.cancel()
                    try:
                        await t
                    except (asyncio.CancelledError, Exception):
                        pass
            await _safe_close_writer(writer)
            with suppress(Exception):
                await ws.aclose()  # type: ignore[attr-defined]


async def _async_bytes_iter(
    body: AsyncIterable[bytes],
) -> AsyncIterator[bytes]:
    async for chunk in body:
        if chunk:
            yield chunk


def base64_b64encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


async def _safe_close_writer(writer: asyncio.StreamWriter) -> None:
    with suppress(Exception):
        writer.close()
        await writer.wait_closed()


async def _send_simple(
    response: DispatchResponseSink, status: int, body: bytes,
) -> None:
    await response.send_head(
        DispatchResponseHead(
            status=status,
            headers=[("content-type", "text/plain"),
                     ("content-length", str(len(body)))],
        ),
    )
    if body:
        await response.send_body(body)
    await response.end_body()


# --- CallableDispatch -------------------------------------------------------


class CallableDispatch:
    """Dispatch impl that invokes an in-process ASGI callable.

    Used by passthrough mode when ``forward_to`` is a callable rather
    than a URL. The h1 parser and h2 transcoder both produce wire-shaped
    requests that this dispatcher hands to the user's ASGI app via the
    streaming invoker in ``_callable_streaming.py``.

    HTTP requests go through ``dispatch``; WebSocket upgrades route to
    ``dispatch_websocket`` which drives the ASGI websocket scope via
    ``_ws_passthrough.invoke_asgi_websocket``. Transports that don't
    yet recognize the WS entry-point fall back to the HTTP path, which
    returns a structured 501 in that case.
    """

    def __init__(
        self,
        *,
        app: object,
        public_host: str,
        max_outbound_body_bytes: int,
    ) -> None:
        self._app = app
        self._public_host = public_host
        self._max_outbound = max_outbound_body_bytes

    async def aclose(self) -> None:
        # Nothing to close — the callable doesn't own resources we
        # provisioned.
        pass

    async def dispatch(
        self, request: DispatchRequest, response: DispatchResponseSink,
    ) -> None:
        if request.is_websocket:
            # Transports that recognize ``dispatch_websocket`` route WS
            # upgrades there directly. If we get here, the transport
            # didn't (older path or h2 stub) — refuse gracefully.
            await _send_simple(
                response,
                501,
                b"websocket dispatch routed to http path",
            )
            return
        # Path validation — same rule as URL dispatch.
        reason = validate_envelope_path(request.path)
        if reason is not None:
            await _send_simple(response, 400, b"invalid path")
            return
        from inkbox.tunnels.client._callable_streaming import (
            invoke_asgi_streaming,
        )
        try:
            await invoke_asgi_streaming(
                self._app,
                request,
                response,
                public_host=self._public_host,
                max_outbound_body_bytes=self._max_outbound,
            )
            logger.info(
                "dispatch=callable-%s method=%s path=%s outcome=ok",
                request.transport, request.method, request.path,
            )
        except Exception:
            logger.warning(
                "dispatch=callable-%s method=%s path=%s outcome=handler-error",
                request.transport, request.method, request.path,
            )
            raise

    async def dispatch_websocket(
        self,
        request: DispatchRequest,
        ws: object,  # WebSocketSink — typed via _ws_passthrough
    ) -> None:
        """Bridge a WS upgrade into an ASGI ``websocket``-scope app.

        The transport (h1 parser, h2 transcoder) builds a sink whose
        ``accept`` writes the protocol-appropriate handshake response
        and whose ``send_frame`` / ``recv_frame`` pump RFC 6455 frames.
        """
        reason = validate_envelope_path(request.path)
        if reason is not None:
            try:
                await ws.reject(status=400)  # type: ignore[attr-defined]
            except Exception:
                pass
            return
        from inkbox.tunnels.client._ws_passthrough import (
            invoke_asgi_websocket,
        )
        await invoke_asgi_websocket(
            self._app,
            request,
            ws,  # type: ignore[arg-type]
            public_host=self._public_host,
        )
