"""
inkbox.tunnels — Tunnels SDK surface (read/update + data-plane connect).
"""

from inkbox.tunnels.types import (
    SignedCert,
    TLSMode,
    Tunnel,
    TunnelStatus,
)
from inkbox.tunnels.exceptions import (
    TunnelCSRStateConflict,
    TunnelError,
    TunnelNameInvalid,
    TunnelNotProvisioned,
    TunnelRemoved,
    TunnelStateConflict,
    TunnelTLSModeMismatch,
)
from inkbox.tunnels._validation import (
    normalize_agent_handle,
    validate_agent_handle,
    validate_tunnel_name,
)
from inkbox.tunnels.resources.tunnels import TunnelsResource

__all__ = [
    "SignedCert",
    "TLSMode",
    "Tunnel",
    "TunnelStatus",
    "TunnelsResource",
    "TunnelCSRStateConflict",
    "TunnelError",
    "TunnelNameInvalid",
    "TunnelNotProvisioned",
    "TunnelRemoved",
    "TunnelStateConflict",
    "TunnelTLSModeMismatch",
    "normalize_agent_handle",
    "validate_agent_handle",
    "validate_tunnel_name",
]
