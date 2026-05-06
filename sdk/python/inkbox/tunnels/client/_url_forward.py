"""
inkbox/tunnels/client/_url_forward.py

URL-forward HTTP proxy. Takes an inbound :class:`Envelope` and forwards
it as an HTTP request to ``forward_to`` (a local URL like
``http://localhost:8080``).

Path semantics, header injection, body caps, and SSRF guards live here.
The runtime calls :func:`forward_envelope_to_url` from its dispatch loop.
"""

from __future__ import annotations

import ipaddress
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING
from urllib.parse import unquote, urlsplit, urlunsplit

from inkbox.tunnels.client._envelope import HOP_BY_HOP_REQUEST

if TYPE_CHECKING:
    import httpx
    from inkbox.tunnels.client._envelope import Envelope


logger = logging.getLogger("inkbox.tunnels")


@dataclass(frozen=True)
class ForwardResult:
    """Result of forwarding to a user-supplied ``forward_to``."""
    status: int
    headers: list[tuple[str, str]]
    body: bytes
    inkbox_reason: str | None = None


_LOOPBACK_LITERALS = frozenset({"localhost", "127.0.0.1", "::1"})


class ForwardTargetRefused(ValueError):
    """``forward_to`` points outside the allowlist and ``allow_remote_forwarding`` is False."""


def validate_forward_target(
    forward_to: str, *, allow_remote_forwarding: bool,
) -> None:
    """Validate ``forward_to`` against the loopback-only allowlist.

    Default behavior refuses any host that isn't a literal loopback form
    (``localhost``, IPv4 in ``127.0.0.0/8``, or IPv6 ``::1``). Hostnames
    that *would* resolve to loopback are also refused — the SDK doesn't
    invoke the system resolver, so DNS rebinding can't be used to slip
    a sensitive target past the check.

    Pass ``allow_remote_forwarding=True`` to skip validation entirely.
    """
    if allow_remote_forwarding:
        return
    parsed = urlsplit(forward_to)
    if parsed.scheme not in ("http", "https"):
        raise ForwardTargetRefused(
            f"forward_to scheme must be http or https; got {parsed.scheme!r}",
        )
    host = parsed.hostname or ""
    if not host:
        raise ForwardTargetRefused(f"forward_to has no host: {forward_to!r}")
    host_lower = host.lower()
    if host_lower in _LOOPBACK_LITERALS:
        return
    # Try parsing as a literal IP. ``ipaddress`` rejects hostnames so a
    # rebinding-prone hostname falls through to the final raise.
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        raise ForwardTargetRefused(
            f"forward_to host {host!r} is not a literal loopback address; "
            "pass allow_remote_forwarding=True to bypass (review the SSRF "
            "tradeoff first)",
        ) from None
    if isinstance(ip, ipaddress.IPv4Address) and ip.is_loopback:
        return
    if isinstance(ip, ipaddress.IPv6Address) and ip.is_loopback:
        return
    raise ForwardTargetRefused(
        f"forward_to address {host!r} is not loopback; pass "
        "allow_remote_forwarding=True to bypass (review the SSRF tradeoff first)",
    )


def validate_envelope_path(path: str) -> str | None:
    """Reject path-traversal evasion attempts.

    Returns ``None`` on success, an ``inkbox-reason`` string on rejection.

    Algorithm:
        1. Pre-decode reject — if the raw path contains ``%2f`` /
           ``%2F`` / ``%5c`` / ``%5C``, reject. Encoded ``/`` and ``\\``
           are evasion-only.
        2. Iterative percent-decode, max 2 passes. If the result still
           changes after pass 2, reject (triple+ encoding is evasion).
        3. After decoding stabilizes, split on ``/`` and reject any
           segment that equals ``.`` or ``..`` or contains a control
           byte (``< 0x20`` or ``0x7f``).

    The original path is forwarded verbatim — decoding is for validation
    only.
    """
    raw_path, _, _ = path.partition("?")
    lowered = raw_path.lower()
    for forbidden in ("%2f", "%5c"):
        if forbidden in lowered:
            return "invalid-path"
    try:
        decoded_pass1 = unquote(raw_path)
        if decoded_pass1 != raw_path:
            decoded_pass2 = unquote(decoded_pass1)
            if decoded_pass2 != decoded_pass1:
                return "invalid-path"
            decoded = decoded_pass2
        else:
            decoded = decoded_pass1
    except (UnicodeDecodeError, ValueError):
        return "invalid-path"
    for segment in decoded.split("/"):
        if segment in (".", ".."):
            return "invalid-path"
        if segment.lower() in (".", ".."):
            return "invalid-path"
        # Some upstream frameworks (IIS, Tomcat in some configs, a few
        # Node static-file libs) treat raw backslash as a path separator.
        # Reject it so ``/static\..\secret`` can't slip past the
        # split-on-/ check.
        if "\\" in segment:
            return "invalid-path"
        for ch in segment:
            o = ord(ch)
            if o < 0x20 or o == 0x7F:
                return "invalid-path"
    return None


