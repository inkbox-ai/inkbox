"""Tests for the tunnels SDK surface."""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from inkbox.exceptions import InkboxAPIError
from inkbox.tunnels.exceptions import (
    TunnelCSRStateConflict,
    TunnelNameInvalid,
    TunnelNameUnavailable,
    TunnelStateConflict,
    TunnelTLSModeMismatch,
)
from inkbox.tunnels.resources.tunnels import TunnelsResource
from inkbox.tunnels.types import TLSMode, Tunnel, TunnelStatus


def _server_tunnel(**overrides):
    base = {
        "id": str(uuid4()),
        "organization_id": "org_test",
        "tunnel_name": "my-agent",
        "description": None,
        "tls_mode": "edge",
        "cert_pem": None,
        "cert_fingerprint_sha256": None,
        "cert_expires_at": None,
        "status": "active",
        "last_connected_at": None,
        "last_connected_ip_addr": None,
        "restore_deadline_at": None,
        "currently_connected": False,
        "public_host": "my-agent.inkboxwire.com",
        "zone": "inkboxwire.com",
        "metadata": {"team": "platform"},
        "created_at": "2025-01-01T00:00:00+00:00",
        "updated_at": "2025-01-01T00:00:00+00:00",
    }
    base.update(overrides)
    return base


@pytest.fixture
def http():
    h = MagicMock()
    return h


@pytest.fixture
def tunnels(http):
    return TunnelsResource(http)


# --- Local validation -----------------------------------------------------


def test_create_rejects_invalid_name_locally(tunnels, http):
    with pytest.raises(TunnelNameInvalid):
        tunnels.create(tunnel_name="--bad")
    http.post.assert_not_called()


def test_create_rejects_too_short_name(tunnels):
    with pytest.raises(TunnelNameInvalid):
        tunnels.create(tunnel_name="ab")


def test_create_rejects_too_long_name(tunnels):
    with pytest.raises(TunnelNameInvalid):
        tunnels.create(tunnel_name="a" * 64)


def test_create_rejects_consecutive_hyphens(tunnels):
    with pytest.raises(TunnelNameInvalid):
        tunnels.create(tunnel_name="my--agent")


def test_create_rejects_uppercase(tunnels):
    with pytest.raises(TunnelNameInvalid):
        tunnels.create(tunnel_name="MyAgent")


# --- Status remap ---------------------------------------------------------


def test_status_remap_pending_removal(tunnels, http):
    http.get.return_value = _server_tunnel(status="delete_pending")
    out = tunnels.get("abc")
    assert out.status == TunnelStatus.PENDING_REMOVAL


def test_unknown_status_preserved_as_raw_string(tunnels, http):
    """Statuses the SDK doesn't know about (server-only states) flow through unchanged.

    The server filters finalized tunnels out of normal access, so the
    SDK can't observe ``deleted`` directly via GET in practice — but if
    a future server-side state appears, the SDK preserves the raw value
    rather than coercing it to ACTIVE.
    """
    http.get.return_value = _server_tunnel(status="deleted")
    out = tunnels.get("abc")
    assert out.status == "deleted"
    # Equality against any known TunnelStatus member must fail so users
    # don't silently treat the unknown state as active.
    assert out.status != TunnelStatus.ACTIVE
    assert out.status != TunnelStatus.PENDING_REMOVAL


def test_metadata_always_dict(tunnels, http):
    http.get.return_value = _server_tunnel(metadata=None)
    out = tunnels.get("abc")
    assert out.metadata == {}


# --- list() unwraps {"tunnels": [...]} envelope ---------------------------


def test_list_unwraps_envelope(tunnels, http):
    http.get.return_value = {"tunnels": [_server_tunnel()]}
    out = tunnels.list()
    assert len(out) == 1
    assert isinstance(out[0], Tunnel)


def test_list_handles_bare_list(tunnels, http):
    http.get.return_value = [_server_tunnel()]
    out = tunnels.list()
    assert len(out) == 1


# --- Update semantics -----------------------------------------------------


