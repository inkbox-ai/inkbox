"""ALPN advertisement tests for the passthrough TLS terminator."""

from __future__ import annotations

import ssl
from datetime import datetime, timedelta, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from inkbox.tunnels.client._tls import TLSTerminator


def _self_signed_pair(cn: str = "test.example") -> tuple[bytes, bytes]:
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(1)
        .not_valid_before(datetime.now(timezone.utc) - timedelta(minutes=1))
        .not_valid_after(datetime.now(timezone.utc) + timedelta(days=1))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(cn)]), critical=False)
        .sign(key, hashes.SHA256())
    )
    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    key_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return cert_pem, key_pem


def _drive_handshake(
    terminator: TLSTerminator, client_alpn: list[str]
) -> str | None:
    """Spin up an in-memory client/server pair, return the negotiated ALPN."""
    sess = terminator.session()
    cctx = ssl.create_default_context()
    cctx.check_hostname = False
    cctx.verify_mode = ssl.CERT_NONE
    cctx.set_alpn_protocols(client_alpn)
    cin = ssl.MemoryBIO()
    cout = ssl.MemoryBIO()
    csock = cctx.wrap_bio(cin, cout, server_side=False, server_hostname="test.example")

    client_done = False
    for _ in range(64):
        # Step the client: it might emit ClientHello, ChangeCipherSpec, etc.
        if not client_done:
            try:
                csock.do_handshake()
                client_done = True
            except ssl.SSLWantReadError:
                pass
        client_out = cout.read()
        # Feed any client bytes into the server; collect server-side output
        # in the same call.
        _, server_out = sess.feed(client_out)
        if server_out:
            cin.write(server_out)
        if client_done and sess.handshake_done:
            return csock.selected_alpn_protocol()
    raise RuntimeError("handshake did not converge")


def test_alpn_default_is_h1_only():
    cert_pem, key_pem = _self_signed_pair()
    term = TLSTerminator(cert_chain_pem=cert_pem, key_pem=key_pem)
    # Client advertises h2-preferred; we should still negotiate h1.
    selected = _drive_handshake(term, ["h2", "http/1.1"])
    assert selected == "http/1.1"


def test_alpn_explicit_h1_only():
    cert_pem, key_pem = _self_signed_pair()
    term = TLSTerminator(
        cert_chain_pem=cert_pem,
        key_pem=key_pem,
        alpn_protocols=("http/1.1",),
    )
    selected = _drive_handshake(term, ["h2", "http/1.1"])
    assert selected == "http/1.1"


def test_alpn_h2_offered_when_caller_requests():
    """Sanity: the parameter actually controls what's advertised."""
    cert_pem, key_pem = _self_signed_pair()
    term = TLSTerminator(
        cert_chain_pem=cert_pem,
        key_pem=key_pem,
        alpn_protocols=("h2", "http/1.1"),
    )
    selected = _drive_handshake(term, ["h2", "http/1.1"])
    assert selected == "h2"
