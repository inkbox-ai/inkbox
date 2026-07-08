"""
inkbox/tunnels/exceptions.py

Typed exceptions for the Tunnels SDK surface.
"""

from __future__ import annotations

from inkbox.exceptions import InkboxAPIError, InkboxError


class TunnelError(InkboxError):
    """Base for all tunnel-related SDK errors that aren't wire errors."""


class TunnelNameInvalid(TunnelError):
    """Local validation: ``tunnel_name`` failed the SDK's regex/length/reserved check.

    Fast-fail before the request is sent — distinct from
    :class:`inkbox.identities.exceptions.HandleUnavailableError`, which
    surfaces the server-side 409 when the unified handle namespace
    rejects the name at create / rename time.
    """


class TunnelStateConflict(InkboxAPIError):
    """409 from tunnel operations against a tunnel in an incompatible status."""


class TunnelTLSModeMismatch(InkboxAPIError):
    """409 from :meth:`TunnelsResource.sign_csr` against an edge tunnel.

    CSR signing is only meaningful on passthrough tunnels.
    """


class TunnelCSRStateConflict(TunnelStateConflict):
    """409 from :meth:`TunnelsResource.sign_csr` against a tunnel in the wrong status."""


class TunnelRemoved(TunnelError):
    """The on-disk state file references a tunnel that has been finalized.

    The server returned 404 for the stored ``tunnel_id``. The name may now
    belong to a different organization (or its prior identity is gone).
    Clear the state directory and call ``inkbox.create_identity(...)``
    to start fresh.
    """


class TunnelNotProvisioned(TunnelError):
    """Raised by :func:`connect` when no tunnel exists for the supplied
    name in the calling org. Tunnels are provisioned atomically as part
    of ``inkbox.create_identity(...)``."""


class TunnelSupersededError(TunnelError):
    """Another client connected to the same tunnel and took over.

    Raised out of ``serve()`` / ``wait()`` when a newer client displaces this
    one. Terminal by design: the client stops and does not reconnect. Run one
    client per tunnel; use separate identities for redundancy. Catch this to
    react to the takeover (alert, exit, fail over to another identity).
    """
