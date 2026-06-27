"""
inkbox/tunnels/client/_tls.py

In-memory TLS endpoint for passthrough mode. The SDK is the *server* in
the handshake — third parties connect TLS to the public host, the tunnel
server forwards the encrypted bytes inside an h2 DATA frame stream, and
this module decrypts them. The decrypted plaintext is then forwarded to
the user's local listener.
"""

from __future__ import annotations

import os
import ssl
import tempfile
from typing import Sequence


def create_default_verify_context() -> ssl.SSLContext:
    """A verifying client context, with a certifi fallback for empty stores.

    The macOS python.org installer doesn't hook the system keychain, so
    ``ssl.create_default_context()`` can come up empty and fail to verify our
    edge cert. When the default store has no CAs we load certifi's bundle.
    ``SSL_CERT_FILE`` still wins.
    """
    ctx = ssl.create_default_context()
    if ctx.cert_store_stats().get("x509_ca", 0) == 0:
        try:
            import certifi

            ctx.load_verify_locations(cafile=certifi.where())
        except Exception:
            pass
    return ctx


class TLSTerminator:
    """Owns a memory-only TLS context for one tunnel.

    Built once from the server-issued cert + chain (PEM) and the
    customer-held private key (PEM). Keys + certs round-trip through
    tempfiles to feed ``SSLContext.load_cert_chain`` (which only
    accepts paths); the tempfiles are mode 0o600 from creation and
    unlinked in ``finally``.

    ``alpn_protocols`` controls what we advertise to the third party.
    Default is ``("http/1.1",)`` — we only commit to a protocol the
    rest of the data plane can actually deliver.
    """

    def __init__(
        self,
        *,
        cert_chain_pem: bytes,
        key_pem: bytes,
        alpn_protocols: Sequence[str] = ("http/1.1",),
    ) -> None:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.set_alpn_protocols(list(alpn_protocols))
        cert_path = key_path = None
        try:
            cert_fd, cert_path = tempfile.mkstemp(suffix=".pem")
            try:
                os.fchmod(cert_fd, 0o600)
            except (AttributeError, OSError):
                pass
            with os.fdopen(cert_fd, "wb") as f:
                f.write(cert_chain_pem)

            key_fd, key_path = tempfile.mkstemp(suffix=".pem")
            try:
                os.fchmod(key_fd, 0o600)
            except (AttributeError, OSError):
                pass
            with os.fdopen(key_fd, "wb") as f:
                f.write(key_pem)

            ctx.load_cert_chain(certfile=cert_path, keyfile=key_path)
        finally:
            for p in (cert_path, key_path):
                if p is not None:
                    try:
                        os.unlink(p)
                    except OSError:
                        pass
        self._ctx = ctx

    def session(self) -> TLSSession:
        return TLSSession(self._ctx)


class TLSSession:
    """One inbound third-party TLS connection's worth of state."""

    def __init__(self, ctx: ssl.SSLContext) -> None:
        self._in_bio = ssl.MemoryBIO()
        self._out_bio = ssl.MemoryBIO()
        self._sslobj = ctx.wrap_bio(
            incoming=self._in_bio,
            outgoing=self._out_bio,
            server_side=True,
        )
        self._handshake_done = False

    @property
    def handshake_done(self) -> bool:
        return self._handshake_done

    def feed(self, encrypted: bytes) -> tuple[list[bytes], bytes]:
        """Feed encrypted bytes; return ``(plaintext_chunks, encrypted_to_send)``."""
        if encrypted:
            self._in_bio.write(encrypted)
        plaintext: list[bytes] = []
        if not self._handshake_done:
            try:
                self._sslobj.do_handshake()
                self._handshake_done = True
            except ssl.SSLWantReadError:
                pass
        if self._handshake_done:
            while True:
                try:
                    chunk = self._sslobj.read(16384)
                except ssl.SSLWantReadError:
                    break
                except ssl.SSLZeroReturnError:
                    break
                if not chunk:
                    break
                plaintext.append(chunk)
        encrypted_out = self._out_bio.read() or b""
        return plaintext, encrypted_out

    def send(self, plaintext: bytes) -> bytes:
        """Encrypt outbound plaintext; return encrypted bytes for the wire."""
        if plaintext:
            offset = 0
            while offset < len(plaintext):
                offset += self._sslobj.write(plaintext[offset:])
        return self._out_bio.read() or b""

    def close(self) -> bytes:
        try:
            self._sslobj.unwrap()
        except (ssl.SSLWantReadError, ssl.SSLError, OSError):
            pass
        return self._out_bio.read() or b""
