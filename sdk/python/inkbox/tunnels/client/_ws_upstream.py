"""
inkbox/tunnels/client/_ws_upstream.py

Shared helper for opening an h1 ``Upgrade: websocket`` connection to a
URL upstream. Used by both:

* ``UpstreamUrlDispatch.dispatch_websocket`` — passthrough mode, where
  the third party's WS frames ride h1/h2 plaintext through the SDK.
* The runtime's edge-mode ``_dispatch_ws_upgrade_to_url`` — where the
  third party's WS frames arrive over the bridge stream as length-
  prefixed JSON envelopes inside outer WS BINARY frames.

The hop itself is identical: open TCP/TLS, send GET + Upgrade headers,
read 101 response, verify ``Sec-WebSocket-Accept`` per RFC 6455 §1.3.
The bridging that happens after the hop differs by mode and is left to
the caller.
"""

from __future__ import annotations

import asyncio
import os
import ssl
from contextlib import suppress
from dataclasses import dataclass
from urllib.parse import urlsplit

from inkbox.tunnels.client._envelope import HOP_BY_HOP_REQUEST


@dataclass
class WsUpstream:
    """Result of a successful upstream WS handshake."""

    reader: asyncio.StreamReader
    writer: asyncio.StreamWriter
    # Subprotocol the upstream negotiated, if any.
    subprotocol: str | None
    # Bytes the upstream sent past the response head — typically empty,
    # but possibly the start of a WS frame the upstream pushed eagerly.
    leftover: bytes
    # All 101 response headers, lowercased keys, in arrival order.
    # Application-defined headers (e.g. ``Set-Cookie``,
    # ``X-Use-Inkbox-*``) live here. The runtime filters out
    # hop-by-hop + handshake-control headers when reconstructing the
    # third-party-facing 101.
    headers: list[tuple[str, str]]


class WsUpstreamError(Exception):
    """Raised on any failure to establish the upstream WS hop.

    Carries an HTTP-style ``status`` the caller can surface back to the
    third party (502 for connection failures, the upstream's own status
    for non-101 replies).
    """

    def __init__(self, status: int, reason: str) -> None:
        super().__init__(reason)
        self.status = status
        self.reason = reason


UPSTREAM_HANDSHAKE_TIMEOUT_S = 30.0


