"""create_default_verify_context() with contexts that cannot report store stats."""

from __future__ import annotations

import ssl
from unittest.mock import Mock

import certifi
import pytest

from inkbox.tunnels.client import _tls


class _NoStatsContext(ssl.SSLContext):
    """Mimics truststore.SSLContext: cert_store_stats() is not implemented."""

    def cert_store_stats(self):  # type: ignore[override]
        raise NotImplementedError()


class _EmptyStoreContext(ssl.SSLContext):
    def cert_store_stats(self):  # type: ignore[override]
        return {"x509": 0, "crl": 0, "x509_ca": 0}


def test_context_without_store_stats_is_returned(monkeypatch):
    ctx = _NoStatsContext(ssl.PROTOCOL_TLS_CLIENT)
    monkeypatch.setattr(ssl, "create_default_context", lambda *a, **k: ctx)

    assert _tls.create_default_verify_context() is ctx


def test_empty_store_still_falls_back_to_certifi(monkeypatch):
    ctx = _EmptyStoreContext(ssl.PROTOCOL_TLS_CLIENT)
    loaded: list[str] = []
    monkeypatch.setattr(ssl, "create_default_context", lambda *a, **k: ctx)
    monkeypatch.setattr(ctx, "load_verify_locations", lambda cafile=None, **k: loaded.append(cafile), raising=False)

    assert _tls.create_default_verify_context() is ctx
    assert len(loaded) == 1


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
