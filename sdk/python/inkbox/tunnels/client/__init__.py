"""
inkbox.tunnels.client — Data-plane runtime for ``inkbox.tunnels.connect()``.

POSIX-only. Importing on Windows is fine, but ``connect()`` raises
:class:`NotImplementedError` there.
"""

from __future__ import annotations

import sys

from inkbox.tunnels.client._listener import TunnelListener, connect

__all__ = ["TunnelListener", "connect"]


def _check_posix() -> None:
    """Hook used by :func:`inkbox.tunnels.connect` to gate platform support."""
    if sys.platform.startswith("win"):
        raise NotImplementedError(
            "inkbox.tunnels.connect requires a POSIX platform; CRUD "
            "operations are supported on Windows",
        )
