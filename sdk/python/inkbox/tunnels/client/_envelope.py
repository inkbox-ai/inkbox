"""
inkbox/tunnels/client/_envelope.py

Tunnel envelope parsing. Pure / synchronous; no I/O. The ``inkbox-body-uri``
materialization step lives in ``_runtime`` so this module stays trivially
unit-testable.
"""

from __future__ import annotations

from dataclasses import dataclass, field


# Hop-by-hop request/response headers that must NOT be forwarded
# verbatim. Keep in sync with the wire shape.
HOP_BY_HOP_REQUEST = frozenset({
    "host", "connection", "upgrade", "keep-alive", "te", "trailer",
    "transfer-encoding", "proxy-authenticate", "proxy-authorization",
    "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions",
})

HOP_BY_HOP_RESPONSE = frozenset({
    "connection", "keep-alive", "transfer-encoding", "upgrade",
    "proxy-authenticate", "proxy-authorization", "te", "trailer",
})


@dataclass
class Envelope:
    """One inbound third-party request, parsed from tunnel-server headers."""
    request_id: str
    method: str
    path: str
    route_kind: str  # "webhook" | "ws-upgrade" | "tcp-stream"
    ws_id: str | None
    forwarded_headers: list[tuple[str, str]]
    body: bytes
    body_uri: str | None = None
    forwarded_for_ip: str | None = None
    tcp_id: str | None = None
    sni_host: str | None = None
    extra_meta: dict[str, str] = field(default_factory=dict)


def parse_envelope(
    headers: list[tuple[str, str]], body: bytes,
) -> Envelope | None:
    """Parse a ``/_system/intake`` response into an :class:`Envelope`.

    Returns ``None`` if the headers are missing the required
    ``inkbox-request-id`` field.

    The returned envelope's ``body`` may be the empty bytes when the
    server has offloaded the body to an out-of-band fetch URL — in that
    case ``body_uri`` is set and the runtime materializes it before
    dispatch.
    """
    request_id = ""
    method = "GET"
    path = "/"
    route_kind = "webhook"
    ws_id: str | None = None
    tcp_id: str | None = None
    sni_host: str | None = None
    body_uri: str | None = None
    forwarded_for_ip: str | None = None
    forwarded: list[tuple[str, str]] = []
    extra: dict[str, str] = {}

    for k, v in headers:
        kl = k.lower() if isinstance(k, str) else k.decode("latin-1").lower()
        if kl == "inkbox-request-id":
            request_id = v
        elif kl == "inkbox-method":
            method = v
        elif kl == "inkbox-path":
            path = v
        elif kl == "inkbox-route-kind":
            route_kind = v
        elif kl == "inkbox-ws-id":
            ws_id = v
        elif kl == "inkbox-tcp-id":
            tcp_id = v
        elif kl == "inkbox-sni-host":
            sni_host = v
        elif kl == "inkbox-body-uri":
            body_uri = v
        elif kl == "inkbox-forwarded-for":
            forwarded_for_ip = v
            extra[kl] = v
        elif kl.startswith("inkbox-h-"):
            forwarded.append((kl.removeprefix("inkbox-h-"), v))
        elif kl.startswith("inkbox-"):
            extra[kl] = v

    if not request_id:
        return None
    return Envelope(
        request_id=request_id,
        method=method,
        path=path,
        route_kind=route_kind,
        ws_id=ws_id,
        forwarded_headers=forwarded,
        body=body,
        body_uri=body_uri,
        forwarded_for_ip=forwarded_for_ip,
        tcp_id=tcp_id,
        sni_host=sni_host,
        extra_meta=extra,
    )


def filter_response_headers(
    headers: list[tuple[str, str]],
) -> list[tuple[str, str]]:
    """Drop hop-by-hop headers from an upstream response before forwarding."""
    return [(k, v) for k, v in headers if k.lower() not in HOP_BY_HOP_RESPONSE]
