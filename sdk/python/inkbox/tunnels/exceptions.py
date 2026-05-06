"""
inkbox/tunnels/exceptions.py

Typed exceptions for the Tunnels SDK surface.
"""

from __future__ import annotations

from typing import Any

from inkbox.exceptions import InkboxAPIError, InkboxError


class TunnelError(InkboxError):
    """Base for all tunnel-related SDK errors that aren't wire errors."""


class TunnelNameInvalid(TunnelError):
    """Local validation: ``tunnel_name`` failed the SDK's regex/length check.

    Distinct from :class:`TunnelNameUnavailable` (server-side conflict);
    this is a fast-fail before the request is sent so we don't burn a
    daily create-rate-limit slot on an obviously-bad name.
    """


class TunnelStateConflict(InkboxAPIError):
    """409 from operations that require a specific tunnel status.

    For example, calling :meth:`TunnelsResource.restore` on a tunnel that
    is not ``pending_removal``.
    """

    def __init__(self, status_code: int, detail: str | dict[str, Any]) -> None:
        # Normalize non-public lifecycle strings in the server-side detail.
        sanitized = _sanitize_detail(detail)
        super().__init__(status_code=status_code, detail=sanitized)


class TunnelNameUnavailable(InkboxAPIError):
    """409 from :meth:`TunnelsResource.create` when the name is taken or reserved."""


class TunnelTLSModeMismatch(InkboxAPIError):
    """409 from :meth:`TunnelsResource.sign_csr` against an edge tunnel.

    CSR signing is only meaningful on passthrough tunnels.
    """


class TunnelCSRStateConflict(TunnelStateConflict):
    """409 from :meth:`TunnelsResource.sign_csr` against a tunnel in the wrong status."""


class TunnelSecretUnavailable(TunnelError):
    """The local ``connect_secret`` could not be located.

    Raised by :func:`inkbox.tunnels.connect` when the tunnel exists but no
    secret is in the state file or passed via ``secret=``. The hash on the
    server is one-way; recover by calling
    :meth:`TunnelsResource.rotate_secret` and retrying.
    """


class TunnelRemoved(TunnelError):
    """The on-disk state file references a tunnel that has been finalized.

    The server returned 404 for the stored ``tunnel_id``. The name may now
    belong to a different organization. Clear the state directory and call
    :meth:`TunnelsResource.create` to start fresh.
    """


def _sanitize_detail(detail: str | dict[str, Any]) -> str | dict[str, Any]:
    """Normalize lifecycle strings in server-side ``detail`` to the public labels."""
    # Wire values that need rewriting to their public equivalents.
    _rewrites = (
        ("delete_pending", "pending_removal"),
        ("deleted", "removed"),
    )
    if isinstance(detail, str):
        out_str = detail
        for old, new in _rewrites:
            out_str = out_str.replace(old, new)
        return out_str
    if isinstance(detail, dict):
        out: dict[str, Any] = {}
        for k, v in detail.items():
            if isinstance(v, str):
                rewritten = v
                for old, new in _rewrites:
                    rewritten = rewritten.replace(old, new)
                out[k] = rewritten
            else:
                out[k] = v
        return out
    return detail