def test_update_omitted_skips_field(tunnels, http):
    http.patch.return_value = _server_tunnel()
    tunnels.update("abc")
    body = http.patch.call_args.kwargs["json"]
    assert body == {}


def test_update_explicit_none_clears_description(tunnels, http):
    http.patch.return_value = _server_tunnel()
    tunnels.update("abc", description=None)
    body = http.patch.call_args.kwargs["json"]
    assert body == {"description": None}


def test_update_metadata_set(tunnels, http):
    http.patch.return_value = _server_tunnel()
    tunnels.update("abc", metadata={"k": "v"})
    body = http.patch.call_args.kwargs["json"]
    assert body == {"metadata": {"k": "v"}}


def test_update_metadata_empty_clears(tunnels, http):
    http.patch.return_value = _server_tunnel()
    tunnels.update("abc", metadata={})
    body = http.patch.call_args.kwargs["json"]
    assert body == {"metadata": {}}


def test_update_metadata_none_passes_through(tunnels, http):
    """metadata=None is sent verbatim; the server collapses it to {}."""
    http.patch.return_value = _server_tunnel()
    tunnels.update("abc", metadata=None)
    body = http.patch.call_args.kwargs["json"]
    assert body == {"metadata": None}


def test_update_metadata_invalid_type_rejected(tunnels, http):
    """Non-dict, non-None metadata is rejected client-side."""
    with pytest.raises(ValueError):
        tunnels.update("abc", metadata=[1, 2, 3])  # type: ignore[arg-type]
    http.patch.assert_not_called()


# --- Error mapping --------------------------------------------------------


def test_create_409_maps_to_name_unavailable(tunnels, http):
    http.post.side_effect = InkboxAPIError(409, "tunnel_name already taken")
    with pytest.raises(TunnelNameUnavailable):
        tunnels.create(tunnel_name="my-agent")


def test_restore_409_maps_to_state_conflict(tunnels, http):
    http.post.side_effect = InkboxAPIError(
        409, "tunnel is not in delete_pending state",
    )
    with pytest.raises(TunnelStateConflict) as ei:
        tunnels.restore("abc")
    # Sanitization: server detail mentioning delete_pending should be remapped
    assert "pending_removal" in str(ei.value.detail)
    assert "delete_pending" not in str(ei.value.detail)


def test_force_delete_409_maps_to_state_conflict(tunnels, http):
    http.delete_with_response.side_effect = InkboxAPIError(409, "wrong state")
    with pytest.raises(TunnelStateConflict):
        tunnels.force_delete("abc")


def test_sign_csr_409_edge_maps_to_tls_mode_mismatch(tunnels, http):
    http.post.side_effect = InkboxAPIError(
        409, "tunnel is in edge tls_mode; CSR signing is passthrough-only",
    )
    with pytest.raises(TunnelTLSModeMismatch):
        tunnels.sign_csr("abc", csr_pem="pem")


def test_sign_csr_409_state_maps_to_csr_state_conflict(tunnels, http):
    http.post.side_effect = InkboxAPIError(
        409, "tunnel is in delete_pending state",
    )
    with pytest.raises(TunnelCSRStateConflict):
        tunnels.sign_csr("abc", csr_pem="pem")


# --- delete_with_response wiring -----------------------------------------


def test_delete_uses_delete_with_response(tunnels, http):
    http.delete_with_response.return_value = _server_tunnel(status="delete_pending")
    out = tunnels.delete("abc")
    assert out.status == TunnelStatus.PENDING_REMOVAL
    http.delete_with_response.assert_called_once()


# --- sign_csr passes elevated timeout -------------------------------------


def test_sign_csr_passes_180s_timeout(tunnels, http):
    http.post.return_value = {
        "cert_pem": "pem",
        "chain_pem": "chain",
        "cert_fingerprint_sha256": "abc",
        "cert_expires_at": "2026-01-01T00:00:00+00:00",
    }
    tunnels.sign_csr("abc", csr_pem="csr")
    timeout = http.post.call_args.kwargs.get("timeout")
    assert timeout == 180.0
