"""Phase 3a — `https://` URL upstream variants.

Spins up a TLS upstream with a self-signed cert and verifies:

* ``forward_to_verify_tls=False`` — accepts any cert (test passes).
* default verify-on with no CA → upstream connection fails, dispatcher
  surfaces a 502 to the third party.
* ``forward_to_ca_bundle=<pem>`` — explicit CA pin, succeeds when the
  CA matches and fails when it doesn't.
* SNI propagation — the upstream sees the configured hostname in the
  TLS handshake's ``server_name`` extension.
"""

from __future__ import annotations

import asyncio
import datetime
import ssl
from typing import AsyncIterator

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from inkbox.tunnels.client._dispatch import (
    DispatchRequest,
    DispatchResponseHead,
    DispatchResponseSink,
    UpstreamUrlDispatch,
)


def _make_self_signed(common_name: str) -> tuple[bytes, bytes]:
    """Return (cert_pem, key_pem) for a self-signed cert valid 1 year."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, common_name),
    ])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=1))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(
            x509.SubjectAlternativeName([x509.DNSName(common_name)]),
            critical=False,
        )
        .sign(private_key=key, algorithm=hashes.SHA256())
    )
    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    key_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    )
    return cert_pem, key_pem


async def _start_https_echo(
    cert_pem: bytes, key_pem: bytes, port_holder: list[int],
    sni_holder: list[str | None],
) -> asyncio.AbstractServer:
    ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    # Capture SNI via servername_callback.
    def on_sni(sslobj, server_name, ctx):
        sni_holder.append(server_name)

    # Load cert/key from the PEM via temp paths (Python's ssl ctx
    # accepts them via load_cert_chain only as filesystem paths).
    import tempfile
    cert_f = tempfile.NamedTemporaryFile(
        suffix=".pem", delete=False,
    )
    cert_f.write(cert_pem)
    cert_f.close()
    key_f = tempfile.NamedTemporaryFile(
        suffix=".pem", delete=False,
    )
    key_f.write(key_pem)
    key_f.close()
    ctx.load_cert_chain(certfile=cert_f.name, keyfile=key_f.name)
    ctx.set_servername_callback(on_sni)

    async def handle(reader, writer):
        # Read until \r\n\r\n then echo a tiny 200 OK response.
        head = bytearray()
        while b"\r\n\r\n" not in bytes(head):
            chunk = await reader.read(4096)
            if not chunk:
                writer.close()
                return
            head.extend(chunk)
        body = b"hello-from-https-upstream"
        resp = (
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: text/plain\r\n"
            b"Content-Length: " + str(len(body)).encode("ascii") + b"\r\n"
            b"Connection: close\r\n\r\n"
        ) + body
        writer.write(resp)
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(
        handle, host="127.0.0.1", port=0, ssl=ctx,
    )
    port_holder.append(server.sockets[0].getsockname()[1])
    return server


class _CapturingSink(DispatchResponseSink):
    def __init__(self) -> None:
        self.head: DispatchResponseHead | None = None
        self.body = bytearray()
        self.ended = False

    async def send_head(self, head):
        self.head = head

    async def send_body(self, chunk):
        self.body.extend(chunk)

    async def end_body(self):
        self.ended = True

    async def reset(self, reason):
        pass


async def _empty_body() -> AsyncIterator[bytes]:
    if False:  # pragma: no cover
        yield b""


@pytest.mark.asyncio
async def test_https_upstream_verify_off_succeeds():
    cert_pem, key_pem = _make_self_signed("localhost")
    port_holder: list[int] = []
    sni_holder: list[str | None] = []
    server = await _start_https_echo(
        cert_pem, key_pem, port_holder, sni_holder,
    )
    serve = asyncio.create_task(server.serve_forever())
    try:
        port = port_holder[0]
        dispatch = UpstreamUrlDispatch(
            forward_to=f"https://localhost:{port}",
            public_host="agent.test",
            max_outbound_body_bytes=1_000_000,
            max_inbound_body_bytes=1_000_000,
            verify=False,
        )
        try:
            sink = _CapturingSink()
            request = DispatchRequest(
                method="GET", path="/", headers=[], body=_empty_body(),
            )
            await dispatch.dispatch(request, sink)
            assert sink.head is not None
            assert sink.head.status == 200
            assert bytes(sink.body) == b"hello-from-https-upstream"
            # SNI should propagate.
            assert sni_holder == ["localhost"]
        finally:
            await dispatch.aclose()
    finally:
        serve.cancel()
        try:
            await serve
        except (asyncio.CancelledError, Exception):
            pass
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_https_upstream_verify_on_no_ca_returns_502():
    cert_pem, key_pem = _make_self_signed("localhost")
    port_holder: list[int] = []
    sni_holder: list[str | None] = []
    server = await _start_https_echo(
        cert_pem, key_pem, port_holder, sni_holder,
    )
    serve = asyncio.create_task(server.serve_forever())
    try:
        port = port_holder[0]
        dispatch = UpstreamUrlDispatch(
            forward_to=f"https://localhost:{port}",
            public_host="agent.test",
            max_outbound_body_bytes=1_000_000,
            max_inbound_body_bytes=1_000_000,
            # verify defaults to True; no CA bundle supplied — system
            # trust store doesn't have our self-signed cert.
        )
        try:
            sink = _CapturingSink()
            request = DispatchRequest(
                method="GET", path="/", headers=[], body=_empty_body(),
            )
            await dispatch.dispatch(request, sink)
            assert sink.head is not None
            assert sink.head.status == 502
        finally:
            await dispatch.aclose()
    finally:
        serve.cancel()
        try:
            await serve
        except (asyncio.CancelledError, Exception):
            pass
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_https_upstream_with_explicit_ca_bundle_succeeds():
    cert_pem, key_pem = _make_self_signed("localhost")
    port_holder: list[int] = []
    sni_holder: list[str | None] = []
    server = await _start_https_echo(
        cert_pem, key_pem, port_holder, sni_holder,
    )
    serve = asyncio.create_task(server.serve_forever())
    try:
        port = port_holder[0]
        dispatch = UpstreamUrlDispatch(
            forward_to=f"https://localhost:{port}",
            public_host="agent.test",
            max_outbound_body_bytes=1_000_000,
            max_inbound_body_bytes=1_000_000,
            ca_bundle=cert_pem,  # pin our self-signed cert
        )
        try:
            sink = _CapturingSink()
            request = DispatchRequest(
                method="GET", path="/", headers=[], body=_empty_body(),
            )
            await dispatch.dispatch(request, sink)
            assert sink.head is not None
            assert sink.head.status == 200
        finally:
            await dispatch.aclose()
    finally:
        serve.cancel()
        try:
            await serve
        except (asyncio.CancelledError, Exception):
            pass
        server.close()
        await server.wait_closed()


# ---------------------------------------------------------------------------
# Edge-mode HTTPS upstream regressions — the same ``forward_to_verify_tls`` /
# ``forward_to_ca_bundle`` knobs must apply to the edge URL-forwarding path,
# not only the passthrough one.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_edge_https_upstream_verify_off_succeeds():
    """Edge URL forwarding to ``https://`` self-signed upstream with
    ``forward_to_verify_tls=False`` must succeed. Before the fix the
    edge-side ``httpx.AsyncClient`` was constructed without ``verify=``
    so the new option had no effect."""
    from inkbox.tunnels.client._url_forward import forward_envelope_to_url
    from inkbox.tunnels.client._envelope import Envelope
    from inkbox.tunnels.client._upstream_tls import build_upstream_tls_context
    import httpx

    cert_pem, key_pem = _make_self_signed("localhost")
    port_holder: list[int] = []
    sni_holder: list[str | None] = []
    server = await _start_https_echo(
        cert_pem, key_pem, port_holder, sni_holder,
    )
    serve = asyncio.create_task(server.serve_forever())
    try:
        port = port_holder[0]
        verify = build_upstream_tls_context(verify=False, ca_bundle=None)
        client = httpx.AsyncClient(timeout=30.0, verify=verify)
        try:
            envelope = Envelope(
                request_id="r-edge", method="GET", path="/probe",
                route_kind="webhook", ws_id=None, forwarded_headers=[],
                body=b"", body_uri=None, forwarded_for_ip=None,
                tcp_id=None, sni_host=None, extra_meta={},
            )
            result = await forward_envelope_to_url(
                envelope=envelope,
                forward_to=f"https://localhost:{port}",
                public_host="agent.test",
                http_client=client,
                max_outbound_body_bytes=1_000_000,
            )
            assert result.status == 200
            assert result.body == b"hello-from-https-upstream"
        finally:
            await client.aclose()
    finally:
        serve.cancel()
        try:
            await serve
        except (asyncio.CancelledError, Exception):
            pass
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_edge_https_upstream_verify_on_no_ca_fails_cleanly():
    """Edge URL forwarding with default verify-on must fail with a
    structured upstream-error result (502) when the upstream cert can't
    be verified — i.e. it actually consults the verify knob."""
    from inkbox.tunnels.client._url_forward import forward_envelope_to_url
    from inkbox.tunnels.client._envelope import Envelope
    from inkbox.tunnels.client._upstream_tls import build_upstream_tls_context
    import httpx

    cert_pem, key_pem = _make_self_signed("localhost")
    port_holder: list[int] = []
    sni_holder: list[str | None] = []
    server = await _start_https_echo(
        cert_pem, key_pem, port_holder, sni_holder,
    )
    serve = asyncio.create_task(server.serve_forever())
    try:
        port = port_holder[0]
        verify = build_upstream_tls_context(verify=True, ca_bundle=None)
        client = httpx.AsyncClient(timeout=30.0, verify=verify)
        try:
            envelope = Envelope(
                request_id="r-edge-fail", method="GET", path="/probe",
                route_kind="webhook", ws_id=None, forwarded_headers=[],
                body=b"", body_uri=None, forwarded_for_ip=None,
                tcp_id=None, sni_host=None, extra_meta={},
            )
            result = await forward_envelope_to_url(
                envelope=envelope,
                forward_to=f"https://localhost:{port}",
                public_host="agent.test",
                http_client=client,
                max_outbound_body_bytes=1_000_000,
            )
            assert result.status == 502
            assert result.inkbox_reason
        finally:
            await client.aclose()
    finally:
        serve.cancel()
        try:
            await serve
        except (asyncio.CancelledError, Exception):
            pass
        server.close()
        await server.wait_closed()
