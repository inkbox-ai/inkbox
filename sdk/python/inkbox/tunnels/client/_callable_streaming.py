"""
inkbox/tunnels/client/_callable_streaming.py

Streaming ASGI HTTP invoker used by ``CallableDispatch`` in passthrough
mode. Unlike the buffered ``invoke_asgi_http`` in ``_asgi.py`` (which is
fine for the edge envelope path that materializes the whole response),
this module drives ASGI with a streaming ``receive`` (yielding inbound
body chunks as they arrive) and a streaming ``send`` (translating
``http.response.body`` events into ``DispatchResponseSink.send_body``
calls so the third party gets a true streamed response).

WebSocket upgrades are handled separately by
``_ws_passthrough.invoke_asgi_websocket`` — the h1 parser and h2
transcoder route ``is_websocket=True`` requests directly to
``CallableDispatch.dispatch_websocket`` so they never reach this
HTTP-only invoker.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from inkbox.tunnels.client._asgi import build_asgi_http_scope
from inkbox.tunnels.client._dispatch import (
    DispatchRequest,
    DispatchResponseHead,
    DispatchResponseSink,
)


logger = logging.getLogger("inkbox.tunnels")


async def invoke_asgi_streaming(
    app: Any,
    request: DispatchRequest,
    response: DispatchResponseSink,
    *,
    public_host: str,
    max_outbound_body_bytes: int,
) -> None:
    """Drive ``app`` (an ASGI HTTP app) against ``request``; stream the
    response back through ``response``."""
    scope = build_asgi_http_scope(
        method=request.method,
        path=request.path,
        headers=request.headers,
        forwarded_for_ip=request.forwarded_for_ip,
        public_host=public_host,
    )

    body_iter = request.body
    body_done = asyncio.Event()
    body_buffer: list[bytes] = []
    fetch_lock = asyncio.Lock()

    async def _next_chunk() -> tuple[bytes, bool]:
        async with fetch_lock:
            if body_buffer:
                return body_buffer.pop(0), False
            if body_done.is_set():
                return b"", True
            try:
                chunk = await body_iter.__anext__()
                return chunk, False
            except StopAsyncIteration:
                body_done.set()
                return b"", True

    async def receive() -> dict[str, Any]:
        chunk, done = await _next_chunk()
        return {
            "type": "http.request",
            "body": chunk,
            "more_body": not done,
        }

    head_sent = False
    bytes_out = 0
    aborted = False

    async def send(event: dict[str, Any]) -> None:
        nonlocal head_sent, bytes_out, aborted
        if aborted:
            return
        etype = event.get("type")
        if etype == "http.response.start":
            status = int(event.get("status", 200))
            raw_headers = event.get("headers", []) or []
            decoded: list[tuple[str, str]] = []
            for k, v in raw_headers:
                kk = (
                    k.decode("latin-1") if isinstance(k, (bytes, bytearray))
                    else str(k)
                )
                vv = (
                    v.decode("latin-1") if isinstance(v, (bytes, bytearray))
                    else str(v)
                )
                decoded.append((kk, vv))
            await response.send_head(
                DispatchResponseHead(status=status, headers=decoded),
            )
            head_sent = True
        elif etype == "http.response.body":
            body = event.get("body", b"") or b""
            if isinstance(body, str):
                body = body.encode("utf-8")
            if not head_sent:
                # ASGI server should always send start before body.
                await response.send_head(
                    DispatchResponseHead(
                        status=200,
                        headers=[("content-type", "application/octet-stream")],
                    ),
                )
                head_sent = True
            bytes_out += len(body)
            if bytes_out > max_outbound_body_bytes:
                aborted = True
                await response.reset("response-too-large")
                return
            if body:
                await response.send_body(body)
            if not event.get("more_body", False):
                await response.end_body()
        # 'http.disconnect' is for handler-side observation; we don't
        # synthesize it from the SDK side in this minimal v1.

    try:
        await app(scope, receive, send)
    except Exception:
        logger.exception("ASGI handler raised")
        if not head_sent:
            try:
                await response.send_head(
                    DispatchResponseHead(
                        status=502,
                        headers=[("content-type", "text/plain")],
                    ),
                )
                await response.send_body(b"upstream error")
                await response.end_body()
            except Exception:
                pass
