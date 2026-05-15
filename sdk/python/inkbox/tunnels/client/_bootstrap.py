"""
inkbox/tunnels/client/_bootstrap.py

Pre-runtime orchestration: state-file lookup, server lookup, optional
CSR + sign for passthrough. Returns a fully-resolved bundle the runtime
can connect with.

Tunnels are provisioned atomically by ``inkbox.create_identity(...)``;
``connect`` is read-only on the control plane (with the exception of
passthrough CSR signing). Data-plane authentication uses the client's
API key — no per-tunnel secret is involved.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence
from uuid import UUID

from inkbox.exceptions import InkboxAPIError
from inkbox.tunnels._validation import validate_tunnel_name
from inkbox.tunnels.client._cert import (
    build_csr,
    cert_needs_sign,
    key_pem_bytes,
    load_or_create_keypair,
    write_cert_chain,
)
from inkbox.tunnels.client._state import (
    CERT_FILE,
    StateEntry,
    ensure_private_state_dir,
    load_state,
    save_state,
)
from inkbox.tunnels.client._tls import TLSTerminator
from inkbox.tunnels.exceptions import (
    TunnelNotProvisioned,
    TunnelRemoved,
    TunnelStateConflict,
)
from inkbox.tunnels.resources.tunnels import POOL_SIZE_MAX, POOL_SIZE_MIN
from inkbox.tunnels.types import TLSMode, Tunnel, TunnelStatus

logger = logging.getLogger("inkbox.tunnels")


# Default tunnel zone — used as a fallback when neither the server
# response nor the state file specifies one.
PROD_ZONE = "inkboxwire.com"


@dataclass
class TunnelBundle:
    tunnel: Tunnel
    public_host: str
    zone: str
    tls_terminator: TLSTerminator | None


def _status_repr(status: TunnelStatus | str) -> str:
    """Stringify a status that may be either an enum or a raw server string."""
    if isinstance(status, TunnelStatus):
        return status.value
    return str(status)


def validate_pool_size(pool_size: int | None) -> None:
    if pool_size is None:
        return
    if not isinstance(pool_size, int) or pool_size < POOL_SIZE_MIN:
        raise ValueError(
            f"pool_size must be an int >= {POOL_SIZE_MIN} (got {pool_size!r})",
        )
    if pool_size > POOL_SIZE_MAX:
        raise ValueError(
            f"pool_size must be <= {POOL_SIZE_MAX} (got {pool_size!r})",
        )


def resolve_zone_and_host(
    *,
    name: str,
    server_zone: str | None,
    server_public_host: str | None,
    state: StateEntry | None,
    data_plane_zone_override: str | None,
) -> tuple[str, str]:
    """Pick the zone + public host using the documented precedence.

    ``data_plane_zone_override`` only overrides the zone (data-plane h2
    endpoint). ``public_host`` always comes from server > state >
    prod-zone fallback.
    """
    if server_public_host:
        public_host = server_public_host
    elif state and state.public_host:
        public_host = state.public_host
    else:
        public_host = f"{name}.{PROD_ZONE}"

    if data_plane_zone_override:
        zone = data_plane_zone_override
    elif server_zone:
        zone = server_zone
    elif state and state.zone:
        zone = state.zone
    else:
        zone = PROD_ZONE
    return zone, public_host


def bootstrap(
    *,
    inkbox: object,  # Inkbox instance; circular-import-friendly typing
    name: str,
    state_dir: Path,
    data_plane_zone_override: str | None,
    alpn_protocols: Sequence[str] = ("http/1.1",),
) -> TunnelBundle:
    """Resolve a tunnel for ``connect()``: server lookup + cert dance for
    passthrough."""
    validate_tunnel_name(name)

    state_dir = Path(state_dir).expanduser()
    ensure_private_state_dir(state_dir)
    state = load_state(state_dir)

    tunnels = inkbox.tunnels  # type: ignore[attr-defined]

    tunnel: Tunnel | None = None
    state_tunnel_id: UUID | None = None
    if state and state.tunnel_id:
        try:
            state_tunnel_id = UUID(state.tunnel_id)
        except ValueError:
            state_tunnel_id = None

    if state_tunnel_id is not None:
        try:
            tunnel = tunnels.get(state_tunnel_id)
        except InkboxAPIError as err:
            if err.status_code == 404:
                raise TunnelRemoved(
                    f"tunnel {name!r} (id={state_tunnel_id}) has been removed; "
                    f"clear {state_dir} and call inkbox.create_identity({name!r}) "
                    "to start fresh",
                ) from err
            raise

    if tunnel is None:
        # Look up by name (the server lists only live tunnels).
        for t in tunnels.list():
            if t.tunnel_name == name:
                tunnel = t
                break

    if tunnel is None:
        raise TunnelNotProvisioned(
            f"no tunnel named {name!r} exists in this org. "
            "Tunnels are provisioned atomically by "
            f"inkbox.create_identity({name!r}); call that first."
        )

    # Edge tunnels must be ACTIVE before we open the data plane.
    # Passthrough has its own AWAITING_CERT branch below.
    if (
        tunnel.tls_mode == TLSMode.EDGE
        and tunnel.status != TunnelStatus.ACTIVE
    ):
        raise TunnelStateConflict(
            status_code=409,
            detail=(
                f"tunnel {name!r} is in status {_status_repr(tunnel.status)}; "
                "expected active before opening the data plane"
            ),
        )

    # Cert dance for passthrough.
    terminator: TLSTerminator | None = None
    if tunnel.tls_mode == TLSMode.PASSTHROUGH:
        zone, public_host = resolve_zone_and_host(
            name=name,
            server_zone=tunnel.zone,
            server_public_host=tunnel.public_host,
            state=state,
            data_plane_zone_override=data_plane_zone_override,
        )
        key = load_or_create_keypair(state_dir)
        if (
            tunnel.status == TunnelStatus.AWAITING_CERT
            or cert_needs_sign(state_dir, key)
        ):
            csr_pem = build_csr(key, public_host)
            logger.info("POST /tunnels/%s/sign-csr", tunnel.id)
            signed = tunnels.sign_csr(tunnel.id, csr_pem=csr_pem)
            chain_bytes = write_cert_chain(
                state_dir, signed.cert_pem, signed.chain_pem,
            )
            # Refresh tunnel record to pick up the new active status.
            tunnel = tunnels.get(tunnel.id)
        else:
            chain_bytes = (state_dir / CERT_FILE).read_bytes()

        if tunnel.status != TunnelStatus.ACTIVE:
            raise TunnelStateConflict(
                status_code=409,
                detail=(
                    f"tunnel {name!r} is in status {_status_repr(tunnel.status)}; "
                    "expected active after CSR sign"
                ),
            )

        terminator = TLSTerminator(
            cert_chain_pem=chain_bytes,
            key_pem=key_pem_bytes(key),
            alpn_protocols=alpn_protocols,
        )

    zone, public_host = resolve_zone_and_host(
        name=name,
        server_zone=tunnel.zone,
        server_public_host=tunnel.public_host,
        state=state,
        data_plane_zone_override=data_plane_zone_override,
    )

    # Persist final state (zone/public_host learned from server).
    save_state(state_dir, StateEntry(
        tunnel_id=str(tunnel.id),
        name=name,
        mode=tunnel.tls_mode.value,
        zone=zone,
        public_host=public_host,
    ))

    return TunnelBundle(
        tunnel=tunnel,
        public_host=public_host,
        zone=zone,
        tls_terminator=terminator,
    )
