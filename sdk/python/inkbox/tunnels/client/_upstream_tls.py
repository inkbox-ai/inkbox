"""
inkbox/tunnels/client/_upstream_tls.py

TLS context construction for outbound upstream connections.

When ``forward_to`` is an ``https://`` URL, ``UpstreamUrlDispatch`` needs
an SSL context that respects two user-supplied knobs:

* ``forward_to_verify_tls`` — when ``False``, accept any cert. Used for
  local dev with self-signed certs on ``https://localhost``.
* ``forward_to_ca_bundle`` — extra CA bundle (PEM, as bytes or a path)
  to trust. Used for corporate dev environments with private CAs.

The two are mutually exclusive in practice — passing a CA bundle while
disabling verification is meaningless.
"""

from __future__ import annotations

import ssl


def build_upstream_tls_context(
    *,
    verify: bool = True,
    ca_bundle: bytes | str | None = None,
) -> ssl.SSLContext | bool:
    """Return an ``SSLContext`` for the upstream connection, or ``True``.

    ``True`` triggers httpx's default-context path (system CAs, hostname
    verification on); we use it when no overrides were supplied so we
    don't pin a snapshot of the system trust store.

    When ``verify=False``, returns a context with hostname verification
    and certificate verification both disabled.

    When ``ca_bundle`` is supplied, returns a context that trusts the
    given PEM in addition to the system trust store.
    """
    if not verify:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    if ca_bundle is not None:
        ctx = ssl.create_default_context()
        if isinstance(ca_bundle, (bytes, bytearray)):
            ctx.load_verify_locations(cadata=ca_bundle.decode("ascii"))
        else:
            ctx.load_verify_locations(cafile=str(ca_bundle))
        return ctx
    return True
