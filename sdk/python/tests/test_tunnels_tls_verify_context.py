"""create_default_verify_context() with contexts that cannot report store stats."""

from __future__ import annotations

import ssl

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