async def open_ws_upstream(
    *,
    forward_to: str,
    request_path: str,
    request_headers: list[tuple[str, str]],
    ws_subprotocol: str | None,
    forwarded_for_ip: str | None,
    public_host: str,
    verify: bool = True,
    ca_bundle: bytes | str | None = None,
    handshake_timeout_s: float = UPSTREAM_HANDSHAKE_TIMEOUT_S,
) -> WsUpstream:
    """Open a TCP/TLS connection to ``forward_to`` and complete an h1
    ``Upgrade: websocket`` handshake. Returns the connected reader/
    writer + the negotiated subprotocol on success.

    Raises ``WsUpstreamError`` on any failure (connection refused, TLS
    error, non-101 response, missing/wrong ``Sec-WebSocket-Accept``).
    """
    from inkbox.tunnels.client._url_forward import join_forward_path
    from inkbox.tunnels.client._ws_passthrough import compute_ws_accept

    target_url = join_forward_path(forward_to, request_path)
    parsed = urlsplit(target_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    path_only = parsed.path or "/"
    if parsed.query:
        path_only = f"{path_only}?{parsed.query}"

    ssl_ctx: ssl.SSLContext | None = None
    if parsed.scheme == "https":
        from inkbox.tunnels.client._tls import create_default_verify_context
        from inkbox.tunnels.client._upstream_tls import (
            build_upstream_tls_context,
        )
        built = build_upstream_tls_context(verify=verify, ca_bundle=ca_bundle)
        if isinstance(built, ssl.SSLContext):
            ssl_ctx = built
        else:
            ssl_ctx = create_default_verify_context()

    # Single composite handshake budget (connect + write + head-read).
    # Earlier shape used two ``wait_for(..., timeout=handshake_timeout_s)``
    # calls so worst-case wall time was 2x the configured timeout —
    # confusing when the runtime threads response_deadline_seconds in.
    loop = asyncio.get_running_loop()
    deadline = loop.time() + handshake_timeout_s

    def _remaining() -> float:
        return max(0.0, deadline - loop.time())

    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(
                host, port, ssl=ssl_ctx,
                server_hostname=host if ssl_ctx else None,
            ),
            timeout=_remaining(),
        )
    except asyncio.TimeoutError as e:
        raise WsUpstreamError(504, "upstream-connect-timeout") from e
    except (OSError, ssl.SSLError) as e:
        raise WsUpstreamError(502, f"upstream-unreachable: {e}") from e

    ws_key = _b64_random_key()
    host_header = parsed.netloc
    upgrade_lines = [
        f"GET {path_only} HTTP/1.1",
        f"Host: {host_header}",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        f"Sec-WebSocket-Key: {ws_key}",
    ]
    if ws_subprotocol:
        upgrade_lines.append(f"Sec-WebSocket-Protocol: {ws_subprotocol}")
    upgrade_lines.append(f"X-Forwarded-Host: {public_host}")
    upgrade_lines.append("X-Forwarded-Proto: https")
    if forwarded_for_ip:
        upgrade_lines.append(f"X-Forwarded-For: {forwarded_for_ip}")
    seen_skip = {
        "host", "x-forwarded-host", "x-forwarded-proto",
        "x-forwarded-for", "forwarded",
        "sec-websocket-key", "sec-websocket-version",
        "sec-websocket-protocol",
        # We don't implement permessage-deflate or any other WS extensions —
        # don't forward an Offer the upstream might accept.
        "sec-websocket-extensions",
        "upgrade", "connection",
    }
    for k, v in request_headers:
        kl = k.lower()
        if kl in HOP_BY_HOP_REQUEST or kl.startswith(":"):
            continue
        if kl in seen_skip:
            continue
        upgrade_lines.append(f"{k}: {v}")
    upgrade_bytes = ("\r\n".join(upgrade_lines) + "\r\n\r\n").encode("ascii")

    try:
        writer.write(upgrade_bytes)
        await asyncio.wait_for(writer.drain(), timeout=_remaining())
    except asyncio.TimeoutError as e:
        await _safe_close(writer)
        raise WsUpstreamError(504, "upstream-write-timeout") from e
    except (OSError, ConnectionError) as e:
        await _safe_close(writer)
        raise WsUpstreamError(502, f"upstream-write: {e}") from e

    head_buf = bytearray()

    async def _read_head() -> None:
        while b"\r\n\r\n" not in bytes(head_buf):
            chunk = await reader.read(4096)
            if not chunk:
                raise ConnectionError("upstream closed before response")
            head_buf.extend(chunk)
            if len(head_buf) > 65536:
                raise ConnectionError("upstream response head too large")

    try:
        await asyncio.wait_for(_read_head(), timeout=_remaining())
    except asyncio.TimeoutError as e:
        await _safe_close(writer)
        raise WsUpstreamError(504, "upstream-handshake-timeout") from e
    except (OSError, ConnectionError) as e:
        await _safe_close(writer)
        raise WsUpstreamError(502, f"upstream-read: {e}") from e

    head_end = bytes(head_buf).index(b"\r\n\r\n") + 4
    head_text = bytes(head_buf[:head_end - 4]).decode(
        "iso-8859-1", errors="replace",
    )
    leftover = bytes(head_buf[head_end:])
    lines = head_text.split("\r\n")
    if not lines:
        await _safe_close(writer)
        raise WsUpstreamError(502, "empty response")
    parts = lines[0].split(" ", 2)
    try:
        status = int(parts[1])
    except (IndexError, ValueError):
        status = 502
    if status != 101:
        await _safe_close(writer)
        raise WsUpstreamError(status, f"upstream returned {status}")

    upstream_subprotocol: str | None = None
    upstream_accept: str | None = None
    upstream_extensions: str | None = None
    response_headers: list[tuple[str, str]] = []
    for line in lines[1:]:
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        kl = k.strip().lower()
        vstripped = v.strip()
        response_headers.append((kl, vstripped))
        if kl == "sec-websocket-protocol":
            upstream_subprotocol = vstripped
        elif kl == "sec-websocket-accept":
            upstream_accept = vstripped
        elif kl == "sec-websocket-extensions":
            upstream_extensions = vstripped

    expected_accept = compute_ws_accept(ws_key)
    if upstream_accept != expected_accept:
        await _safe_close(writer)
        raise WsUpstreamError(502, "upstream Sec-WebSocket-Accept mismatch")
    # We never offer extensions; per RFC 6455 §9.1 the server MUST NOT
    # confirm one that wasn't offered. If a misbehaving upstream still
    # claims one (e.g. permessage-deflate), refuse — we don't have a
    # codec wired and would forward compressed bytes raw.
    if upstream_extensions:
        await _safe_close(writer)
        raise WsUpstreamError(
            502, f"upstream negotiated unsupported extensions: {upstream_extensions}",
        )
    # RFC 6455 §4.1: the server's selected subprotocol MUST be one the
    # client offered (or omitted). A misbehaving upstream that picks an
    # un-offered token would force us to advertise something the third
    # party never asked for; the third party then fails the handshake.
    if upstream_subprotocol:
        offered = _parse_subprotocol_offer(ws_subprotocol)
        if upstream_subprotocol not in offered:
            await _safe_close(writer)
            raise WsUpstreamError(
                502,
                f"upstream-subprotocol-not-offered: {upstream_subprotocol}",
            )

    return WsUpstream(
        reader=reader,
        writer=writer,
        subprotocol=upstream_subprotocol,
        leftover=leftover,
        headers=response_headers,
    )


def _parse_subprotocol_offer(offer: str | None) -> list[str]:
    """Split a ``Sec-WebSocket-Protocol`` value into offered tokens.

    Whitespace trimmed; empty tokens dropped. Case-sensitive per RFC.
    """
    if not offer:
        return []
    return [s.strip() for s in offer.split(",") if s.strip()]


def _b64_random_key() -> str:
    import base64
    return base64.b64encode(os.urandom(16)).decode("ascii")


async def _safe_close(writer: asyncio.StreamWriter) -> None:
    with suppress(Exception):
        writer.close()
        await writer.wait_closed()
