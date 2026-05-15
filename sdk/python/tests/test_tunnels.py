"""Tests for the tunnels SDK surface."""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from inkbox.exceptions import InkboxAPIError
from inkbox.tunnels._validation import (
    normalize_agent_handle,
    validate_agent_handle,
    validate_tunnel_name,
)
from inkbox.tunnels.exceptions import (
    TunnelCSRStateConflict,
    TunnelNameInvalid,
    TunnelTLSModeMismatch,
)
from inkbox.tunnels.resources.tunnels import TunnelsResource
from inkbox.tunnels.types import Tunnel, TunnelStatus


def _server_tunnel(**overrides):
    base = {
        "id": str(uuid4()),
        "organization_id": "org_test",
        "tunnel_name": "my-agent",
        "tls_mode": "edge",
        "cert_pem": None,
        "cert_fingerprint_sha256": None,
        "cert_expires_at": None,
        "status": "active",
        "last_connected_at": None,
        "last_connected_ip_addr": None,
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


# --- Local validation (against the standalone validator) ------------------


def test_validate_rejects_invalid_name():
    with pytest.raises(TunnelNameInvalid):
        validate_tunnel_name("--bad")


def test_validate_rejects_too_short():
    with pytest.raises(TunnelNameInvalid):
        validate_tunnel_name("ab")


def test_validate_rejects_too_long():
    with pytest.raises(TunnelNameInvalid):
        validate_tunnel_name("a" * 64)


def test_validate_rejects_consecutive_hyphens():
    with pytest.raises(TunnelNameInvalid):
        validate_tunnel_name("my--agent")


def test_validate_rejects_reserved_names():
    with pytest.raises(TunnelNameInvalid):
        validate_tunnel_name("admin")
    with pytest.raises(TunnelNameInvalid):
        validate_tunnel_name("openai")


def test_validate_normalizes_at_prefix_and_case():
    assert validate_tunnel_name("@MyAgent") == "myagent"
    assert normalize_agent_handle("@FOO") == "foo"


def test_validate_agent_handle_is_alias_of_tunnel_name():
    assert validate_agent_handle is validate_tunnel_name


# --- Status parsing -------------------------------------------------------


def test_status_deleted_recognised(tunnels, http):
    http.get.return_value = _server_tunnel(status="deleted")
    out = tunnels.get("abc")
    assert out.status == TunnelStatus.DELETED


def test_unknown_status_preserved_as_raw_string(tunnels, http):
    """Server-only states the SDK doesn't know about flow through unchanged."""
    http.get.return_value = _server_tunnel(status="quarantined")
    out = tunnels.get("abc")
    assert out.status == "quarantined"
    assert out.status != TunnelStatus.ACTIVE


def test_metadata_always_dict(tunnels, http):
    http.get.return_value = _server_tunnel(metadata=None)
    out = tunnels.get("abc")
    assert out.metadata == {}


def test_missing_public_host_or_zone_raises(tunnels, http):
    bad = _server_tunnel()
    bad["public_host"] = ""
    http.get.return_value = bad
    with pytest.raises(ValueError, match="public_host"):
        tunnels.get("abc")


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


# --- sign_csr error mapping ----------------------------------------------


def test_sign_csr_409_edge_maps_to_tls_mode_mismatch(tunnels, http):
    http.post.side_effect = InkboxAPIError(
        409, "tunnel is in edge tls_mode; CSR signing is passthrough-only",
    )
    with pytest.raises(TunnelTLSModeMismatch):
        tunnels.sign_csr("abc", csr_pem="pem")


def test_sign_csr_409_state_maps_to_csr_state_conflict(tunnels, http):
    http.post.side_effect = InkboxAPIError(
        409, "tunnel is in unexpected state",
    )
    with pytest.raises(TunnelCSRStateConflict):
        tunnels.sign_csr("abc", csr_pem="pem")


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
