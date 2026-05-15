"""
inkbox/tunnels/resources/tunnels.py

Control-plane reads + update + sign-csr for tunnels. Tunnels are created
and deleted exclusively via identity-create / identity-delete cascades;
there is no standalone create / delete / restore / force-delete /
rotate-secret surface.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.exceptions import InkboxAPIError
from inkbox.tunnels.exceptions import (
    TunnelCSRStateConflict,
    TunnelStateConflict,
    TunnelTLSModeMismatch,
)
from inkbox.tunnels.types import SignedCert, Tunnel

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_BASE = "/tunnels"
_UNSET = object()

# The cert issuance flow runs synchronously inside the request and can
# take up to a few minutes. Bump well above the standard timeout so this
# one call doesn't fail on its own success path.
_SIGN_CSR_TIMEOUT_SECONDS = 180.0

# Bounds for the optional ``pool_size`` kwarg on ``connect()``. Validated
# in the data-plane connect surface, but the constants live here so the
# resource module is the single source of truth.
POOL_SIZE_MIN = 1
POOL_SIZE_MAX = 32


def _detail_text(detail: Any) -> str:
    if isinstance(detail, str):
        return detail
    if isinstance(detail, dict):
        inner = detail.get("detail")
        if isinstance(inner, str):
            return inner
    return str(detail)


def _map_sign_csr_error(err: InkboxAPIError) -> Exception:
    if err.status_code != 409:
        return err
    text = _detail_text(err.detail).lower()
    if "edge" in text or "tls_mode" in text or "passthrough" in text:
        return TunnelTLSModeMismatch(status_code=err.status_code, detail=err.detail)
    return TunnelCSRStateConflict(status_code=err.status_code, detail=err.detail)


class TunnelsResource:
    """Read + edit wrapper for ``/api/v1/tunnels/*`` plus the
    ``connect()`` data-plane entry point. Tunnel lifecycle is owned by
    identity-create / identity-delete; there is no create / delete /
    restore / force-delete / rotate-secret surface here."""

    def __init__(self, http: HttpTransport, *, inkbox: Any | None = None) -> None:
        self._http = http
        self._inkbox = inkbox

    # --- Reads -----------------------------------------------------------

    def list(self) -> list[Tunnel]:
        """List all tunnels for your organisation."""
        data = self._http.get(_BASE + "/")
        if isinstance(data, dict) and "tunnels" in data:
            items = data["tunnels"]
        else:
            items = data
        return [Tunnel._from_dict(t) for t in items]

    def get(self, tunnel_id: UUID | str) -> Tunnel:
        """Fetch a tunnel by id."""
        data = self._http.get(f"{_BASE}/{tunnel_id}")
        return Tunnel._from_dict(data)

    # --- Writes ----------------------------------------------------------

    def update(
        self,
        tunnel_id: UUID | str,
        *,
        metadata: dict[str, Any] | None = _UNSET,  # type: ignore[assignment]
    ) -> Tunnel:
        """Update a tunnel's metadata.

        ``metadata`` is the only mutable field on the tunnel; other
        attributes are derived from the owning identity.

        - ``metadata={}`` and ``metadata=None`` both clear to ``{}``
          (the server's column is non-nullable; both forms collapse on
          the wire).
        """
        body: dict[str, Any] = {}
        if metadata is not _UNSET:
            if metadata is not None and not isinstance(metadata, dict):
                raise ValueError("metadata must be a dict or None")
            body["metadata"] = metadata
        data = self._http.patch(f"{_BASE}/{tunnel_id}", json=body)
        return Tunnel._from_dict(data)

    def sign_csr(
        self,
        tunnel_id: UUID | str,
        *,
        csr_pem: str,
    ) -> SignedCert:
        """Sign a CSR for a passthrough tunnel.

        The server performs DNS validation and cert issuance
        synchronously inside this request, which can take up to a few
        minutes. This call uses an elevated 180-second timeout to
        accommodate that.

        Args:
            tunnel_id: The tunnel's id.
            csr_pem: PEM-encoded CSR. The CN must equal the tunnel hostname.
        """
        try:
            data = self._http.post(
                f"{_BASE}/{tunnel_id}/sign-csr",
                json={"csr_pem": csr_pem},
                timeout=_SIGN_CSR_TIMEOUT_SECONDS,
            )
        except InkboxAPIError as err:
            raise _map_sign_csr_error(err) from err
        return SignedCert._from_dict(data)

    # --- Data plane ------------------------------------------------------

    def connect(self, **kwargs: Any) -> Any:
        """Bring a tunnel online from this process.

        See :func:`inkbox.tunnels.client.connect` for the full kwarg list.
        Lazy-imports the data-plane runtime so non-tunnel users don't
        pay the ``h2`` import cost.
        """
        if self._inkbox is None:
            raise RuntimeError(
                "TunnelsResource.connect requires the Inkbox client; "
                "this should not happen in normal usage",
            )
        from inkbox.tunnels.client import connect as _connect

        return _connect(self._inkbox, **kwargs)


# Reference imports to silence unused-import warnings on the surviving
# exception surface (still exported through the package __init__).
__all__ = [
    "POOL_SIZE_MAX",
    "POOL_SIZE_MIN",
    "TunnelStateConflict",
    "TunnelsResource",
]
