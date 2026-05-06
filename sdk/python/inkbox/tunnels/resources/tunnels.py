"""
inkbox/tunnels/resources/tunnels.py

Control-plane CRUD for tunnels. Wraps ``/api/v1/tunnels/*``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.exceptions import InkboxAPIError
from inkbox.tunnels._validation import validate_tunnel_name
from inkbox.tunnels.exceptions import (
    TunnelCSRStateConflict,
    TunnelNameUnavailable,
    TunnelStateConflict,
    TunnelTLSModeMismatch,
)
from inkbox.tunnels.types import (
    CreatedTunnel,
    RotatedSecret,
    SignedCert,
    TLSMode,
    Tunnel,
)

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
        # The server's tunnel routes still emit string ``detail`` for 409s,
        # but tolerate dicts with a ``detail`` key just in case.
        inner = detail.get("detail")
        if isinstance(inner, str):
            return inner
    return str(detail)


def _map_create_error(err: InkboxAPIError) -> Exception:
    if err.status_code == 409:
        return TunnelNameUnavailable(status_code=err.status_code, detail=err.detail)
    return err


def _map_state_error(err: InkboxAPIError) -> Exception:
    if err.status_code == 409:
        return TunnelStateConflict(status_code=err.status_code, detail=err.detail)
    return err


def _map_sign_csr_error(err: InkboxAPIError) -> Exception:
    if err.status_code != 409:
        return err
    text = _detail_text(err.detail).lower()
    # Server emits two distinct 409s: TLS-mode mismatch (edge tunnel) vs.
    # state conflict (e.g. tunnel already in pending_removal).
    if "edge" in text or "tls_mode" in text or "passthrough" in text:
        return TunnelTLSModeMismatch(status_code=err.status_code, detail=err.detail)
    return TunnelCSRStateConflict(status_code=err.status_code, detail=err.detail)


class TunnelsResource:
    """CRUD wrapper for ``/api/v1/tunnels/*`` plus the ``connect()`` data-plane entry point."""

    def __init__(self, http: HttpTransport, *, inkbox: Any | None = None) -> None:
        self._http = http
        # Reference back to the Inkbox client. Set by Inkbox.__init__
        # after construction so connect() can call out to the full SDK
        # surface (e.g. signing CSRs via the resource-level wrappers
        # rather than re-implementing them).
        self._inkbox = inkbox

    # --- Reads -----------------------------------------------------------

    def list(self) -> list[Tunnel]:
        """List all tunnels for your organisation."""
        data = self._http.get(_BASE + "/")
        # Server returns ``{"tunnels": [...]}``.
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

    def create(
        self,
        *,
        tunnel_name: str,
        tls_mode: TLSMode | str = TLSMode.EDGE,
        description: str | None = None,
    ) -> CreatedTunnel:
        """Create a new tunnel.

        Args:
            tunnel_name: Customer-chosen subdomain label. Must be 3-63 chars,
                lowercase a-z / 0-9 / hyphens, start and end with an
                alphanumeric, no consecutive hyphens.
            tls_mode: ``"edge"`` (default — Inkbox terminates TLS) or
                ``"passthrough"`` (you terminate TLS in your own client).
                Fixed at creation; cannot be changed later.
            description: Free-form description, visible only to your org.

        Returns:
            A :class:`CreatedTunnel` carrying the parsed ``tunnel`` and the
            one-shot ``connect_secret``. **Persist the secret immediately;
            the server stores only a hash and cannot recover it.**

        Raises:
            TunnelNameInvalid: Local validation failed (regex/length).
            TunnelNameUnavailable: 409 — name is taken or reserved.
        """
        validate_tunnel_name(tunnel_name)
        body: dict[str, Any] = {
            "tunnel_name": tunnel_name,
            "tls_mode": tls_mode.value if isinstance(tls_mode, TLSMode) else tls_mode,
        }
        if description is not None:
            body["description"] = description
        try:
            data = self._http.post(_BASE + "/", json=body)
        except InkboxAPIError as err:
            raise _map_create_error(err) from err
        return CreatedTunnel._from_dict(data)

    def update(
        self,
        tunnel_id: UUID | str,
        *,
        description: str | None = _UNSET,  # type: ignore[assignment]
        metadata: dict[str, Any] | None = _UNSET,  # type: ignore[assignment]
    ) -> Tunnel:
        """Update a tunnel.

        Pass only the fields you want to change; omitted fields are left
        as-is.

        - ``description=None`` clears the description.
        - ``metadata={}`` and ``metadata=None`` both clear to ``{}``
          (the server's column is non-nullable; both forms collapse on
          the wire).
        """
        body: dict[str, Any] = {}
        if description is not _UNSET:
            body["description"] = description
        if metadata is not _UNSET:
            if metadata is not None and not isinstance(metadata, dict):
                raise ValueError("metadata must be a dict or None")
            body["metadata"] = metadata
        data = self._http.patch(f"{_BASE}/{tunnel_id}", json=body)
        return Tunnel._from_dict(data)

    def delete(self, tunnel_id: UUID | str) -> Tunnel:
        """Schedule a tunnel for removal.

        The name is held for 24 hours, during which :meth:`restore` brings
        it back online. After 24 hours the tunnel is removed and the name
        is released.
        """
        data = self._http.delete_with_response(f"{_BASE}/{tunnel_id}")
        return Tunnel._from_dict(data)

    def restore(self, tunnel_id: UUID | str) -> Tunnel:
        """Bring a scheduled-for-removal tunnel back online."""
        try:
            data = self._http.post(f"{_BASE}/{tunnel_id}/restore")
        except InkboxAPIError as err:
            raise _map_state_error(err) from err
        return Tunnel._from_dict(data)

    def force_delete(self, tunnel_id: UUID | str) -> Tunnel:
        """Remove a scheduled-for-removal tunnel immediately, skipping the 24-hour window.

        Requires an admin-scoped API key.
        """
        try:
            data = self._http.delete_with_response(f"{_BASE}/{tunnel_id}/force")
        except InkboxAPIError as err:
            raise _map_state_error(err) from err
        return Tunnel._from_dict(data)

    def rotate_secret(self, tunnel_id: UUID | str) -> RotatedSecret:
        """Rotate the per-tunnel connect secret.

        The new secret takes effect on the next agent reconnect (idle drop,
        deploy roll, network blip). Existing live connections continue
        serving traffic with the old secret until they reconnect.
        """
        data = self._http.post(f"{_BASE}/{tunnel_id}/rotate-secret")
        return RotatedSecret._from_dict(data)

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
