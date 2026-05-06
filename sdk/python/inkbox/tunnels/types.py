"""
inkbox/tunnels/types.py

Resource models for the Tunnels SDK surface.
"""

from __future__ import annotations

from dataclasses import dataclass, field
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
        PENDING_REMOVAL: ``DELETE`` was called; the name is held for 24
            hours during which :meth:`TunnelsResource.restore` brings it
            back. After 24 hours the tunnel is permanently removed and
            its name is released. Past that point a ``GET`` for the
            tunnel id returns 404; :class:`TunnelRemoved` surfaces that
            condition for clients holding stale state.
    """
    AWAITING_CERT = "awaiting_cert"
    ACTIVE = "active"
    PENDING_REMOVAL = "pending_removal"


# Map server-side wire enum values to public SDK labels.
_STATUS_REMAP_TO_PUBLIC = {
    "awaiting_cert": TunnelStatus.AWAITING_CERT,
    "active": TunnelStatus.ACTIVE,
    "delete_pending": TunnelStatus.PENDING_REMOVAL,
}


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
    server-side surface unmodified rather than getting silently coerced
    to ``ACTIVE`` — equality checks against ``TunnelStatus.*`` will
    correctly fail for an unknown value, prompting a SDK update.
    """
    id: UUID
    organization_id: str
    tunnel_name: str
    description: str | None
    tls_mode: TLSMode
    cert_pem: str | None
    cert_fingerprint_sha256: str | None
    cert_expires_at: datetime | None
    status: TunnelStatus | str
    last_connected_at: datetime | None
    last_connected_ip_addr: str | None
    restore_deadline_at: datetime | None
    currently_connected: bool
    public_host: str | None
    zone: str | None
    metadata: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> Tunnel:
        raw_status = str(data["status"])
        status: TunnelStatus | str
        if raw_status in _STATUS_REMAP_TO_PUBLIC:
            status = _STATUS_REMAP_TO_PUBLIC[raw_status]
        else:
            try:
                status = TunnelStatus(raw_status)
            except ValueError:
                # Unknown future status — preserve the raw string so the
                # caller can decide what to do. Comparisons against any
                # known TunnelStatus member will correctly fail.
                status = raw_status
        raw_metadata = data.get("metadata")
        metadata = dict(raw_metadata) if isinstance(raw_metadata, dict) else {}
        return cls(
            id=UUID(str(data["id"])),
            organization_id=str(data["organization_id"]),
            tunnel_name=str(data["tunnel_name"]),
            description=data.get("description"),
            tls_mode=TLSMode(str(data["tls_mode"])),
            cert_pem=data.get("cert_pem"),
            cert_fingerprint_sha256=data.get("cert_fingerprint_sha256"),
            cert_expires_at=_parse_dt(data.get("cert_expires_at")),
            status=status,
            last_connected_at=_parse_dt(data.get("last_connected_at")),
            last_connected_ip_addr=data.get("last_connected_ip_addr"),
            restore_deadline_at=_parse_dt(data.get("restore_deadline_at")),
            currently_connected=bool(data.get("currently_connected", False)),
            public_host=data.get("public_host"),
            zone=data.get("zone"),
            metadata=metadata,
            created_at=_parse_dt(data["created_at"]),  # type: ignore[arg-type]
            updated_at=_parse_dt(data["updated_at"]),  # type: ignore[arg-type]
        )


@dataclass(frozen=True)
class CreatedTunnel:
    """Result of :meth:`TunnelsResource.create`.

    The ``connect_secret`` is shown ONCE — persist it immediately.
    """
    tunnel: Tunnel
    connect_secret: str

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> CreatedTunnel:
        return cls(
            tunnel=Tunnel._from_dict(data["tunnel"]),
            connect_secret=str(data["connect_secret"]),
        )


@dataclass(frozen=True)
class RotatedSecret:
    """Result of :meth:`TunnelsResource.rotate_secret`.

    The new secret takes effect on the next agent reconnect. Existing
    live connections continue serving traffic with the old secret until
    they reconnect.
    """
    connect_secret: str

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> RotatedSecret:
        return cls(connect_secret=str(data["connect_secret"]))


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


# Convenience: empty metadata sentinel for type-checked equality without
# allocating per-call.
_EMPTY_METADATA: dict[str, Any] = field(default_factory=dict)  # noqa: F841 (typing aid)
