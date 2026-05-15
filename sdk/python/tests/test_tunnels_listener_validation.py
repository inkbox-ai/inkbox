"""Synchronous validation in ``inkbox.tunnels.client._listener.connect``.

`tls_mode` is fixed at identity-create time and no longer a `connect()`
arg, but the `forward_to` URL validator still gates the loopback-only
check. The patched bootstrap raises a sentinel so we can confirm the
URL-validation step let us through.
"""

from __future__ import annotations

import pytest

from inkbox.tunnels.client import _listener
from inkbox.tunnels.client._listener import connect


class _FakeInkbox:
    """Stand-in for the Inkbox client; the bootstrap stub never reads it."""
    _api_key = "ApiKey_test"


class _BootstrapCalled(Exception):
    """Raised by the patched bootstrap to prove we got past validation."""


def _patch_bootstrap_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    def _stub(**_kwargs):
        raise _BootstrapCalled
    monkeypatch.setattr(_listener, "bootstrap", _stub)


def test_forward_to_https_loopback_passes(monkeypatch: pytest.MonkeyPatch):
    """https:// loopback flows through validation cleanly."""
    _patch_bootstrap_raises(monkeypatch)
    with pytest.raises(_BootstrapCalled):
        connect(
            _FakeInkbox(),  # type: ignore[arg-type]
            name="t",
            forward_to="https://127.0.0.1:8443",
        )


def test_forward_to_http_loopback_passes(monkeypatch: pytest.MonkeyPatch):
    """http:// loopback passes synchronous validation."""
    _patch_bootstrap_raises(monkeypatch)
    with pytest.raises(_BootstrapCalled):
        connect(
            _FakeInkbox(),  # type: ignore[arg-type]
            name="t",
            forward_to="http://127.0.0.1:8080",
        )


def test_forward_to_callable_passes(monkeypatch: pytest.MonkeyPatch):
    """An ASGI callable as `forward_to` is accepted (no URL-only guard)."""
    _patch_bootstrap_raises(monkeypatch)

    async def _app(scope, receive, send):  # noqa: ARG001
        return None

    with pytest.raises(_BootstrapCalled):
        connect(
            _FakeInkbox(),  # type: ignore[arg-type]
            name="t",
            forward_to=_app,
        )
