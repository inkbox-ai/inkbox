from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.x509.oid import NameOID

from inkbox.exceptions import InkboxAPIError
from inkbox.tunnels.client._bootstrap import bootstrap
from inkbox.tunnels.client._cert import cert_needs_sign, load_or_create_keypair
from inkbox.tunnels.client._state import CERT_FILE, KEY_FILE, StateEntry, load_state, save_state
from inkbox.tunnels.exceptions import TunnelStateConflict
from inkbox.tunnels.types import TLSMode, TunnelStatus


def certificate(key, host, *, start=-1, end=90, san=True):
    now = datetime.now(timezone.utc)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, host)])
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject).issuer_name(subject).public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now + timedelta(days=start))
        .not_valid_after(now + timedelta(days=end))
    )
    if san:
        builder = builder.add_extension(
            x509.SubjectAlternativeName([x509.DNSName(host)]), critical=False,
        )
    return builder.sign(key, hashes.SHA256())


def tunnel(*, name="my-agent", status=TunnelStatus.ACTIVE, mode=TLSMode.PASSTHROUGH):
    return SimpleNamespace(
        id=uuid4(), tunnel_name=name, public_host=f"{name}.example.test",
        zone="example.test", tls_mode=mode, status=status,
        cert_fingerprint_sha256=None,
    )


def cached(tmp_path, record, cert=None):
    key = load_or_create_keypair(tmp_path)
    cert = cert or certificate(key, record.public_host)
    (tmp_path / CERT_FILE).write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    record.cert_fingerprint_sha256 = cert.fingerprint(hashes.SHA256()).hex()
    save_state(tmp_path, StateEntry(
        tunnel_id=str(record.id), name=record.tunnel_name,
        mode=record.tls_mode.value, zone=record.zone, public_host=record.public_host,
    ))
    return key


def run(tmp_path, api, name="my-agent"):
    return bootstrap(
        inkbox=SimpleNamespace(tunnels=api), name=name, state_dir=tmp_path,
        data_plane_zone_override=None,
    )


def test_reconnect_reuses_matching_certificate_and_key(tmp_path):
    record = tunnel()
    cached(tmp_path, record)
    original = {name: (tmp_path / name).read_bytes() for name in [KEY_FILE, CERT_FILE]}
    api = Mock(get=Mock(return_value=record))
    for _ in range(3):
        assert run(tmp_path, api).tunnel.id == record.id
    api.sign_csr.assert_not_called()
    api.list.assert_not_called()
    assert {name: (tmp_path / name).read_bytes() for name in original} == original


@pytest.mark.parametrize("stored_name", ["another-agent", "my-agent"])
def test_cached_lookup_never_selects_another_tunnel(tmp_path, stored_name):
    old = tunnel(name=stored_name, mode=TLSMode.EDGE)
    cached(tmp_path, old)
    wrong = tunnel(name="another-agent", mode=TLSMode.EDGE)
    wanted = tunnel(mode=TLSMode.EDGE)
    api = Mock(get=Mock(return_value=wrong), list=Mock(return_value=[wrong, wanted]))
    bundle = run(tmp_path, api)
    assert bundle.tunnel.id == wanted.id
    assert load_state(tmp_path).tunnel_id == str(wanted.id)
    if stored_name != "my-agent":
        api.get.assert_not_called()


def test_removed_saved_id_discovers_replacement_without_deleting_key(tmp_path):
    old = tunnel(mode=TLSMode.EDGE)
    cached(tmp_path, old)
    key = (tmp_path / KEY_FILE).read_bytes()
    wanted = tunnel(mode=TLSMode.EDGE)
    api = Mock(
        get=Mock(side_effect=InkboxAPIError(404, "not found")),
        list=Mock(return_value=[wanted]),
    )
    assert run(tmp_path, api).tunnel.id == wanted.id
    assert (tmp_path / KEY_FILE).read_bytes() == key


@pytest.mark.parametrize("status", [TunnelStatus.DELETED, "unrecognized"])
def test_unusable_tunnel_cannot_spend_certificate_issuance(tmp_path, status):
    record = tunnel(status=status)
    cached(tmp_path, record)
    api = Mock(get=Mock(return_value=record))
    with pytest.raises(TunnelStateConflict):
        run(tmp_path, api)
    api.sign_csr.assert_not_called()


@pytest.mark.parametrize("case", ["hostname", "fingerprint", "expired", "future", "missing_san", "key"])
def test_certificate_reuse_requires_current_identity_and_validity(tmp_path, case):
    key = load_or_create_keypair(tmp_path)
    host = "my-agent.example.test"
    cert = certificate(
        key, "another-agent.example.test" if case == "hostname" else host,
        start=1 if case == "future" else -90,
        end=-1 if case == "expired" else 90, san=case != "missing_san",
    )
    (tmp_path / CERT_FILE).write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    fingerprint = "00" * 32 if case == "fingerprint" else cert.fingerprint(hashes.SHA256()).hex()
    if case == "key":
        (tmp_path / KEY_FILE).unlink()
        key = load_or_create_keypair(tmp_path)
    assert cert_needs_sign(tmp_path, key, public_host=host, fingerprint_sha256=fingerprint)


def test_renewal_preserves_key_and_stops_after_success(tmp_path):
    record = tunnel()
    key = cached(tmp_path, record)
    record.cert_fingerprint_sha256 = "00" * 32
    original_key = (tmp_path / KEY_FILE).read_bytes()
    renewed = certificate(key, record.public_host)
    pem = renewed.public_bytes(serialization.Encoding.PEM).decode()

    def sign(*args, **kwargs):
        record.cert_fingerprint_sha256 = renewed.fingerprint(hashes.SHA256()).hex()
        return SimpleNamespace(cert_pem=pem, chain_pem="")

    api = Mock(get=Mock(return_value=record), sign_csr=Mock(side_effect=sign))
    run(tmp_path, api)
    run(tmp_path, api)
    api.sign_csr.assert_called_once()
    assert (tmp_path / KEY_FILE).read_bytes() == original_key