def join_forward_path(forward_to: str, envelope_path: str) -> str:
    """Prefix-join the envelope's path onto ``forward_to``'s base path."""
    parsed = urlsplit(forward_to)
    base_path = parsed.path or ""
    if base_path.endswith("/"):
        base_path = base_path[:-1]
    raw_path, _, query = envelope_path.partition("?")
    if not raw_path.startswith("/"):
        raw_path = "/" + raw_path
    full_path = f"{base_path}{raw_path}" if base_path else raw_path
    return urlunsplit((parsed.scheme, parsed.netloc, full_path, query, ""))


def build_forward_headers(
    envelope: Envelope, *, public_host: str, target_host: str,
) -> list[tuple[str, str]]:
    """Build the headers we send to ``forward_to``.

    Hop-by-hop headers and inbound ``X-Forwarded-For`` / ``Forwarded``
    headers are stripped here (defense in depth — the server side also
    strips inbound forwarded-for headers from third-party traffic so
    only this SDK's view of the source IP reaches your app). The SDK
    then injects ``Host``, ``X-Forwarded-Host``, ``X-Forwarded-Proto``,
    ``X-Forwarded-For``, ``Forwarded`` so the user's app sees a
    consistent forwarded-headers view.
    """
    out: list[tuple[str, str]] = []
    out.append(("Host", target_host))
    out.append(("X-Forwarded-Host", public_host))
    out.append(("X-Forwarded-Proto", "https"))
    if envelope.forwarded_for_ip:
        out.append(("X-Forwarded-For", envelope.forwarded_for_ip))
        out.append(("Forwarded", f"for={envelope.forwarded_for_ip}"))
    seen_special = {"host", "x-forwarded-host", "x-forwarded-proto",
                    "x-forwarded-for", "forwarded"}
    for k, v in envelope.forwarded_headers:
        kl = k.lower()
        if kl in HOP_BY_HOP_REQUEST:
            continue
        if kl in seen_special:
            continue
        out.append((k, v))
    return out


async def forward_envelope_to_url(
    *,
    envelope: Envelope,
    forward_to: str,
    public_host: str,
    http_client: httpx.AsyncClient,
    max_outbound_body_bytes: int,
) -> ForwardResult:
    """Forward an envelope to ``forward_to`` and return the upstream response.

    The caller is expected to have already:
        - Validated ``forward_to`` via :func:`validate_forward_target`.
        - Validated the envelope's path via :func:`validate_envelope_path`.
        - Materialized the inbound body (resolved any ``inkbox-body-uri``).
    """
    parsed = urlsplit(forward_to)
    target_host = parsed.netloc
    target_url = join_forward_path(forward_to, envelope.path)
    headers = build_forward_headers(
        envelope, public_host=public_host, target_host=target_host,
    )
    # Stream the upstream response so we can bail early on oversized
    # bodies without buffering them into memory first.
    try:
        async with http_client.stream(
            method=envelope.method,
            url=target_url,
            headers=headers,
            content=envelope.body,
        ) as resp:
            buf = bytearray()
            oversize = False
            try:
                async for chunk in resp.aiter_bytes():
                    if len(buf) + len(chunk) > max_outbound_body_bytes:
                        oversize = True
                        break
                    buf.extend(chunk)
            except Exception:
                logger.warning(
                    "url-forward stream error request_id=%s url=%s",
                    envelope.request_id, target_url,
                )
                return ForwardResult(
                    status=502,
                    headers=[("content-type", "text/plain")],
                    body=b"upstream error",
                    inkbox_reason="upstream-error",
                )
            if oversize:
                logger.warning(
                    "url-forward response too large; cap=%d",
                    max_outbound_body_bytes,
                )
                return ForwardResult(
                    status=502,
                    headers=[("content-type", "text/plain")],
                    body=b"response too large",
                    inkbox_reason="response-too-large",
                )
            resp_headers: list[tuple[str, str]] = [
                (k, v) for k, v in resp.headers.items()
            ]
            return ForwardResult(
                status=resp.status_code,
                headers=resp_headers,
                body=bytes(buf),
            )
    except Exception:
        logger.warning(
            "url-forward upstream error request_id=%s url=%s",
            envelope.request_id, target_url,
        )
        return ForwardResult(
            status=502,
            headers=[("content-type", "text/plain")],
            body=b"upstream error",
            inkbox_reason="upstream-error",
        )
