"""
inkbox/tunnels/_validation.py

Local handle and tunnel-name syntax validation.
Availability is checked by the API; unavailable names return HTTP 409.
"""

from __future__ import annotations

import re

from inkbox.tunnels.exceptions import TunnelNameInvalid

_TUNNEL_NAME_MIN_LENGTH = 3
_TUNNEL_NAME_MAX_LENGTH = 63

_TUNNEL_NAME_RE = re.compile(
    r"^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$|^[a-z0-9]$",
)


def normalize_agent_handle(value: str) -> str:
    """Strip a leading ``@`` and lowercase the value. Subsequent
    validation runs against the returned normalized form."""
    if not isinstance(value, str):  # type: ignore[unreachable]
        raise TunnelNameInvalid("agent_handle / tunnel_name must be a string")
    s = value
    if s.startswith("@"):
        s = s[1:]
    return s.lower()


def validate_tunnel_name(name: str) -> str:
    """Validate a tunnel name / agent handle; raises
    :class:`TunnelNameInvalid` on rejection. Returns the normalized
    value (``@`` stripped, lowercased)."""
    normalized = normalize_agent_handle(name)
    if len(normalized) < _TUNNEL_NAME_MIN_LENGTH:
        raise TunnelNameInvalid(
            f"tunnel_name must be at least {_TUNNEL_NAME_MIN_LENGTH} characters",
        )
    if len(normalized) > _TUNNEL_NAME_MAX_LENGTH:
        raise TunnelNameInvalid(
            f"tunnel_name must be at most {_TUNNEL_NAME_MAX_LENGTH} characters",
        )
    if not _TUNNEL_NAME_RE.match(normalized):
        raise TunnelNameInvalid(
            "tunnel_name may only contain lowercase letters, numbers, and "
            "hyphens, must start and end with a letter or number, and must "
            "not contain consecutive hyphens",
        )
    return normalized


# Alias: handle and tunnel-name share a global namespace and the same
# validator. This lets callers spell their intent.
validate_agent_handle = validate_tunnel_name
