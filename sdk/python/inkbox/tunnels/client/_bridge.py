"""
inkbox/tunnels/client/_bridge.py

Per-bridge runtime state for passthrough TCP streams. The actual pump
loops live in :mod:`_runtime` (they need access to h2 / send_lock /
flow-control), but the dataclasses + close-code mapping live here.
"""

from __future__ import annotations

from dataclasses import dataclass


BRIDGE_STATUS_TIMEOUT_SEC = 10.0
BRIDGE_HALF_CLOSE_GRACE_SEC = 5.0
BRIDGE_CLEANUP_SEND_TIMEOUT_SEC = 1.0
BRIDGE_CLOSE_CODE: dict[str, int] = {
    "clean-eof": 1000,
    "protocol-error": 1002,
    "inbound-error": 1011,
    "outbound-error": 1011,
    "tls-error": 1011,
    "cancelled": 1001,
}


@dataclass(slots=True)
class BridgeStats:
    tcp_id: str
    stream_id: int
    sni_host: str
    inbound_frames: int = 0
    outbound_frames: int = 0
    decrypted_bytes: int = 0
    encrypted_bytes: int = 0
    continuation_frames: int = 0
    tls_handshake_done: bool = False
    close_reason: str = ""


class BridgeProtocolError(RuntimeError):
    """Raised by the inbound pump on a wire-format violation."""


class BridgeOpenFailed(RuntimeError):
    """Raised when CONNECT /_system/tcp/{tcp_id} returns non-200."""


class BridgeStreamReset(RuntimeError):
    """Raised when the inbound pump sees an h2 RST_STREAM event."""
