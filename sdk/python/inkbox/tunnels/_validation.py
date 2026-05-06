"""
inkbox/tunnels/_validation.py

Local tunnel-name validation. Mirrors the server-side rules so we can
fast-fail syntactically-bad names locally — the server enforces a daily
create-rate limit, so a name a local regex would have caught shouldn't
consume one of the day's slots.
"""

from __future__ import annotations

import re

from inkbox.tunnels.exceptions import TunnelNameInvalid

_TUNNEL_NAME_MIN_LENGTH = 3
_TUNNEL_NAME_MAX_LENGTH = 63

_TUNNEL_NAME_RE = re.compile(
    r"^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$|^[a-z0-9]$",
)


def validate_tunnel_name(name: str) -> str:
    """Validate a tunnel name; raises :class:`TunnelNameInvalid` on rejection."""
    if not isinstance(name, str):  # type: ignore[unreachable]
        raise TunnelNameInvalid("tunnel_name must be a string")
    if len(name) < _TUNNEL_NAME_MIN_LENGTH:
        raise TunnelNameInvalid(
            f"tunnel_name must be at least {_TUNNEL_NAME_MIN_LENGTH} characters",
        )
    if len(name) > _TUNNEL_NAME_MAX_LENGTH:
        raise TunnelNameInvalid(
            f"tunnel_name must be at most {_TUNNEL_NAME_MAX_LENGTH} characters",
        )
    if not _TUNNEL_NAME_RE.match(name):
        raise TunnelNameInvalid(
            "tunnel_name may only contain lowercase letters, numbers, and "
            "hyphens, must start and end with a letter or number, and must "
            "not contain consecutive hyphens",
        )
    return name
