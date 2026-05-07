"""
inkbox/tunnels/client/_asgi.py

In-process HTTP invocation for ``forward_to`` callables that match the
``async def app(scope, receive, send)`` calling convention. Builds a
scope whose forwarded-header view matches the URL-forward path so the
user's app sees a consistent request shape regardless of how
``forward_to`` is wired.

Scope details:

- ``scope["client"]`` carries the third-party IP from the envelope's
  ``inkbox-forwarded-for`` header (or ``"unknown"`` if absent).
- ``scope["server"]`` is ``(public_host, 443)``.
- ``scope["scheme"] == "https"``.
- The ``Host`` header is explicitly injected. URL-generating helpers
  (e.g. Starlette's ``request.url_for``, ``request.base_url``) read
  ``Host`` rather than ``scope["server"]``, so an explicit ``Host``
  ensures generated URLs use the public host.
"""

from __future__ import annotations

import asyncio
from typing import Any

from inkbox.tunnels.client._envelope import HOP_BY_HOP_REQUEST, Envelope


class AsgiResponseTooLarge(Exception):
    """Raised when the ASGI app's accumulated response exceeds the cap."""


def build_asgi_http_scope(
    *,
    method: str,
    path: str,
    headers: list[tuple[str, str]],
    forwarded_for_ip: str | None,
    public_host: str,
    encoding: str = "latin-1",
) -> dict[str, Any]:
    """Build an ASGI HTTP scope dict from wire-shaped fields.

    Used by both the buffered envelope path (``invoke_asgi_http``) and
    the streaming passthrough path (``_callable_streaming``) so the app
    sees the same shape regardless of how ``forward_to`` is wired.
    """
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
    seen = {
        b"host", b"x-forwarded-host", b"x-forwarded-proto",
        b"x-forwarded-for", b"forwarded",
    }
    for k, v in headers:
        kl = k.lower()
        if kl.startswith(":"):
            continue
        if kl in HOP_BY_HOP_REQUEST:
            continue
        kb = kl.encode("latin-1")
        if kb in seen:
            continue
        asgi_headers.append((kb, v.encode("latin-1")))

    client_host = forwarded_for_ip or "unknown"
    return {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method.upper(),
        "scheme": "https",
        "path": raw_path,
        "raw_path": raw_path.encode(encoding),
        "query_string": query_string.encode(encoding),
        "root_path": "",
        "headers": asgi_headers,
        "client": (client_host, 0),
        "server": (public_host, 443),
    }


async def invoke_asgi_http(
    *,
    app: Any,
    envelope: Envelope,
    public_host: str,
    max_response_bytes: int,
    disconnect_event: asyncio.Event | None = None,
) -> tuple[int, list[tuple[str, str]], bytes]:
    """Run an ASGI HTTP app against an envelope; return ``(status, headers, body)``.

    Per-chunk size cap: if the accumulated response body exceeds
    ``max_response_bytes`` mid-stream, this raises
    :class:`AsgiResponseTooLarge` instead of buffering the rest. The
    runtime catches that and posts a 502 to the third party.
    """
    scope = build_asgi_http_scope(
        method=envelope.method,
        path=envelope.path,
        headers=list(envelope.forwarded_headers),
        forwarded_for_ip=envelope.forwarded_for_ip,
        public_host=public_host,
        encoding="utf-8",
    )

    body_sent = False
    disc = disconnect_event if disconnect_event is not None else asyncio.Event()

    async def receive() -> dict[str, Any]:
        nonlocal body_sent
        if not body_sent:
            body_sent = True
            return {
                "type": "http.request",
                "body": envelope.body,
                "more_body": False,
            }
        # Subsequent calls must block until the dispatch is genuinely
        # cancelled (stream RST, connection drop, etc.) rather than
        # returning http.disconnect immediately — handlers that poll
        # receive() for backpressure / disconnect (SSE, streaming) would
        # otherwise terminate the moment they checked.
        await disc.wait()
        return {"type": "http.disconnect"}

    response_status = 500
    response_headers: list[tuple[str, str]] = []
    response_body = bytearray()

    async def send(message: dict[str, Any]) -> None:
        nonlocal response_status
        if message["type"] == "http.response.start":
            response_status = int(message["status"])
            for k, v in message.get("headers", []):
                response_headers.append(
                    (k.decode("latin-1"), v.decode("latin-1")),
                )
        elif message["type"] == "http.response.body":
            chunk = message.get("body") or b""
            if chunk:
                if len(response_body) + len(chunk) > max_response_bytes:
                    raise AsgiResponseTooLarge(
                        f"asgi response exceeded {max_response_bytes} bytes"
                    )
                response_body.extend(chunk)

    await app(scope, receive, send)
    return response_status, response_headers, bytes(response_body)
