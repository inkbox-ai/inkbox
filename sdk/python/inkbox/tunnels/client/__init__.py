"""Data-plane runtime for ``inkbox.tunnels.connect()``."""

from inkbox.tunnels.client._listener import TunnelListener, connect

__all__ = ["TunnelListener", "connect"]
