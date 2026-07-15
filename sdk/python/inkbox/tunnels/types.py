"""
inkbox/tunnels/types.py

Resource models for the Tunnels SDK surface.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID


class TLSMode(StrEnum):
    """How TLS termination is performed for inbound third-party traffic.

    Attributes:
        EDGE: TLS terminates at Inkbox's edge using a managed cert; the
            agent forwards plaintext to your local handler. Default.
        PASSTHROUGH: You hold the cert + private key and terminate TLS in
            your own client. Obtain a per-tunnel cert via
            :meth:`TunnelsResource.sign_csr`.
    """
    EDGE = "edge"
    PASSTHROUGH = "passthrough"


class TunnelStatus(StrEnum):
    """Lifecycle state of a tunnel.

    Attributes:
        AWAITING_CERT: Passthrough-only intermediate state — the tunnel
            exists but no cert has been signed yet. Inbound TLS handshakes
            will fail until you call :meth:`TunnelsResource.sign_csr`.
        ACTIVE: Routable end-to-end.
        DELETED: Terminal. The tunnel is offline. Tunnels are deleted
            exclusively via the identity-delete cascade — there is no
            direct tunnel-delete surface.
    """
    AWAITING_CERT = "awaiting_cert"
    ACTIVE = "active"
    DELETED = "deleted"


def _parse_dt(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    s = str(v).replace("Z", "+00:00")
    return datetime.fromisoformat(s)


@dataclass(frozen=True)
class Tunnel:
    """Public view of a tunnel record.

    ``status`` is a :class:`TunnelStatus` for any value the SDK knows
    about, otherwise the raw server string. New lifecycle states added
    server-side surface unmodified rather than getting silently coerced —
    equality checks against ``TunnelStatus.*`` will correctly fail for
    an unknown value, prompting a SDK update.

    ``public_host`` and ``zone`` are guaranteed non-empty for live
    tunnels; parser raises ``ValueError`` on missing values.
    """
    id: UUID
    organization_id: str
    tunnel_name: str
    agent_identity_id: UUID | None
    tls_mode: TLSMode
    cert_pem: str | None
    cert_fingerprint_sha256: str | None
    cert_expires_at: datetime | None
    status: TunnelStatus | str
    last_connected_at: datetime | None
    last_connected_ip_addr: str | None
    currently_connected: bool
    public_host: str
    zone: str
    metadata: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> Tunnel:
        raw_status = str(data["status"])
        status: TunnelStatus | str
        try:
            status = TunnelStatus(raw_status)
        except ValueError:
            # Unknown future status — preserve the raw string so the
            # caller can decide what to do. Comparisons against any
            # known TunnelStatus member will correctly fail.
            status = raw_status
        raw_metadata = data.get("metadata")
        metadata = dict(raw_metadata) if isinstance(raw_metadata, dict) else {}
        public_host = data.get("public_host")
        zone = data.get("zone")
        if not isinstance(public_host, str) or not public_host:
            raise ValueError("tunnel response missing required field 'public_host'")
        if not isinstance(zone, str) or not zone:
            raise ValueError("tunnel response missing required field 'zone'")
        raw_identity_id = data.get("agent_identity_id")
        return cls(
            id=UUID(str(data["id"])),
            organization_id=str(data["organization_id"]),
            tunnel_name=str(data["tunnel_name"]),
            agent_identity_id=UUID(str(raw_identity_id)) if raw_identity_id else None,
            tls_mode=TLSMode(str(data["tls_mode"])),
            cert_pem=data.get("cert_pem"),
            cert_fingerprint_sha256=data.get("cert_fingerprint_sha256"),
            cert_expires_at=_parse_dt(data.get("cert_expires_at")),
            status=status,
            last_connected_at=_parse_dt(data.get("last_connected_at")),
            last_connected_ip_addr=data.get("last_connected_ip_addr"),
            currently_connected=bool(data.get("currently_connected", False)),
            public_host=public_host,
            zone=zone,
            metadata=metadata,
            created_at=_parse_dt(data["created_at"]),  # type: ignore[arg-type]
            updated_at=_parse_dt(data["updated_at"]),  # type: ignore[arg-type]
        )


@dataclass(frozen=True)
class TunnelSummary:
    """Durable-config projection of a tunnel, embedded in identity payloads.

    Carries the routing and lifecycle facts identity views need, plus the
    ids to reach the full tunnel. Excludes runtime state
    (``currently_connected``) and cert material — fetch the full
    :class:`Tunnel` via :meth:`TunnelsResource.get` for those; the tunnels
    endpoints always resolve connection state live.

    ``status`` follows the same unknown-value contract as :class:`Tunnel`:
    a :class:`TunnelStatus` when recognized, otherwise the raw string.
    """
    id: UUID
    tunnel_name: str
    agent_identity_id: UUID | None
    tls_mode: TLSMode
    status: TunnelStatus | str
    public_host: str
    zone: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> TunnelSummary:
        raw_status = str(data["status"])
        status: TunnelStatus | str
        try:
            status = TunnelStatus(raw_status)
        except ValueError:
            status = raw_status
        raw_identity_id = data.get("agent_identity_id")
        public_host = data.get("public_host")
        zone = data.get("zone")
        if not isinstance(public_host, str) or not public_host:
            raise ValueError("tunnel summary missing required field 'public_host'")
        if not isinstance(zone, str) or not zone:
            raise ValueError("tunnel summary missing required field 'zone'")
        return cls(
            id=UUID(str(data["id"])),
            tunnel_name=str(data["tunnel_name"]),
            agent_identity_id=UUID(str(raw_identity_id)) if raw_identity_id else None,
            tls_mode=TLSMode(str(data["tls_mode"])),
            status=status,
            public_host=public_host,
            zone=zone,
            created_at=_parse_dt(data["created_at"]),  # type: ignore[arg-type]
            updated_at=_parse_dt(data["updated_at"]),  # type: ignore[arg-type]
        )


@dataclass(frozen=True)
class SignedCert:
    """Result of :meth:`TunnelsResource.sign_csr` (passthrough only)."""
    cert_pem: str
    chain_pem: str
    cert_fingerprint_sha256: str
    cert_expires_at: datetime

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> SignedCert:
        return cls(
            cert_pem=str(data["cert_pem"]),
            chain_pem=str(data["chain_pem"]),
            cert_fingerprint_sha256=str(data["cert_fingerprint_sha256"]),
            cert_expires_at=_parse_dt(data["cert_expires_at"]),  # type: ignore[arg-type]
        )
