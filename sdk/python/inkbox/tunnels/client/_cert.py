"""
inkbox/tunnels/client/_cert.py

Passthrough cert lifecycle: load-or-create EC P-256 keypair, build CSR,
detect when the cached cert needs resigning.
"""

from __future__ import annotations

import datetime as _dt
import logging
import os
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.types import PrivateKeyTypes
from cryptography.x509.oid import NameOID

from inkbox.tunnels.client._state import (
    CERT_FILE,
    KEY_FILE,
    ensure_private_state_dir,
    write_private_file,
)


logger = logging.getLogger("inkbox.tunnels")

CERT_RENEWAL_THRESHOLD = _dt.timedelta(days=14)


def load_or_create_keypair(state_dir: Path) -> PrivateKeyTypes:
    """Load EC P-256 key from disk or generate one."""
    key_path = state_dir / KEY_FILE
    if key_path.is_file():
        return serialization.load_pem_private_key(
            key_path.read_bytes(), password=None,
        )

    logger.info("generating EC P-256 keypair -> %s", key_path)
    ensure_private_state_dir(state_dir)
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    write_private_file(key_path, pem)
    return key


def build_csr(key: PrivateKeyTypes, public_host: str) -> str:
    """Build a CSR with CN + SAN = ``public_host``."""
    csr = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(
            x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, public_host)]),
        )
        .add_extension(
            x509.SubjectAlternativeName([x509.DNSName(public_host)]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    return csr.public_bytes(serialization.Encoding.PEM).decode("ascii")


def cert_expiry(state_dir: Path) -> _dt.datetime | None:
    cert_path = state_dir / CERT_FILE
    if not cert_path.is_file():
        return None
    try:
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
    except ValueError:
        return None
    return cert.not_valid_after_utc


def cert_needs_sign(state_dir: Path, key: PrivateKeyTypes) -> bool:
    """Decide whether the cached cert needs resigning."""
    cert_path = state_dir / CERT_FILE
    expiry = cert_expiry(state_dir)
    now = _dt.datetime.now(_dt.timezone.utc)

    if not cert_path.is_file() or expiry is None:
        return True
    if expiry - now < CERT_RENEWAL_THRESHOLD:
        return True
    # Even if in-window, the on-disk private key may have been
    # regenerated since the cert was signed (e.g. accidental key
    # deletion). Compare pubkeys; mismatch => resign.
    try:
        cached_cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        if (
            cached_cert.public_key().public_numbers()
            != key.public_key().public_numbers()
        ):
            logger.info("key/cert mismatch on disk; resigning CSR")
            return True
    except (OSError, ValueError, AttributeError):
        return True
    return False


def write_cert_chain(state_dir: Path, cert_pem: str, chain_pem: str) -> bytes:
    """Persist the signed cert+chain (mode 0o600); return the bytes."""
    full_chain = (cert_pem + chain_pem).encode("ascii")
    cert_path = state_dir / CERT_FILE
    write_private_file(cert_path, full_chain)
    try:
        os.chmod(cert_path, 0o600)
    except OSError:
        pass
    return full_chain


def key_pem_bytes(key: PrivateKeyTypes) -> bytes:
    """Serialize a private key as unencrypted PKCS8 PEM bytes."""
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
