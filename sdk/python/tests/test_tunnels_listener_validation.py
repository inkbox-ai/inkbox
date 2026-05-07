"""Synchronous validation in ``inkbox.tunnels.client._listener.connect``.

The passthrough-only ``https://`` rejection lives at the listener entry
point and must not change the shared ``validate_forward_target``
behavior — edge URL forwarding to ``https://`` upstreams still works.
"""

from __future__ import annotations

import pytest

from inkbox.tunnels.client import _listener
from inkbox.tunnels.client._listener import connect
from inkbox.tunnels.types import TLSMode


_INKBOX_SENTINEL = object()


class _BootstrapCalled(Exception):
    """Raised by the patched bootstrap to prove we got past validation."""


def _patch_bootstrap_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    def _stub(**_kwargs):
        raise _BootstrapCalled
    monkeypatch.setattr(_listener, "bootstrap", _stub)


def test_passthrough_accepts_https_forward_to(monkeypatch: pytest.MonkeyPatch):
    """Passthrough + https:// flows through validation cleanly."""
    _patch_bootstrap_raises(monkeypatch)
    # Validation passes; the patched bootstrap raises our sentinel.
    with pytest.raises(_BootstrapCalled):
        connect(
            _INKBOX_SENTINEL,  # type: ignore[arg-type]
            name="t",
            forward_to="https://127.0.0.1:8443",
            tls_mode=TLSMode.PASSTHROUGH,
        )


def test_passthrough_accepts_http_forward_to(monkeypatch: pytest.MonkeyPatch):
    """Passthrough + http:// must pass synchronous validation cleanly."""
    _patch_bootstrap_raises(monkeypatch)
    with pytest.raises(_BootstrapCalled):
        connect(
            _INKBOX_SENTINEL,  # type: ignore[arg-type]
            name="t",
            forward_to="http://127.0.0.1:8080",
            tls_mode=TLSMode.PASSTHROUGH,
        )


def test_edge_https_forward_to_still_works(monkeypatch: pytest.MonkeyPatch):
    """Edge mode + https:// must NOT trip the passthrough-only rejection."""
    _patch_bootstrap_raises(monkeypatch)
    # If validation lets us through, the patched bootstrap raises our
    # sentinel — proving no inline rejection fired.
    with pytest.raises(_BootstrapCalled):
        connect(
            _INKBOX_SENTINEL,  # type: ignore[arg-type]
            name="t",
            forward_to="https://127.0.0.1:8443",
            tls_mode=TLSMode.EDGE,
        )


def test_passthrough_accepts_callable_forward_to(monkeypatch: pytest.MonkeyPatch):
    """Passthrough + callable is accepted (no URL-only guard)."""
    _patch_bootstrap_raises(monkeypatch)

    async def _app(scope, receive, send):  # noqa: ARG001
        return None

    with pytest.raises(_BootstrapCalled):
        connect(
            _INKBOX_SENTINEL,  # type: ignore[arg-type]
            name="t",
            forward_to=_app,
            tls_mode=TLSMode.PASSTHROUGH,
        )
