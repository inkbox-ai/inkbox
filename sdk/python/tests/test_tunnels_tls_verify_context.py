"""Client verification works even when certificate-store inspection is unavailable."""

import ssl
from unittest.mock import Mock

import certifi
import pytest

from inkbox.tunnels.client import _tls


@pytest.mark.parametrize("stats", [NotImplementedError(), {"x509_ca": 1}, {"x509_ca": 0}])
def test_preserves_verifier_and_only_loads_bundle_for_known_empty_store(monkeypatch, stats):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    inspect_store = Mock(side_effect=stats) if isinstance(stats, Exception) else Mock(return_value=stats)
    load_bundle = Mock(wraps=context.load_verify_locations)
    monkeypatch.setattr(context, "cert_store_stats", inspect_store)
    monkeypatch.setattr(context, "load_verify_locations", load_bundle)
    monkeypatch.setattr(ssl, "create_default_context", lambda: context)

    assert _tls.create_default_verify_context() is context
    assert context.check_hostname
    assert context.verify_mode == ssl.CERT_REQUIRED
    if stats == {"x509_ca": 0}:
        load_bundle.assert_called_once_with(cafile=certifi.where())
        assert context.get_ca_certs()
    else:
        load_bundle.assert_not_called()


@pytest.mark.parametrize("error", [ValueError("invalid store"), OSError("unavailable store")])
def test_unexpected_store_errors_propagate(monkeypatch, error):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    monkeypatch.setattr(context, "cert_store_stats", Mock(side_effect=error))
    monkeypatch.setattr(ssl, "create_default_context", lambda: context)

    with pytest.raises(type(error), match=str(error)):
        _tls.create_default_verify_context()


def test_empty_store_bundle_failure_keeps_verification_enabled(monkeypatch):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    monkeypatch.setattr(context, "load_verify_locations", Mock(side_effect=OSError("unavailable bundle")))
    monkeypatch.setattr(ssl, "create_default_context", lambda: context)

    assert _tls.create_default_verify_context() is context
    assert context.check_hostname
    assert context.verify_mode == ssl.CERT_REQUIRED
